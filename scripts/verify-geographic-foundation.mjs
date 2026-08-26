// Verifies the protected geographic foundation against the local synthetic database only.
//
// It proves that exact coordinates stay private, that the public approximation is stable and
// deliberately off-centre, that saved places belong to their owner and survive ride retention,
// and that no public driver route geometry exists anywhere.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { haversineMetres, syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) { throw new Error(message); }

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase geographic test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only geographic configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for geographic verification.');
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
  if (result.status !== 0) fail(`A geographic database assertion failed.\n${result.stderr}`);
  return result.stdout.trim();
}

function expectSqlFailure(container, statement) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  assert.notEqual(result.status, 0, 'A protected geographic statement unexpectedly succeeded.');
  return result.stderr;
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
  if (result.error) fail(`Geographic RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await callRpc(client, name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic geographic user could not sign in.');
}

function isoAfter(days, hour) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-9);
const password = `Local-geography-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);

// ------------------------------------------------------------------ extension and grants

assert.equal(runSql(container, "select extname from pg_extension where extname = 'postgis';"), 'postgis');
assert.equal(
  runSql(container, "select nspname from pg_namespace n join pg_extension e on e.extnamespace = n.oid where e.extname = 'postgis';"),
  'extensions',
);

for (const table of ['private.user_place', 'private.geo_approximation_secret']) {
  assert.equal(
    runSql(container, `select relrowsecurity and relforcerowsecurity from pg_class where oid = ${sqlLiteral(table)}::regclass;`),
    't',
    `${table} must force row level security.`,
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      runSql(container, `select coalesce(has_table_privilege(${sqlLiteral(role)}, ${sqlLiteral(table)}, 'select'), false);`),
      'f',
      `${role} must not read ${table} directly.`,
    );
  }
}

for (const index of ['church_location_gist', 'user_place_exact_location_gist', 'user_place_public_center_gist']) {
  assert.equal(runSql(container, `select indexname from pg_indexes where indexname = ${sqlLiteral(index)};`), index);
}

// ------------------------------------------------------------------ approximation properties

const approximation = runSql(container, `
  with point as (
    select extensions.st_setsrid(extensions.st_makepoint(7.6869, 45.0703), 4326)::extensions.geography as exact_point,
      '11111111-1111-4111-8111-111111111111'::uuid as owner_a,
      '22222222-2222-4222-8222-222222222222'::uuid as owner_b
  )
  select
    (app.public_area_center(exact_point, owner_a) = app.public_area_center(exact_point, owner_a))::text
    || '|' || (app.public_area_center(exact_point, owner_a) <> app.public_area_center(exact_point, owner_b))::text
    || '|' || round(extensions.st_distance(exact_point, app.public_area_center(exact_point, owner_a)))::text
  from point;
`).split('|');
assert.equal(approximation[0], 'true', 'The public centre must be stable for one owner and place.');
assert.equal(approximation[1], 'true', 'Two owners at one place must not share a public centre.');
const approximationOffset = Number(approximation[2]);
assert.ok(approximationOffset >= 300 && approximationOffset <= 700, 'The privacy offset must stay inside its approved band.');

// ------------------------------------------------------------------ synthetic accounts

