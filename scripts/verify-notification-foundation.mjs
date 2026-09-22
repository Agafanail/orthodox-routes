import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) { throw new Error(message); }

function localConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase notification test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Local notification test configuration is incomplete.');
  return { publicKey, serviceRoleKey, url };
}

function databaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  const name = result.stdout?.split(/\r?\n/).find((value) => value.trim() === 'supabase_db_orthodox-routes');
  if (result.status !== 0 || !name) fail('The local notification database is unavailable.');
  return name.trim();
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function runSql(container, statement, { expectFailure = false } = {}) {
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-',
  ], { encoding: 'utf8', input: statement });
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'The unsafe notification database operation unexpectedly succeeded.');
    return '';
  }
  if (result.status !== 0) fail(`Notification database verification failed: ${result.stderr}`);
  return result.stdout.trim();
}

function userClient(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Notification RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function rpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

const { publicKey, serviceRoleKey, url } = localConfig();
const container = databaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const password = `Notifications-${suffix}-Aa1!`;
const identities = [0, 1].map((index) => ({
  email: `notification-${index}-${suffix}@example.test`,
  name: `Notification ${index}`,
  phone: `+39000${String(Date.now()).slice(-7)}${index}`,
}));
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);
const clients = identities.map(() => userClient(url, publicKey));
const createdUserIds = [];
const termsVersion = `notification-terms-${suffix}`;
const churchSlug = `notification-${suffix}`.toLowerCase();
let emailProviderReference = '';

