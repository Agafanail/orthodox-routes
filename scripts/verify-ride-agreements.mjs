import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));

function fail(message) { throw new Error(message); }

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase agreement test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only agreement configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for agreement verification.');
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
  if (result.status !== 0) fail(`An agreement database assertion failed.\n${result.stderr}`);
  return result.stdout.trim();
}

function expectSqlFailure(container, statement) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  assert.notEqual(result.status, 0, 'A protected agreement database mutation unexpectedly succeeded.');
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function callRpc(client, name, args = {}) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.schema('api').rpc(name, args);
    const cachePending = result.error
      && /schema cache|could not find the function|retrying/i.test(result.error.message);
    if (!cachePending || attempt === 11) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Unreachable RPC retry state.');
}

async function rpc(client, name, args = {}) {
  const result = await callRpc(client, name, args);
  if (result.error) fail(`Agreement RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await callRpc(client, name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic agreement user could not sign in.');
}

function isoAfter(days, hour, minute = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const nowValue = Date.now();
const suffix = `${nowValue}-${process.pid}`;
const phoneStem = String(nowValue).slice(-9);
const password = `Local-agreement-${suffix}-Aa1!`;
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const anonymous = userClient(url, publicKey);
const identities = [
  { email: `agreement-passenger-a-${suffix}@example.test`, name: 'Passenger Alpha', phone: `+390${phoneStem}1` },
  { email: `agreement-passenger-b-${suffix}@example.test`, name: 'Passenger Beta', phone: `+390${phoneStem}2` },
  { email: `agreement-passenger-c-${suffix}@example.test`, name: 'Passenger Gamma', phone: `+390${phoneStem}3` },
  { email: `agreement-driver-${suffix}@example.test`, name: 'Driver Delta', phone: `+390${phoneStem}4` },
  { email: `agreement-other-${suffix}@example.test`, name: 'Unrelated User', phone: `+390${phoneStem}5` },
];

for (const identity of identities) {
  const created = await admin.auth.admin.createUser({ email: identity.email, email_confirm: true, password });
  if (created.error || !created.data.user) fail('A synthetic agreement identity could not be created.');
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
    'terms', ${sqlLiteral(`agreement-test-${suffix}`)}, array['en'], now() - interval '1 hour', 'published', repeat('b', 64)
  );
`);
for (const client of clients) await rpc(client, 'accept_current_terms');
runSql(container, `
  update private.account_contact set phone_verified_at = now()
  where account_id in (${identities.map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
`);

const churchId = randomUUID();
runSql(container, `
  insert into app.church (
    public_id, slug, official_name, address_display, locality, country_code, timezone, status
  ) values (
    ${sqlLiteral(churchId)}::uuid, ${sqlLiteral(`agreement-test-${suffix}`)}, 'Synthetic Agreement Church',
    'Synthetic public church address', 'Test Locality', 'IT', 'UTC', 'published'
  );
`);

async function publishRequest(client, arrivalAt, passengers, label) {
  return rpc(client, 'publish_passenger_request', {
    p_child_seat_required: false,
    p_children_count: 0,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_desired_arrival_at: arrivalAt,
    p_places: [{ exact_label: `Exact ${label}`, public_area_label: `${label} district` }],
    p_public_note: null,
    p_return_required: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_passengers: passengers,
  });
}

async function publishOccurrence(arrivalAt, seats, label) {
  const departure = new Date(new Date(arrivalAt).getTime() - 60 * 60 * 1000).toISOString();
  return rpc(clients[3], 'publish_driver_occurrence', {
    p_arrival_at: arrivalAt,
    p_children_allowed: true,
    p_church_id: churchId,
    p_client_key: randomUUID(),
    p_departure_at: departure,
    p_driver_child_seat_available: true,
    p_exact_origin_label: `Exact driver origin ${label}`,
    p_max_detour_km: 5,
    p_public_note: null,
    p_public_origin_area: `${label} origin district`,
    p_return_available: false,
    p_service_occurrence_id: null,
    p_timezone: 'UTC',
    p_total_seats: seats,
  });
}

async function placeId(requestId) {
  const requests = await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId });
  return requests.find((request) => request.request_id === requestId)?.place_options[0]?.place_id;
}

