import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase church-administration test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only integration configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for church-administration verification.');
  const container = result.stdout.split(/\r?\n/).map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function runSql(container, statement, { expectFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'The church-administration database operation unexpectedly succeeded.');
    return result.stderr;
  }
  if (result.status !== 0) fail('A synthetic church-administration database operation failed.');
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic church administrator could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Protected church-administration RPC failed: ${name}.`);
  return result.data;
}

async function rpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const compactSuffix = suffix.replaceAll('-', '');
const password = `Church-${suffix}-Aa1!`;
const identities = Array.from({ length: 5 }, (_, index) => ({
  email: `church-admin-${index + 1}-${suffix}@example.test`,
  name: `Church Administrator ${index + 1}`,
  phone: `+3900000010${index + 1}`,
}));
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const createdUserIds = [];

const churchArgs = (overrides = {}) => ({
  p_address_display: 'Via Test 10, Torino',
  p_client_key: randomUUID(),
  p_country_code: 'IT',
  p_lat: 45.0703,
  p_lng: 7.6869,
  p_locality: 'Torino',
  p_official_name: 'Synthetic Orthodox Church',
  p_slug: `synthetic-church-${compactSuffix}`,
  p_source_language: 'en',
  p_timezone: 'Europe/Rome',
  ...overrides,
});

try {
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email, email_confirm: true, password,
    });
    if (created.error || !created.data.user) fail('A synthetic church identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
  }

  const clients = identities.map(() => userClient(url, publicKey));
  for (let index = 0; index < clients.length; index += 1) {
    await signIn(clients[index], identities[index].email, password);
    await rpc(clients[index], 'create_account', {
      p_display_name: identities[index].name,
      p_phone_e164: identities[index].phone,
      p_preferred_language: 'en',
    });
    await rpc(clients[index], 'declare_adult');
  }
  runSql(container, `
    insert into app.legal_document_version (
      document_type, version, language_codes, effective_at, status, content_hash
    ) values (
      'terms', ${sqlLiteral(`church-test-${suffix}`)}, array['en'],
      now() - interval '1 hour', 'published', repeat('d', 64)
    );
  `);
  for (const client of clients) await rpc(client, 'accept_current_terms');
  runSql(container, `
    update private.account_contact set phone_verified_at = now()
    where account_id in (${identities.slice(0, 4).map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
  `);

  const anonymousCreate = await fetch(`${url}/rest/v1/rpc/create_church`, {
    method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: JSON.stringify(churchArgs()),
  });
  assert.ok([401, 403, 404].includes(anonymousCreate.status));
  await rpcFailure(clients[4], 'create_church', churchArgs({
    p_slug: `ineligible-church-${compactSuffix}`,
  }));

  const creationKey = randomUUID();
  const firstArgs = churchArgs({ p_client_key: creationKey });
  const created = await rpc(clients[0], 'create_church', firstArgs);
  assert.equal(created.status, 'created');
  assert.equal(created.slug, firstArgs.p_slug);
  assert.equal(created.safe_route, `/churches/${firstArgs.p_slug}`);
  assert.deepEqual(await rpc(clients[0], 'create_church', firstArgs), created);
  await rpcFailure(clients[0], 'create_church', {
    ...firstArgs, p_official_name: 'Changed input with reused key',
  });

  const publicChurch = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(publicChurch.church_id, created.church_id);
  assert.equal(publicChurch.official_name, firstArgs.p_official_name);
  assert.equal(publicChurch.address, firstArgs.p_address_display);

  const managedByCreator = await rpc(clients[0], 'current_managed_churches');
  assert.equal(managedByCreator.length, 1);
  assert.equal(managedByCreator[0].church_id, created.church_id);
  assert.equal(managedByCreator[0].administrator_count, 1);
  assert.equal(managedByCreator[0].content_version, 1);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const editArgs = {
    p_church_id: created.church_id,
    p_official_name: 'Synthetic Orthodox Church Updated',
    p_description_source: 'A public description of this synthetic church.',
    p_expected_version: 1,
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'update_church_content', editArgs);
  const edited = await rpc(clients[0], 'update_church_content', editArgs);
  assert.equal(edited.status, 'saved');
  assert.equal(edited.content_version, 2);
  assert.deepEqual(await rpc(clients[0], 'update_church_content', editArgs), edited);
  await rpcFailure(clients[0], 'update_church_content', {
    ...editArgs, p_official_name: 'Reused key with different content',
  });
  await rpcFailure(clients[0], 'update_church_content', {
    ...editArgs, p_client_key: randomUUID(),
  });
  const editedPublicChurch = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(editedPublicChurch.official_name, editArgs.p_official_name);
  assert.equal(editedPublicChurch.description, editArgs.p_description_source);
  assert.equal(editedPublicChurch.address, firstArgs.p_address_display);
  assert.equal((await rpc(clients[0], 'current_managed_churches'))[0].content_version, 2);
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and event_type = 'church.content_updated';`), '1');

  const serviceArgs = {
    p_church_id: created.church_id,
    p_source_name: 'Synthetic Vespers',
    p_source_description: 'A one-off synthetic service.',
    p_starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'create_one_off_service', serviceArgs);
  await rpcFailure(clients[4], 'create_one_off_service', serviceArgs);
  const service = await rpc(clients[0], 'create_one_off_service', serviceArgs);
  assert.equal(service.status, 'created');
  assert.equal(service.version, 1);
  assert.deepEqual(await rpc(clients[0], 'create_one_off_service', serviceArgs), service);
  await rpcFailure(clients[0], 'create_one_off_service', {
    ...serviceArgs, p_source_name: 'Different service with reused key',
  });
  await rpcFailure(clients[0], 'create_one_off_service', {
    ...serviceArgs, p_client_key: randomUUID(),
  });
  const publicSchedule = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(publicSchedule.length, 1);
  assert.equal(publicSchedule[0].service_id, service.service_id);
  assert.equal(publicSchedule[0].source_name, serviceArgs.p_source_name);
  assert.equal(publicSchedule[0].description, serviceArgs.p_source_description);
  assert.equal(Date.parse(publicSchedule[0].starts_at), Date.parse(serviceArgs.p_starts_at));
  assert.equal(publicSchedule[0].timezone, 'Europe/Rome');
  assert.equal(publicSchedule[0].status, 'scheduled');
  const churchWithSchedule = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.ok(Number.isFinite(Date.parse(churchWithSchedule.schedule_updated_at)));
  assert.deepEqual(await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id, p_limit: 0,
  }), []);
  runSql(container, `update app.church set status = 'hidden'
    where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  assert.deepEqual(await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  }), []);
  runSql(container, `update app.church set status = 'published'
    where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and event_type = 'service.created';`), '1');

  const serviceInternalId = runSql(container,
    `select id from app.service_occurrence where public_id = ${sqlLiteral(service.service_id)}::uuid;`);
  const serviceStart = sqlLiteral(serviceArgs.p_starts_at);
  runSql(container, `
    insert into private.user_place (owner_account_id, exact_address, public_area_name)
    values
      (${sqlLiteral(identities[1].id)}::uuid, 'Synthetic meeting', 'Synthetic area'),
      (${sqlLiteral(identities[2].id)}::uuid, 'Synthetic departure', 'Synthetic area'),
      (${sqlLiteral(identities[3].id)}::uuid, 'Synthetic custom departure', 'Synthetic area');
    insert into app.passenger_request (
      author_account_id, church_id, service_occurrence_id, desired_arrival_at,
      timezone, service_name_snapshot, total_passengers, child_seat_required,
      return_required, remaining_passengers, terms_version
    ) values (
      ${sqlLiteral(identities[1].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${sqlLiteral(serviceInternalId)}::uuid, ${serviceStart}::timestamptz,
      'Europe/Rome', 'Synthetic Vespers', 1, false, false, 1,
      ${sqlLiteral(`church-test-${suffix}`)}
    );
    insert into app.driver_offer_occurrence (
      publication_key, author_account_id, church_id, service_occurrence_id,
      departure_at, arrival_at, timezone, service_name_snapshot,
      origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available
    ) values (
      ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${sqlLiteral(serviceInternalId)}::uuid,
      ${serviceStart}::timestamptz - interval '2 hours', ${serviceStart}::timestamptz,
      'Europe/Rome', 'Synthetic Vespers',
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
        and exact_address = 'Synthetic departure' limit 1),
      2, 5, true, false, false
    );
    insert into app.driver_offer_occurrence (
      publication_key, author_account_id, church_id, departure_at, arrival_at,
      timezone, origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available
    ) values (
      ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[3].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${serviceStart}::timestamptz - interval '2 hours', ${serviceStart}::timestamptz,
      'Europe/Rome',
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and exact_address = 'Synthetic custom departure' limit 1),
      2, 5, true, false, false
    );
    insert into app.ride_condition_snapshot (
      passenger_request_id, driver_occurrence_id, church_id, passenger_count,
      scheduled_arrival_at, timezone, children_count, child_seat_required,
      children_allowed, driver_child_seat_available, passenger_return_required,
      driver_return_available, max_detour_km, request_content_version,
      occurrence_conditions_version
    ) values (
      (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid),
      (select id from app.driver_offer_occurrence where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and service_occurrence_id is null limit 1),
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      1, ${serviceStart}::timestamptz, 'Europe/Rome', 0, false,
      true, false, false, false, 5, 1, 1
    );
    insert into app.ride_response (
      direction, passenger_account_id, driver_account_id, passenger_request_id,
      driver_occurrence_id, offered_passenger_count, conditions_snapshot_id,
      status, expires_at
    ) values (
      'passenger_to_driver', ${sqlLiteral(identities[1].id)}::uuid,
      ${sqlLiteral(identities[3].id)}::uuid,
      (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid),
      (select id from app.driver_offer_occurrence where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and service_occurrence_id is null limit 1),
      1,
      (select id from app.ride_condition_snapshot where passenger_request_id in
        (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
        and driver_occurrence_id in (select id from app.driver_offer_occurrence
          where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
            and service_occurrence_id is null) limit 1),
      'await_driver', now() + interval '1 day'
    );
  `);
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid);`), '2');
  await rpcFailure(clients[1], 'preview_one_off_service_cancellation', {
    p_service_id: service.service_id,
  });
  const cancellationPreview = await rpc(clients[0], 'preview_one_off_service_cancellation', {
    p_service_id: service.service_id,
  });
  assert.equal(cancellationPreview.passenger_requests, 1);
  assert.equal(cancellationPreview.driver_offers, 1);
  assert.equal(cancellationPreview.pending_responses, 1);
  assert.equal(cancellationPreview.agreements, 0);
  const cancellationArgs = {
    p_service_id: service.service_id, p_expected_version: 1, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'cancel_one_off_service', cancellationArgs);
  const cancelledService = await rpc(clients[0], 'cancel_one_off_service', cancellationArgs);
  assert.equal(cancelledService.status, 'cancelled');
  assert.equal(cancelledService.version, 2);
  assert.deepEqual(await rpc(clients[0], 'cancel_one_off_service', cancellationArgs), cancelledService);
  await rpcFailure(clients[0], 'cancel_one_off_service', {
    ...cancellationArgs, p_client_key: randomUUID(),
  });
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid);`), '0');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid and status = 'active';`), '1');
  assert.equal(runSql(container, `select count(*) from app.driver_offer_occurrence
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid and status = 'active';`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.cancelled'
      and object_public_id = ${sqlLiteral(service.service_id)}::uuid;`), '3');
  const rejectedResponse = runSql(container, `
    update app.ride_response set status = 'accepted',
      selected_request_place_id = (
        select id from private.user_place where owner_account_id = ${sqlLiteral(identities[1].id)}::uuid
          and exact_address = 'Synthetic meeting' limit 1
      )
    where passenger_request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
      and driver_account_id = ${sqlLiteral(identities[3].id)}::uuid;
  `, { expectFailure: true });
  assert.match(rejectedResponse, /The linked service was cancelled/);
  const rejectedAgreement = runSql(container, `
    insert into app.ride_agreement (
      response_id, driver_occurrence_id, passenger_request_id,
      driver_account_id, passenger_account_id, confirmed_passenger_count,
      active_snapshot_id, selected_exact_place_id, contact_visible_until,
      exact_data_delete_due_at
    ) select response.id, response.driver_occurrence_id, response.passenger_request_id,
      response.driver_account_id, response.passenger_account_id, 1,
      response.conditions_snapshot_id,
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[1].id)}::uuid
        and exact_address = 'Synthetic meeting' limit 1),
      ${serviceStart}::timestamptz + interval '1 day',
      ${serviceStart}::timestamptz + interval '2 days'
    from app.ride_response as response
    where response.passenger_request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
      and response.driver_account_id = ${sqlLiteral(identities[3].id)}::uuid;
  `, { expectFailure: true });
  assert.match(rejectedAgreement, /The linked service was cancelled/);
  assert.equal((await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  }))[0].status, 'cancelled');

  const duplicateArgs = churchArgs({
    p_client_key: randomUUID(), p_lat: 45.0705, p_lng: 7.6871,
    p_official_name: 'Duplicate Attempt', p_slug: `duplicate-church-${compactSuffix}`,
  });
  const duplicate = await rpc(clients[1], 'create_church', duplicateArgs);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.church_id, created.church_id);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const suspicious = await rpc(clients[1], 'create_church', churchArgs({
    p_client_key: randomUUID(), p_lat: 46.0703, p_lng: 8.6869,
    p_official_name: 'Same Address Far Away', p_slug: `suspicious-church-${compactSuffix}`,
  }));
  assert.equal(suspicious.status, 'potential_duplicate');
  assert.equal(suspicious.church_id, undefined);

  const secondArgs = churchArgs({
    p_address_display: 'Piazza Test 20, Milano',
    p_client_key: randomUUID(),
    p_lat: 45.4642,
    p_lng: 9.19,
    p_locality: 'Milano',
    p_official_name: 'Second Synthetic Orthodox Church',
    p_slug: `second-synthetic-church-${compactSuffix}`,
  });
  const second = await rpc(clients[1], 'create_church', secondArgs);
  assert.equal(second.status, 'created');
  assert.equal((await rpc(clients[1], 'current_managed_churches'))[0].church_id, second.church_id);

  const firstInternalId = runSql(container,
    `select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[1].id)}::uuid, 'invite'),
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[2].id)}::uuid, 'invite');
  `);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[3].id)}::uuid, 'invite');
  `, { expectFailure: true });
  assert.equal(runSql(container, `select count(*) from app.church_admin_membership
    where church_id = ${sqlLiteral(firstInternalId)}::uuid and status = 'active';`), '3');

  const inviteArgs = (email, transfer = false) => ({
    p_church_id: second.church_id, p_email: email,
    p_transfer_own_place: transfer, p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'invite_church_admin', inviteArgs(identities[2].email));
  const firstInviteArgs = inviteArgs(identities[2].email);
  const firstInvite = await rpc(clients[1], 'invite_church_admin', firstInviteArgs);
  assert.equal(firstInvite.status, 'pending');
  assert.deepEqual(await rpc(clients[1], 'invite_church_admin', firstInviteArgs), firstInvite);
  await rpcFailure(clients[1], 'invite_church_admin', { ...firstInviteArgs, p_email: identities[3].email });
  const firstToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(firstInvite.invite_id)}::uuid;`);
  assert.equal(firstToken.length, 64);
  await rpcFailure(clients[0], 'church_invite_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 10,
  });
  const leaseToken = randomUUID();
  const queuedMail = await rpc(admin, 'church_invite_worker_claim', {
    p_lease_token: leaseToken, p_limit: 10,
  });
  const claimedMail = queuedMail.find((item) => item.invite_id === firstInvite.invite_id);
  assert.ok(claimedMail);
  assert.equal(claimedMail.token, firstToken);
  assert.equal(claimedMail.destination_email, identities[2].email);
  assert.equal(await rpc(admin, 'church_invite_worker_complete', {
    p_job_id: claimedMail.job_id, p_lease_token: leaseToken,
    p_outcome: 'sent', p_provider_reference: randomUUID(),
  }), true);
  await rpcFailure(clients[3], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: firstToken,
  });
  await rpcFailure(clients[2], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: '0'.repeat(64),
  });
  assert.equal((await rpc(clients[2], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: firstToken,
  })).status, 'accepted');
  assert.equal((await rpc(clients[2], 'current_managed_churches'))[0].church_id, second.church_id);

  const reserved = await rpc(clients[1], 'invite_church_admin', inviteArgs(identities[0].email));
  await rpcFailure(clients[1], 'invite_church_admin', inviteArgs(identities[3].email));
  const transfer = await rpc(clients[1], 'invite_church_admin', inviteArgs(identities[3].email, true));
  const transferToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(transfer.invite_id)}::uuid;`);
  assert.equal((await rpc(clients[3], 'accept_church_admin_invite', {
    p_invite_id: transfer.invite_id, p_token: transferToken,
  })).status, 'accepted');
  assert.equal((await rpc(clients[1], 'current_managed_churches'))
    .some((item) => item.church_id === second.church_id), false);
  assert.equal((await rpc(clients[3], 'current_managed_churches'))[0].administrator_count, 2);
  await rpcFailure(clients[1], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id });
  assert.equal(await rpc(clients[3], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id }), true);
  assert.equal(await rpc(clients[3], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id }), false);
  const declined = await rpc(clients[3], 'invite_church_admin', inviteArgs(identities[0].email));
  const declineToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(declined.invite_id)}::uuid;`);
  assert.equal(await rpc(clients[0], 'decline_church_admin_invite', {
    p_invite_id: declined.invite_id, p_token: declineToken,
  }), true);
  assert.equal(await rpc(clients[2], 'leave_church_administration', { p_church_id: second.church_id }), true);
  await rpcFailure(clients[3], 'leave_church_administration', { p_church_id: second.church_id });
  assert.equal(runSql(container, `select count(*) from app.church_admin_membership
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and status in ('active', 'transferring');`), '1');

  const retryInvite = await rpc(clients[3], 'invite_church_admin', inviteArgs(identities[0].email));
  await rpcFailure(clients[3], 'resend_church_admin_invite', { p_invite_id: retryInvite.invite_id });
  const originalRetryToken = runSql(container, `select mail.token_value
    from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  runSql(container, `with timing as (select clock_timestamp() - interval '11 minutes' as moment)
    update app.church_admin_invite as invite
    set issued_at = timing.moment, expires_at = timing.moment + interval '7 days',
      last_sent_at = timing.moment
    from timing where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;
    update private.church_invite_mail as mail
    set state = 'dead', token_value = repeat('0', 64), attempt_count = 5
    where mail.invite_id = (select id from app.church_admin_invite
      where public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid);`);
  assert.equal(await rpc(clients[3], 'resend_church_admin_invite', {
    p_invite_id: retryInvite.invite_id,
  }), true);
  const replacementToken = runSql(container, `select mail.token_value
    from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  assert.notEqual(replacementToken, originalRetryToken);
  assert.notEqual(replacementToken, '0'.repeat(64));
  assert.equal(runSql(container, `select (
    invite.token_hash = encode(extensions.digest(convert_to(mail.token_value, 'UTF8'), 'sha256'), 'hex')
  )::text from app.church_admin_invite as invite
  join private.church_invite_mail as mail on mail.invite_id = invite.id
  where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`), 'true');

  runSql(container, `update private.church_invite_mail set attempt_count = 4
    where invite_id = (select id from app.church_admin_invite
      where public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid);`);
  const finalLease = randomUUID();
  const fifthAttempt = (await rpc(admin, 'church_invite_worker_claim', {
    p_lease_token: finalLease, p_limit: 10,
  })).find((item) => item.invite_id === retryInvite.invite_id);
  assert.ok(fifthAttempt);
  assert.equal(fifthAttempt.attempt_count, 5);
  assert.equal(await rpc(admin, 'church_invite_worker_complete', {
    p_job_id: fifthAttempt.job_id, p_lease_token: finalLease,
    p_outcome: 'sent', p_provider_reference: randomUUID(),
  }), true);
  assert.equal(runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`), replacementToken);
  runSql(container, `with timing as (select clock_timestamp() - interval '8 days' as moment)
    update app.church_admin_invite as invite
    set issued_at = timing.moment, expires_at = timing.moment + interval '7 days'
    from timing where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  await rpc(admin, 'church_invite_worker_claim', { p_lease_token: randomUUID(), p_limit: 10 });
  assert.equal(runSql(container, `select invite.state || ':' || mail.state || ':' || mail.token_value
    from app.church_admin_invite as invite
    join private.church_invite_mail as mail on mail.invite_id = invite.id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`),
  `expired:cancelled:${'0'.repeat(64)}`);

  assert.equal(runSql(container, `select count(*) from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role')
      and table_schema in ('app', 'private')
      and table_name in ('church_slug_history', 'church_admin_membership', 'church_admin_event',
        'church_operation', 'church_admin_invite', 'church_invite_mail')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`), '0');
  assert.equal(runSql(container, `select count(*) from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'private')
      and relation.relname in ('church_slug_history', 'church_admin_membership', 'church_admin_event',
        'church_operation', 'church_admin_invite', 'church_invite_mail')
      and relation.relrowsecurity and relation.relforcerowsecurity;`), '6');
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = ${sqlLiteral(firstInternalId)}::uuid
       and event_type in ('church.created', 'membership.joined', 'church.content_updated');`), '3');

  process.stdout.write([
    'Church administration foundation verification passed:',
    '- only fully eligible actors can publish a church page',
    '- creation is actor-derived, idempotent, and immediately creates the first equal administrator place',
    '- church source text edits are member-only, idempotent, version-checked, and public only through the deliberate projection',
    '- normalized-address and PostGIS proximity checks return the existing safe page instead of duplicating it',
    '- suspicious same-address geography fails closed for protected review',
    '- administrator membership and pending invitations share a three-place cap; own-place transfer is atomic',
    '- invite acceptance requires the matching confirmed email, a valid token, and eligibility',
    '- a member may leave while another active administrator remains',
    '- failed delivery can be resent with a fresh hashed token; fifth-attempt success retains it until expiry',
    '- expiring a delivered invitation scrubs the clear token',
    '- administrator membership grants no visitor transport access',
    '- administrative tables remain behind forced RLS with no direct application-role grants',
  ].join('\n') + '\n');
} finally {
  if (createdUserIds.length > 0) {
    try {
      const accountList = createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
      runSql(container, `
        delete from private.church_invite_mail where invite_id in (
          select id from app.church_admin_invite where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        );
        delete from app.church_admin_invite where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_admin_event where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_admin_membership where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.ride_response where passenger_account_id in (${accountList});
        delete from app.ride_condition_snapshot where passenger_request_id in (
          select id from app.passenger_request where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        );
        delete from app.driver_offer_occurrence where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.passenger_request where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.user_place where owner_account_id in (${accountList})
          and exact_address in ('Synthetic meeting', 'Synthetic departure', 'Synthetic custom departure');
        delete from app.service_occurrence where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_slug_history where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.church_operation where actor_account_id in (${accountList});
        delete from app.church where created_by in (${accountList});
        delete from app.account where id in (${accountList});
        delete from app.legal_document_version where version = ${sqlLiteral(`church-test-${suffix}`)};
      `);
    } catch {
      // The disposable local database is rebuilt before every CI integration run.
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }
}
