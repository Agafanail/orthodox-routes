import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) { throw new Error(message); }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function localConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Local Supabase credentials are unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function databaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  const container = result.stdout.split(/\r?\n/).find((value) => value.trim() === 'supabase_db_orthodox-routes');
  if (result.status !== 0 || !container) fail('The local database container is unavailable.');
  return container.trim();
}

function sql(container, statement) {
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-',
  ], { encoding: 'utf8', input: statement });
  if (result.status !== 0) fail(`Browser fixture SQL failed.\n${result.stderr}`);
}

function sqlValue(container, statement) {
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-',
  ], { encoding: 'utf8', input: statement });
  if (result.status !== 0) fail(`Browser fixture query failed.\n${result.stderr}`);
  return result.stdout.trim();
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Browser fixture RPC ${name} failed: ${result.error.message}`);
  return result.data;
}

const { publicKey, serviceRoleKey, url } = localConfig();
const container = databaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const password = `Core-browser-${suffix}-Aa1!`;
const phoneStem = String(Date.now()).slice(-8);
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const users = [
  { role: 'passenger', name: 'Browser Passenger', email: `core-passenger-${suffix}@example.test`, phone: `+3900${phoneStem}1` },
  { role: 'driver', name: 'Browser Driver', email: `core-driver-${suffix}@example.test`, phone: `+3900${phoneStem}2` },
  { role: 'other', name: 'Browser Other', email: `core-other-${suffix}@example.test`, phone: `+3900${phoneStem}3` },
];

sql(container, `
  insert into app.legal_document_version (
    document_type, version, language_codes, effective_at, status, content_hash
  ) values (
    'terms', ${sqlLiteral(`core-browser-${suffix}`)}, array['ru'], now() - interval '1 minute',
    'published', repeat('e', 64)
  );
  insert into app.church (
    slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    'pokrov-catanzaro', 'Храм Покрова Пресвятой Богородицы',
    'Via browser fixture 1', 'Catanzaro', 'IT', 'Europe/Rome', 'published',
    extensions.st_setsrid(extensions.st_makepoint(16.5960, 38.9098), 4326)::extensions.geography
  ) on conflict (slug) do update set
    official_name = excluded.official_name,
    address_display = excluded.address_display,
    locality = excluded.locality,
    country_code = excluded.country_code,
    timezone = excluded.timezone,
    status = excluded.status,
    location = excluded.location;
  insert into app.church (
    slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    'browser-far-church', 'Храм святителя Николая',
    'Via browser fixture 2', 'Palermo', 'IT', 'Europe/Rome', 'published',
    extensions.st_setsrid(extensions.st_makepoint(13.3614, 38.1157), 4326)::extensions.geography
  ) on conflict (slug) do update set location = excluded.location, status = excluded.status;
`);

for (const user of users) {
  const created = await admin.auth.admin.createUser({ email: user.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail(`Could not create ${user.role} identity.`);
  user.id = created.data.user.id;
  const client = createClient(url, publicKey, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email: user.email, password });
  if (signedIn.error) fail(`Could not sign in ${user.role} fixture.`);
  await rpc(client, 'create_account', { p_display_name: user.name, p_phone_e164: user.phone, p_preferred_language: 'ru' });
  await rpc(client, 'declare_adult');
  await rpc(client, 'accept_current_terms');
}

sql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${users.map((user) => `${sqlLiteral(user.id)}::uuid`).join(', ')});
`);

// Published synthetic geography so the browser check has a passenger with several meeting
// places and a driver whose departure is genuinely on the way to the same church.
const churchId = sqlValue(container, `select public_id from app.church where slug = 'pokrov-catanzaro';`);
const arrival = new Date();
arrival.setUTCDate(arrival.getUTCDate() + 7);
arrival.setUTCHours(9, 0, 0, 0);
const departure = new Date(arrival.getTime() - 60 * 60 * 1000);

const passengerClient = createClient(url, publicKey, { auth: { persistSession: false } });
await passengerClient.auth.signInWithPassword({ email: users[0].email, password });
await rpc(passengerClient, 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: arrival.toISOString(),
  p_places: [
    // One place needs a noticeable detour and one only a small one, so the suggestion shows a
    // real added distance and keeps the alternative visible.
    syntheticPlace(38.8600, 16.6100, 'Via Sintetica 10, вход во двор', 'Catanzaro'),
    syntheticPlace(38.8900, 16.5450, 'Piazza Sintetica 3, у фонтана', 'Catanzaro Lido'),
  ],
  p_public_note: 'Поедем вдвоём, без багажа.',
  p_return_required: true,
  p_service_occurrence_id: null,
  p_timezone: 'Europe/Rome',
  p_total_passengers: 2,
});

const driverClient = createClient(url, publicKey, { auth: { persistSession: false } });
await driverClient.auth.signInWithPassword({ email: users[1].email, password });
await rpc(driverClient, 'publish_driver_occurrence', {
  p_arrival_at: arrival.toISOString(),
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: departure.toISOString(),
  p_driver_child_seat_available: true,
  p_max_detour_km: 10,
  p_origin: syntheticPlace(38.8400, 16.5300, 'Via Sintetica 88, у ворот', 'Catanzaro Lido'),
  p_public_note: null,
  p_return_available: true,
  p_service_occurrence_id: null,
  p_timezone: 'Europe/Rome',
  p_total_seats: 3,
});

for (const user of users) {
  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = generated.data?.properties?.hashed_token;
  if (generated.error || !tokenHash) fail(`Could not generate ${user.role} browser link.`);
  user.loginUrl = `http://localhost:3000/auth/confirm#flow=login&type=email&token_hash=${encodeURIComponent(tokenHash)}`;
  delete user.id;
  delete user.phone;
}

console.log(JSON.stringify({
  catalogUrl: 'http://localhost:3000/churches',
  churchUrl: 'http://localhost:3000/churches/pokrov-catanzaro',
  locationUrl: 'http://localhost:3000/churches/pokrov-catanzaro/location',
  matchesUrl: 'http://localhost:3000/churches/pokrov-catanzaro?view=matches',
  users,
}, null, 2));