const firstArrival = isoAfter(7, 9);
const firstRequest = await publishRequest(clients[0], firstArrival, 2, 'Alpha');
const churchProjection = await rpc(anonymous, 'transport_church_by_slug', { p_slug: `agreement-test-${suffix}` });
assert.equal(churchProjection.church_id, churchId);
assert.equal(churchProjection.official_name, 'Synthetic Agreement Church');
assert.equal(JSON.stringify(churchProjection).includes('Exact'), false);
assert.equal(await rpc(anonymous, 'transport_church_by_slug', { p_slug: `missing-${suffix}` }), null);

const contextualDraftId = randomUUID();
runSql(container, `
  insert into private.contextual_draft (
    public_id, client_key, action_type, payload_version, payload, payload_fingerprint,
    state, auth_user_id, account_id, expires_at, claimed_at
  ) values (
    ${sqlLiteral(contextualDraftId)}::uuid, ${sqlLiteral(randomUUID())}::uuid,
    'passenger_request', 1, '{"safe":"fixture"}'::jsonb, repeat('c', 64),
    'claimed', ${sqlLiteral(identities[0].id)}::uuid, ${sqlLiteral(identities[0].id)}::uuid,
    now() + interval '1 hour', now()
  );
`);
await expectRpcFailure(clients[4], 'complete_contextual_transport_draft', {
  p_draft_id: contextualDraftId, p_result_id: firstRequest.request_id, p_result_type: 'passenger_request',
});
const completedDraft = await rpc(clients[0], 'complete_contextual_transport_draft', {
  p_draft_id: contextualDraftId, p_result_id: firstRequest.request_id, p_result_type: 'passenger_request',
});
assert.equal(completedDraft.status, 'completed');
assert.equal(runSql(container, `select state || ':' || (payload is null)::text from private.contextual_draft where public_id = ${sqlLiteral(contextualDraftId)}::uuid;`), 'completed:true');
const firstOccurrence = await publishOccurrence(firstArrival, 1, 'first');
const firstPlaceId = await placeId(firstRequest.request_id);
assert.ok(firstPlaceId);

const contextualResponseDraftId = randomUUID();
runSql(container, `
  insert into private.contextual_draft (
    public_id, client_key, action_type, payload_version, payload, payload_fingerprint,
    state, auth_user_id, account_id, expires_at, claimed_at
  ) values (
    ${sqlLiteral(contextualResponseDraftId)}::uuid, ${sqlLiteral(randomUUID())}::uuid,
    'ride_response', 1, '{"safe":"response-fixture"}'::jsonb, repeat('d', 64),
    'claimed', ${sqlLiteral(identities[2].id)}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
    now() + interval '1 hour', now()
  );
`);
const contextualPassengerResponseArgs = {
  p_child_seat_required: false, p_children_count: 0, p_church_id: churchId,
  p_client_key: contextualResponseDraftId, p_desired_arrival_at: firstArrival,
  p_occurrence_id: firstOccurrence.occurrence_id,
  p_places: [{ exact_label: 'Exact contextual passenger', public_area_label: 'Context passenger district' }],
  p_public_note: null, p_return_required: false, p_service_occurrence_id: null,
  p_timezone: 'UTC', p_total_passengers: 1,
};
const contextualPassengerResponse = await rpc(clients[2], 'publish_contextual_passenger_response', contextualPassengerResponseArgs);
assert.equal(contextualPassengerResponse.status, 'await_driver');
assert.deepEqual(
  await rpc(clients[2], 'publish_contextual_passenger_response', contextualPassengerResponseArgs),
  contextualPassengerResponse,
);
assert.equal((await rpc(clients[2], 'complete_contextual_transport_draft', {
  p_draft_id: contextualResponseDraftId, p_result_id: contextualPassengerResponse.response_id,
  p_result_type: 'ride_response',
})).status, 'completed');
const unrelatedResponseDraftId = randomUUID();
runSql(container, `
  insert into private.contextual_draft (
    public_id, client_key, action_type, payload_version, payload, payload_fingerprint,
    state, auth_user_id, account_id, expires_at, claimed_at
  ) values (
    ${sqlLiteral(unrelatedResponseDraftId)}::uuid, ${sqlLiteral(randomUUID())}::uuid,
    'ride_response', 1, '{"safe":"unrelated-response-fixture"}'::jsonb, repeat('e', 64),
    'claimed', ${sqlLiteral(identities[2].id)}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
    now() + interval '1 hour', now()
  );
`);
await expectRpcFailure(clients[2], 'complete_contextual_transport_draft', {
  p_draft_id: unrelatedResponseDraftId, p_result_id: contextualPassengerResponse.response_id,
  p_result_type: 'ride_response',
});
await rpc(clients[3], 'answer_passenger_response', {
  p_accept: false, p_client_key: randomUUID(), p_offered_passenger_count: null,
  p_place_id: null, p_response_id: contextualPassengerResponse.response_id,
});

