// Creates synthetic staging data for a human walkthrough of the Maps surfaces, and leaves it
// in place until the owner has finished testing.
//
// Everything it writes is invented: two accounts on `example.test`, one published church, one
// passenger request with three alternative meeting places, and one driver offer positioned so
// that the detour rule produces a real suggestion. No real person's data is used.
//
// It prints one-use sign-in links so the owner can walk the flow as a real signed-in
// participant. It never prints an API key. Remove the data afterwards with
// `npm run staging:maps-fixture:remove`.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { syntheticPlace } from './synthetic-geo.mjs';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const projectRefPath = fileURLToPath(new URL('../supabase/.temp/project-ref', import.meta.url));
const expectedProjectName = 'orthodox-routes-staging';
const stagingAppOrigin = 'https://orthodox-routes-staging.onrender.com';
const fixtureTag = 'maps-walkthrough';

function fail(message) { throw new Error(message); }

function runCli(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) fail('The authenticated staging CLI operation failed.');
  return result.stdout;
}

function runSql(statement) { runCli(['db', 'query', '--linked', statement]); }

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function readStagingConfiguration() {
  const projectRef = readFileSync(projectRefPath, 'utf8').trim();
  if (!/^[a-z]{20}$/.test(projectRef)) fail('The linked Supabase project ref is invalid.');
  const projects = JSON.parse(runCli(['projects', 'list', '--output', 'json']));
  const project = projects.find((candidate) => candidate.id === projectRef || candidate.ref === projectRef);
  if (!project || project.name !== expectedProjectName || project.status !== 'ACTIVE_HEALTHY') {
    fail('The linked project is not the active isolated Orthodox Routes staging project.');
  }
  const keys = JSON.parse(runCli([
    'projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json',
  ]));
  const publicKey = keys.find((key) => key.type === 'publishable')?.api_key
    ?? keys.find((key) => key.name === 'anon')?.api_key;
  const secretKey = keys.find((key) => key.type === 'secret')?.api_key
    ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!publicKey || !secretKey) fail('Required staging API keys are unavailable.');
  return { publicKey, secretKey, url: `https://${projectRef}.supabase.co` };
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function rpc(client, name, args = {}) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await client.schema('api').rpc(name, args);
    const pending = result.error
      && /schema cache|could not find the function|retrying/i.test(result.error.message);
    if (!pending) {
      if (result.error) fail(`Staging fixture RPC failed: ${name}: ${result.error.message}`);
      return result.data;
    }
    if (attempt === 59) fail(`Staging fixture RPC never resolved: ${name}`);
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

const { publicKey, secretKey, url } = readStagingConfiguration();
const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-9);
const password = `Staging-maps-${suffix}-Aa1!`;
const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

/** Mints one fresh one-use sign-in link per walkthrough identity and prints the entry points. */
async function announce(entries) {
  const links = [];
  for (const identity of entries) {
    const link = await admin.auth.admin.generateLink({ email: identity.email, type: 'magiclink' });
    if (link.error || !link.data?.properties?.hashed_token) {
      fail('A one-use staging sign-in link could not be generated.');
    }
    links.push({
      name: identity.name,
      url: `${stagingAppOrigin}/auth/confirm#flow=login&type=email&token_hash=${link.data.properties.hashed_token}`,
    });
  }
  console.log(`Церковь:   ${stagingAppOrigin}/churches/pokrov-catanzaro`);
  console.log(`Каталог:   ${stagingAppOrigin}/churches\n`);
  console.log('Одноразовые ссылки для входа (каждая работает один раз):');
  for (const link of links) console.log(`  ${link.name}\n    ${link.url}`);
  console.log('\nУдалить данные после проверки: npm run staging:maps-fixture:remove');
}

// A sign-in link is spent the moment it is used, so a walkthrough that is paused and resumed
// needs new links rather than new data. This mode mints them against the identities that are
// already there and writes nothing.
if (process.argv.includes('--links-only')) {
  const listed = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = (listed.data?.users ?? [])
    .filter((candidate) => candidate.email?.startsWith(`${fixtureTag}-`))
    .sort((left, right) => String(left.email).localeCompare(String(right.email)));
  if (listed.error || existing.length === 0) {
    fail('No synthetic staging walkthrough identity exists. Run the fixture without --links-only.');
  }
  console.log('Fresh one-use sign-in links for the existing walkthrough data.\n');
  await announce(existing.map((candidate) => ({
    email: candidate.email,
    name: candidate.email.includes('-driver-') ? 'Иван (проверка)' : 'Анна (проверка)',
  })));
  process.exit(0);
}

// Turin, so the synthetic geography is coherent and the detour numbers are believable.
const church = { lat: 45.0703, lng: 7.6869 };
// The church page still resolves its slug against the bundled reference churches, so the
// walkthrough reuses one of those slugs rather than inventing a new one.
const churchSlug = 'pokrov-catanzaro';
const churchId = randomUUID();

const identities = [
  { email: `${fixtureTag}-passenger-${suffix}@example.test`, name: 'Анна (проверка)', phone: `+390${phoneStem}1` },
  { email: `${fixtureTag}-driver-${suffix}@example.test`, name: 'Иван (проверка)', phone: `+390${phoneStem}2` },
];

for (const identity of identities) {
  const created = await admin.auth.admin.createUser({
    email: identity.email, email_confirm: true, password,
  });
  if (created.error || !created.data.user) fail('A synthetic staging identity could not be created.');
  identity.id = created.data.user.id;
}

