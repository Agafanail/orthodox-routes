import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Only the parent's exact local synthetic account/container is used. No provider is called.
export async function verifyPhoneDeliveryDeadlines({ container, runSql, rpc, client, admin, accountId, otherAccountId }) {
  const sql = (statement) => runSql(container, statement);
  const created = [];
  const trigger = `verify_phone_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const start = async () => {
    sql(`update ops.phone_verification_attempt set requested_at = requested_at - interval '2 minutes' where account_id = '${accountId}';`);
    const result = await rpc(client, 'request_phone_change', { p_phone_e164: '+390000000191', p_client_key: randomUUID() });
    assert.equal(result.status, 'queued'); created.push(result.attempt_id); return result.attempt_id;
  };
  const claim = async (id, lease = randomUUID()) => {
    const job = await rpc(admin, 'phone_worker_claim_delivery_v3', { p_attempt_id: id, p_lease_token: lease });
    if (job) {
      assert.equal(job.attempt_id, id); assert.equal(job.sms_template_version, 2);
      const duration = Date.parse(job.lease_until) - Date.parse(job.evaluated_at);
      assert.ok(duration > 0 && duration <= 300000); assert.ok(Date.parse(job.lease_until) <= Date.parse(job.expires_at));
    }
    return { job, lease };
  };
  const complete = (id, lease) => rpc(admin, 'phone_worker_complete_delivery', {
    p_attempt_id: id, p_lease_token: lease, p_delivered: true,
    p_provider_adapter: 'local-deadline-test', p_provider_reference: 'synthetic-provider-reference',
  });
  const digest = (id) => sql(`select md5(to_jsonb(attempt)::text || coalesce(to_jsonb(material)::text, 'null'))
    from ops.phone_verification_attempt as attempt left join ops.phone_verification_delivery as material on material.attempt_id = attempt.id
    where attempt.id = '${id}';`);
  const asyncSql = (statement) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.resume();
    child.on('error', reject); child.on('close', (code) => resolve({ code, output })); child.stdin.end(statement);
  });
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (sql(`select (${condition})::text;`) === 'true') return;
      await delay(50);
    }
    throw new Error('Synthetic phone deadline barrier was not observed.');
  };
  try {
    const first = await start();
    const contenders = await Promise.all([claim(first), claim(first)]);
    assert.equal(contenders.filter((item) => item.job).length, 1);
    const winner = contenders.find((item) => item.job);
    const before = digest(first);
    assert.equal(await complete(first, randomUUID()), false); assert.equal(digest(first), before);
    assert.ok((await admin.schema('api').rpc('phone_worker_complete_delivery', {
      p_attempt_id: first, p_lease_token: winner.lease, p_delivered: null,
      p_provider_adapter: 'local-deadline-test', p_provider_reference: null,
    })).error); assert.equal(digest(first), before);
    sql(`create function private.${trigger}() returns trigger language plpgsql set search_path = '' as $failure$
      begin raise exception 'Synthetic phone delivery failure.'; end; $failure$;
      revoke all on function private.${trigger}() from public, anon, authenticated, service_role;
      create trigger ${trigger} before delete on ops.phone_verification_delivery for each row
        when (old.attempt_id = '${first}'::uuid) execute function private.${trigger}();`);
    try {
      assert.ok((await admin.schema('api').rpc('phone_worker_complete_delivery', {
        p_attempt_id: first, p_lease_token: winner.lease, p_delivered: true,
        p_provider_adapter: 'local-deadline-test', p_provider_reference: null,
      })).error); assert.equal(digest(first), before);
    } finally { sql(`drop trigger if exists ${trigger} on ops.phone_verification_delivery; drop function if exists private.${trigger}();`); }
    assert.equal(await complete(first, winner.lease), true);

    for (const target of ['delivery', 'attempt']) {
      const id = await start(), current = await claim(id);
      sql(`update ops.phone_verification_delivery set lease_until = clock_timestamp() + interval '3 seconds' where attempt_id = '${id}';`);
      const expected = digest(id), name = `phone-deadline-${randomUUID()}`;
      const row = target === 'delivery' ? `select attempt_id from ops.phone_verification_delivery where attempt_id = '${id}'`
        : `select id from ops.phone_verification_attempt where id = '${id}'`;
      const gate = asyncSql(`set application_name = '${name}'; begin; ${row} for update; select pg_sleep(4); commit;`);
      let waiter;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}' and wait_event = 'PgSleep')`);
        waiter = asyncSql(`set application_name = '${name}-wait'; set role service_role;
          select 'RESULT:' || api.phone_worker_complete_delivery('${id}', '${current.lease}', true, 'local-deadline-test', null)::text;`);
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}-wait' and wait_event_type = 'Lock')`);
        const result = await waiter; assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:false'));
        assert.equal(digest(id), expected);
      } finally { await Promise.all([gate, waiter].filter(Boolean)); }
      const reclaimed = await claim(id);
      const payload = (job) => Object.fromEntries(Object.entries(job).filter(([key]) => !['lease_until', 'evaluated_at'].includes(key)));
      assert.deepEqual(payload(reclaimed.job), payload(current.job), 'Reclaim changes timing only.');
      assert.equal(await complete(id, current.lease), false); assert.equal(await complete(id, reclaimed.lease), true);
    }

    // Real attempt-row wait crosses code expiry, not merely an artificially stale client clock.
    for (const action of ['claim', 'complete']) {
      const id = await start(); const current = action === 'complete' ? await claim(id) : null;
      sql(`update ops.phone_verification_attempt set expires_at = clock_timestamp() + interval '3 seconds' where id = '${id}';`);
      const name = `phone-expiry-${randomUUID()}`;
      const gate = asyncSql(`set application_name = '${name}'; begin;
        select id from ops.phone_verification_attempt where id = '${id}' for update; select pg_sleep(4); commit;`);
      let waiter;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}' and wait_event = 'PgSleep')`);
        const expression = action === 'claim' ? `coalesce(api.phone_worker_claim_delivery_v3('${id}', '${randomUUID()}')::text, 'null')`
          : `api.phone_worker_complete_delivery('${id}', '${current.lease}', true, 'local-deadline-test', null)::text`;
        waiter = asyncSql(`set application_name = '${name}-wait'; set role service_role; select 'RESULT:' || ${expression};`);
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}-wait' and wait_event_type = 'Lock')`);
        const result = await waiter; assert.equal(result.code, 0);
        assert.ok(result.output.includes(action === 'claim' ? 'RESULT:null' : 'RESULT:false'));
        assert.equal(sql(`select state || ':' || (code_salt is null and code_digest is null)::text || ':' ||
          (not exists (select 1 from ops.phone_verification_delivery where attempt_id = '${id}'))::text
          from ops.phone_verification_attempt where id = '${id}';`), 'expired:true:true');
      } finally { await Promise.all([gate, waiter].filter(Boolean)); }
    }
    // Actual authenticated verification must expire after contact/attempt row waits and
    // roll back a tentative binding after waiting for the unique verified-phone index.
    for (const target of ['contact', 'attempt', 'phone-index']) {
      const id = await start(), current = await claim(id);
      assert.equal(await complete(id, current.lease), true);
      const contactBefore = sql(`select md5(to_jsonb(contact)::text) from private.account_contact as contact where account_id = '${accountId}';`);
      sql(`update ops.phone_verification_attempt set expires_at = clock_timestamp() + interval '3 seconds' where id = '${id}';`);
      const name = `phone-code-expiry-${randomUUID()}`;
      const lock = target === 'phone-index'
        ? `update private.account_contact set phone_e164 = '+390000000191', phone_verified_at = clock_timestamp() where account_id = '${otherAccountId}';`
        : target === 'contact' ? `select account_id from private.account_contact where account_id = '${accountId}' for update;`
          : `select id from ops.phone_verification_attempt where id = '${id}' for update;`;
      const gate = asyncSql(`set application_name = '${name}'; begin; ${lock} select pg_sleep(4); rollback;`);
      let waiter;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}' and wait_event = 'PgSleep')`);
        waiter = asyncSql(`set application_name = '${name}-wait'; set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${accountId}","role":"authenticated"}', false);
          select 'RESULT:' || (api.verify_phone_code('${id}', '${current.job.verification_code}')->>'status');`);
        await wait(`exists (select 1 from pg_stat_activity where application_name = '${name}-wait' and wait_event_type = 'Lock')`);
        const result = await waiter; assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:expired'));
        assert.equal(sql(`select md5(to_jsonb(contact)::text) from private.account_contact as contact where account_id = '${accountId}';`), contactBefore);
        assert.equal(sql(`select state || ':' || (code_salt is null and code_digest is null)::text
          from ops.phone_verification_attempt where id = '${id}';`), 'expired:true');
        assert.equal(sql(`select count(*) from ops.audit_event where event_key = 'phone-binding:${id}';`), '0');
      } finally { await Promise.all([gate, waiter].filter(Boolean)); }
    }
    const clampedId = await start();
    sql(`update ops.phone_verification_attempt set expires_at = clock_timestamp() + interval '30 seconds' where id = '${clampedId}';`);
    const clamped = await claim(clampedId); assert.equal(clamped.job.lease_until, clamped.job.expires_at);
    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', routine.oid, 'definition', md5(pg_get_functiondef(routine.oid)),
      'acl', routine.proacl::text) order by routine.oid) from pg_proc as routine where routine.oid in (
      'ops.claim_phone_verification_delivery_target(uuid,uuid)'::regprocedure,
      'ops.claim_phone_verification_deliveries(uuid,integer)'::regprocedure,
      'ops.complete_phone_verification_delivery(uuid,uuid,boolean,text,text)'::regprocedure,
      'api.phone_worker_claim_delivery_v3(uuid,uuid)'::regprocedure,
      'api.verify_phone_code(uuid,text)'::regprocedure);`);
    const expectedDefinitions = definitions(), expectedRows = digest(clampedId);
    sql(readFileSync(new URL('../supabase/migrations/20261020110000_phone_delivery_deadlines.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), expectedDefinitions); assert.equal(digest(clampedId), expectedRows);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}', 'api.phone_worker_claim_delivery_v3(uuid,uuid)', 'EXECUTE')::text;`),
        role === 'service_role' ? 'true' : 'false');
      assert.equal(sql(`select has_function_privilege('${role}', 'ops.claim_phone_verification_delivery_target(uuid,uuid)', 'EXECUTE')::text;`), 'false');
    }
    process.stdout.write('Phone deadlines verified: relative/clamped timing, concurrent claims, rollback, lease/code row waits, authenticated contact/attempt/index expiry, and replay/grants.\n');
  } finally {
    sql(`drop trigger if exists ${trigger} on ops.phone_verification_delivery; drop function if exists private.${trigger}();
      delete from ops.phone_verification_attempt where account_id = '${accountId}' and id = any(array[${created.map((id) => `'${id}'`).join(',')}]::uuid[]);`);
  }
}