const wrapperRequest = await publishRequest(clients[1], firstArrival, 1, 'Wrapper Beta');
const contextualDriverResponse = await rpc(clients[3], 'publish_contextual_driver_response', {
  p_arrival_at: firstArrival, p_children_allowed: false, p_church_id: churchId,
  p_client_key: randomUUID(), p_departure_at: new Date(new Date(firstArrival).getTime() - 3600000).toISOString(),
  p_driver_child_seat_available: false, p_exact_origin_label: 'Exact contextual driver',
  p_max_detour_km: 5, p_offered_passenger_count: 1,
  p_place_id: await placeId(wrapperRequest.request_id), p_public_note: null,
  p_public_origin_area: 'Context driver district', p_request_id: wrapperRequest.request_id,
  p_return_available: false, p_service_occurrence_id: null, p_timezone: 'UTC', p_total_seats: 1,
});
assert.equal(contextualDriverResponse.status, 'await_passenger');
await rpc(clients[1], 'decline_ride_response', {
  p_client_key: randomUUID(), p_response_id: contextualDriverResponse.response_id,
});

const requestCountBeforeFailedWrapper = runSql(container, `select count(*) from app.passenger_request where author_account_id = ${sqlLiteral(identities[2].id)}::uuid;`);
await expectRpcFailure(clients[2], 'publish_contextual_passenger_response', {
  p_child_seat_required: false, p_children_count: 0, p_church_id: churchId,
  p_client_key: randomUUID(), p_desired_arrival_at: firstArrival, p_occurrence_id: randomUUID(),
  p_places: [{ exact_label: 'Must roll back', public_area_label: 'Rollback district' }],
  p_public_note: null, p_return_required: false, p_service_occurrence_id: null,
  p_timezone: 'UTC', p_total_passengers: 1,
});
assert.equal(runSql(container, `select count(*) from app.passenger_request where author_account_id = ${sqlLiteral(identities[2].id)}::uuid;`), requestCountBeforeFailedWrapper);

const firstResponse = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(),
  p_occurrence_id: firstOccurrence.occurrence_id,
  p_offered_passenger_count: 1,
  p_place_id: firstPlaceId,
  p_request_id: firstRequest.request_id,
});
assert.equal(firstResponse.status, 'await_passenger');

const passengerResponses = await rpc(clients[0], 'current_ride_responses');
assert.equal(passengerResponses[0].response_id, firstResponse.response_id);
assert.equal(passengerResponses[0].current_role, 'passenger');
assert.equal(passengerResponses[0].selected_place.public_area_label, 'Alpha district');
assert.equal(JSON.stringify(passengerResponses).includes('Exact Alpha'), false);
assert.equal(JSON.stringify(passengerResponses).includes(identities[3].phone), false);
assert.deepEqual(await rpc(clients[4], 'current_ride_responses'), []);
assert.equal(await rpc(clients[0], 'get_agreement_contacts', { p_agreement_id: randomUUID() }), null);

