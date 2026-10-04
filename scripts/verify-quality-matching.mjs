// Verifies deterministic quality matching against the local synthetic database only.
//
// It proves every approved hard condition, the detour rule and its explanation, the best
// compatible place among several, recomputation when inputs change, that an unmeasured
// candidate is never called a mismatch, that a confirmed agreement is not destroyed by later
// matching changes, and that no counterpart exact geography reaches a participant through it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) { throw new Error(message); }

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase matching stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only matching configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for matching verification.');
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
  if (result.status !== 0) fail(`A matching database assertion failed.\n${result.stderr}`);
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
  if (result.error) fail(`Matching RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await callRpc(client, name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

function isoAfter(days, hour, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

/**
 * A deterministic stand-in for a route provider: straight lines with a fixed road factor.
 * It is never described as provider verification; it exists so every rule can be proved
 * without an account, a network call, or spend.
 */
const ROAD_FACTOR = 1.3;
const AVERAGE_SPEED_MS = 13.9;

function metres(from, to) {
  const earthRadius = 6371008.8;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function measureAllPendingLegs(worker) {
  let measured = 0;
  for (let round = 0; round < 20; round += 1) {
    const legs = await rpc(worker, 'route_worker_pending_legs', { p_limit: 50 });
    if (legs.length === 0) return measured;
    for (const leg of legs) {
      const distance = (leg.via
        ? metres(leg.origin, leg.via) + metres(leg.via, leg.destination)
        : metres(leg.origin, leg.destination)) * ROAD_FACTOR;
      await rpc(worker, 'route_worker_record_leg', {
        p_church_id: leg.church_id,
        p_distance_m: Math.round(distance),
        p_duration_s: Math.round(distance / AVERAGE_SPEED_MS),
        p_origin_place_id: leg.origin_place_id,
        p_provider_name: 'local-fake',
        p_via_place_id: leg.via_place_id,
      });
      measured += 1;
    }
  }
  fail('The pending route legs never drained.');
  return measured;
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-9);
const password = `Local-matching-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const worker = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);

const identities = [
  { email: `match-passenger-${suffix}@example.test`, name: 'Match Passenger', phone: `+390${phoneStem}1` },
  { email: `match-driver-${suffix}@example.test`, name: 'Match Driver', phone: `+390${phoneStem}2` },
  { email: `match-far-driver-${suffix}@example.test`, name: 'Match Far Driver', phone: `+390${phoneStem}3` },
  { email: `match-blocked-${suffix}@example.test`, name: 'Match Blocked Driver', phone: `+390${phoneStem}4` },
];
for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic matching identity could not be created.');
  identity.id = created.data.user.id;
}
const clients = identities.map(() => userClient(url, publicKey));
for (let index = 0; index < clients.length; index += 1) {
  const signedIn = await clients[index].auth.signInWithPassword({ email: identities[index].email, password });
  if (signedIn.error) fail('A synthetic matching user could not sign in.');
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
    'terms', ${sqlLiteral(`match-test-${suffix}`)}, array['en'], now() - interval '1 hour', 'published', repeat('e', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');
runSql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

// The church sits in Turin; every synthetic place below is positioned relative to it.
const church = { lat: 45.0703, lng: 7.6869 };
const churchId = randomUUID();
runSql(container, `
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    ${sqlLiteral(churchId)}::uuid, ${sqlLiteral(`match-test-${suffix}`)}, ${sqlLiteral(`Match Church ${suffix}`)},
    'Synthetic public church address', 'Torino', 'IT', 'UTC', 'published',
    extensions.st_setsrid(extensions.st_makepoint(${church.lng}, ${church.lat}), 4326)::extensions.geography
  );
`);

const arrivalAt = isoAfter(7, 9);
const departureAt = isoAfter(7, 8);

// Place A sits almost on the driver's straight line to the church; place B is far off it.
const nearPlace = syntheticPlace(45.0500, 7.6700, 'Exact near meeting place', 'Torino');
const offPlace = syntheticPlace(45.0450, 7.5600, 'Exact off-line meeting place', 'Rivoli');
const middlePlace = syntheticPlace(45.0400, 7.6600, 'Exact middle meeting place', 'Moncalieri');
const driverOrigin = syntheticPlace(45.0200, 7.6500, 'Exact driver departure', 'Moncalieri');

const request = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: arrivalAt,
  p_places: [nearPlace, offPlace, middlePlace],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 2,
});

const occurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: arrivalAt,
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: departureAt,
  p_driver_child_seat_available: true,
  p_max_detour_km: 5,
  p_origin: driverOrigin,
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 3,
});

// ------------------------------------------------------------------ before measurement

// Without a road measurement the pair is simply not established. It is never a mismatch.
assert.deepEqual(await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }), []);
assert.deepEqual(await rpc(clients[1], 'list_quality_matches', { p_church_id: churchId }), []);

// A signed-in person must never reach the measurement bridge: it carries exact coordinates.
await expectRpcFailure(clients[0], 'route_worker_pending_legs', { p_limit: 5 });
await expectRpcFailure(clients[0], 'route_worker_record_leg', {
  p_church_id: churchId, p_distance_m: 1, p_duration_s: 1, p_origin_place_id: randomUUID(),
  p_provider_name: 'local-fake', p_via_place_id: null,
});
await expectRpcFailure(anonymous, 'route_worker_pending_legs', { p_limit: 5 });
await expectRpcFailure(anonymous, 'list_quality_matches', { p_church_id: churchId });

// ------------------------------------------------------------------ measured matching

await measureAllPendingLegs(worker);

const passengerMatches = await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId });
assert.equal(passengerMatches.length, 1);
const [match] = passengerMatches;
assert.equal(match.occurrence_id, occurrence.occurrence_id);
assert.equal(match.request_id, request.request_id);
assert.equal(match.current_role, 'passenger');
assert.equal(match.available_seats, 3);
assert.equal(match.passenger_count, 2);

// The far-off place breaks the five-kilometre limit, so only the two workable places appear.
const placeLabels = match.places.map((place) => place.public_area_label).sort();
assert.deepEqual(placeLabels, ['Moncalieri', 'Torino']);
assert.equal(match.places.length, 2, 'A place beyond the detour limit must not be offered.');

// Alternatives stay visible and exactly one of them is marked as the best.
assert.equal(match.places.filter((place) => place.best).length, 1);
const best = match.places.find((place) => place.best);
assert.equal(best.added_distance_m, Math.min(...match.places.map((place) => place.added_distance_m)));
assert.equal(match.added_distance_m, best.added_distance_m);
assert.ok(match.added_distance_m >= 0);
assert.ok(match.added_distance_m <= 5000, 'The reported detour must respect the driver limit.');
assert.ok(match.added_duration_s > 0);

// The driver sees the same pair from the other side.
const driverMatches = await rpc(clients[1], 'list_quality_matches', { p_church_id: churchId });
assert.equal(driverMatches.length, 1);
assert.equal(driverMatches[0].current_role, 'driver');
await rpc(admin, 'notification_worker_enqueue_scheduled');
await rpc(admin, 'notification_worker_enqueue_scheduled');
const passengerMatchNotifications = (await rpc(clients[0], 'current_notifications')).filter((notification) =>
  notification.event_type === 'ride.quality_match'
  && notification.parameters.request_id === request.request_id
  && notification.parameters.occurrence_id === occurrence.occurrence_id);
const driverMatchNotifications = (await rpc(clients[1], 'current_notifications')).filter((notification) =>
  notification.event_type === 'ride.quality_match'
  && notification.parameters.request_id === request.request_id
  && notification.parameters.occurrence_id === occurrence.occurrence_id);
assert.equal(passengerMatchNotifications.length, 1);
assert.equal(driverMatchNotifications.length, 1);
assert.equal(JSON.stringify({ passengerMatchNotifications, driverMatchNotifications }).includes('Exact'), false);

// Neither side learns the other's exact geography through matching.
const matchPayload = JSON.stringify({ driverMatches, passengerMatches });
for (const secret of [
  'Exact near meeting place', 'Exact off-line meeting place', 'Exact middle meeting place',
  'Exact driver departure', '45.02', '7.65', '45.05',
]) {
  assert.equal(matchPayload.includes(secret), false, 'Matching must not expose exact geography.');
}
// No score, percentage, or route geometry exists in the result.
for (const token of ['score', 'percent', 'polyline', 'geometry', 'corridor', 'rating']) {
  assert.equal(matchPayload.toLowerCase().includes(token), false);
}

