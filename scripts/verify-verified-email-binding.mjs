import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Exact local synthetic identity/source mutations, not a real email-change or recovery flow.
export async function verifyVerifiedEmailBinding({ admin, actor, accountId, originalEmail, container, rpc, sql, literal }) {
  const changedEmail = `binding-${randomUUID()}@example.test`, notifications = [];
  const identityEmail = async (email) => {
    const result = await admin.auth.admin.updateUserById(accountId, { email, email_confirm: true });
    assert.equal(result.error, null);
  };
  const create = () => {
    const id = sql(`select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received',
      'ride_response', gen_random_uuid(), '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
    notifications.push(id); return id;
  };
  const privateSource = () => sql(`select md5(to_jsonb(contact)::text || to_jsonb(preference)::text)
    from private.account_contact as contact join private.notification_preference as preference on preference.account_id = contact.account_id
    where contact.account_id = ${literal(accountId)}::uuid;`);
  const expectedPrivate = privateSource();
  const notification = create();
  const ids = JSON.parse(sql(`select jsonb_build_object('job', job.id, 'delivery', delivery.id, 'public_delivery', delivery.public_id)
    from app.notification as notification join app.notification_delivery as delivery on delivery.notification_id = notification.id
    join app.outbox_job as job on job.payload_reference = delivery.id
    where notification.public_id = ${literal(notification)}::uuid and delivery.channel = 'email';`));
  const claim = (lease = randomUUID()) => rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['email'] });
  const queued = () => sql(`select md5(to_jsonb(job)::text || to_jsonb(delivery)::text || to_jsonb(destination)::text)
    from app.outbox_job as job join app.notification_delivery as delivery on delivery.id = job.payload_reference
    join private.notification_destination as destination on destination.delivery_id = delivery.id where job.id = ${literal(ids.job)}::uuid;`);
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
    throw new Error('Synthetic email-binding barrier was not observed.');
  };
  try {
    assert.equal((await rpc(actor, 'current_eligibility')).eligible, true);
    const before = queued();
    await identityEmail(changedEmail);
    const eligibility = await rpc(actor, 'current_eligibility');
    assert.equal(eligibility.email_verified, false); assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.includes('email_not_verified'));
    assert.equal((await rpc(actor, 'current_notification_preferences')).has_effective_external_channel, false);
    assert.equal(privateSource(), expectedPrivate);
    for (const name of ['notification_worker_claim_jobs', 'notification_worker_claim_jobs_v2']) {
      assert.deepEqual(await rpc(admin, name, { p_lease_token: randomUUID(), p_limit: 1,
        ...(name.endsWith('_v2') ? { p_channels: ['email'] } : {}) }), []);
    }
    assert.equal(await claim(), null); assert.equal(queued(), before);
    const pending = create();
    assert.equal(sql(`select count(*) from app.notification_delivery as delivery join app.notification as notification
      on notification.id = delivery.notification_id where notification.public_id = ${literal(pending)}::uuid and delivery.channel = 'email';`), '0');
    assert.equal(privateSource(), expectedPrivate);
    await identityEmail(originalEmail);
    assert.equal((await rpc(actor, 'current_eligibility')).eligible, true);
    assert.equal((await rpc(actor, 'current_notification_preferences')).has_effective_external_channel, true);
    // Matching Auth/contact alone cannot authorize an old queued destination snapshot.
    sql(`update private.notification_destination set destination_value = 'stale-binding@example.test' where delivery_id = ${literal(ids.delivery)}::uuid;`);
    const stale = queued(); assert.equal(await claim(), null); assert.equal(queued(), stale);
    sql(`update private.notification_destination set destination_value = ${literal(originalEmail)} where delivery_id = ${literal(ids.delivery)}::uuid;`);
    // A changed Auth source commits while the helper waits for delivery. The v3 post-lock
    // source re-read must return no destination, even though the original candidate was valid.
    const name = `email-binding-${randomUUID()}`;
    const gate = asyncSql(`set application_name = ${literal(name)}; begin;
      select id from app.notification_delivery where id = ${literal(ids.delivery)}::uuid for update;
      select pg_sleep(4); update auth.users set email = ${literal(changedEmail)}, email_confirmed_at = clock_timestamp()
      where id = ${literal(accountId)}::uuid; commit;`);
    let waiter;
    try {
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and wait_event = 'PgSleep')`);
      waiter = asyncSql(`set application_name = ${literal(`${name}-wait`)}; set role service_role;
        select 'RESULT:' || coalesce(api.notification_worker_claim_job_v3(${literal(randomUUID())}::uuid, array['email']::text[])::text, 'null');`);
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-wait`)} and wait_event_type = 'Lock')`);
      const result = await waiter; assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:null'));
      assert.equal(privateSource(), expectedPrivate);
    } finally { await Promise.all([gate, waiter].filter(Boolean)); }
    await identityEmail(originalEmail);
    sql(`update app.outbox_job set lock_deadline = clock_timestamp() - interval '1 second' where id = ${literal(ids.job)}::uuid;`);
    const lease = randomUUID(), restored = await claim(lease);
    assert.ok(restored); assert.equal(restored.destination_value, originalEmail); assert.equal(restored.delivery_id, ids.public_delivery);
    assert.equal(await rpc(admin, 'notification_worker_complete_job', { p_job_id: restored.job_id, p_lease_token: lease,
      p_outcome: 'sent', p_provider_adapter: 'resend-email-v1', p_provider_code: 'http_200', p_provider_reference: randomUUID(),
      p_safe_failure_class: null }), true);
    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', routine.oid, 'definition', md5(pg_get_functiondef(routine.oid)),
      'acl', routine.proacl::text) order by routine.oid) from pg_proc as routine where routine.oid in (
      'app.current_email_is_verified(uuid)'::regprocedure, 'app.notification_email_destination_is_current(uuid)'::regprocedure,
      'app.current_eligibility_result(uuid)'::regprocedure, 'app.has_effective_external_channel(uuid,boolean,boolean,uuid)'::regprocedure,
      'app.create_notification(uuid,text,text,uuid,text,text,jsonb,integer)'::regprocedure,
      'ops.claim_notification_jobs(uuid,integer)'::regprocedure, 'ops.claim_notification_jobs_v2(uuid,integer,text[])'::regprocedure,
      'api.notification_worker_claim_job_v3(uuid,text[])'::regprocedure);`);
    const expectedDefinitions = definitions();
    sql(readFileSync(new URL('../supabase/migrations/20261020130000_verified_email_binding.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), expectedDefinitions); assert.equal(privateSource(), expectedPrivate);
    for (const role of ['anon', 'authenticated', 'service_role']) for (const fn of ['current_email_is_verified', 'notification_email_destination_is_current']) {
      assert.equal(sql(`select has_function_privilege('${role}', 'app.${fn}(uuid)', 'EXECUTE')::text;`), 'false');
    }
    process.stdout.write('Verified email binding: stale identity/contact/destination refusal, real post-lock source change, unchanged private state, restoration, and replay/grants.\n');
  } finally {
    await identityEmail(originalEmail);
    sql(`delete from app.outbox_job where id = ${literal(ids.job)}::uuid;
      delete from app.notification where public_id = any(array[${notifications.map((id) => literal(id)).join(',')}]::uuid[]);`);
  }
}