const firstConfirmKey = randomUUID();
const firstAgreement = await rpc(clients[0], 'confirm_ride_response', {
  p_client_key: firstConfirmKey, p_response_id: firstResponse.response_id,
});
assert.equal(firstAgreement.status, 'confirmed');
assert.equal((await rpc(clients[0], 'current_ride_agreements'))[0].current_role, 'passenger');
assert.equal((await rpc(clients[3], 'current_ride_agreements'))[0].current_role, 'driver');
assert.deepEqual(await rpc(clients[0], 'confirm_ride_response', {
  p_client_key: firstConfirmKey, p_response_id: firstResponse.response_id,
}), firstAgreement);

const passengerContact = await rpc(clients[0], 'get_agreement_contacts', { p_agreement_id: firstAgreement.agreement_id });
assert.equal(passengerContact.email, identities[3].email);
assert.equal(passengerContact.phone, identities[3].phone);
const driverContact = await rpc(clients[3], 'get_agreement_contacts', { p_agreement_id: firstAgreement.agreement_id });
assert.equal(driverContact.email, identities[0].email);
assert.equal(driverContact.phone, identities[0].phone);
assert.equal((await rpc(clients[0], 'get_agreement_exact_place', { p_agreement_id: firstAgreement.agreement_id })).exact_meeting_label, 'Exact Alpha');
assert.equal((await rpc(clients[3], 'get_agreement_exact_place', { p_agreement_id: firstAgreement.agreement_id })).exact_meeting_label, 'Exact Alpha');
assert.equal(await rpc(clients[4], 'get_agreement_contacts', { p_agreement_id: firstAgreement.agreement_id }), null);
assert.equal(await rpc(clients[4], 'get_agreement_exact_place', { p_agreement_id: firstAgreement.agreement_id }), null);
assert.deepEqual(await rpc(clients[4], 'current_ride_agreements'), []);
expectSqlFailure(container, `
  update app.ride_agreement as agreement
  set contact_visible_until = occurrence.arrival_at + interval '31 days'
  from app.driver_offer_occurrence as occurrence
  where occurrence.id = agreement.driver_occurrence_id
    and agreement.public_id = ${sqlLiteral(firstAgreement.agreement_id)}::uuid;
`);
expectSqlFailure(container, `
  update private.agreement_contact_snapshot set phone_e164 = '+99900000001'
  where agreement_id = (select id from app.ride_agreement where public_id = ${sqlLiteral(firstAgreement.agreement_id)}::uuid);
`);

