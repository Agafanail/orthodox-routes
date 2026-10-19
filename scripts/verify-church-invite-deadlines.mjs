import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyChurchInviteDeadlines({ admin, sender, churchId, container, rpc, sql, literal }) {
  const invite = await rpc(sender, 'invite_church_admin', { p_church_id: churchId,
    p_email: `invite-deadlines-${randomUUID()}@example.test`, p_transfer_own_place: false, p_client_key: randomUUID() });
  const id = sql(`select id from app.church_admin_invite where public_id = ${literal(invite.invite_id)}::uuid;`);
  const mailTable = 'private.church_invite_mail';
  const mailCondition = `invite_id = ${literal(id)}::uuid`;
  const mail = `${mailTable} where ${mailCondition}`;
  const source = () => sql(`select md5(to_jsonb(mail)::text) from private.church_invite_mail as mail where invite_id = ${literal(id)}::uuid;`);
  const trigger = `verify_invite_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const asyncSql = (statement) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.resume();
    child.on('error', reject); child.on('close', (code) => resolve({ code, output })); child.stdin.end(statement);
  });
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (sql(`select (${condition})::text;`) === 'true') return;
      await delay(50);
    }
    throw new Error('Synthetic invitation deadline barrier was not observed.');
  };
  const reset = (seconds = 600) => sql(`with timing as (select clock_timestamp() + make_interval(secs => ${seconds}) as deadline)
    update app.church_admin_invite set issued_at = timing.deadline - interval '7 days', expires_at = timing.deadline,
      last_sent_at = timing.deadline - interval '7 days' from timing where id = ${literal(id)}::uuid;
    update ${mailTable} set state = 'queued', attempt_count = 0, lease_token = null, lease_until = null,
      next_attempt_at = '2000-01-01T00:00:00Z' where ${mailCondition};`);
  const claim = async () => {
    const lease = randomUUID();
    const jobs = await rpc(admin, 'church_invite_worker_claim', { p_lease_token: lease, p_limit: 1 });
    assert.equal(jobs.length, 1); assert.equal(jobs[0].invite_id, invite.invite_id);
    const job = jobs[0], duration = Date.parse(job.lease_until) - Date.parse(job.evaluated_at);
    assert.ok(duration > 0 && duration <= 120000);
    assert.ok(Date.parse(job.lease_until) <= Date.parse(job.expires_at));
    return { job, lease };
  };
  const complete = ({ job, lease }) => ({ p_job_id: job.job_id, p_lease_token: lease,
    p_outcome: 'sent', p_provider_reference: randomUUID() });
  try {
    reset(); const initial = await claim(); const before = source();
    assert.equal(await rpc(admin, 'church_invite_worker_complete', { ...complete(initial), p_lease_token: randomUUID() }), false);
    assert.equal(source(), before);
    for (const invalid of [{ p_outcome: null }, { p_provider_reference: 'private@example.test' }]) {
      assert.ok((await admin.schema('api').rpc('church_invite_worker_complete', { ...complete(initial), ...invalid })).error);
      assert.equal(source(), before);
    }
    sql(`create function private.${trigger}() returns trigger language plpgsql set search_path = '' as $failure$
      begin raise exception 'Synthetic invitation completion failure.'; end; $failure$;
      revoke all on function private.${trigger}() from public, anon, authenticated, service_role;
      create trigger ${trigger} before update on private.church_invite_mail for each row
        when (old.invite_id = ${literal(id)}::uuid) execute function private.${trigger}();`);
    try {
      assert.ok((await admin.schema('api').rpc('church_invite_worker_complete', complete(initial))).error);
      assert.equal(source(), before);
    } finally { sql(`drop trigger if exists ${trigger} on private.church_invite_mail; drop function if exists private.${trigger}();`); }
    assert.equal(await rpc(admin, 'church_invite_worker_complete', complete(initial)), true);

    for (const target of ['mail', 'invitation']) {
      reset(target === 'invitation' ? 3 : 600);
      const current = await claim();
      if (target === 'mail') sql(`update ${mailTable} set lease_until = clock_timestamp() + interval '3 seconds' where ${mailCondition};`);
      const name = `invite-deadline-${randomUUID()}`;
      const row = target === 'mail' ? `select invite_id from ${mail}`
        : `select id from app.church_admin_invite where id = ${literal(id)}::uuid`;
      const gate = asyncSql(`set application_name = ${literal(name)}; begin; ${row} for update; select pg_sleep(4); commit;`);
      let waiter;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and wait_event = 'PgSleep')`);
        waiter = asyncSql(`set application_name = ${literal(`${name}-wait`)}; set role service_role;
          select 'RESULT:' || api.church_invite_worker_complete(${literal(current.job.job_id)}::uuid,
            ${literal(current.lease)}::uuid, 'sent', ${literal(randomUUID())})::text;`);
        await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-wait`)} and wait_event_type = 'Lock')`);
        const result = await waiter;
        assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:false'));
        assert.equal(sql(`select state from ${mail};`), 'claimed');
      } finally { await Promise.all([gate, waiter].filter(Boolean)); }
    }

    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', oid::text, 'definition', md5(pg_get_functiondef(oid)),
      'acl', proacl::text) order by oid) from pg_proc where oid in (
        'api.church_invite_worker_claim(uuid,integer)'::regprocedure,
        'api.church_invite_worker_complete(uuid,uuid,text,text)'::regprocedure);`);
    const expected = definitions();
    sql(readFileSync(new URL('../supabase/migrations/20261019140000_church_invite_delivery_deadlines.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), expected);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(sql(`select has_function_privilege('${role}', 'api.church_invite_worker_claim(uuid,integer)', 'EXECUTE')::text
        || ':' || has_function_privilege('${role}', 'api.church_invite_worker_complete(uuid,uuid,text,text)', 'EXECUTE')::text;`), 'false:false');
    }
    assert.equal(sql(`select count(*) from pg_proc where oid in ('api.church_invite_worker_claim(uuid,integer)'::regprocedure,
      'api.church_invite_worker_complete(uuid,uuid,text,text)'::regprocedure)
      and prosecdef and proconfig @> array['search_path=""', 'lock_timeout=5s']::text[];`), '2');
    process.stdout.write('Church invitation delivery deadlines verified: clamped timing, late-failure rollback, real mail/invitation row-wait expiry, and replay/grants.\n');
  } finally {
    sql(`drop trigger if exists ${trigger} on private.church_invite_mail; drop function if exists private.${trigger}();`);
    await rpc(sender, 'cancel_church_admin_invite', { p_invite_id: invite.invite_id });
  }
}
