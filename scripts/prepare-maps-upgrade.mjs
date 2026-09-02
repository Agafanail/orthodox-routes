// Creates representative pre-Maps Core data on the last migration before the geographic
// foundation, so the upgrade can be verified against records that already existed.
//
// It runs only against the disposable local database and writes its synthetic fixture
// references to an ignored local file for the verifier that runs after the migration.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
export const upgradeStatePath = fileURLToPath(new URL('../supabase/.temp/maps-upgrade.json', import.meta.url));

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
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only upgrade configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for the upgrade fixture.');
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
  if (result.status !== 0) fail(`An upgrade fixture statement failed.\n${result.stderr}`);
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
      if (result.error) fail(`Upgrade fixture RPC failed: ${name}: ${result.error.message}`);
      return result.data;
    }
    if (attempt === 59) fail(`Upgrade fixture RPC never resolved: ${name}`);
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

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-9);
const password = `Local-upgrade-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const identities = [
  { email: `upgrade-passenger-${suffix}@example.test`, name: 'Upgrade Passenger', phone: `+390${phoneStem}1` },
  { email: `upgrade-driver-${suffix}@example.test`, name: 'Upgrade Driver', phone: `+390${phoneStem}2` },
];
for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic upgrade identity could not be created.');
  identity.id = created.data.user.id;
}
const clients = identities.map(() => userClient(url, publicKey));
for (let index = 0; index < clients.length; index += 1) {
  const signedIn = await clients[index].auth.signInWithPassword({ email: identities[index].email, password });
  if (signedIn.error) fail('A synthetic upgrade user could not sign in.');
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
    'terms', ${sqlLiteral(`upgrade-test-${suffix}`)}, array['en'], now() - interval '1 hour', 'published', repeat('d', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');
runSql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

const churchId = randomUUID();
const churchSlug = `upgrade-test-${suffix}`;
runSql(container, `
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status
  ) values (
    ${sqlLiteral(churchId)}::uuid, ${sqlLiteral(churchSlug)}, 'Synthetic Upgrade Church',
    'Synthetic public church address', 'Test Locality', 'IT', 'UTC', 'published'
  );
`);

const arrivalAt = isoAfter(7, 9);
// Pre-Maps records carry only text labels: this is exactly the interim representation the
// geographic migration has to carry forward without breaking anything already agreed.
const request = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: arrivalAt,
  p_places: [{ exact_label: 'Legacy exact meeting place', public_area_label: 'Legacy district' }],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});

const occurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: arrivalAt,
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: isoAfter(7, 8),
  p_driver_child_seat_available: true,
  p_exact_origin_label: 'Legacy exact driver origin',
  p_max_detour_km: 5,
  p_public_note: null,
  p_public_origin_area: 'Legacy origin district',
  p_return_available: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_seats: 2,
});

// A second legacy request stays open, so the upgrade can be checked against a listing that is
// still public rather than one the confirmed agreement has already fulfilled.
const openRequest = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: isoAfter(8, 9),
  p_places: [{ exact_label: 'Legacy open meeting place', public_area_label: 'Legacy open district' }],
  p_public_note: null,
  p_return_required: false,
  p_service_occurrence_id: null,
  p_timezone: 'UTC',
  p_total_passengers: 1,
});

const publicRequests = await rpc(userClient(url, publicKey), 'list_active_passenger_requests', { p_church_id: churchId });
const placeId = publicRequests.find((item) => item.request_id === request.request_id)?.place_options[0]?.place_id;
if (!placeId) fail('The legacy passenger place could not be resolved.');

const response = await rpc(clients[1], 'submit_driver_response', {
  p_client_key: randomUUID(),
  p_occurrence_id: occurrence.occurrence_id,
  p_offered_passenger_count: 1,
  p_place_id: placeId,
  p_request_id: request.request_id,
});
const agreement = await rpc(clients[0], 'confirm_ride_response', {
  p_client_key: randomUUID(),
  p_response_id: response.response_id,
});

mkdirSync(fileURLToPath(new URL('../supabase/.temp/', import.meta.url)), { recursive: true });
writeFileSync(upgradeStatePath, `${JSON.stringify({
  agreementId: agreement.agreement_id,
  churchId,
  churchSlug,
  identities: identities.map((identity) => ({ email: identity.email, id: identity.id })),
  occurrenceId: occurrence.occurrence_id,
  openRequestId: openRequest.request_id,
  password,
  requestId: request.request_id,
  suffix,
}, null, 2)}\n`);

console.log('Representative pre-Maps Core data created for the upgrade check.');