const identities = [
  { email: `geo-passenger-${suffix}@example.test`, name: 'Geo Passenger', phone: `+390${phoneStem}1` },
  { email: `geo-driver-${suffix}@example.test`, name: 'Geo Driver', phone: `+390${phoneStem}2` },
  { email: `geo-other-${suffix}@example.test`, name: 'Geo Other', phone: `+390${phoneStem}3` },
];
for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic geographic identity could not be created.');
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
    'terms', ${sqlLiteral(`geo-test-${suffix}`)}, array['en'], now() - interval '1 hour', 'published', repeat('c', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');
runSql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

// A centred circle would publish the very point it exists to hide, so the database refuses it.
assert.match(
  expectSqlFailure(container, `
    insert into private.user_place (
      owner_account_id, exact_address, public_area_name, exact_location, source_kind,
      public_center, approximation_version
    ) values (
      ${sqlLiteral(identities[0].id)}::uuid, 'Centred place', 'Centred area',
      extensions.st_setsrid(extensions.st_makepoint(7.68, 45.07), 4326)::extensions.geography,
      'user_pin',
      extensions.st_setsrid(extensions.st_makepoint(7.68, 45.07), 4326)::extensions.geography, 1
    );
  `),
  /user_place_public_contains_exact/i,
);

// A public circle that does not contain its exact point is equally refused.
assert.match(
  expectSqlFailure(container, `
    insert into private.user_place (
      owner_account_id, exact_address, public_area_name, exact_location, source_kind,
      public_center, approximation_version
    ) values (
      ${sqlLiteral(identities[0].id)}::uuid, 'Distant place', 'Distant area',
      extensions.st_setsrid(extensions.st_makepoint(7.68, 45.07), 4326)::extensions.geography,
      'user_pin',
      extensions.st_setsrid(extensions.st_makepoint(9.19, 45.46), 4326)::extensions.geography, 1
    );
  `),
  /user_place_public_contains_exact/i,
);

// ------------------------------------------------------------------ church catalog map

const nearChurchId = randomUUID();
const farChurchId = randomUUID();
// Other suites in the same CI job leave their own synthetic churches behind, so the catalog
// assertions search for a term unique to this run instead of a shared generic word.
const searchTerm = `Geocheck${suffix.replaceAll('-', '')}`;
runSql(container, `
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    ${sqlLiteral(nearChurchId)}::uuid, ${sqlLiteral(`geo-near-${suffix}`)}, ${sqlLiteral(`Near Church ${searchTerm}`)},
    'Near public address', 'Torino', 'IT', 'UTC', 'published',
    extensions.st_setsrid(extensions.st_makepoint(7.6869, 45.0703), 4326)::extensions.geography
  ), (
    ${sqlLiteral(farChurchId)}::uuid, ${sqlLiteral(`geo-far-${suffix}`)}, ${sqlLiteral(`Far Church ${searchTerm}`)},
    'Far public address', 'Palermo', 'IT', 'UTC', 'published',
    extensions.st_setsrid(extensions.st_makepoint(13.3614, 38.1157), 4326)::extensions.geography
  );
`);

// A published church without a location is refused: the catalog map cannot show it.
assert.match(
  expectSqlFailure(container, `
    insert into app.church (slug, official_name, address_display, locality, country_code, timezone, status)
    values (${sqlLiteral(`geo-nolocation-${suffix}`)}, 'No Location Church', 'Address', 'Torino', 'IT', 'UTC', 'published');
  `),
  /church_published_location/i,
);

const anonymousCatalog = await rpc(anonymous, 'search_published_churches', { p_query: searchTerm });
assert.equal(anonymousCatalog.length, 2);
assert.ok(anonymousCatalog.some((church) => church.church_id === nearChurchId));
assert.ok(anonymousCatalog.every((church) => typeof church.lat === 'number' && typeof church.lng === 'number'));

// Proximity ordering applies only when the caller supplies a location.
const nearFirst = await rpc(anonymous, 'search_published_churches', {
  p_lat: 45.07, p_lng: 7.68, p_query: searchTerm,
});
assert.equal(nearFirst[0].church_id, nearChurchId);
assert.ok(nearFirst[0].distance_m < 2000);
assert.equal(anonymousCatalog[0].distance_m, null);

const bounded = await rpc(anonymous, 'search_published_churches', {
  p_east: 8.0, p_north: 45.5, p_query: searchTerm, p_south: 44.5, p_west: 7.0,
});
assert.equal(bounded.length, 1);
assert.equal(bounded[0].church_id, nearChurchId);

const churchMap = await rpc(anonymous, 'transport_church_by_slug', { p_slug: `geo-near-${suffix}` });
assert.equal(churchMap.church_id, nearChurchId);
assert.equal(churchMap.lat, 45.0703);

// ------------------------------------------------------------------ saved places

const savedPlace = await rpc(clients[0], 'save_place', {
  p_place: syntheticPlace(45.0611, 7.6721, 'Saved exact home entrance', 'Torino', { label: 'Дом' }),
});
const savedList = await rpc(clients[0], 'list_saved_places');
assert.equal(savedList.length, 1);
assert.equal(savedList[0].place_id, savedPlace.place_id);
assert.equal(savedList[0].label, 'Дом');
assert.equal(savedList[0].lat, 45.0611);

// A saved place belongs to its owner alone.
assert.deepEqual(await rpc(clients[2], 'list_saved_places'), []);
await expectRpcFailure(clients[2], 'rename_saved_place', { p_label: 'Stolen', p_place_id: savedPlace.place_id });
await expectRpcFailure(clients[2], 'delete_saved_place', { p_place_id: savedPlace.place_id });

await rpc(clients[0], 'rename_saved_place', { p_label: 'Дом у храма', p_place_id: savedPlace.place_id });
assert.equal((await rpc(clients[0], 'list_saved_places'))[0].label, 'Дом у храма');

// An anonymous visitor has no saved-place surface at all.
await expectRpcFailure(anonymous, 'list_saved_places');
await expectRpcFailure(anonymous, 'save_place', {
  p_place: syntheticPlace(45.06, 7.67, 'Anonymous attempt', 'Torino', { label: 'X' }),
});

// ------------------------------------------------------------------ publication and reuse

const serviceTime = isoAfter(7, 9);
const request = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: nearChurchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: serviceTime,
  p_places: [
    { saved_place_id: savedPlace.place_id },
    syntheticPlace(45.0559, 7.6802, 'Second exact meeting point', 'Torino'),
  ],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 2,
});
assert.equal(request.status, 'active');

const occurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: serviceTime,
  p_children_allowed: true,
  p_church_id: nearChurchId,
  p_client_key: randomUUID(),
  p_departure_at: isoAfter(7, 8),
  p_driver_child_seat_available: true,
  p_max_detour_km: 10,
  p_origin: syntheticPlace(45.0301, 7.6402, 'Exact driver departure', 'Moncalieri'),
  p_public_note: null,
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 3,
});

// Deleting the reusable saved entry never rewrites geography a live listing depends on.
await rpc(clients[0], 'delete_saved_place', { p_place_id: savedPlace.place_id });
assert.deepEqual(await rpc(clients[0], 'list_saved_places'), []);
const ownedAfterDelete = await rpc(clients[0], 'current_transport_items');
assert.equal(ownedAfterDelete.passenger_requests[0].places[0].exact_address, 'Saved exact home entrance');

// ------------------------------------------------------------------ public payload boundary

const publicRequests = await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: nearChurchId });
const publicRequest = publicRequests.find((item) => item.request_id === request.request_id);
assert.ok(publicRequest);
assert.equal(publicRequest.place_options.length, 2);

const publicOccurrences = await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: nearChurchId });
const publicOccurrence = publicOccurrences.find((item) => item.occurrence_id === occurrence.occurrence_id);
assert.ok(publicOccurrence);

const exactPoints = [
  [45.0611, 7.6721],
  [45.0559, 7.6802],
  [45.0301, 7.6402],
];
const publicAreas = [
  ...publicRequest.place_options.map((option) => option.public_area),
  publicOccurrence.origin_area.public_area,
];
for (const [index, area] of publicAreas.entries()) {
  assert.equal(area.radius_m, 1000);
  const metres = haversineMetres(exactPoints[index][0], exactPoints[index][1], area.lat, area.lng);
  assert.ok(metres > 100, 'A public centre must never sit on its exact point.');
  assert.ok(metres < 1000, 'An exact point must remain inside its public area.');
}

// An authenticated but unrelated account sees exactly the anonymous geography and nothing more.
const otherRequests = await rpc(clients[2], 'list_active_passenger_requests', { p_church_id: nearChurchId });
const otherOccurrences = await rpc(clients[2], 'list_active_driver_occurrences', { p_church_id: nearChurchId });
assert.deepEqual(otherRequests, publicRequests);
assert.deepEqual(otherOccurrences, publicOccurrences);