// An unrelated account sees no suggestion belonging to other people.
assert.deepEqual(await rpc(clients[2], 'list_quality_matches', { p_church_id: churchId }), []);

// ------------------------------------------------------------------ hard conditions

// Not enough seats for the whole remaining group is not an automatic suggestion.
const smallOccurrence = await rpc(clients[2], 'publish_driver_occurrence', {
  p_arrival_at: arrivalAt,
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: departureAt,
  p_driver_child_seat_available: true,
  p_max_detour_km: 20,
  p_origin: syntheticPlace(45.0210, 7.6510, 'Exact small-car departure', 'Moncalieri'),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 1,
});
await measureAllPendingLegs(worker);
assert.equal(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.occurrence_id === smallOccurrence.occurrence_id),
  false,
  'A driver with fewer seats than the whole group is not an automatic match.',
);

// A child in the group requires a driver who takes children.
const childRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: true,
  p_children_count: 1,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: isoAfter(8, 9),
  p_places: [syntheticPlace(45.0501, 7.6701, 'Exact child meeting place', 'Torino')],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 2,
});
const noChildrenOccurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: isoAfter(8, 9),
  p_children_allowed: false,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: isoAfter(8, 8),
  p_driver_child_seat_available: false,
  p_max_detour_km: 20,
  p_origin: syntheticPlace(45.0220, 7.6520, 'Exact no-children departure', 'Moncalieri'),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 4,
});
await measureAllPendingLegs(worker);
assert.equal(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.request_id === childRequest.request_id
      && item.occurrence_id === noChildrenOccurrence.occurrence_id),
  false,
  'A driver who cannot take children is not a match for a group with a child.',
);

// ------------------------------------------------------------------ the arrival window

// Time compatibility compares two stated times and nothing else. The driver's arrival is a
// target they commit to, so the minutes a pickup adds are not folded into it: a driver who
// needs longer to collect someone is expected to leave earlier. Both edges are inclusive.
const windowDesired = isoAfter(9, 10, 55);
const windowPlace = syntheticPlace(45.0520, 7.6720, 'Exact window meeting place', 'Torino');
const windowOrigin = { lat: 45.0200, lng: 7.6500 };
let windowSeed = 0;

/** A driver stating a church arrival exactly `offsetSeconds` from the passenger's desired time. */
async function driverStatingArrivalAt(offsetSeconds) {
  windowSeed += 1;
  const arrival = new Date(Date.parse(windowDesired) + offsetSeconds * 1000);
  return rpc(clients[1], 'publish_driver_occurrence', {
    p_arrival_at: arrival.toISOString(),
    p_children_allowed: true,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_departure_at: new Date(arrival.getTime() - 60 * 60 * 1000).toISOString(),
    p_driver_child_seat_available: true,
    p_max_detour_km: 20,
    p_origin: syntheticPlace(
      windowOrigin.lat, windowOrigin.lng, `Exact window departure ${windowSeed}`, 'Moncalieri',
    ),
    p_public_note: null,
    p_return_available: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_seats: 4,
  });
}

const windowRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: windowDesired,
  p_places: [windowPlace],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});

const exactlyAnHourEarly = await driverStatingArrivalAt(-60 * 60);
const beyondAnHourEarly = await driverStatingArrivalAt(-60 * 60 - 1);
const exactlyHalfAnHourLate = await driverStatingArrivalAt(30 * 60);
const beyondHalfAnHourLate = await driverStatingArrivalAt(30 * 60 + 1);
const oneMinuteLate = await driverStatingArrivalAt(60);
await measureAllPendingLegs(worker);

const windowMatches = await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId });
const offered = (occurrence) => windowMatches.some((item) => item.request_id === windowRequest.request_id
  && item.occurrence_id === occurrence.occurrence_id);

