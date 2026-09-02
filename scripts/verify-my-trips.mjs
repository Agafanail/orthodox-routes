import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const sections = ['needs_response', 'upcoming', 'listings', 'history'];

function fail(message) { throw new Error(message); }

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase My Trips test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only My Trips configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for My Trips verification.');
  const container = result.stdout.split(/\r?\n/).map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function runSql(container, statement) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (result.status !== 0) fail(`A My Trips database assertion failed.\n${result.stderr}`);
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function callRpc(client, name, args = {}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await client.schema('api').rpc(name, args);
    const cachePending = result.error
      && /schema cache|could not find the function|retrying/i.test(result.error.message);
    if (!cachePending || attempt === 59) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Unreachable RPC retry state.');
}

async function rpc(client, name, args = {}) {
  const result = await callRpc(client, name, args);
  if (result.error) fail(`My Trips RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic My Trips user could not sign in.');
}

function isoAfter(days, hour, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

function itemById(payload, section, objectId) {
  return payload[section].find((item) => item.object_id === objectId);
}

function allItems(payload) {
  return sections.flatMap((section) => payload[section].map((item) => ({ item, section })));
}

function assertProjectionShape(payload) {
  assert.deepEqual(Object.keys(payload).sort(), [...sections].sort());
  const seen = new Set();
  for (const { item, section } of allItems(payload)) {
    assert.equal(item.primary_section, section);
    const key = `${item.object_kind}:${item.object_id}`;
    assert.equal(seen.has(key), false, `Duplicate top-level My Trips object: ${key}`);
    seen.add(key);
  }
}

function assertNoProtectedPayload(payload, forbiddenValues) {
  const forbiddenKeys = new Set([
    'address', 'contact', 'coordinates', 'email', 'exact_address', 'exact_label', 'exact_point',
    'geometry', 'lat', 'lng', 'note', 'origin', 'phone', 'place', 'private_note', 'public_note',
    'route', 'secret', 'token',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `Protected key leaked into My Trips: ${key}`);
      visit(child);
    }
  };
  visit(payload);
  const serialized = JSON.stringify(payload);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false, `Protected fixture value leaked into My Trips: ${value}`);
  }
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const nowValue = Date.now();
const suffix = `${nowValue}-${process.pid}`;
const phoneStem = String(nowValue).slice(-9);
const password = `Local-my-trips-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);
const identities = [
  { email: `trips-passenger-a-${suffix}@example.test`, name: 'Trips Passenger Alpha', phone: `+390${phoneStem}1` },
  { email: `trips-passenger-b-${suffix}@example.test`, name: 'Trips Passenger Beta', phone: `+390${phoneStem}2` },
  { email: `trips-passenger-c-${suffix}@example.test`, name: 'Trips Passenger Gamma', phone: `+390${phoneStem}3` },
  { email: `trips-driver-${suffix}@example.test`, name: 'Trips Driver Delta', phone: `+390${phoneStem}4` },
  { email: `trips-unrelated-${suffix}@example.test`, name: 'Trips Unrelated User', phone: `+390${phoneStem}5` },
];

for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic My Trips identity could not be created.');
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
    'terms', ${sqlLiteral(`my-trips-test-${suffix}`)}, array['en'], now() - interval '1 hour',
    'published', repeat('7', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');
runSql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

const churches = [
  {
    id: randomUUID(), slug: `trips-north-${suffix}`, name: 'Synthetic Northern Church',
    locality: 'North Test City', country: 'IT', lng: 7.6869, lat: 45.0703,
  },
  {
    id: randomUUID(), slug: `trips-south-${suffix}`, name: 'Synthetic Southern Church',
    locality: 'South Test City', country: 'DE', lng: 13.405, lat: 52.52,
  },
];
for (const church of churches) {
  runSql(container, `
    insert into app.church (
      public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
    ) values (
      ${sqlLiteral(church.id)}::uuid, ${sqlLiteral(church.slug)}, ${sqlLiteral(church.name)},
      'Synthetic public church address', ${sqlLiteral(church.locality)}, ${sqlLiteral(church.country)},
      'UTC', 'published',
      extensions.st_setsrid(extensions.st_makepoint(${church.lng}, ${church.lat}), 4326)::extensions.geography
    );
  `);
}

let placeCounter = 0;
async function publishRequest(passengerIndex, church, arrivalAt, label, passengers = 1) {
  placeCounter += 1;
  return rpc(clients[passengerIndex], 'publish_passenger_request', {
    p_child_seat_required: false,
    p_children_count: 0,
    p_church_id: church.id,
    p_client_key: randomUUID(),
    p_desired_arrival_at: arrivalAt,
    p_places: [syntheticPlace(
      church.lat - 0.02 - placeCounter / 10000,
      church.lng - 0.02 - placeCounter / 10000,
      `MY_TRIPS_EXACT_${label}`,
      `${label} safe district`,
    )],
    p_public_note: `MY_TRIPS_NOTE_${label}`,
    p_return_required: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_passengers: passengers,
  });
}

async function publishOccurrence(church, arrivalAt, label, seats = 4) {
  placeCounter += 1;
  const departureAt = new Date(new Date(arrivalAt).getTime() - 60 * 60 * 1000).toISOString();
  return rpc(clients[3], 'publish_driver_occurrence', {
    p_arrival_at: arrivalAt,
    p_children_allowed: true,
    p_church_id: church.id,
    p_client_key: randomUUID(),
    p_departure_at: departureAt,
    p_driver_child_seat_available: true,
    p_max_detour_km: 5,
    p_origin: syntheticPlace(
      church.lat - 0.04 - placeCounter / 10000,
      church.lng - 0.04 - placeCounter / 10000,
      `MY_TRIPS_EXACT_DRIVER_${label}`,
      `${label} safe origin district`,
    ),
    p_public_note: `MY_TRIPS_NOTE_DRIVER_${label}`,
    p_return_available: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_seats: seats,
  });
}

async function requestPlaceId(church, requestId) {
  const requests = await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: church.id });
  const placeId = requests.find((request) => request.request_id === requestId)?.place_options[0]?.place_id;
  if (!placeId) fail('A synthetic My Trips request place is unavailable.');
  return placeId;
}

