import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The parent verifies a phone-change code through the real authenticated RPC with ride email OFF.
// The code comes from the disposable local worker fixture, not an actual SMS/handset delivery.
// This proves database queuing/preference/worker contracts, never a real provider send.
export async function verifyMandatoryPhoneSecurityEmail({ sql, rpc, admin, actor, accountId, expectedEmail }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const preferences = () => rpc(actor, 'current_notification_preferences', {});
  const update = (enabled) => rpc(actor, 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: enabled, p_web_push_enabled: false, p_revoke_subscription_id: null,
  });
  const before = await preferences(); assert.equal(before.ride_email_enabled, false); assert.equal(before.web_push_enabled, false);
  const contact = () => sql(`select md5(to_jsonb(contact)::text) from private.account_contact as contact where account_id = ${literal(accountId)}::uuid;`);
  const expectedContact = contact();
  const security = sql(`select public_id from app.notification where recipient_account_id = ${literal(accountId)}::uuid and event_type = 'account.phone_changed';`);
  const delivery = () => JSON.parse(sql(`select jsonb_build_object('job', job.public_id, 'delivery', delivery.public_id,
    'job_state', job.state, 'state', delivery.state) from app.notification as notification
    join app.notification_delivery as delivery on delivery.notification_id = notification.id and delivery.channel = 'email'
    join app.outbox_job as job on job.payload_reference = delivery.id where notification.public_id = ${literal(security)}::uuid;`));
  assert.equal(delivery().job_state, 'queued'); assert.equal(delivery().state, 'queued');
  let ordinary;
  try {
    await update(true);
    ordinary = sql(`select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received',
      'ride_response', gen_random_uuid(), '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
    await update(false);
    assert.equal(delivery().job_state, 'queued'); assert.equal(delivery().state, 'queued');
    assert.equal(sql(`select delivery.state from app.notification_delivery as delivery join app.notification as notification
      on notification.id = delivery.notification_id where notification.public_id = ${literal(ordinary)}::uuid and delivery.channel = 'email';`), 'suppressed');
    const saved = await preferences();
    assert.equal(saved.ride_email_enabled, false); assert.equal(saved.web_push_enabled, false);
    assert.equal(saved.has_effective_external_channel, false, 'Mandatory email became an opted-in ride channel.');
    const ids = delivery(), lease = randomUUID();
    const claimed = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: lease, p_channels: ['email'] });
    assert.ok(claimed); assert.equal(claimed.job_id, ids.job); assert.equal(claimed.delivery_id, ids.delivery);
    assert.equal(claimed.event_type, 'account.phone_changed'); assert.equal(claimed.destination_value, expectedEmail);
    // No adapter is called: record a synthetic temporary failure, never fabricated provider acceptance.
    assert.equal(await rpc(admin, 'notification_worker_complete_job', { p_job_id: claimed.job_id, p_lease_token: lease,
      p_outcome: 'temporary_failure', p_provider_adapter: 'resend-email-v1', p_provider_code: null,
      p_provider_reference: null, p_safe_failure_class: 'provider_unavailable' }), true);
    assert.equal(contact(), expectedContact);
    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', routine.oid,
      'definition', md5(pg_get_functiondef(routine.oid)), 'acl', routine.proacl::text) order by routine.oid)
      from pg_proc as routine where routine.oid in (
        'app.notification_requires_security_email(text)'::regprocedure,
        'app.create_notification(uuid,text,text,uuid,text,text,jsonb,integer)'::regprocedure,
        'api.update_notification_preference(boolean,boolean,uuid,uuid)'::regprocedure);`);
    const expected = definitions(), savedDelivery = delivery();
    sql(readFileSync(new URL('../supabase/migrations/20261022140000_mandatory_phone_security_email.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), expected); assert.deepEqual(delivery(), savedDelivery); assert.equal(contact(), expectedContact);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(sql(`select has_function_privilege(
      ${literal(role)}, 'app.notification_requires_security_email(text)', 'EXECUTE')::text;`), 'false');
    assert.equal(sql(`select app.notification_requires_security_email('account.phone_changed')::text || ':' ||
      app.notification_requires_security_email('account.external_channel_unavailable')::text || ':' ||
      app.notification_requires_security_email('ride.response.received')::text || ':' ||
      app.notification_requires_security_email(null)::text;`), 'true:false:false:false');
    process.stdout.write('Mandatory phone security email: real phone-code source with synthetic worker data, opted-out enqueue/claim, ordinary suppression, unchanged preferences/contact and replay/grants passed.\n');
  } finally {
    if (ordinary) sql(`delete from app.outbox_job where payload_reference in (select delivery.id from app.notification_delivery as delivery
      join app.notification as notification on notification.id = delivery.notification_id where notification.public_id = ${literal(ordinary)}::uuid);
      delete from app.notification where public_id = ${literal(ordinary)}::uuid;`);
  }
}