assert.equal(offered(exactlyAnHourEarly), true, 'Exactly an hour early is inside the window.');
assert.equal(offered(beyondAnHourEarly), false, 'A second past an hour early is outside it.');
assert.equal(offered(exactlyHalfAnHourLate), true, 'Exactly half an hour late is inside the window.');
assert.equal(offered(beyondHalfAnHourLate), false, 'A second past half an hour late is outside it.');
// The case the owner found: a driver a minute late is still useful. The original rule refused it.
assert.equal(offered(oneMinuteLate), true, 'Arriving one minute after the desired time still suits.');


// ------------------------------------------------------------------ minutes explain, not decide

// The mirror of the rule above. A pickup that costs a great many minutes must still match, so
// long as the driver's stated arrival is inside the window and the detour fits the approved
// kilometres. The minutes are shown to people as an explanation and decide nothing.
const explainDesired = isoAfter(10, 10, 55);
const farPlace = syntheticPlace(45.0450, 7.5600, 'Exact far explanation place', 'Rivoli');

const farRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: explainDesired,
  p_places: [farPlace],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});

// Stated arrival twenty minutes after the desired time: inside the window, and close enough to
// the late edge that any earlier rule folding the detour in would have rejected it.
windowSeed += 1;
const lateButStatedInside = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: new Date(Date.parse(explainDesired) + 20 * 60 * 1000).toISOString(),
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: new Date(Date.parse(explainDesired) - 40 * 60 * 1000).toISOString(),
  p_driver_child_seat_available: true,
  p_max_detour_km: 20,
  p_origin: syntheticPlace(
    windowOrigin.lat, windowOrigin.lng, `Exact explanation departure ${windowSeed}`, 'Moncalieri',
  ),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 4,
});
await measureAllPendingLegs(worker);

const explained = (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
  .find((item) => item.request_id === farRequest.request_id
    && item.occurrence_id === lateButStatedInside.occurrence_id);
assert.ok(
  explained,
  'A long pickup does not remove a suggestion whose stated arrival is inside the window.',
);
assert.ok(
  explained.places[0].added_duration_s > 10 * 60,
  'This pickup must genuinely cost many minutes, or the case proves nothing.',
);
assert.ok(
  explained.places[0].added_distance_m <= 20 * 1000,
  'The same pickup must stay inside the approved kilometres, so only the minutes are in question.',
);


// ------------------------------------------------------------------ the same service

// Two people who chose the same service occurrence are compatible in time by definition, and
// the window never applies to them. Publishing enforces that both sides name the service's own
// time, so the pair is created legitimately and the driver's clock is then moved three hours —
// far outside anything the window would accept — to prove the window is not consulted at all.
const serviceId = randomUUID();
runSql(container, `
  insert into app.service_occurrence (public_id, church_id, source_name, starts_at, timezone)
  select ${sqlLiteral(serviceId)}, id, ${sqlLiteral(`Synthetic Liturgy ${suffix}`)},
    ${sqlLiteral(isoAfter(11, 9))}::timestamptz, 'UTC'
  from app.church where public_id = ${sqlLiteral(churchId)}::uuid;
`);
const serviceRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: isoAfter(11, 9),
  p_places: [syntheticPlace(45.0521, 7.6722, 'Exact service meeting place', 'Torino')],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: serviceId,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});
const serviceOccurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: isoAfter(11, 9),
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: isoAfter(11, 8),
  p_driver_child_seat_available: true,
  p_max_detour_km: 20,
  p_origin: syntheticPlace(45.0201, 7.6501, 'Exact service departure', 'Moncalieri'),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: serviceId,
  p_timezone: 'UTC',
  p_total_seats: 4,
});
await measureAllPendingLegs(worker);
const sameServiceMatches = (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
  .some((item) => item.request_id === serviceRequest.request_id
    && item.occurrence_id === serviceOccurrence.occurrence_id);
assert.ok(sameServiceMatches, 'A shared service occurrence is a suggestion.');

runSql(container, `
  update app.driver_offer_occurrence
  set arrival_at = arrival_at + interval '3 hours',
      departure_at = departure_at + interval '3 hours'
  where public_id = ${sqlLiteral(serviceOccurrence.occurrence_id)}::uuid;
`);
assert.ok(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.request_id === serviceRequest.request_id
      && item.occurrence_id === serviceOccurrence.occurrence_id),
  'The same service occurrence stays compatible in time however far the clock times differ.',
);