async function arrangeRide(passengerIndex, church, arrivalAt, label, passengers = 1) {
  const request = await publishRequest(passengerIndex, church, arrivalAt, `${label}_REQUEST`, passengers);
  const occurrence = await publishOccurrence(church, arrivalAt, `${label}_OFFER`, passengers + 1);
  const response = await rpc(clients[3], 'submit_driver_response', {
    p_client_key: randomUUID(),
    p_occurrence_id: occurrence.occurrence_id,
    p_offered_passenger_count: passengers,
    p_place_id: await requestPlaceId(church, request.request_id),
    p_request_id: request.request_id,
  });
  const agreement = await rpc(clients[passengerIndex], 'confirm_ride_response', {
    p_client_key: randomUUID(), p_response_id: response.response_id,
  });
  return { agreement, occurrence, request, response };
}

const listingRequest = await publishRequest(0, churches[0], isoAfter(20, 8), 'LISTING');

const passengerDecisionRequest = await publishRequest(0, churches[0], isoAfter(21, 9), 'PASSENGER_DECISION');
const passengerDecisionOccurrence = await publishOccurrence(churches[0], isoAfter(21, 9), 'PASSENGER_DECISION');
const passengerDecisionResponse = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(),
  p_occurrence_id: passengerDecisionOccurrence.occurrence_id,
  p_offered_passenger_count: 1,
  p_place_id: await requestPlaceId(churches[0], passengerDecisionRequest.request_id),
  p_request_id: passengerDecisionRequest.request_id,
});

const aggregateOccurrence = await publishOccurrence(churches[1], isoAfter(22, 10), 'AGGREGATE', 5);
const aggregateRequestA = await publishRequest(0, churches[1], isoAfter(22, 10), 'AGGREGATE_A');
const aggregateRequestB = await publishRequest(1, churches[1], isoAfter(22, 10), 'AGGREGATE_B', 2);
const aggregateResponseA = await rpc(clients[0], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: aggregateOccurrence.occurrence_id,
  p_request_id: aggregateRequestA.request_id,
});
const aggregateResponseB = await rpc(clients[1], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: aggregateOccurrence.occurrence_id,
  p_request_id: aggregateRequestB.request_id,
});

const confirmedRide = await arrangeRide(2, churches[0], isoAfter(23, 11), 'CONFIRMED');
const changePendingRide = await arrangeRide(0, churches[1], isoAfter(24, 12), 'CHANGE_PENDING');
runSql(container, `
  update app.ride_agreement set status = 'change_pending'
  where public_id = ${sqlLiteral(changePendingRide.agreement.agreement_id)}::uuid;
`);

const declinedRequest = await publishRequest(0, churches[0], isoAfter(25, 13), 'DECLINED');
const declinedOccurrence = await publishOccurrence(churches[0], isoAfter(25, 13), 'DECLINED');
const declinedResponse = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(),
  p_occurrence_id: declinedOccurrence.occurrence_id,
  p_offered_passenger_count: 1,
  p_place_id: await requestPlaceId(churches[0], declinedRequest.request_id),
  p_request_id: declinedRequest.request_id,
});
await rpc(clients[0], 'decline_ride_response', {
  p_client_key: randomUUID(), p_response_id: declinedResponse.response_id,
});