try {
  runSql(container, `
    insert into app.legal_document_version
      (document_type, version, language_codes, effective_at, status, content_hash)
    values ('terms', ${sqlLiteral(termsVersion)}, array['en','ru','it','ro','uk','de'],
      now() - interval '1 minute', 'published', repeat('7', 64));
  `);
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index];
    const created = await admin.auth.admin.createUser({
      email: identity.email, email_confirm: true, password,
    });
    if (created.error || !created.data.user) fail('A synthetic notification user could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
    const signedIn = await clients[index].auth.signInWithPassword({ email: identity.email, password });
    if (signedIn.error) fail('A synthetic notification user could not sign in.');
    await rpc(clients[index], 'create_account', {
      p_display_name: identity.name, p_phone_e164: identity.phone, p_preferred_language: 'en',
    });
    await rpc(clients[index], 'declare_adult');
    runSql(container, `update private.account_contact set phone_verified_at = now()
      where account_id = ${sqlLiteral(identity.id)}::uuid;`);
    await rpc(clients[index], 'accept_current_terms');
  }

  assert.deepEqual(await rpc(clients[0], 'current_notification_preferences'), {
    active_push_subscription_count: 0,
    has_active_transport_commitment: false,
    has_effective_external_channel: true,
    ride_email_enabled: true,
    web_push_enabled: false,
  });
  await rpcFailure(anonymous, 'current_notifications');

  runSql(container, `update app.outbox_job
    set available_at = now() + interval '1 hour'
    where state in ('queued', 'retry') and available_at <= now();`);
  const firstNotificationId = runSql(container, `select app.create_notification(
    ${sqlLiteral(identities[0].id)}::uuid, 'ride.response.received', 'ride_response', gen_random_uuid(),
    '/trips', 'notifications.ride_response_received', '{"passenger_count":2}'::jsonb, 70
  );`);
  const ownHistory = await rpc(clients[0], 'current_notifications');
  assert.equal(ownHistory.length, 1);
  assert.equal(ownHistory[0].notification_id, firstNotificationId);
  assert.deepEqual(ownHistory[0].parameters, { passenger_count: 2 });
  assert.equal(JSON.stringify(ownHistory).includes(identities[0].email), false);
  assert.deepEqual(await rpc(clients[1], 'current_notifications'), []);
  assert.equal(await rpc(clients[1], 'mark_notification_read', { p_notification_id: firstNotificationId }), false);
  assert.equal(await rpc(clients[0], 'mark_notification_read', { p_notification_id: firstNotificationId }), true);
  assert.ok((await rpc(clients[0], 'current_notifications'))[0].read_at);
  runSql(container, `select app.create_notification(
    ${sqlLiteral(identities[0].id)}::uuid, 'ride.unsafe', 'ride_response', gen_random_uuid(),
    '/trips', 'notifications.unsafe', '{"email":"leak@example.test"}'::jsonb, 50
  );`, { expectFailure: true });

  await rpcFailure(clients[0], 'notification_worker_claim_jobs', {
    p_lease_token: randomUUID(), p_limit: 10,
  });
  await rpcFailure(clients[0], 'notification_worker_claim_jobs_v2', {
    p_channels: ['email'], p_lease_token: randomUUID(), p_limit: 10,
  });
  let lease = randomUUID();
  let jobs = await rpc(admin, 'notification_worker_claim_jobs_v2', {
    p_channels: ['email'], p_lease_token: lease, p_limit: 10,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].channel, 'email');
  assert.equal(jobs[0].notification_id, firstNotificationId);
  assert.equal(jobs[0].preferred_language, 'en');
  assert.equal(jobs[0].destination_value, identities[0].email);
  assert.equal(await rpc(admin, 'notification_worker_complete_job', {
    p_job_id: jobs[0].job_id, p_lease_token: lease, p_outcome: 'temporary_failure',
    p_provider_adapter: 'resend-email-v1', p_safe_failure_class: 'provider_unavailable',
  }), true);
  runSql(container, `update app.outbox_job set available_at = now() - interval '1 second'
    where public_id = ${sqlLiteral(jobs[0].job_id)}::uuid;`);
  lease = randomUUID();
  jobs = await rpc(admin, 'notification_worker_claim_jobs', { p_lease_token: lease, p_limit: 10 });
  assert.equal(jobs[0].attempt_count, 2);
  emailProviderReference = randomUUID();
  assert.equal(await rpc(admin, 'notification_worker_complete_job', {
    p_job_id: jobs[0].job_id, p_lease_token: lease, p_outcome: 'sent',
    p_provider_adapter: 'resend-email-v1', p_provider_reference: emailProviderReference,
  }), true);
  const deliveredEventId = `msg_${suffix}_delivered`;
  const deliveredAt = new Date().toISOString();
  const delivered = await rpc(admin, 'notification_worker_record_provider_event', {
    p_event_id: deliveredEventId, p_event_type: 'email.delivered', p_occurred_at: deliveredAt,
    p_provider: 'resend', p_provider_reference: emailProviderReference,
  });
  assert.deepEqual(delivered, {
    duplicate: false, matched: true, outcome: 'delivered', state_changed: true,
  });
  assert.equal((await rpc(admin, 'notification_worker_record_provider_event', {
    p_event_id: deliveredEventId, p_event_type: 'email.delivered', p_occurred_at: deliveredAt,
    p_provider: 'resend', p_provider_reference: emailProviderReference,
  })).duplicate, true);
  const olderSent = await rpc(admin, 'notification_worker_record_provider_event', {
    p_event_id: `msg_${suffix}_older`, p_event_type: 'email.sent',
    p_occurred_at: new Date(Date.parse(deliveredAt) - 60_000).toISOString(),
    p_provider: 'resend', p_provider_reference: emailProviderReference,
  });
  assert.equal(olderSent.state_changed, false);
  assert.equal(runSql(container, `select state from app.notification_delivery
    where provider_reference = ${sqlLiteral(emailProviderReference)};`), 'delivered');

  const pushArgs = (marker, clientKey = randomUUID()) => ({
    p_auth_key: 'B'.repeat(22), p_client_key: clientKey,
    p_device_label: `Synthetic ${marker}`, p_endpoint: `https://push.example.test/${suffix}/${marker}`,
    p_p256dh_key: 'A'.repeat(43), p_vapid_key_version: 1,
  });
  const firstPushKey = randomUUID();
  const firstPushArgs = pushArgs('first', firstPushKey);
  const firstPush = await rpc(clients[0], 'upsert_push_subscription', firstPushArgs);
  assert.deepEqual(await rpc(clients[0], 'upsert_push_subscription', firstPushArgs), firstPush);
  await rpc(clients[0], 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: false, p_web_push_enabled: true,
  });
  const secondNotificationId = runSql(container, `select app.create_notification(
    ${sqlLiteral(identities[0].id)}::uuid, 'ride.confirmed', 'ride_agreement', gen_random_uuid(),
    '/trips', 'notifications.ride_confirmed', '{}'::jsonb, 80
  );`);
  lease = randomUUID();
  jobs = await rpc(admin, 'notification_worker_claim_jobs', { p_lease_token: lease, p_limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].channel, 'web_push');
  assert.equal(jobs[0].destination_value, firstPushArgs.p_endpoint);
  assert.equal(JSON.stringify(await rpc(clients[0], 'current_notifications')).includes(firstPushArgs.p_endpoint), false);
  assert.equal(await rpc(admin, 'notification_worker_complete_job', {
    p_job_id: jobs[0].job_id, p_lease_token: lease, p_outcome: 'permanent_failure',
    p_provider_adapter: 'synthetic-push', p_safe_failure_class: 'subscription_gone',
  }), true);

  const secondPush = await rpc(clients[0], 'upsert_push_subscription', pushArgs('second'));
  runSql(container, `
    insert into app.church (
      slug, official_name, address_display, locality, country_code, timezone, status, location
    )
    values (${sqlLiteral(churchSlug)}, 'Notification Test Church', 'Synthetic public address',
      'Berlin', 'DE', 'Europe/Berlin', 'published',
      extensions.st_setsrid(extensions.st_makepoint(13.405, 52.52), 4326)::extensions.geography);
    insert into app.passenger_request (
      author_account_id, church_id, desired_arrival_at, timezone, total_passengers,
      children_count, child_seat_required, return_required, remaining_passengers,
      status, terms_version
    ) select ${sqlLiteral(identities[0].id)}::uuid, id, now() + interval '2 days',
      'Europe/Berlin', 1, 0, false, false, 1, 'active', ${sqlLiteral(termsVersion)}
    from app.church where slug = ${sqlLiteral(churchSlug)};
  `);
  await rpcFailure(clients[0], 'update_notification_preference', {
    p_client_key: randomUUID(), p_revoke_subscription_id: secondPush.subscription_id,
    p_ride_email_enabled: false, p_web_push_enabled: false,
  });
  const safePreference = await rpc(clients[0], 'update_notification_preference', {
    p_client_key: randomUUID(), p_revoke_subscription_id: secondPush.subscription_id,
    p_ride_email_enabled: true, p_web_push_enabled: false,
  });
  assert.equal(safePreference.has_effective_external_channel, true);

  const thirdPush = await rpc(clients[0], 'upsert_push_subscription', pushArgs('third'));
  await rpc(clients[0], 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: false, p_web_push_enabled: true,
  });
  runSql(container, `select app.create_notification(
    ${sqlLiteral(identities[0].id)}::uuid, 'ride.cancelled', 'ride_agreement', gen_random_uuid(),
    '/trips', 'notifications.ride_cancelled', '{}'::jsonb, 90
  );`);
  lease = randomUUID();
  jobs = await rpc(admin, 'notification_worker_claim_jobs', { p_lease_token: lease, p_limit: 10 });
  assert.equal(jobs.length, 1);
  assert.equal(await rpc(admin, 'notification_worker_complete_job', {
    p_job_id: jobs[0].job_id, p_lease_token: lease, p_outcome: 'permanent_failure',
    p_provider_adapter: 'synthetic-push', p_safe_failure_class: 'subscription_gone',
  }), true);
  const warningHistory = await rpc(clients[0], 'current_notifications');
  assert.ok(warningHistory.some((item) => item.event_type === 'account.external_channel_unavailable'));
  assert.equal(runSql(container, `select count(*) from ops.operational_alert
    where account_id = ${sqlLiteral(identities[0].id)}::uuid and state = 'open';`), '1');
  assert.equal((await rpc(clients[0], 'current_notification_preferences')).has_effective_external_channel, false);
  const missingChannelError = await rpcFailure(clients[0], 'publish_passenger_request', {
    p_child_seat_required: false, p_children_count: 0,
    p_church_id: randomUUID(), p_client_key: randomUUID(),
    p_desired_arrival_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    p_places: [], p_public_note: null, p_return_required: false,
    p_service_occurrence_id: null, p_timezone: 'UTC', p_total_passengers: 1,
  });
  assert.match(missingChannelError.message, /effective external notification channel/i);
  assert.ok(thirdPush.subscription_id);

  assert.equal(runSql(container, `
    select count(*) from information_schema.role_table_grants
    where table_schema in ('app','private','ops')
      and table_name in ('notification','notification_preference','push_subscription',
        'notification_delivery','notification_destination','outbox_job','notification_operation',
        'operational_alert','provider_webhook_receipt')
      and grantee in ('anon','authenticated','service_role');
  `), '0');
  assert.equal(runSql(container, `
    select count(*) from pg_class as class
    join pg_namespace as namespace on namespace.oid = class.relnamespace
    where namespace.nspname in ('app','private','ops')
      and class.relname in ('notification','notification_preference','push_subscription',
        'notification_delivery','notification_destination','outbox_job','notification_operation',
        'operational_alert','provider_webhook_receipt')
      and class.relrowsecurity and class.relforcerowsecurity;
  `), '9');
  assert.equal(runSql(container, `
    select has_function_privilege('anon', 'api.notification_worker_claim_jobs(uuid,integer)', 'execute')::text || ':' ||
      has_function_privilege('authenticated', 'api.notification_worker_claim_jobs(uuid,integer)', 'execute')::text || ':' ||
      has_function_privilege('service_role', 'api.notification_worker_claim_jobs(uuid,integer)', 'execute')::text;
  `), 'false:false:true');
  assert.equal(runSql(container, `
    select has_function_privilege('anon', 'api.notification_worker_record_provider_event(text,text,text,text,timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('authenticated', 'api.notification_worker_record_provider_event(text,text,text,text,timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('service_role', 'api.notification_worker_record_provider_event(text,text,text,text,timestamptz)', 'execute')::text;
  `), 'false:false:true');
  assert.equal(runSql(container, `
    select has_function_privilege('anon', 'api.notification_worker_enqueue_scheduled(timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('authenticated', 'api.notification_worker_enqueue_scheduled(timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('service_role', 'api.notification_worker_enqueue_scheduled(timestamptz)', 'execute')::text;
  `), 'false:false:true');
  assert.ok(secondNotificationId);
  console.log('Notification history, preferences, channel invariant, push storage, and durable outbox verification passed.');
} finally {
  try {
    runSql(container, `
      delete from ops.provider_webhook_receipt where provider_reference = ${sqlLiteral(emailProviderReference ?? '')};
      delete from app.passenger_request where author_account_id in (${createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(',') || 'null'});
      delete from app.church where slug = ${sqlLiteral(churchSlug)};
      delete from app.account where id in (${createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(',') || 'null'});
      delete from app.legal_document_version where version = ${sqlLiteral(termsVersion)};
    `);
  } catch { /* The disposable CI database is rebuilt for every run. */ }
  for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}