const partialPublic = (await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
  .find((request) => request.request_id === firstRequest.request_id);
assert.equal(partialPublic.passenger_count, 1);
assert.equal((await rpc(anonymous, 'list_active_driver_occurrences', { p_church_id: churchId }))
  .some((occurrence) => occurrence.occurrence_id === firstOccurrence.occurrence_id), false);
await expectRpcFailure(clients[4], 'cancel_ride_agreement', {
  p_agreement_id: firstAgreement.agreement_id, p_client_key: randomUUID(),
});
const cancelKey = randomUUID();
const firstCancelled = await rpc(clients[3], 'cancel_ride_agreement', {
  p_agreement_id: firstAgreement.agreement_id, p_client_key: cancelKey,
});
assert.equal(firstCancelled.status, 'cancelled');
assert.deepEqual(await rpc(clients[3], 'cancel_ride_agreement', {
  p_agreement_id: firstAgreement.agreement_id, p_client_key: cancelKey,
}), firstCancelled);
await expectRpcFailure(clients[3], 'cancel_ride_agreement', {
  p_agreement_id: firstAgreement.agreement_id, p_client_key: randomUUID(),
});
assert.equal(await rpc(clients[0], 'get_agreement_contacts', { p_agreement_id: firstAgreement.agreement_id }), null);
assert.equal(await rpc(clients[0], 'get_agreement_exact_place', { p_agreement_id: firstAgreement.agreement_id }), null);
assert.equal(runSql(container, `select confirmed_seats from app.driver_offer_occurrence where public_id = ${sqlLiteral(firstOccurrence.occurrence_id)}::uuid;`), '0');
assert.equal((await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
  .find((request) => request.request_id === firstRequest.request_id).passenger_count, 2);

const secondArrival = isoAfter(8, 10);
const secondRequest = await publishRequest(clients[1], secondArrival, 1, 'Beta');
const secondOccurrence = await publishOccurrence(secondArrival, 1, 'second');
const secondResponse = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: secondOccurrence.occurrence_id,
  p_offered_passenger_count: 1, p_place_id: await placeId(secondRequest.request_id),
  p_request_id: secondRequest.request_id,
});
const secondAgreement = await rpc(clients[1], 'confirm_ride_response', {
  p_client_key: randomUUID(), p_response_id: secondResponse.response_id,
});
assert.equal((await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
  .some((request) => request.request_id === secondRequest.request_id), false);
await rpc(clients[3], 'cancel_ride_agreement', {
  p_agreement_id: secondAgreement.agreement_id, p_client_key: randomUUID(),
});
assert.equal(runSql(container, `select status from app.passenger_request where public_id = ${sqlLiteral(secondRequest.request_id)}::uuid;`), 'restore');
assert.equal((await rpc(anonymous, 'list_active_passenger_requests', { p_church_id: churchId }))
  .some((request) => request.request_id === secondRequest.request_id), false);
assert.equal((await rpc(clients[1], 'restore_passenger_request', {
  p_client_key: randomUUID(), p_request_id: secondRequest.request_id,
})).status, 'active');

const passengerResponse = await rpc(clients[1], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: secondOccurrence.occurrence_id,
  p_request_id: secondRequest.request_id,
});
assert.equal(passengerResponse.status, 'await_driver');
const answered = await rpc(clients[3], 'answer_passenger_response', {
  p_accept: true, p_client_key: randomUUID(), p_offered_passenger_count: 1,
  p_place_id: await placeId(secondRequest.request_id), p_response_id: passengerResponse.response_id,
});
assert.equal(answered.status, 'await_passenger');
const passengerAgreement = await rpc(clients[1], 'confirm_ride_response', {
  p_client_key: randomUUID(), p_response_id: passengerResponse.response_id,
});
assert.equal(passengerAgreement.status, 'confirmed');
const bulkCancelled = await rpc(clients[3], 'cancel_driver_occurrence', {
  p_client_key: randomUUID(), p_occurrence_id: secondOccurrence.occurrence_id,
});
assert.equal(bulkCancelled.cancelled_agreements, 1);
assert.equal(await rpc(clients[1], 'get_agreement_contacts', { p_agreement_id: passengerAgreement.agreement_id }), null);
assert.equal(runSql(container, `select status from app.passenger_request where public_id = ${sqlLiteral(secondRequest.request_id)}::uuid;`), 'restore');

const concurrencyArrival = isoAfter(9, 11);
const concurrencyRequestA = await publishRequest(clients[0], concurrencyArrival, 1, 'Concurrent Alpha');
const concurrencyRequestB = await publishRequest(clients[2], concurrencyArrival, 1, 'Concurrent Gamma');
const concurrencyOccurrence = await publishOccurrence(concurrencyArrival, 1, 'concurrency');
const concurrencyResponseA = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: concurrencyOccurrence.occurrence_id,
  p_offered_passenger_count: 1, p_place_id: await placeId(concurrencyRequestA.request_id),
  p_request_id: concurrencyRequestA.request_id,
});
const concurrencyResponseB = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: concurrencyOccurrence.occurrence_id,
  p_offered_passenger_count: 1, p_place_id: await placeId(concurrencyRequestB.request_id),
  p_request_id: concurrencyRequestB.request_id,
});
const concurrentResults = await Promise.all([
  rpc(clients[0], 'confirm_ride_response', { p_client_key: randomUUID(), p_response_id: concurrencyResponseA.response_id }),
  rpc(clients[2], 'confirm_ride_response', { p_client_key: randomUUID(), p_response_id: concurrencyResponseB.response_id }),
]);
assert.deepEqual(concurrentResults.map((result) => result.status).sort(), ['confirmed', 'stale']);
assert.equal(runSql(container, `select confirmed_seats from app.driver_offer_occurrence where public_id = ${sqlLiteral(concurrencyOccurrence.occurrence_id)}::uuid;`), '1');
assert.equal(runSql(container, `
  select count(*) from app.ride_agreement as agreement
  join app.driver_offer_occurrence as occurrence on occurrence.id = agreement.driver_occurrence_id
  where occurrence.public_id = ${sqlLiteral(concurrencyOccurrence.occurrence_id)}::uuid and agreement.status = 'confirmed';
`), '1');

