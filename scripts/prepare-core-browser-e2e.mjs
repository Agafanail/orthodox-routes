import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
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

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Browser fixture RPC ${name} failed: ${result.error.message}`);
  return result.data;
}

const { publicKey, serviceRoleKey, url } = localConfig();
const container = databaseContainer();
const appOrigin = process.env.CORE_E2E_APP_ORIGIN?.trim() || 'http://127.0.0.1:3000';
const suffix = `${Date.now()}-${process.pid}`;
const markerSuffix = suffix.replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)));
// Run-unique markers. Each exact address must stay invisible to anyone outside a confirmed
// agreement; each locality becomes the derived public area name and must stay visible.
const markers = {
  driverExactOrigin: `Browser driver exact origin ${markerSuffix}`,
  driverPublicArea: `Browser driver public area ${markerSuffix}`,
  passengerExactPlace: `Browser passenger exact place ${markerSuffix}`,
  passengerPublicArea: `Browser passenger public area ${markerSuffix}`,
};
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

// Each publisher gets one saved place, so the browser check can publish through the real
// place field without a map provider: the saved chips are the offline path through that field.
// The exact address and the locality carry distinct run-unique markers. The locality becomes
// the derived public area name, so one fixture proves both halves of the privacy boundary:
// the locality must be publicly visible and the exact address must never be.
const savedPlaces = {
  driver: {
    label: `Гараж ${markerSuffix}`,
    place: syntheticPlace(38.8400, 16.5300, markers.driverExactOrigin, markers.driverPublicArea),
  },
  passenger: {
    label: `Двор ${markerSuffix}`,
    place: syntheticPlace(38.8600, 16.6100, markers.passengerExactPlace, markers.passengerPublicArea),
  },
};

for (const user of users) {
  const saved = savedPlaces[user.role];
  if (!saved) continue;
  const client = createClient(url, publicKey, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email: user.email, password });
  if (signedIn.error) fail(`Could not sign in ${user.role} to save a place.`);
  await rpc(client, 'save_place', { p_place: { ...saved.place, label: saved.label } });
}

for (const user of users) {
  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = generated.data?.properties?.hashed_token;
  if (generated.error || !tokenHash) fail(`Could not generate ${user.role} browser link.`);
  user.loginUrl = `${appOrigin}/auth/confirm#flow=login&type=email&token_hash=${encodeURIComponent(tokenHash)}`;
  delete user.id;
}


const fixture = {
  api: { publicKey, url },
  churchUrl: `${appOrigin}/churches/pokrov-catanzaro`,
  markers,
  savedPlaceLabels: {
    driver: savedPlaces.driver.label,
    passenger: savedPlaces.passenger.label,
  },
  users,
};
const fixturePath = process.env.CORE_E2E_FIXTURE_PATH?.trim();

if (fixturePath) {
  const absolutePath = resolve(fixturePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(fixture), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write('Core browser fixtures are ready.\n');
} else {
  console.log(JSON.stringify({
    churchUrl: fixture.churchUrl,
    users: users.map((entry) => ({
      role: entry.role,
      name: entry.name,
      email: entry.email,
      loginUrl: entry.loginUrl,
    })),
  }, null, 2));
}
