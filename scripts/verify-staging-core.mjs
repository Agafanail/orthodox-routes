import assert from 'node:assert/strict';
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

function fail(message) {
  throw new Error(message);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const reason = `${result.stderr ?? ''}${result.stdout ?? ''}`
      .trim().split('\n').slice(-4).join('\n');
    fail(`The authenticated staging CLI operation failed.\n${reason}`);
  }
  return result.stdout;
}

function runSql(statement) {
  runCli(['db', 'query', '--linked', statement]);
}

function queryRows(statement) {
  const result = JSON.parse(runCli([
    'db', 'query', '--linked', '--output-format', 'json', statement,
  ]));
  if (!Array.isArray(result.rows)) fail('The staging query returned an invalid result.');
  return result.rows;
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
  const secretKey = keys.find((key) => key.type === 'secret')?.api_key
    ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!publicKey || !secretKey) fail('Required staging API keys are unavailable.');

  return { projectRef, publicKey, secretKey, url: `https://${projectRef}.supabase.co` };
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
  if (result.error) {
    const safeCode = result.error.code ?? result.error.status ?? 'unknown';
    fail(`The staging Core RPC failed: ${name} (${safeCode}).`);
  }
  return result.data;
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic staging identity could not sign in.');
}

function isoAfter(days, hour) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function cleanupSql(accountIds, churchId, removeChurch) {
  const accounts = accountIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
  const fixtureAccounts = `select id from app.account where id in (${accounts})`;
  const fixtureRequests = `select id from app.passenger_request where author_account_id in (${accounts})`;
  const fixtureOccurrences = `select id from app.driver_offer_occurrence where author_account_id in (${accounts})`;
  const fixtureAgreements = `
    select id from app.ride_agreement
    where passenger_request_id in (${fixtureRequests})
       or driver_occurrence_id in (${fixtureOccurrences})
  `;

  return `
    begin;
    set local session_replication_role = replica;
    delete from private.agreement_contact_snapshot where agreement_id in (${fixtureAgreements});
    delete from app.agreement_event where agreement_id in (${fixtureAgreements});
    delete from app.ride_agreement where id in (${fixtureAgreements});
    delete from app.ride_response
    where passenger_request_id in (${fixtureRequests})
       or driver_occurrence_id in (${fixtureOccurrences});
    delete from app.ride_condition_snapshot
    where passenger_request_id in (${fixtureRequests})
       or driver_occurrence_id in (${fixtureOccurrences});
    set local session_replication_role = origin;
    delete from app.passenger_request_place where request_id in (${fixtureRequests});
    delete from app.passenger_request where id in (${fixtureRequests});
    delete from app.driver_offer_occurrence where id in (${fixtureOccurrences});
    delete from app.driver_offer_series where author_account_id in (${accounts});
    delete from private.user_place where owner_account_id in (${accounts});
    delete from app.account where id in (${fixtureAccounts});
    ${removeChurch ? `delete from app.church where public_id = ${sqlLiteral(churchId)}::uuid;` : ''}
    commit;
  `;
}

const { publicKey, secretKey, url } = readStagingConfiguration();

const currentTerms = queryRows(`
  select id
  from app.legal_document_version
  where id = app.current_legal_document_id('terms', now())
`);
if (currentTerms.length !== 1) {
  fail('The isolated staging project has no current published Terms fixture.');
}

const existingChurches = queryRows(`
  select public_id, status
  from app.church
  where slug = 'pokrov-catanzaro'
`);
if (existingChurches.length > 1
  || (existingChurches.length === 1 && existingChurches[0].status !== 'published')) {
  fail('The staging board church is ambiguous or unavailable.');
}
const churchId = existingChurches[0]?.public_id ?? randomUUID();
const createdChurch = existingChurches.length === 0;

const readiness = await fetch(`${stagingAppOrigin}/api/readiness`, {
  headers: { 'cache-control': 'no-cache' },
});
assert.equal(readiness.status, 200);
const readinessBody = await readiness.json();
assert.equal(readinessBody.scope, 'core-application');
assert.equal(readinessBody.status, 'ready');

const suffix = `${Date.now()}-${process.pid}`;
const phoneStem = String(Date.now()).slice(-9);
const password = `Staging-core-${suffix}-Aa1!`;
const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);
const identities = [
  { email: `staging-passenger-${suffix}@example.test`, name: 'Staging Passenger', phone: `+390${phoneStem}1` },
  { email: `staging-driver-${suffix}@example.test`, name: 'Staging Driver', phone: `+390${phoneStem}2` },
  { email: `staging-unrelated-${suffix}@example.test`, name: 'Staging Unrelated', phone: `+390${phoneStem}3` },
];