const winningAgreement = concurrentResults.find((result) => result.status === 'confirmed');
const winnerClient = concurrentResults[0].status === 'confirmed' ? clients[0] : clients[2];
assert.equal(runSql(container, `
  select ((agreement.contact_visible_until = occurrence.arrival_at + interval '30 days')
    and (agreement.exact_data_delete_due_at = occurrence.arrival_at + interval '30 days'))::text
  from app.ride_agreement as agreement
  join app.driver_offer_occurrence as occurrence on occurrence.id = agreement.driver_occurrence_id
  where agreement.public_id = ${sqlLiteral(winningAgreement.agreement_id)}::uuid;
`), 'true');

const terminalArrival = isoAfter(10, 12);
const terminalRequest = await publishRequest(clients[2], terminalArrival, 1, 'Terminal Gamma');
const terminalOccurrence = await publishOccurrence(terminalArrival, 1, 'terminal');
const terminalPlace = await placeId(terminalRequest.request_id);
const withdrawPassenger = await rpc(clients[2], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: terminalOccurrence.occurrence_id, p_request_id: terminalRequest.request_id,
});
assert.equal((await rpc(clients[2], 'withdraw_ride_response', {
  p_client_key: randomUUID(), p_response_id: withdrawPassenger.response_id,
})).status, 'withdrawn');
const declinePassenger = await rpc(clients[2], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: terminalOccurrence.occurrence_id, p_request_id: terminalRequest.request_id,
});
assert.equal((await rpc(clients[3], 'decline_ride_response', {
  p_client_key: randomUUID(), p_response_id: declinePassenger.response_id,
})).status, 'declined');
const withdrawDriver = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: terminalOccurrence.occurrence_id,
  p_offered_passenger_count: 1, p_place_id: terminalPlace, p_request_id: terminalRequest.request_id,
});
assert.equal((await rpc(clients[3], 'withdraw_ride_response', {
  p_client_key: randomUUID(), p_response_id: withdrawDriver.response_id,
})).status, 'withdrawn');
const declineDriver = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: terminalOccurrence.occurrence_id,
  p_offered_passenger_count: 1, p_place_id: terminalPlace, p_request_id: terminalRequest.request_id,
});
assert.equal((await rpc(clients[2], 'decline_ride_response', {
  p_client_key: randomUUID(), p_response_id: declineDriver.response_id,
})).status, 'declined');

const pendingExpiryResponse = await rpc(clients[2], 'submit_passenger_response', {
  p_client_key: randomUUID(), p_occurrence_id: terminalOccurrence.occurrence_id,
  p_request_id: terminalRequest.request_id,
});

