import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) {
  throw new Error(message);
}

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase transport test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only transport configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for transport verification.');
  const container = result.stdout.split(/\r?\n/).map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(container, statement) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (result.status !== 0) fail(`A transport database assertion failed.\n${result.stderr}`);
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Transport RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic transport user could not sign in.');
}

function isoAfter(days, hour) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function dateAfter(days) {
  return isoAfter(days, 12).slice(0, 10);
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-10);
const password = `Local-transport-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);
const identities = [
  { email: `transport-passenger-${suffix}@example.test`, name: 'Transport Passenger', phone: `+39${phoneStem}1` },
  { email: `transport-driver-${suffix}@example.test`, name: 'Transport Driver', phone: `+39${phoneStem}2` },
  { email: `transport-other-${suffix}@example.test`, name: 'Transport Other', phone: `+39${phoneStem}3` },
];

for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic transport identity could not be created.');
  identity.id = created.data.user.id;
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
    'terms', ${sqlLiteral(`transport-test-${suffix}`)}, array['en'], now() - interval '1 day', 'published', repeat('a', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');

await expectRpcFailure(clients[2], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: randomUUID(),
  p_client_key: randomUUID(),
  p_desired_arrival_at: isoAfter(7, 9),
  p_places: [{ exact_label: 'Hidden other place', public_area_label: 'Other area' }],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});

runSql(container, `
  update private.account_contact
  set phone_verified_at = now()
  where account_id in (${identities.map((identity) => sqlLiteral(identity.id)).join(', ')});
`);

const churchId = randomUUID();
const serviceId = randomUUID();
const serviceTime = isoAfter(7, 9);
runSql(container, `
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status
  ) values (
    ${sqlLiteral(churchId)}, ${sqlLiteral(`transport-test-${suffix}`)}, 'Synthetic Transport Church',
    'Synthetic public church address', 'Test Locality', 'IT', 'UTC', 'published'
  );
  insert into app.service_occurrence (public_id, church_id, source_name, starts_at, timezone)
  select ${sqlLiteral(serviceId)}, id, 'Synthetic Liturgy', ${sqlLiteral(serviceTime)}::timestamptz, 'UTC'
  from app.church where public_id = ${sqlLiteral(churchId)}::uuid;