try {
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email,
      email_confirm: true,
      password,
    });
    if (created.error || !created.data.user) {
      const safeCode = created.error?.code ?? created.error?.status ?? 'unknown';
      fail(`A synthetic staging identity could not be created (${safeCode}).`);
    }
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

  runSql(`
    update private.account_contact
    set phone_verified_at = now()
    where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
    ${createdChurch ? `
      insert into app.church (
        public_id, slug, official_name, address_display, locality, country_code, timezone, status, location
      ) values (
        ${sqlLiteral(churchId)}::uuid, 'pokrov-catanzaro',
        'Synthetic Staging Church', 'Synthetic staging address', 'Test Locality', 'IT', 'UTC', 'published',
        extensions.st_setsrid(extensions.st_makepoint(7.6869, 45.0703), 4326)::extensions.geography
      );
    ` : ''}
  `);

  for (const client of clients) await rpc(client, 'accept_current_terms');

  const arrivalAt = isoAfter(7, 10);
  const request = await rpc(clients[0], 'publish_passenger_request', {
    p_child_seat_required: false,
    p_children_count: 0,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_desired_arrival_at: arrivalAt,
    p_places: [syntheticPlace(45.0611, 7.6721, 'Synthetic exact passenger place', 'Passenger test area')],
    p_public_note: null,
    p_return_required: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_passengers: 1,
  });
  const occurrence = await rpc(clients[1], 'publish_driver_occurrence', {
    p_arrival_at: arrivalAt,
    p_children_allowed: false,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_departure_at: isoAfter(7, 9),
    p_driver_child_seat_available: false,
    p_origin: syntheticPlace(45.0301, 7.6402, 'Synthetic exact driver place', 'Driver test area'),
    p_max_detour_km: 5,
    p_public_note: null,
    p_return_available: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_seats: 2,
  });

  const publicRequests = await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId });
  const publicRequest = publicRequests.find((item) => item.request_id === request.request_id);
  assert.ok(publicRequest);
  assert.equal(JSON.stringify(publicRequest).includes('Synthetic exact'), false);
  assert.equal(JSON.stringify(publicRequest).includes('@example.test'), false);
  const publicOccurrences = await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId });
  assert.equal(publicOccurrences.some((item) => item.occurrence_id === occurrence.occurrence_id), true);
  assert.equal(JSON.stringify(publicOccurrences).includes('Synthetic exact'), false);

  const boardResponse = await fetch(`${stagingAppOrigin}/churches/pokrov-catanzaro`, {
    headers: { 'cache-control': 'no-cache' },
  });
  assert.equal(boardResponse.status, 200);
  const boardHtml = await boardResponse.text();
  assert.equal(boardHtml.includes('Passenger test area'), true);
  assert.equal(boardHtml.includes('Driver test area'), true);
  assert.equal(boardHtml.includes('Synthetic exact'), false);
  assert.equal(boardHtml.includes('@example.test'), false);
  assert.equal(identities.some((identity) => boardHtml.includes(identity.phone)), false);

  const response = await rpc(clients[1], 'submit_driver_response', {
    p_client_key: randomUUID(),
    p_occurrence_id: occurrence.occurrence_id,
    p_offered_passenger_count: 1,
    p_place_id: publicRequest.place_options[0].place_id,
    p_request_id: request.request_id,
  });
  assert.deepEqual(await rpc(clients[2], 'current_ride_responses'), []);
  const agreement = await rpc(clients[0], 'confirm_ride_response', {
    p_client_key: randomUUID(),
    p_response_id: response.response_id,
  });
  assert.equal(agreement.status, 'confirmed');
  assert.deepEqual(await rpc(clients[2], 'current_ride_agreements'), []);

  const passengerContact = await rpc(clients[0], 'get_agreement_contacts', {
    p_agreement_id: agreement.agreement_id,
  });
  assert.equal(passengerContact.email, identities[1].email);
  assert.equal(passengerContact.phone, identities[1].phone);
  assert.equal(await rpc(clients[2], 'get_agreement_contacts', {
    p_agreement_id: agreement.agreement_id,
  }), null);
  assert.equal((await rpc(clients[0], 'get_agreement_exact_place', {
    p_agreement_id: agreement.agreement_id,
  })).exact_meeting_label, 'Synthetic exact passenger place');

  const afterConfirmation = await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId });
  assert.equal(afterConfirmation.find((item) => item.occurrence_id === occurrence.occurrence_id).available_seats, 1);
  await rpc(clients[1], 'cancel_ride_agreement', {
    p_agreement_id: agreement.agreement_id,
    p_client_key: randomUUID(),
  });
  assert.equal(await rpc(clients[0], 'get_agreement_contacts', {
    p_agreement_id: agreement.agreement_id,
  }), null);
  const afterCancellation = await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId });
  assert.equal(afterCancellation.find((item) => item.occurrence_id === occurrence.occurrence_id).available_seats, 2);
  assert.equal((await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
    .some((item) => item.request_id === request.request_id), true);

  console.log('Remote staging Core smoke verification passed:');
  console.log('- isolated synthetic passenger, driver, and unrelated identities coordinated through the remote API');
  console.log('- the HTTPS deployment rendered remote public board data without exact places or contacts');
  console.log('- ownership, public privacy, agreement, capacity, driver cancellation, republication, and disclosure held');
  console.log('- phone eligibility used a database-owner staging fixture; real SMS delivery was not verified');
} finally {
  const createdAccountIds = identities.flatMap((identity) => identity.id ? [identity.id] : []);
  if (createdAccountIds.length > 0) {
    runSql(cleanupSql(createdAccountIds, churchId, createdChurch));
  }
  for (const identity of identities) {
    if (!identity.id) continue;
    const removed = await admin.auth.admin.deleteUser(identity.id);
    if (removed.error) fail('A synthetic staging identity could not be removed.');
  }
  const leftoverAccounts = createdAccountIds.length === 0 ? [] : queryRows(`
    select id from app.account
    where id in (${createdAccountIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')})
  `);
  assert.deepEqual(leftoverAccounts, []);
  if (!createdChurch) {
    const preservedChurch = queryRows(`
      select public_id from app.church where public_id = ${sqlLiteral(churchId)}::uuid
    `);
    assert.equal(preservedChurch.length, 1);
  }
  console.log('- only this run\'s synthetic staging data was removed; unrelated fixtures were preserved');
}
