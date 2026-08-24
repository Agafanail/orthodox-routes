// Guarded staging verification for the Maps and quality-matching surfaces.
//
// It runs only against the exact isolated `orthodox-routes-staging` project and its deployment,
// uses no account fixtures, and writes nothing. Account-based Core flows are already covered by
// `verify-staging-core.mjs`; this checks what the Maps campaign added:
//
//  - the geographic migrations are applied remotely;
//  - the public church catalog exposes exact church coordinates, because a church is public;
//  - passenger and driver listings expose an approximate area and never an exact place;
//  - the matching reader and the route bridge are unreachable without the right identity;
//  - the deployed pages serve the interactive map surfaces and their required attribution;
//  - no exact coordinate appears in anonymous HTML.
//
// It never prints a key and never targets production.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const projectRefPath = fileURLToPath(new URL('../supabase/.temp/project-ref', import.meta.url));
const expectedProjectName = 'orthodox-routes-staging';
const stagingAppOrigin = 'https://orthodox-routes-staging.onrender.com';

function fail(message) { throw new Error(message); }

function runCli(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) fail('The authenticated staging CLI operation failed.');
  return result.stdout;
}

function runSql(statement) {
  runCli(['db', 'query', '--linked', statement]);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

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
  if (!publicKey) fail('The staging public API key is unavailable.');

  return { projectRef, publicKey, url: `https://${projectRef}.supabase.co` };
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Staging RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcDenied(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} must not be reachable with this identity.`);
}

async function page(path) {
  const response = await fetch(`${stagingAppOrigin}${path}`, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200, `${path} must be served.`);
  return response.text();
}

const { projectRef, publicKey, url } = readStagingConfiguration();
const anonymous = createClient(url, publicKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

// ------------------------------------------------------------------ migrations applied

// This CLI already emits JSON here; asking for it again switches the command to a table.
const migrations = JSON.parse(runCli(['migration', 'list', '--linked'])).migrations ?? [];
for (const version of ['20260823120000', '20260823170000']) {
  const entry = migrations.find((item) => item.local === version);
  assert.ok(entry, `Migration ${version} must be committed.`);
  assert.equal(entry.remote, version, `Migration ${version} must be applied to staging.`);
}

// ------------------------------------------------------------------ synthetic fixture

// Staging carries no real data, so the check creates one synthetic published church with a
// location, verifies the surfaces against it, and removes it again in the `finally` below.
const churchId = randomUUID();
const churchSlug = `maps-check-${Date.now()}-${process.pid}`;
const churchPoint = { lat: 45.0703, lng: 7.6869 };

runSql(`
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
  ) values (
    ${sqlLiteral(churchId)}::uuid, ${sqlLiteral(churchSlug)}, 'Synthetic Maps Check Church',
    'Synthetic staging address', 'Torino', 'IT', 'UTC', 'published',
    extensions.st_setsrid(extensions.st_makepoint(${churchPoint.lng}, ${churchPoint.lat}), 4326)::extensions.geography
  );