// A mutual block removes the suggestion silently, in both directions.
const blockedOccurrence = await rpc(clients[3], 'publish_driver_occurrence', {
  p_arrival_at: arrivalAt,
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: departureAt,
  p_driver_child_seat_available: true,
  p_max_detour_km: 20,
  p_origin: syntheticPlace(45.0250, 7.6550, 'Exact blocked departure', 'Moncalieri'),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 4,
});
await measureAllPendingLegs(worker);
assert.equal(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.occurrence_id === blockedOccurrence.occurrence_id),
  true,
  'The blocked driver must match before the block exists.',
);
runSql(container, `
  insert into app.personal_block (blocker_account_id, blocked_account_id)
  values (${sqlLiteral(identities[0].id)}::uuid, ${sqlLiteral(identities[3].id)}::uuid);
`);
assert.equal(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.occurrence_id === blockedOccurrence.occurrence_id),
  false,
  'A mutual block must suppress the suggestion.',
);
assert.equal(
  (await rpc(clients[3], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.request_id === request.request_id),
  false,
  'A block must suppress the suggestion in both directions.',
);

// ------------------------------------------------------------------ recomputation

// Tightening the detour limit removes the far place from the suggestion immediately, because
// the cheap conditions are evaluated live rather than trusted from a stored verdict.
const beforeTighten = (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
  .find((item) => item.occurrence_id === occurrence.occurrence_id);
assert.ok(beforeTighten.places.length >= 1);
runSql(container, `
  update app.driver_offer_occurrence set max_detour_km = 0
  where public_id = ${sqlLiteral(occurrence.occurrence_id)}::uuid;
`);
assert.equal(
  (await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.occurrence_id === occurrence.occurrence_id),
  false,
  'A stricter detour limit must take effect without recalculating routes.',
);
runSql(container, `
  update app.driver_offer_occurrence set max_detour_km = 5
  where public_id = ${sqlLiteral(occurrence.occurrence_id)}::uuid;
`);

// Cancelling the driver offer removes the suggestion at once.
runSql(container, `
  update app.driver_offer_occurrence set status = 'cancelled', closed_at = now()
  where public_id = ${sqlLiteral(blockedOccurrence.occurrence_id)}::uuid;
`);
assert.equal(
  (await rpc(clients[3], 'list_quality_matches', { p_church_id: churchId }))
    .some((item) => item.occurrence_id === blockedOccurrence.occurrence_id),
  false,
);

// ------------------------------------------------------------------ agreement independence

const placeId = (await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
  .find((item) => item.request_id === request.request_id).place_options[0].place_id;
const response = await rpc(clients[1], 'submit_driver_response', {
  p_client_key: randomUUID(),
  p_occurrence_id: occurrence.occurrence_id,
  p_offered_passenger_count: 2,
  p_place_id: placeId,
  p_request_id: request.request_id,
});
const agreement = await rpc(clients[0], 'confirm_ride_response', {
  p_client_key: randomUUID(),
  p_response_id: response.response_id,
});
assert.equal(agreement.status, 'confirmed');

// Later matching input changes must never cancel a confirmed agreement.
runSql(container, `
  update app.driver_offer_occurrence set max_detour_km = 0
  where public_id = ${sqlLiteral(occurrence.occurrence_id)}::uuid;
`);
runSql(container, `delete from app.route_measurement;`);
const survivingAgreements = await rpc(clients[0], 'current_ride_agreements');
assert.equal(
  survivingAgreements.find((item) => item.agreement_id === agreement.agreement_id).status,
  'confirmed',
  'A confirmed agreement must survive any later matching change.',
);
assert.equal(
  (await rpc(clients[0], 'get_agreement_exact_place', { p_agreement_id: agreement.agreement_id })).exact_meeting_label,
  'Exact near meeting place',
);

// With every measurement removed, matching claims nothing while the board keeps working.
assert.deepEqual(await rpc(clients[0], 'list_quality_matches', { p_church_id: churchId }), []);
assert.ok((await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId })).length >= 0);
assert.ok((await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId })).length >= 1);

// ------------------------------------------------------------------ cleanup

for (const identity of identities) await admin.auth.admin.deleteUser(identity.id);

console.log('Deterministic quality matching, hard conditions, detour, and privacy verification passed.');