const cancelledRide = await arrangeRide(0, churches[1], isoAfter(26, 14), 'CANCELLED');
await rpc(clients[3], 'cancel_ride_agreement', {
  p_agreement_id: cancelledRide.agreement.agreement_id, p_client_key: randomUUID(),
});

const completedRide = await arrangeRide(0, churches[0], isoAfter(27, 15), 'COMPLETED');
const noOutcomeRide = await arrangeRide(1, churches[0], isoAfter(28, 16), 'NO_OUTCOME');
const archivedRide = await arrangeRide(2, churches[1], isoAfter(29, 17), 'ARCHIVED');
runSql(container, `
  update app.ride_agreement set status = 'completed', completed_at = now() - interval '1 hour'
  where public_id = ${sqlLiteral(completedRide.agreement.agreement_id)}::uuid;
  update app.ride_agreement set status = 'no_outcome', completed_at = now() - interval '8 days'
  where public_id = ${sqlLiteral(noOutcomeRide.agreement.agreement_id)}::uuid;
  update app.ride_agreement set status = 'archived', completed_at = now() - interval '31 days',
    archived_at = now()
  where public_id = ${sqlLiteral(archivedRide.agreement.agreement_id)}::uuid;
  update app.driver_offer_occurrence set status = 'completed', closed_at = now(), updated_at = now()
  where public_id in (
    ${sqlLiteral(completedRide.occurrence.occurrence_id)}::uuid,
    ${sqlLiteral(noOutcomeRide.occurrence.occurrence_id)}::uuid,
    ${sqlLiteral(archivedRide.occurrence.occurrence_id)}::uuid
  );
`);

const listingOccurrence = await publishOccurrence(churches[0], isoAfter(30, 18), 'LISTING');
const seriesDate = isoAfter(31, 19).slice(0, 10);
const seriesDay = new Date(`${seriesDate}T19:00:00Z`).getUTCDay();
const listingSeries = await rpc(clients[3], 'publish_driver_series', {
  p_children_allowed: true,
  p_church_id: churches[1].id,
  p_client_key: randomUUID(),
  p_driver_child_seat_available: true,
  p_ends_on: seriesDate,
  p_local_arrival_time: '19:00:00',
  p_local_departure_time: '18:00:00',
  p_max_detour_km: 5,
  p_origin: syntheticPlace(52.48, 13.36, 'MY_TRIPS_EXACT_DRIVER_SERIES', 'Series safe district'),
  p_public_note: 'MY_TRIPS_NOTE_DRIVER_SERIES',
  p_return_available: false,
  p_starts_on: seriesDate,
  p_timezone: 'UTC',
  p_total_seats: 3,
  p_weekdays: [seriesDay],
});

const anonymousResult = await callRpc(anonymous, 'current_my_trips');
assert.ok(anonymousResult.error, 'Anonymous My Trips access unexpectedly succeeded.');

const unrelatedTrips = await rpc(clients[4], 'current_my_trips');
assertProjectionShape(unrelatedTrips);
for (const section of sections) assert.deepEqual(unrelatedTrips[section], []);

const passengerTrips = await rpc(clients[0], 'current_my_trips');
assertProjectionShape(passengerTrips);
assert.ok(itemById(passengerTrips, 'listings', listingRequest.request_id));
const passengerDecision = itemById(passengerTrips, 'needs_response', passengerDecisionResponse.response_id);
assert.equal(passengerDecision.current_role, 'passenger');
assert.equal(passengerDecision.status, 'await_passenger');
assert.equal(passengerDecision.action_required, true);
const waitingForDriver = itemById(passengerTrips, 'listings', aggregateResponseA.response_id);
assert.equal(waitingForDriver.action_required, false);
assert.equal(waitingForDriver.status, 'await_driver');
const changePending = itemById(passengerTrips, 'upcoming', changePendingRide.agreement.agreement_id);
assert.equal(changePending.status, 'change_pending');
assert.equal(changePending.action_required, false);
assert.equal(itemById(passengerTrips, 'history', declinedResponse.response_id).status, 'declined');
const cancelled = itemById(passengerTrips, 'history', cancelledRide.agreement.agreement_id);
assert.equal(cancelled.status, 'cancelled');
assert.equal(cancelled.cancelled_by_role, 'driver');
assert.equal(itemById(passengerTrips, 'history', completedRide.agreement.agreement_id).status, 'completed');

const passengerChurches = new Set(allItems(passengerTrips).map(({ item }) => item.church.church_id));
assert.deepEqual([...passengerChurches].sort(), churches.map((church) => church.id).sort());
for (const { item } of allItems(passengerTrips)) assert.equal(item.current_role, 'passenger');

