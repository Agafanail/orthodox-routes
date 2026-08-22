// Verifies the geographic migration against data that already existed before it.
//
// It proves that a pre-Maps agreement keeps working, that its interim label representation is
// still projected safely, that the new coordinate-based publication works on the same church,
// and that no exact geography leaked into an anonymous payload during the upgrade.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { haversineMetres, syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const upgradeStatePath = fileURLToPath(new URL('../supabase/.temp/maps-upgrade.json', import.meta.url));

function fail(message) { throw new Error(message); }

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase upgrade stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  if (!url || !publicKey) fail('Required local-only upgrade configuration is unavailable.');
  return { publicKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for upgrade verification.');
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
  if (result.status !== 0) fail(`An upgrade database assertion failed.\n${result.stderr}`);
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function rpc(client, name, args = {}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await client.schema('api').rpc(name, args);
    const cachePending = result.error
      && /schema cache|could not find the function|retrying/i.test(result.error.message);
    if (!cachePending) {
      if (result.error) fail(`Upgrade RPC failed: ${name}: ${result.error.message}`);
      return result.data;
    }
    if (attempt === 59) fail(`Upgrade RPC never resolved: ${name}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function isoAfter(days, hour) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

const state = JSON.parse(readFileSync(upgradeStatePath, 'utf8'));
const { publicKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const anonymous = userClient(url, publicKey);

const clients = [];
for (const identity of state.identities) {
  const client = userClient(url, publicKey);
  const signedIn = await client.auth.signInWithPassword({ email: identity.email, password: state.password });
  if (signedIn.error) fail('A synthetic upgrade user could not sign in after the migration.');
  clients.push(client);
}

// The migration applied cleanly and the geographic foundation exists.
assert.equal(runSql(container, "select extname from pg_extension where extname = 'postgis';"), 'postgis');
assert.equal(
  runSql(container, "select count(*)::text from information_schema.columns where table_schema = 'private' and table_name = 'user_place' and column_name in ('exact_location', 'public_center', 'saved');"),
  '3',
);

// The pre-Maps agreement survived the migration and still discloses to its participants.
const passengerAgreements = await rpc(clients[0], 'current_ride_agreements');
const upgraded = passengerAgreements.find((agreement) => agreement.agreement_id === state.agreementId);
assert.ok(upgraded, 'A confirmed agreement must survive the geographic migration.');
assert.equal(upgraded.status, 'confirmed');

const disclosure = await rpc(clients[0], 'get_agreement_exact_place', { p_agreement_id: state.agreementId });
assert.equal(disclosure.exact_meeting_label, 'Legacy exact meeting place');
// The driver departure place is backfilled from the occurrence the agreement was confirmed on.
assert.equal(disclosure.departure_place.exact_address, 'Legacy exact driver origin');
assert.equal(disclosure.departure_place.exact_point, undefined);

const contacts = await rpc(clients[0], 'get_agreement_contacts', { p_agreement_id: state.agreementId });
assert.equal(contacts.agreement_id, state.agreementId);

// A record that predates coordinates keeps its interim label and simply carries no circle.
const legacyOwned = await rpc(clients[0], 'current_transport_items');
const legacyRequest = legacyOwned.passenger_requests.find((item) => item.request_id === state.requestId);
assert.ok(legacyRequest);
assert.equal(legacyRequest.places[0].exact_address, 'Legacy exact meeting place');
assert.equal(legacyRequest.places[0].exact_point, undefined);

// New publication on the same church requires a confirmed coordinate and derives its own area.
runSql(container, `
  update app.church
  set location = extensions.st_setsrid(extensions.st_makepoint(7.6869, 45.0703), 4326)::extensions.geography
  where public_id = ${sqlLiteral(state.churchId)}::uuid;
`);

const upgradedArrival = isoAfter(9, 9);
const newRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: state.churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: upgradedArrival,
  p_places: [syntheticPlace(45.0611, 7.6721, 'Upgraded exact meeting place', 'Torino')],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});
assert.equal(newRequest.status, 'active');

const publicRequests = await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: state.churchId });
const publicNew = publicRequests.find((item) => item.request_id === newRequest.request_id);
assert.ok(publicNew);
assert.equal(publicNew.place_options[0].public_area.radius_m, 1000);
assert.ok(
  haversineMetres(45.0611, 7.6721, publicNew.place_options[0].public_area.lat, publicNew.place_options[0].public_area.lng) > 100,
  'A public centre must never sit on its exact point after an upgrade.',
);

const publicLegacy = publicRequests.find((item) => item.request_id === state.openRequestId);
assert.ok(publicLegacy, 'A pre-Maps listing must remain publicly visible.');
assert.equal(publicLegacy.place_options[0].public_area, undefined);
assert.equal(publicLegacy.place_options[0].public_area_label, 'Legacy open district');

const publicPayload = JSON.stringify(publicRequests);
for (const secret of ['Legacy exact meeting place', 'Legacy open meeting place', 'Upgraded exact meeting place', '45.0611', '7.6721']) {
  assert.equal(publicPayload.includes(secret), false, 'The upgrade must not expose exact geography publicly.');
}

console.log('Representative pre-Maps upgrade, disclosure, and public boundary verification passed.');