const clients = identities.map(() => userClient(url, publicKey));
for (let index = 0; index < clients.length; index += 1) {
  const signedIn = await clients[index].auth.signInWithPassword({
    email: identities[index].email, password,
  });
  if (signedIn.error) fail('A synthetic staging identity could not sign in.');
  await rpc(clients[index], 'create_account', {
    p_display_name: identities[index].name,
    p_phone_e164: identities[index].phone,
    p_preferred_language: 'ru',
  });
  await rpc(clients[index], 'declare_adult');
}

runSql(`
  insert into app.legal_document_version (
    document_type, version, language_codes, effective_at, status, content_hash
  ) values (
    'terms', ${sqlLiteral(`${fixtureTag}-${suffix}`)}, array['ru'],
    now() - interval '1 day', 'published', repeat('a', 64)
  ) on conflict do nothing;
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    ${sqlLiteral(churchId)}::uuid, ${sqlLiteral(churchSlug)},
    'Покровский храм (проверка)', 'Via Giuseppe Verdi 12, Torino', 'Torino', 'IT', 'Europe/Rome', 'published',
    extensions.st_setsrid(extensions.st_makepoint(${church.lng}, ${church.lat}), 4326)::extensions.geography
  );
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

for (const client of clients) await rpc(client, 'accept_current_terms');

const arrivalAt = isoAfter(7, 9);

// Three alternative meeting places: two close to the driver's line to the church, one far off
// it, so the detour rule visibly keeps some and drops the other.
const request = await rpc(clients[0], 'publish_passenger_request', {
  p_child_seat_required: false,
  p_children_count: 0,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_desired_arrival_at: arrivalAt,
  p_places: [
    syntheticPlace(45.0500, 7.6700, 'Corso Vittorio Emanuele II 45, Torino', 'Torino'),
    syntheticPlace(45.0400, 7.6600, 'Piazza Carducci 3, Torino', 'Torino'),
    syntheticPlace(45.0450, 7.5600, 'Via Roma 8, Rivoli', 'Rivoli'),
  ],
  p_public_note: null,
  p_return_required: true,
  p_service_occurrence_id: null,
  p_timezone: 'Europe/Rome',
  p_total_passengers: 2,
});

const occurrence = await rpc(clients[1], 'publish_driver_occurrence', {
  p_arrival_at: arrivalAt,
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_departure_at: isoAfter(7, 8),
  p_driver_child_seat_available: true,
  p_max_detour_km: 5,
  p_origin: syntheticPlace(45.0200, 7.6500, 'Via Torino 100, Moncalieri', 'Moncalieri'),
  p_public_note: null,
  p_return_available: true,
  p_service_occurrence_id: null,
  p_timezone: 'Europe/Rome',
  p_total_seats: 3,
});

// Three more drivers, placed either side of the approved arrival window so the rule is visible
// rather than merely described. The passenger wants 09:00 UTC, so the window runs from 08:00 to
// 09:30 measured after the pickup detour, which on these short detours costs only a few minutes.
async function publishTimedDriver(arrivalHour, arrivalMinute, note, origin) {
  return rpc(clients[1], 'publish_driver_occurrence', {
    p_arrival_at: isoAfter(7, arrivalHour, arrivalMinute),
    p_children_allowed: true,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_departure_at: isoAfter(7, arrivalHour - 1, arrivalMinute),
    p_driver_child_seat_available: true,
    p_max_detour_km: 10,
    p_origin: origin,
    p_public_note: note,
    p_return_available: false,
    p_service_occurrence_id: null,
    p_timezone: 'Europe/Rome',
    p_total_seats: 3,
  });
}

// Later than the passenger asked for, and still useful. The previous rule refused this outright.
const slightlyLate = await publishTimedDriver(
  9, 15, 'Проверка: приезжаю позже желаемого на 15 минут.',
  syntheticPlace(45.0210, 7.6510, 'Via Torino 102, Moncalieri', 'Moncalieri'),
);
// Far enough past the desired time that the detour cannot bring it back inside.
const tooLate = await publishTimedDriver(
  9, 50, 'Проверка: приезжаю позже желаемого на 50 минут.',
  syntheticPlace(45.0220, 7.6520, 'Via Torino 104, Moncalieri', 'Moncalieri'),
);
// Early beyond the hour the window allows.
const tooEarly = await publishTimedDriver(
  7, 30, 'Проверка: приезжаю на полтора часа раньше желаемого.',
  syntheticPlace(45.0230, 7.6530, 'Via Torino 106, Moncalieri', 'Moncalieri'),
);

console.log('Synthetic staging walkthrough data is in place and will remain until removed.\n');
console.log(`Просьба:   ${request.request_id}`);
console.log(`Поездка:   ${occurrence.occurrence_id}\n`);
console.log('Проверка временного окна (пассажир хочет приехать к 11:00 по Риму):');
console.log(`  ожидается «Подходит»       — вовремя           ${occurrence.occurrence_id}`);
console.log(`  ожидается «Подходит»       — на 15 мин позже   ${slightlyLate.occurrence_id}`);
console.log(`  ожидается БЕЗ метки        — на 50 мин позже   ${tooLate.occurrence_id}`);
console.log(`  ожидается БЕЗ метки        — на 1,5 ч раньше   ${tooEarly.occurrence_id}\n`);
await announce(identities);