const publicPayload = JSON.stringify({ publicRequests, publicOccurrences, anonymousCatalog });
for (const secret of ['Saved exact home entrance', 'Second exact meeting point', 'Exact driver departure']) {
  assert.equal(publicPayload.includes(secret), false, 'An exact address leaked into a public payload.');
}
// Compared as numbers rather than as text. A public centre is published to five decimals and
// an exact point is written here to four, so `45.06112` contains `45.0611` as a substring, and
// a substring test would call that a leak. It is not one: the offset is a fixed distance in a
// per-owner bearing, and a bearing that happens to run nearly due east leaves the latitude
// almost unchanged while the point still moves the required hundreds of metres away. The
// distance assertions above are what prove the privacy property; this proves that no exact
// coordinate is published as a value.
const publicNumbers = [];
(function collect(value) {
  if (typeof value === 'number') publicNumbers.push(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
})({ anonymousCatalog, publicOccurrences, publicRequests });
for (const coordinate of [45.0611, 7.6721, 45.0559, 7.6802, 45.0301, 7.6402]) {
  const leaked = publicNumbers.some((value) => Math.abs(value - coordinate) < 1e-9);
  assert.equal(leaked, false, 'An exact coordinate leaked into a public payload.');
}
// No public route geometry exists as a concept anywhere in a public payload.
for (const token of ['polyline', 'corridor', 'route_geometry', 'encodedpath', 'waypoint']) {
  assert.equal(publicPayload.toLowerCase().includes(token), false, 'Public route geometry must not exist.');
}

// ------------------------------------------------------------------ input validation

for (const invalid of [
  { address: 'No coordinate', country_code: 'IT', locality: 'Torino', source_kind: 'user_pin' },
  syntheticPlace(95, 7.6, 'Impossible latitude', 'Torino'),
  syntheticPlace(45.06, 7.6, 'Bad source', 'Torino', { source_kind: 'invented_kind' }),
  syntheticPlace(45.06, 7.6, 'Bad country', 'Torino', { country_code: 'italy' }),
  { ...syntheticPlace(45.06, 7.6, 'Unowned saved place', 'Torino'), saved_place_id: randomUUID() },
]) {
  await expectRpcFailure(clients[0], 'publish_passenger_request', {
    p_child_seat_required: false,
    p_children_count: 0,
    p_church_id: nearChurchId,
    p_client_key: randomUUID(),
    p_desired_arrival_at: isoAfter(8, 9),
    p_places: [invalid],
    p_public_note: null,
    p_return_required: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_passengers: 1,
  });
}

// ------------------------------------------------------------------ saved-place retention

const retainedPlace = await rpc(clients[1], 'save_place', {
  p_place: syntheticPlace(45.0208, 7.6301, 'Retained saved place', 'Moncalieri', { label: 'Работа' }),
});
// Retention is forced only for this run's own synthetic agreements, so a parallel suite in the
// same job is never rewritten.
runSql(container, `
  update app.ride_agreement set status = 'archived', archived_at = now(),
    contact_visible_until = now() - interval '2 days',
    exact_data_delete_due_at = now() - interval '1 day'
  where driver_account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')})
     or passenger_account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);
const anonymized = JSON.parse(runSql(container, 'select ops.anonymize_expired_places();'));
assert.ok(anonymized.anonymized_places >= 0);
assert.equal(
  (await rpc(clients[1], 'list_saved_places')).some((place) => place.place_id === retainedPlace.place_id),
  true,
  'Ride retention must never delete a place its owner deliberately saved.',
);

// ------------------------------------------------------------------ cleanup

runSql(container, `
  delete from app.passenger_request where church_id in (
    select id from app.church where public_id in (${sqlLiteral(nearChurchId)}::uuid, ${sqlLiteral(farChurchId)}::uuid)
  );
  delete from app.driver_offer_occurrence where church_id in (
    select id from app.church where public_id in (${sqlLiteral(nearChurchId)}::uuid, ${sqlLiteral(farChurchId)}::uuid)
  );
`);
for (const identity of identities) await admin.auth.admin.deleteUser(identity.id);

console.log('Geographic foundation, approximation, saved place, and privacy verification passed.');