`);

try {

// ------------------------------------------------------------------ public church geography

// A church location is public and exact: the catalog map plots it.
const catalog = await rpc(anonymous, 'search_published_churches', { p_limit: 50 });
assert.ok(Array.isArray(catalog), 'The public catalog must be readable anonymously.');
for (const church of catalog) {
  assert.equal(typeof church.lat, 'number');
  assert.equal(typeof church.lng, 'number');
}

const created = catalog.find((church) => church.church_id === churchId);
assert.ok(created, 'The synthetic church must appear in the public catalog.');
assert.equal(created.lat, churchPoint.lat);
assert.equal(created.lng, churchPoint.lng);

// Proximity ordering is available but only when a caller supplies a location.
const near = await rpc(anonymous, 'search_published_churches', {
  p_lat: churchPoint.lat, p_lng: churchPoint.lng, p_limit: 5,
});
assert.equal(near[0].church_id, churchId);
assert.equal(typeof near[0].distance_m, 'number');
assert.equal(created.distance_m ?? null, null, 'Distance must be absent without a supplied location.');

// ------------------------------------------------------------------ approximate public areas

const requests = await rpc(anonymous, 'list_active_passenger_requests');
const occurrences = await rpc(anonymous, 'list_active_driver_occurrences');

for (const request of requests) {
  for (const option of request.place_options ?? []) {
    assert.ok(option.public_area_label, 'A public place must carry its area label.');
    if (option.public_area) {
      assert.equal(option.public_area.radius_m, 1000, 'The public area stays about one kilometre.');
    }
    assert.equal(option.exact_address, undefined, 'An exact address must never be public.');
    assert.equal(option.exact_point, undefined, 'An exact point must never be public.');
  }
}
for (const offer of occurrences) {
  assert.ok(offer.public_origin_area, 'A driver offer must carry its public departure area label.');
  if (offer.origin_area?.public_area) {
    assert.equal(offer.origin_area.public_area.radius_m, 1000);
  }
}

// No public route geometry exists as a concept in any anonymous projection.
const publicPayload = JSON.stringify({ catalog, occurrences, requests }).toLowerCase();
for (const token of ['polyline', 'corridor', 'route_geometry', 'encodedpath', 'waypoint', 'exact_address']) {
  assert.equal(publicPayload.includes(token), false, `A public payload must not contain ${token}.`);
}

// ------------------------------------------------------------------ protected boundaries

// Suggestions belong to an identified person; the route bridge belongs to the service role only.
await expectRpcDenied(anonymous, 'list_quality_matches');
await expectRpcDenied(anonymous, 'route_worker_pending_legs', { p_limit: 1 });
await expectRpcDenied(anonymous, 'route_worker_record_leg', {
  p_church_id: '00000000-0000-4000-8000-000000000001',
  p_distance_m: 1,
  p_duration_s: 1,
  p_origin_place_id: '00000000-0000-4000-8000-000000000002',
  p_provider_name: 'probe',
  p_via_place_id: null,
});
await expectRpcDenied(anonymous, 'list_saved_places');

// ------------------------------------------------------------------ deployed map surfaces

const catalogHtml = await page(`/churches?q=${encodeURIComponent('Synthetic Maps Check')}`);
assert.ok(catalogHtml.includes('data-church-catalog'), 'The deployed catalog must render.');
assert.ok(catalogHtml.includes('Рядом со мной'), 'The explicit location action must be present.');
assert.ok(catalogHtml.includes('data-catalog-map'), 'The catalog map surface must be present.');
assert.ok(catalogHtml.includes('data-interactive-map'), 'The catalog must mount the interactive map.');
// Attribution is a licence obligation, not decoration.
assert.ok(catalogHtml.includes('OpenStreetMap'), 'A rendered map must carry its data attribution.');
assert.ok(catalogHtml.includes('Geoapify'), 'The provider credit must be present.');
// The server credential must never reach a page.
assert.equal(catalogHtml.includes('ORTHODOX_ROUTES_MAP_SERVER_KEY'), false);

const churchHtml = await page(`/churches/${churchSlug}/location`);
assert.ok(churchHtml.includes('data-church-location-map'), 'The church location map must render.');
assert.ok(churchHtml.includes('data-interactive-map'), 'The location screen must mount the interactive map.');
// External navigation stays a link and never becomes an embedded integration.
assert.ok(churchHtml.includes('data-external-maps'), 'The external navigation links must be offered.');
assert.ok(churchHtml.includes('google.com/maps') && churchHtml.includes('yandex.ru/maps'));

// Exact private coordinates must not appear in anonymous HTML anywhere.
for (const html of [catalogHtml, churchHtml]) {
  assert.equal(/data-exact-(lat|lng|point)/.test(html), false, 'Exact geography must not reach anonymous HTML.');
}

console.log(`Staging maps verification passed for project ${projectRef}.`);
console.log('- both geographic migrations are applied remotely');
console.log('- the public catalog exposes exact church coordinates and optional proximity ordering');
console.log('- public listings expose only approximate areas and carry no route geometry');
console.log('- the matching reader, the route bridge, and saved places refuse an anonymous caller');
console.log('- the deployed catalog and church location screens mount the interactive map with attribution');
console.log('- no server credential and no exact geography reached anonymous HTML');

} finally {
  runSql(`delete from app.church where public_id = ${sqlLiteral(churchId)}::uuid;`);
}
