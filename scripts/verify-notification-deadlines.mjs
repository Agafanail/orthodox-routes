import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyNotificationDeadlines({ admin, actor, accountId, container, rpc, sql, literal }) {
  const notification = sql(`select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received',
    'ride_response', gen_random_uuid(), '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
  const ids = JSON.parse(sql(`select jsonb_build_object('job', job.id, 'delivery', delivery.id, 'delivery_public', delivery.public_id)
    from app.notification as notification join app.notification_delivery as delivery on delivery.notification_id = notification.id
    join app.outbox_job as job on job.payload_reference = delivery.id
    where notification.public_id = ${literal(notification)}::uuid and delivery.channel = 'email';`));
  const source = () => sql(`select md5(to_jsonb(job)::text || to_jsonb(delivery)::text)
    from app.outbox_job as job join app.notification_delivery as delivery on delivery.id = job.payload_reference
    where job.id = ${literal(ids.job)}::uuid;`);
  const trigger = `verify_notify_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const optionalUuid = (value) => value ? `${literal(value)}::uuid` : 'null::uuid';
  let pushId, pushNotification, pushDelivery;
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
    throw new Error('Synthetic notification deadline barrier was not observed.');
  };
  const reset = () => sql(`update app.outbox_job set state = 'queued', attempt_count = 0, lock_owner = null,
      lock_deadline = null, completed_at = null, available_at = '2000-01-01T00:00:00Z'
      where id = ${literal(ids.job)}::uuid;
    update app.notification_delivery set state = 'queued', provider_adapter = null, provider_code = null,
      provider_reference = null, safe_failure_class = null, sent_at = null where id = ${literal(ids.delivery)}::uuid;`);
  const claim = async () => {
    const lease = randomUUID();
    const job = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['email'] });
    assert.ok(job); assert.equal(job.channel, 'email'); assert.equal(job.notification_id, notification);
    const duration = Date.parse(job.lease_until) - Date.parse(job.evaluated_at);
    assert.ok(duration > 0 && duration <= 60000);
    return { job, lease };
  };
  const complete = ({ job, lease }) => ({ p_job_id: job.job_id, p_lease_token: lease, p_outcome: 'sent',
    p_provider_adapter: 'resend-email-v1', p_provider_code: 'http_200', p_provider_reference: randomUUID(), p_safe_failure_class: null });
  try {
    reset(); const initial = await claim(); const before = source();
    assert.equal(await rpc(admin, 'notification_worker_complete_job', { ...complete(initial), p_lease_token: randomUUID() }), false);
    assert.ok((await admin.schema('api').rpc('notification_worker_complete_job', { ...complete(initial), p_outcome: null })).error);
    assert.equal(source(), before);
    sql(`create function private.${trigger}() returns trigger language plpgsql set search_path = '' as $failure$
      begin raise exception 'Synthetic notification completion failure.'; end; $failure$;
      revoke all on function private.${trigger}() from public, anon, authenticated, service_role;
      create trigger ${trigger} before update on app.notification_delivery for each row
        when (old.id = ${literal(ids.delivery)}::uuid) execute function private.${trigger}();`);
    try {
      assert.ok((await admin.schema('api').rpc('notification_worker_complete_job', complete(initial))).error);
      assert.equal(source(), before);
    } finally { sql(`drop trigger if exists ${trigger} on app.notification_delivery; drop function if exists private.${trigger}();`); }
    assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(initial)), true);

    reset(); const competingLeases = [randomUUID(), randomUUID()];
    const competing = await Promise.all(competingLeases.map((lease) => rpc(admin, 'notification_worker_claim_job_v3', {
      p_lease_token: lease, p_channels: ['email'],
    })));
    assert.equal(competing.filter(Boolean).length, 1);
    const winning = competing.findIndex(Boolean);
    assert.equal(await rpc(admin, 'notification_worker_complete_job', complete({ job: competing[winning], lease: competingLeases[winning] })), true);

    for (const target of ['outbox', 'delivery']) {
      reset(); const current = await claim();
      sql(`update app.outbox_job set lock_deadline = clock_timestamp() + interval '3 seconds' where id = ${literal(ids.job)}::uuid;`);
      const expected = source(); const name = `notify-deadline-${randomUUID()}`;
      const row = target === 'outbox' ? `select id from app.outbox_job where id = ${literal(ids.job)}::uuid`
        : `select id from app.notification_delivery where id = ${literal(ids.delivery)}::uuid`;
      const gate = asyncSql(`set application_name = ${literal(name)}; begin; ${row} for update; select pg_sleep(4); commit;`);
      let waiter;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and wait_event = 'PgSleep')`);
        waiter = asyncSql(`set application_name = ${literal(`${name}-wait`)}; set role service_role;
          select 'RESULT:' || api.notification_worker_complete_job(${literal(current.job.job_id)}::uuid,
            ${literal(current.lease)}::uuid, 'sent', 'resend-email-v1', 'http_200', ${literal(randomUUID())}, null)::text;`);
        await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-wait`)} and wait_event_type = 'Lock')`);
        const result = await waiter; assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:false'));
        assert.equal(source(), expected);
      } finally { await Promise.all([gate, waiter].filter(Boolean)); }
      const reclaimed = await claim(); assert.equal(reclaimed.job.job_id, current.job.job_id);
      assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(current)), false);
      assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(reclaimed)), true);
    }
    reset(); sql(`update app.outbox_job set attempt_count = 4 where id = ${literal(ids.job)}::uuid;`);
    const fifth = await claim(); assert.equal(fifth.job.attempt_count, 5);
    assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(fifth)), true);
    reset(); sql(`update app.outbox_job set attempt_count = 4 where id = ${literal(ids.job)}::uuid;`);
    const abandoned = await claim();
    sql(`update app.outbox_job set lock_deadline = clock_timestamp() - interval '1 second' where id = ${literal(ids.job)}::uuid;`);
    const empty = () => rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: randomUUID(), p_channels: ['email'] });
    assert.deepEqual(await Promise.all([empty(), empty()]), [null, null]);
    assert.equal(sql(`select state || ':' || attempt_count::text from app.outbox_job where id = ${literal(ids.job)}::uuid;`), 'dead:5');
    assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(abandoned)), false);
    assert.equal(await empty(), null);
    assert.equal(sql(`select count(*) from ops.operational_alert where safe_reference = ${literal(ids.delivery_public)}::uuid;`), '1');
    // Legacy APIs cannot overflow the structural counter after repeated old-worker crashes.
    reset(); sql(`update app.outbox_job set attempt_count = 20 where id = ${literal(ids.job)}::uuid;`);
    for (const name of ['notification_worker_claim_jobs', 'notification_worker_claim_jobs_v2']) {
      assert.deepEqual(await rpc(admin, name, { p_lease_token: randomUUID(), p_limit: 1,
        ...(name.endsWith('_v2') ? { p_channels: ['email'] } : {}) }), []);
    }
    assert.equal(await empty(), null);
    for (const terminal of ['delivered', 'permanent_failure', 'suppressed']) {
      reset(); const current = await claim();
      sql(`update app.notification_delivery set state = ${literal(terminal)}, provider_event_at = clock_timestamp()
        where id = ${literal(ids.delivery)}::uuid;`);
      const deliveryBefore = sql(`select md5(to_jsonb(delivery)::text) from app.notification_delivery as delivery where id = ${literal(ids.delivery)}::uuid;`);
      assert.equal(await rpc(admin, 'notification_worker_complete_job', complete(current)), false);
      sql(`update app.outbox_job set lock_deadline = clock_timestamp() - interval '1 second' where id = ${literal(ids.job)}::uuid;`);
      assert.equal(await empty(), null);
      assert.equal(sql(`select md5(to_jsonb(delivery)::text) from app.notification_delivery as delivery where id = ${literal(ids.delivery)}::uuid;`), deliveryBefore);
      assert.equal(sql(`select state from app.outbox_job where id = ${literal(ids.job)}::uuid;`),
        terminal === 'delivered' ? 'sent' : terminal === 'suppressed' ? 'suppressed' : 'dead');
    }
    // A terminal result committed while claim waits on its delivery row must survive the
    // UPDATE predicate recheck; the claimant gets no destination to dispatch.
    reset(); const terminalGateName = `notify-terminal-${randomUUID()}`;
    const terminalGate = asyncSql(`set application_name = ${literal(terminalGateName)}; begin;
      select id from app.notification_delivery where id = ${literal(ids.delivery)}::uuid for update;
      select pg_sleep(4); update app.notification_delivery set state = 'delivered', provider_event_at = clock_timestamp()
      where id = ${literal(ids.delivery)}::uuid; commit;`);
    let terminalWaiter;
    try {
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(terminalGateName)} and wait_event = 'PgSleep')`);
      terminalWaiter = asyncSql(`set application_name = ${literal(`${terminalGateName}-wait`)}; set role service_role;
        select 'RESULT:' || coalesce(api.notification_worker_claim_job_v3(${literal(randomUUID())}::uuid, array['email']::text[])::text, 'null');`);
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${terminalGateName}-wait`)} and wait_event_type = 'Lock')`);
      const result = await terminalWaiter; assert.equal(result.code, 0); assert.ok(result.output.includes('RESULT:null'));
      assert.equal(sql(`select state from app.notification_delivery where id = ${literal(ids.delivery)}::uuid;`), 'delivered');
    } finally { await Promise.all([terminalGate, terminalWaiter].filter(Boolean)); }
    sql(`update app.outbox_job set lock_deadline = clock_timestamp() - interval '1 second' where id = ${literal(ids.job)}::uuid;`);
    assert.equal(await empty(), null);
    assert.equal(sql(`select state from app.outbox_job where id = ${literal(ids.job)}::uuid;`), 'sent');
    // A real authenticated opt-in creates a linked push delivery; uncertain exhaustion alone
    // must not invalidate that subscription or change the account's saved preferences.
    const subscription = await rpc(actor, 'upsert_push_subscription', { p_endpoint: `https://push.example.test/deadlines/${randomUUID()}`,
      p_p256dh_key: 'A'.repeat(43), p_auth_key: 'B'.repeat(22), p_vapid_key_version: 1,
      p_device_label: 'Synthetic deadline device', p_client_key: randomUUID() });
    pushId = subscription.subscription_id;
    await rpc(actor, 'update_notification_preference', { p_client_key: randomUUID(), p_ride_email_enabled: false, p_web_push_enabled: true });
    pushNotification = sql(`select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received',
      'ride_response', gen_random_uuid(), '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
    const pushSource = () => sql(`select md5(to_jsonb(preference)::text || to_jsonb(subscription)::text)
      from private.notification_preference as preference join private.push_subscription as subscription on subscription.account_id = preference.account_id
      where preference.account_id = ${literal(accountId)}::uuid and subscription.public_id = ${literal(pushId)}::uuid;`);
    const pushBefore = pushSource();
    const pushIds = JSON.parse(sql(`select jsonb_build_object('job', job.id, 'delivery', delivery.public_id)
      from app.notification as notification join app.notification_delivery as delivery on delivery.notification_id = notification.id
      join app.outbox_job as job on job.payload_reference = delivery.id
      where notification.public_id = ${literal(pushNotification)}::uuid and delivery.channel = 'web_push';`));
    pushDelivery = pushIds.delivery;
    sql(`update app.outbox_job set attempt_count = 4 where id = ${literal(pushIds.job)}::uuid;`);
    const pushLease = randomUUID();
    const pushJob = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: pushLease, p_channels: ['web_push'] });
    assert.equal(pushJob.notification_id, pushNotification); assert.equal(pushJob.attempt_count, 5);
    sql(`update app.outbox_job set lock_deadline = clock_timestamp() - interval '1 second' where id = ${literal(pushIds.job)}::uuid;`);
    assert.equal(await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: randomUUID(), p_channels: ['web_push'] }), null);
    assert.equal(sql(`select state from app.outbox_job where id = ${literal(pushIds.job)}::uuid;`), 'dead');
    assert.equal(pushSource(), pushBefore);
    assert.equal(sql(`select count(*) from ops.operational_alert where safe_reference = ${literal(pushDelivery)}::uuid;`), '1');
    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', oid::text, 'definition', md5(pg_get_functiondef(oid)),
      'acl', proacl::text) order by oid) from pg_proc where oid in (
        'ops.claim_notification_jobs(uuid,integer)'::regprocedure,
        'ops.claim_notification_jobs_v2(uuid,integer,text[])'::regprocedure,
        'ops.complete_notification_job(uuid,uuid,text,text,text,text,text)'::regprocedure,
        'api.notification_worker_claim_job_v3(uuid,text[])'::regprocedure,
        'api.notification_worker_claim_jobs_v2(uuid,integer,text[])'::regprocedure);`);
    const expected = definitions();
    sql(readFileSync(new URL('../supabase/migrations/20261019150000_notification_delivery_deadlines.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), expected);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}', 'api.notification_worker_claim_job_v3(uuid,text[])', 'EXECUTE')::text;`),
        role === 'service_role' ? 'true' : 'false');
      assert.equal(sql(`select has_function_privilege('${role}', 'ops.claim_notification_jobs_v2(uuid,integer,text[])', 'EXECUTE')::text;`), 'false');
    }
    process.stdout.write('Notification deadlines verified: single-job timing, rollback, real outbox/delivery row-wait expiry, stale reclaim, and replay/grants.\n');
  } finally {
    if (pushId) await rpc(actor, 'update_notification_preference', { p_client_key: randomUUID(),
      p_ride_email_enabled: true, p_web_push_enabled: false, p_revoke_subscription_id: pushId });
    sql(`drop trigger if exists ${trigger} on app.notification_delivery; drop function if exists private.${trigger}();
      delete from ops.operational_alert where safe_reference in (${literal(ids.delivery_public)}::uuid, ${optionalUuid(pushDelivery)});
      delete from app.outbox_job where id = ${literal(ids.job)}::uuid;
      delete from app.notification where public_id in (${literal(notification)}::uuid, ${optionalUuid(pushNotification)});
      delete from private.push_subscription where public_id = ${optionalUuid(pushId)} and account_id = ${literal(accountId)}::uuid;`);
  }
}