const seriesDate = isoAfter(11, 13).slice(0, 10);
const seriesDow = new Date(`${seriesDate}T12:00:00Z`).getUTCDay();
const seriesOffer = await rpc(clients[3], 'publish_driver_series', {
  p_children_allowed: true,
  p_church_id: churchId,
  p_client_key: randomUUID(),
  p_driver_child_seat_available: true,
  p_ends_on: seriesDate,
  p_exact_origin_label: 'Exact series lifecycle origin',
  p_local_arrival_time: '13:00:00',
  p_local_departure_time: '12:00:00',
  p_max_detour_km: 5,
  p_public_note: null,
  p_public_origin_area: 'Series lifecycle district',
  p_return_available: false,
  p_starts_on: seriesDate,
  p_timezone: 'UTC',
  p_total_seats: 1,
  p_weekdays: [seriesDow],
});
const seriesRequest = await publishRequest(clients[0], `${seriesDate}T13:00:00.000Z`, 1, 'Series Alpha');
const seriesResponse = await rpc(clients[3], 'submit_driver_response', {
  p_client_key: randomUUID(), p_occurrence_id: seriesOffer.first_occurrence_id,
  p_offered_passenger_count: 1, p_place_id: await placeId(seriesRequest.request_id),
  p_request_id: seriesRequest.request_id,
});
const seriesAgreement = await rpc(clients[0], 'confirm_ride_response', {
  p_client_key: randomUUID(), p_response_id: seriesResponse.response_id,
});
const stoppedSeries = await rpc(clients[3], 'stop_driver_series', {
  p_client_key: randomUUID(), p_series_id: seriesOffer.series_id,
});
assert.equal(stoppedSeries.cancelled_occurrences, 1);
assert.equal(stoppedSeries.cancelled_agreements, 1);
assert.equal(await rpc(clients[0], 'get_agreement_contacts', { p_agreement_id: seriesAgreement.agreement_id }), null);
assert.equal(runSql(container, `select status from app.passenger_request where public_id = ${sqlLiteral(seriesRequest.request_id)}::uuid;`), 'restore');

const lifecycle = JSON.parse(runSql(container, `select ops.expire_transport_items(now() + interval '60 days');`));
assert.ok(lifecycle.responses >= 1);
assert.ok(lifecycle.completed_agreements >= 1);
assert.ok(lifecycle.no_outcome_agreements >= 1);
assert.ok(lifecycle.archived_agreements >= 4);
assert.equal(runSql(container, `select status from app.ride_response where public_id = ${sqlLiteral(pendingExpiryResponse.response_id)}::uuid;`), 'expired');
assert.equal(runSql(container, `select count(*) from app.ride_agreement where status <> 'archived';`), '0');
assert.equal(runSql(container, `select count(*) from private.agreement_contact_snapshot where deleted_at is null;`), '0');
assert.equal(runSql(container, `select count(*) from private.agreement_contact_snapshot where email_normalized like '%@example.test' or phone_e164 like '+390%';`), '0');
assert.equal(await rpc(winnerClient, 'get_agreement_contacts', { p_agreement_id: winningAgreement.agreement_id }), null);
assert.equal(await rpc(winnerClient, 'get_agreement_exact_place', { p_agreement_id: winningAgreement.agreement_id }), null);

const directAnonymousContacts = await fetch(`${url}/rest/v1/rpc/get_agreement_contacts`, {
  method: 'POST',
  headers: { apikey: publicKey, 'content-type': 'application/json' },
  body: JSON.stringify({ p_agreement_id: firstAgreement.agreement_id }),
});
assert.ok([401, 403, 404].includes(directAnonymousContacts.status));
assert.equal(runSql(container, `
  select count(*) from information_schema.role_table_grants
  where table_schema in ('app', 'private')
    and table_name in ('ride_response', 'ride_condition_snapshot', 'ride_agreement', 'agreement_contact_snapshot', 'agreement_event')
    and grantee in ('anon', 'authenticated', 'service_role');
`), '0');
assert.equal(runSql(container, `
  select count(*) from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname in ('app', 'private')
    and class.relname in ('ride_response', 'ride_condition_snapshot', 'ride_agreement', 'agreement_contact_snapshot', 'agreement_event')
    and class.relrowsecurity and class.relforcerowsecurity;
`), '5');
assert.equal(runSql(container, `
  select count(*) from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('api', 'app', 'ops') and procedure.prosecdef
    and coalesce(array_to_string(procedure.proconfig, ','), '') not like '%search_path=""%';
`), '0');

console.log('Ride response, agreement, capacity, cancellation, and disclosure verification passed.');
