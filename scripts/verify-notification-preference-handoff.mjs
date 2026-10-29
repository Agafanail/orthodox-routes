import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable local database only. No provider adapter or real recipient is used.
export async function verifyNotificationPreferenceHandoff({ admin, actor, accountId, container, rpc, sql, literal }) {
  const sourceId = randomUUID(), name = `notify-pref-${randomUUID()}`;
  const trigger = `verify_pref_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const lock = `hashtextextended(${literal(name)}, 0)`;
  const launch = (statement, hold = false) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.resume();
    const done = new Promise((resolve, reject) => {
      child.on('error', reject); child.on('close', (code) => resolve(code));
    });
    if (hold) child.stdin.write(statement); else child.stdin.end(statement);
    return { child, done, get output() { return output; } };
  };
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (sql(`select (${condition})::text;`) === 'true') return;
      await delay(50);
    }
    throw new Error('Synthetic notification preference barrier was not observed.');
  };
  const change = (email, push = false) => rpc(actor, 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: email, p_web_push_enabled: push,
  });
  const fixture = `select notification.id from app.notification as notification
    where notification.recipient_account_id = ${literal(accountId)}::uuid
      and notification.object_public_id = ${literal(sourceId)}::uuid`;
  const before = await rpc(actor, 'current_notification_preferences');
  const pushArgs = { p_auth_key: 'B'.repeat(22), p_client_key: randomUUID(), p_device_label: 'Synthetic preference race',
    p_endpoint: `https://push.example.test/preference-${sourceId}`, p_p256dh_key: 'A'.repeat(43), p_vapid_key_version: 1 };
  const create = (event = 'ride.response.received') => sql(`select app.create_notification(${literal(accountId)}::uuid,
    ${literal(event)}, 'account', ${literal(sourceId)}::uuid, '/trips', 'notifications.update', '{}'::jsonb, 99);`);
  const claim = (channel) => rpc(admin, 'notification_worker_claim_job_v3', {
    p_lease_token: randomUUID(), p_channels: [channel],
  });
  const complete = (job, lease, outcome, failure = null) => rpc(admin, 'notification_worker_complete_job', {
    p_job_id: job.job_id, p_lease_token: lease, p_outcome: outcome,
    p_provider_adapter: job.channel === 'email' ? 'resend-email-v1' : 'synthetic-push',
    p_provider_reference: outcome === 'sent' ? randomUUID() : null, p_safe_failure_class: failure,
  });
  const privateSource = () => sql(`select md5(to_jsonb(preference)::text || coalesce((select jsonb_agg(to_jsonb(subscription))::text
    from private.push_subscription as subscription where subscription.account_id = preference.account_id), '[]'))
    from private.notification_preference as preference where preference.account_id = ${literal(accountId)}::uuid;`);
  let gate, creator, waiter, pushId;
  try {
    sql(`create function private.${trigger}() returns trigger language plpgsql set search_path = '' as $barrier$
      begin perform pg_advisory_xact_lock(${lock}); return new; end; $barrier$;
      revoke all on function private.${trigger}() from public, anon, authenticated, service_role;
      create trigger ${trigger} before insert on app.notification for each row
        when (new.recipient_account_id = ${literal(accountId)}::uuid and new.object_public_id = ${literal(sourceId)}::uuid)
        execute function private.${trigger}();`);
    for (const channel of ['email', 'web_push']) {
      if (channel === 'web_push') pushId = (await rpc(actor, 'upsert_push_subscription', pushArgs)).subscription_id;
      await change(channel === 'email', channel === 'web_push');
      gate = launch(`set application_name = ${literal(name)}; begin; select pg_advisory_xact_lock(${lock});\n`, true);
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and state = 'idle in transaction')`);
      creator = launch(`set application_name = ${literal(`${name}-create`)}; set statement_timeout = '15s';
        select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received', 'ride_response',
          ${literal(sourceId)}::uuid, '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
      await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-create`)} and wait_event = 'advisory')`);
      // The actual authenticated preference RPC commits before any notification/job exists.
      assert.equal((await change(false)).ride_email_enabled, false);
      gate.child.stdin.end('commit;\n');
      assert.equal(await gate.done, 0); assert.equal(await creator.done, 0);
      assert.equal(sql(`select count(*) from app.notification_delivery as delivery
        where delivery.notification_id in (${fixture}) and delivery.channel = ${literal(channel)} and delivery.state = 'queued';`), '1',
      'The test must causally reproduce late enqueue, not manufacture a delivery row.');
      const expectedPrivate = privateSource();
      if (channel === 'email') {
        const selectedId = sql(`select delivery.id from app.notification_delivery as delivery
          where delivery.notification_id in (${fixture}) and delivery.channel = 'email';`);
        const state = () => sql(`select md5(to_jsonb(job)::text || to_jsonb(delivery)::text) from app.outbox_job as job
          join app.notification_delivery as delivery on delivery.id = job.payload_reference where delivery.id = ${literal(selectedId)}::uuid;`);
        const expectedState = state(), failure = `${trigger}_fail`;
        sql(`create function private.${failure}() returns trigger language plpgsql set search_path = '' as $failure$
          begin raise exception 'Synthetic notification preference failure.'; end; $failure$;
          revoke all on function private.${failure}() from public, anon, authenticated, service_role;
          create trigger ${failure} before update on app.notification_delivery for each row
            when (new.id = ${literal(selectedId)}::uuid and new.state = 'suppressed') execute function private.${failure}();`);
        try {
          const result = await admin.schema('api').rpc('notification_worker_claim_job_v3', {
            p_lease_token: randomUUID(), p_channels: ['email'],
          });
          assert.equal(Boolean(result.error), true); assert.equal(state(), expectedState);
        } finally { sql(`drop trigger ${failure} on app.notification_delivery; drop function private.${failure}();`); }
      }
      const claimed = await claim(channel);
      if (claimed) assert.equal(sql(`select (id in (${fixture}))::text from app.notification
        where public_id = ${literal(claimed.notification_id)}::uuid;`), 'true', 'The handoff selected a foreign test fixture.');
      // Compare only a boolean, so a failed regression never logs a private destination/key payload.
      assert.equal(Boolean(claimed), false, 'A late ordinary notification crossed the selected worker handoff after committed opt-out.');
      assert.equal(sql(`select count(*) from app.outbox_job as job join app.notification_delivery as delivery
        on delivery.id = job.payload_reference where delivery.notification_id in (${fixture}) and delivery.channel = ${literal(channel)}
        and job.state = 'suppressed' and delivery.state = 'suppressed' and job.lock_owner is null and job.lock_deadline is null;`), '1');
      assert.equal(privateSource(), expectedPrivate);
    }

    // An ordinary opt-out must not disable mandatory phone-change account security email.
    // The authenticated phone-code source is covered separately; this is a synthetic worker boundary fixture.
    const mandatory = create('account.phone_changed');
    await change(false);
    let lease = randomUUID();
    let job = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['email'] });
    assert.ok(job); assert.equal(job.notification_id, mandatory); assert.equal(job.event_type, 'account.phone_changed');
    assert.equal(await complete(job, lease, 'temporary_failure', 'provider_unavailable'), true);
    sql(`update app.outbox_job set available_at = clock_timestamp() + interval '1 hour'
      where public_id = ${literal(job.job_id)}::uuid;`);

    // Reconcile a synthetic accepted-provider fact with an uncertain expired lease, never resend it.
    await change(true);
    const accepted = create(); lease = randomUUID();
    job = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['email'] });
    assert.ok(job); assert.equal(job.notification_id, accepted);
    assert.equal(await complete(job, lease, 'sent'), true); // Synthetic recorded result, not actual provider acceptance.
    sql(`update app.outbox_job set state = 'claimed', completed_at = null, lock_owner = gen_random_uuid(),
      lock_deadline = clock_timestamp() - interval '1 second' where public_id = ${literal(job.job_id)}::uuid;`);
    await change(false);
    const providerFact = () => sql(`select md5(jsonb_build_array(delivery.sent_at, delivery.provider_adapter,
      delivery.provider_reference, delivery.provider_code, delivery.provider_event_at)::text)
      from app.notification_delivery as delivery where delivery.public_id = ${literal(job.delivery_id)}::uuid;`);
    const expectedFact = providerFact();
    assert.equal(Boolean(await claim('email')), false);
    assert.equal(providerFact(), expectedFact);
    assert.equal(sql(`select outbox.state || ':' || delivery.state from app.outbox_job as outbox
      join app.notification_delivery as delivery on delivery.id = outbox.payload_reference
      where outbox.public_id = ${literal(job.job_id)}::uuid;`), 'sent:sent');
    sql(`update app.outbox_job set state = 'claimed', attempt_count = 5, completed_at = null,
      lock_owner = gen_random_uuid(), lock_deadline = clock_timestamp() - interval '1 second'
      where public_id = ${literal(job.job_id)}::uuid;`);
    assert.equal(Boolean(await claim('email')), false);
    assert.equal(providerFact(), expectedFact);
    assert.equal(sql(`select outbox.state || ':' || delivery.state from app.outbox_job as outbox
      join app.notification_delivery as delivery on delivery.id = outbox.payload_reference
      where outbox.public_id = ${literal(job.job_id)}::uuid;`), 'sent:sent');
    assert.equal(sql(`select count(*) from ops.operational_alert where safe_reference = ${literal(job.delivery_id)}::uuid;`), '0');

    // A real completion-contract failure invalidates the subscription, not the saved push choice.
    await change(true, true);
    create(); create(); lease = randomUUID();
    job = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['web_push'] });
    assert.ok(job);
    const pendingPush = sql(`select delivery.id from app.notification_delivery as delivery join app.notification as notification
      on notification.id = delivery.notification_id where notification.id in (${fixture}) and delivery.channel = 'web_push'
      and delivery.state = 'queued';`);
    gate = launch(`set application_name = ${literal(name)}; begin;
      select id from app.notification_delivery where id = ${literal(pendingPush)}::uuid for update;\n`, true);
    await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and state = 'idle in transaction')`);
    waiter = launch(`set application_name = ${literal(`${name}-claim`)}; set role service_role;
      select case when api.notification_worker_claim_job_v3(${literal(randomUUID())}::uuid, array['web_push']::text[])
        is null then 'REFUSED' else 'HANDED_OFF' end;`);
    await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-claim`)} and wait_event_type = 'Lock')`);
    assert.equal(await complete(job, lease, 'permanent_failure', 'subscription_gone'), true);
    assert.equal(sql(`select state from private.push_subscription where public_id = ${literal(pushId)}::uuid;`), 'invalid');
    const invalidSource = privateSource();
    gate.child.stdin.end('commit;\n');
    assert.equal(await gate.done, 0); assert.equal(await waiter.done, 0);
    assert.ok(waiter.output.includes('REFUSED'), 'Subscription invalidation committed during the claim wait but was not rechecked.');
    assert.equal(sql(`select state from app.notification_delivery where id = ${literal(pendingPush)}::uuid;`), 'suppressed');
    assert.equal(privateSource(), invalidSource);
    assert.equal((await rpc(actor, 'current_notification_preferences')).web_push_enabled, true);
    const definition = () => sql(`select md5(pg_get_functiondef(routine.oid)) || ':' || routine.proacl::text
      from pg_proc as routine where routine.oid = 'api.notification_worker_claim_job_v3(uuid,text[])'::regprocedure;`);
    const expectedDefinition = definition();
    sql(readFileSync(new URL('../supabase/migrations/20261029120000_notification_preference_handoff.sql', import.meta.url), 'utf8'));
    assert.equal(definition(), expectedDefinition);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(sql(`select has_function_privilege(
      ${literal(role)}, 'api.notification_worker_claim_job_v3(uuid,text[])', 'EXECUTE')::text;`), role === 'service_role' ? 'true' : 'false');
    process.stdout.write('Notification preference handoff: causal email/push late-enqueue refusal, rollback, mandatory email, accepted-fact preservation, real post-wait subscription invalidation and replay/grants passed.\n');
  } finally {
    if (gate && !gate.child.stdin.writableEnded) gate.child.stdin.end('rollback;\n');
    await Promise.all([gate?.done, creator?.done, waiter?.done].filter(Boolean));
    sql(`drop trigger if exists ${trigger} on app.notification; drop function if exists private.${trigger}();
      delete from app.outbox_job where payload_reference in (select delivery.id from app.notification_delivery as delivery
        where delivery.notification_id in (${fixture}));
      delete from app.notification where id in (${fixture});`);
    if (pushId) sql(`delete from private.push_subscription where public_id = ${literal(pushId)}::uuid
      and account_id = ${literal(accountId)}::uuid;`);
    await rpc(actor, 'update_notification_preference', { p_client_key: randomUUID(),
      p_ride_email_enabled: before.ride_email_enabled, p_web_push_enabled: before.web_push_enabled });
  }
}