`);

const requestKey = randomUUID();
const requestArgs = {
  p_child_seat_required: true,
  p_children_count: 1,
  p_church_id: churchId,
  p_client_key: requestKey,
  p_desired_arrival_at: serviceTime,
  p_places: [
    { exact_label: 'Exact private entrance A', public_area_label: 'North district' },
    { exact_label: 'Exact private entrance B', public_area_label: 'Central district' },
  ],
  p_public_note: 'Folding wheelchair',
  p_return_required: true,
  p_service_occurrence_id: serviceId,
  p_timezone: 'UTC',
  p_total_passengers: 3,
};
const request = await rpc(clients[0], 'publish_passenger_request', requestArgs);
assert.equal(request.status, 'active');
assert.deepEqual(await rpc(clients[0], 'publish_passenger_request', requestArgs), request);
const changedRequestError = await expectRpcFailure(clients[0], 'publish_passenger_request', {
  ...requestArgs, p_total_passengers: 4,
});
assert.match(changedRequestError.message, /idempotency/i);
await expectRpcFailure(clients[0], 'publish_passenger_request', {
  ...requestArgs, p_client_key: randomUUID(), p_public_note: 'Call +390000009999',
});
await expectRpcFailure(clients[1], 'publish_passenger_request', {
  ...requestArgs, p_client_key: randomUUID(), p_service_occurrence_id: randomUUID(),
});

const occurrenceKey = randomUUID();
const occurrenceArgs = {
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: occurrenceKey,
  p_departure_at: isoAfter(7, 8),
  p_driver_child_seat_available: true,
  p_exact_origin_label: 'Exact private driver origin',
  p_max_detour_km: 5,
  p_public_note: 'Room for a folded stroller',
  p_public_origin_area: 'South district',
  p_return_available: true,
  p_service_occurrence_id: serviceId,
  p_timezone: 'UTC',
  p_total_seats: 3,
  p_arrival_at: serviceTime,
};
const occurrence = await rpc(clients[1], 'publish_driver_occurrence', occurrenceArgs);
assert.equal(occurrence.available_seats, 3);
assert.deepEqual(await rpc(clients[1], 'publish_driver_occurrence', occurrenceArgs), occurrence);

const startDate = dateAfter(1);
const endDate = dateAfter(14);
const startDow = new Date(`${startDate}T12:00:00Z`).getUTCDay();
const series = await rpc(clients[1], 'publish_driver_series', {
  p_children_allowed: false,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_driver_child_seat_available: false,
  p_ends_on: endDate,
  p_exact_origin_label: 'Exact repeated driver origin',
  p_local_arrival_time: '10:00:00',
  p_local_departure_time: '09:00:00',
  p_max_detour_km: 2,
  p_public_note: null,
  p_public_origin_area: 'West district',
  p_return_available: false,
  p_starts_on: startDate,
  p_timezone: 'UTC',
  p_total_seats: 2,
  p_weekdays: [startDow],
});
assert.equal(series.status, 'active');
assert.equal(series.occurrence_count, 2);

const publicRequests = await rpc(anonymous, 'list_active_passenger_requests');
const publicRequest = publicRequests.find((item) => item.request_id === request.request_id);
assert.ok(publicRequest);
assert.deepEqual(publicRequest.public_areas, ['North district', 'Central district']);
assert.equal(JSON.stringify(publicRequest).includes('Exact private'), false);
assert.equal(JSON.stringify(publicRequest).includes(identities[0].phone), false);
assert.equal(JSON.stringify(publicRequest).includes(identities[0].email), false);

const publicOccurrences = await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId });
const publicOccurrence = publicOccurrences.find((item) => item.occurrence_id === occurrence.occurrence_id);
assert.ok(publicOccurrence);
assert.equal(publicOccurrence.public_origin_area, 'South district');
assert.equal(JSON.stringify(publicOccurrence).includes('Exact private'), false);
assert.equal(JSON.stringify(publicOccurrence).includes(identities[1].phone), false);

const passengerOwned = await rpc(clients[0], 'current_transport_items');
assert.equal(passengerOwned.passenger_requests.length, 1);
assert.equal(passengerOwned.passenger_requests[0].places[0].exact_label, 'Exact private entrance A');
assert.equal(passengerOwned.driver_occurrences.length, 0);
const otherOwned = await rpc(clients[2], 'current_transport_items');
assert.deepEqual(otherOwned.passenger_requests, []);
assert.deepEqual(otherOwned.driver_occurrences, []);

await expectRpcFailure(clients[2], 'cancel_passenger_request', {
  p_client_key: randomUUID(), p_request_id: request.request_id,
});
await expectRpcFailure(clients[0], 'cancel_driver_occurrence', {
  p_client_key: randomUUID(), p_occurrence_id: occurrence.occurrence_id,
});

const cancelRequestKey = randomUUID();
const cancelledRequest = await rpc(clients[0], 'cancel_passenger_request', {
  p_client_key: cancelRequestKey, p_request_id: request.request_id,
});
assert.equal(cancelledRequest.status, 'cancelled');
assert.deepEqual(await rpc(clients[0], 'cancel_passenger_request', {
  p_client_key: cancelRequestKey, p_request_id: request.request_id,
}), cancelledRequest);
assert.equal((await rpc(anonymous, 'list_active_passenger_requests')).some((item) => item.request_id === request.request_id), false);

const cancelOccurrenceKey = randomUUID();
assert.equal((await rpc(clients[1], 'cancel_driver_occurrence', {
  p_client_key: cancelOccurrenceKey, p_occurrence_id: occurrence.occurrence_id,
})).status, 'cancelled');
assert.equal((await rpc(anonymous, 'list_active_driver_occurrences')).some((item) => item.occurrence_id === occurrence.occurrence_id), false);

const stopped = await rpc(clients[1], 'stop_driver_series', {
  p_client_key: randomUUID(), p_series_id: series.series_id,
});
assert.equal(stopped.status, 'stopped');
assert.equal(stopped.cancelled_occurrences, 2);

const directAnonymousRead = await fetch(`${url}/rest/v1/passenger_request?select=*`, {
  headers: { apikey: publicKey, 'x-client-info': 'transport-foundation-verifier' },
});
assert.ok([401, 403, 404, 406].includes(directAnonymousRead.status));

assert.equal(runSql(container, `
  select count(*) from information_schema.role_table_grants
  where table_schema in ('app', 'private')
    and table_name in ('passenger_request', 'passenger_request_place', 'driver_offer_series', 'driver_offer_occurrence', 'user_place')
    and grantee in ('anon', 'authenticated', 'service_role');
`), '0');
assert.equal(runSql(container, `
  select count(*) from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname in ('app', 'private')
    and class.relname in ('church', 'service_occurrence', 'user_place', 'transport_operation', 'passenger_request', 'passenger_request_place', 'driver_offer_series', 'driver_offer_occurrence')
    and class.relrowsecurity and class.relforcerowsecurity;
`), '8');
assert.equal(runSql(container, `
  select count(*) from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('api', 'app', 'ops')
    and procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ','), '') not like '%search_path=\"\"%';
`), '0');

console.log('Transport domain foundation verification passed.');