const secondPassengerTrips = await rpc(clients[1], 'current_my_trips');
assertProjectionShape(secondPassengerTrips);
assert.equal(itemById(secondPassengerTrips, 'history', noOutcomeRide.agreement.agreement_id).status, 'no_outcome');

const thirdPassengerTrips = await rpc(clients[2], 'current_my_trips');
assertProjectionShape(thirdPassengerTrips);
assert.equal(itemById(thirdPassengerTrips, 'upcoming', confirmedRide.agreement.agreement_id).status, 'confirmed');
assert.equal(itemById(thirdPassengerTrips, 'history', archivedRide.agreement.agreement_id).status, 'archived');

const driverTrips = await rpc(clients[3], 'current_my_trips');
assertProjectionShape(driverTrips);
for (const { item } of allItems(driverTrips)) assert.equal(item.current_role, 'driver');
const aggregated = itemById(driverTrips, 'needs_response', aggregateOccurrence.occurrence_id);
assert.ok(aggregated);
assert.equal(aggregated.object_kind, 'driver_occurrence');
assert.equal(aggregated.action_required, true);
assert.equal(aggregated.counts.response_count, 2);
assert.equal(aggregated.counts.pending_response_count, 2);
assert.equal(aggregated.counts.action_required_count, 2);
assert.equal(aggregated.children.responses.length, 2);
assert.deepEqual(
  aggregated.children.responses.map((response) => response.object_id).sort(),
  [aggregateResponseA.response_id, aggregateResponseB.response_id].sort(),
);
const confirmedDriverOccurrence = itemById(driverTrips, 'upcoming', confirmedRide.occurrence.occurrence_id);
assert.ok(confirmedDriverOccurrence);
assert.equal(confirmedDriverOccurrence.counts.confirmed_seats, 1);
assert.equal(confirmedDriverOccurrence.counts.available_seats, 1);
assert.equal(confirmedDriverOccurrence.counts.agreement_count, 1);
assert.equal(confirmedDriverOccurrence.children.agreements[0].object_id, confirmedRide.agreement.agreement_id);
assert.ok(itemById(driverTrips, 'listings', listingOccurrence.occurrence_id));
assert.ok(itemById(driverTrips, 'listings', listingSeries.series_id));
assert.ok(itemById(driverTrips, 'history', completedRide.occurrence.occurrence_id));
assert.ok(itemById(driverTrips, 'history', noOutcomeRide.occurrence.occurrence_id));
assert.ok(itemById(driverTrips, 'history', archivedRide.occurrence.occurrence_id));
const driverTopLevelIds = new Set(allItems(driverTrips).map(({ item }) => item.object_id));
assert.equal(driverTopLevelIds.has(aggregateResponseA.response_id), false);
assert.equal(driverTopLevelIds.has(aggregateResponseB.response_id), false);
assert.equal(driverTopLevelIds.has(confirmedRide.agreement.agreement_id), false);

const forbiddenValues = [
  ...identities.flatMap((identity) => [identity.email, identity.phone]),
  'MY_TRIPS_EXACT_', 'MY_TRIPS_NOTE_', 'Synthetic public church address',
];
for (const payload of [passengerTrips, secondPassengerTrips, thirdPassengerTrips, driverTrips]) {
  assertNoProtectedPayload(payload, forbiddenValues);
}

assert.equal(runSql(container, `
  select has_function_privilege('anon', 'api.current_my_trips()', 'execute')::text || ':' ||
    has_function_privilege('authenticated', 'api.current_my_trips()', 'execute')::text || ':' ||
    has_function_privilege('service_role', 'api.current_my_trips()', 'execute')::text;
`), 'false:true:false');
assert.equal(runSql(container, `
  select count(*) from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'api' and procedure.proname = 'current_my_trips'
    and procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ','), '') like '%search_path=""%';
`), '1');
assert.equal(runSql(container, `
  select count(*) from information_schema.role_table_grants
  where table_schema in ('app', 'private')
    and table_name in (
      'account', 'church', 'passenger_request', 'driver_offer_series', 'driver_offer_occurrence',
      'ride_response', 'ride_condition_snapshot', 'ride_agreement'
    )
    and grantee in ('anon', 'authenticated', 'service_role');
`), '0');
assert.equal(runSql(container, `
  select count(*) from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'app'
    and class.relname in (
      'account', 'church', 'passenger_request', 'driver_offer_series', 'driver_offer_occurrence',
      'ride_response', 'ride_condition_snapshot', 'ride_agreement'
    )
    and class.relrowsecurity and class.relforcerowsecurity;
`), '8');

console.log('Account-scoped My Trips authorization, classification, aggregation, and privacy verification passed.');
