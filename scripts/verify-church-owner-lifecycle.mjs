import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

// This verifier has no remote URL/credential option: only the exact disposable local container.
const inventory = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
const container = inventory.stdout?.split(/\r?\n/).find((name) => name === 'supabase_db_orthodox-routes');
if (inventory.status !== 0 || !container) throw new Error('The local-only owner-operation test database is unavailable.');
const args = (actor) => ['exec', '-i', container, 'psql', '-U', actor, '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-qAt', '-f', '-'];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const role = 'orthodox_routes_church_operator';
const operatorLogin = 'orthodox_routes_church_operator_test';
const otherRole = 'orthodox_routes_church_operator_test_other';
const ids = Object.fromEntries(['church', 'churchPublic', 'passenger', 'driver', 'meeting', 'origin',
  'request', 'offer', 'snapshot', 'response', 'agreement', 'archiveRequest'].map((name) => [name, randomUUID()]));
const slug = `owner-test-${ids.church}`;
const sqlState = (stderr) => /ERROR:\s+([A-Z0-9]{5})/.exec(stderr)?.[1] ?? 'unknown';

function sql(statement, expectedError = null) {
  const actor = typeof statement === 'string' ? 'postgres' : statement.actor;
  const input = typeof statement === 'string' ? statement : statement.input;
  const result = spawnSync('docker', args(actor), { input, encoding: 'utf8', timeout: 20_000 });
  if (expectedError) {
    assert.notEqual(result.status, 0, 'An owner-boundary refusal unexpectedly succeeded.');
    assert.equal(sqlState(result.stderr), expectedError);
    return null;
  }
  if (result.status !== 0) throw new Error(`Synthetic owner verification failed (${sqlState(result.stderr)}).`);
  return result.stdout.trim();
}
function asyncSql(statement) {
  return new Promise((resolve, reject) => {
    const actor = typeof statement === 'string' ? 'postgres' : statement.actor;
    const input = typeof statement === 'string' ? statement : statement.input;
    const child = spawn('docker', args(actor), { windowsHide: true, timeout: 20_000 });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), state: sqlState(stderr) }));
    child.stdin.end(input);
  });
}
const asOperator = (input, actor = operatorLogin) => ({ input, actor });
const prepareSql = (action = 'archive_church', reference = 'SYNTHETIC-OWNER-CASE') =>
  `select ops.prepare_church_lifecycle(${literal(ids.churchPublic)}::uuid, ${literal(action)},
    ${literal(reference)}, ${literal(action === 'archive_church' ? 'reviewed_archival' : 'reviewed_restoration')});`;
const prepare = (action) => JSON.parse(sql(asOperator(prepareSql(action))));
const executeSql = (operation, token = operation.token) =>
  `select ops.execute_church_lifecycle(${literal(operation.operation_id)}::uuid, ${literal(token)});`;
const execute = (operation) => JSON.parse(sql(asOperator(executeSql(operation))));
const churchStatus = () => sql(`select status from app.church where id = ${literal(ids.church)}::uuid;`);
const publicRead = () => sql(`set role anon; select api.transport_church_by_slug(${literal(slug)}) is null;`);

try {
  sql(`begin;
    insert into auth.users(id, email) values
      (${literal(ids.passenger)}::uuid, 'owner-passenger-${ids.church}@example.test'),
      (${literal(ids.driver)}::uuid, 'owner-driver-${ids.church}@example.test');
    insert into app.account(id, display_name, preferred_language) values
      (${literal(ids.passenger)}::uuid, 'Synthetic Owner Passenger', 'en'),
      (${literal(ids.driver)}::uuid, 'Synthetic Owner Driver', 'en');
    insert into private.account_contact(account_id, email_normalized) values
      (${literal(ids.passenger)}::uuid, 'owner-passenger-${ids.church}@example.test'),
      (${literal(ids.driver)}::uuid, 'owner-driver-${ids.church}@example.test');
    insert into app.church(id, public_id, slug, official_name, address_display, locality, country_code,
      timezone, status, created_by, location) values
      (${literal(ids.church)}::uuid, ${literal(ids.churchPublic)}::uuid, ${literal(slug)},
       'Synthetic Owner Church', 'Synthetic Public Church Address', 'Synthetic City', 'IT', 'Europe/Rome',
       'published', ${literal(ids.passenger)}::uuid,
       extensions.st_setsrid(extensions.st_makepoint(7.6, 45.0), 4326)::extensions.geography);
    insert into app.church_admin_membership(church_id, account_id, access_source)
      values (${literal(ids.church)}::uuid, ${literal(ids.passenger)}::uuid, 'creator');
    insert into app.church_archive_request(id, church_id, requested_by)
      values (${literal(ids.archiveRequest)}::uuid, ${literal(ids.church)}::uuid, ${literal(ids.passenger)}::uuid);
    insert into private.user_place(id, owner_account_id, exact_address, public_area_name) values
      (${literal(ids.meeting)}::uuid, ${literal(ids.passenger)}::uuid, 'Synthetic Private Meeting', 'Synthetic Area'),
      (${literal(ids.origin)}::uuid, ${literal(ids.driver)}::uuid, 'Synthetic Private Origin', 'Synthetic Area');
    create role ${operatorLogin} login;
    create role ${otherRole} login;
    grant ${role} to ${operatorLogin}, ${otherRole};
    commit;`);

  assert.equal(sql(asOperator('select session_user::text;')), operatorLogin);
  assert.equal(sql(asOperator('select session_user::text;', otherRole)), otherRole);
  for (const denied of ['anon', 'authenticated', 'service_role']) {
    sql(`set role ${denied}; ${prepareSql()}`, '42501');
    sql(`set role ${denied}; select ops.execute_church_lifecycle(${literal(randomUUID())}::uuid, repeat('a',64));`, '42501');
  }
  for (const table of ['ops.owner_operation', 'ops.audit_event', 'app.church', 'private.account_contact']) {
    sql(asOperator(`select * from ${table};`), '42501');
  }
  sql(asOperator(`select ops.church_lifecycle_state(${literal(ids.church)}::uuid);`), '42501');
  sql(asOperator(prepareSql('drop_church')), '22023');
  sql(asOperator(prepareSql('archive_church', 'private@example.test')), '22023');
  assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'ops.owner_operation'::regclass;`), 't');
  const first = prepare();
  assert.equal(first.preview.administrator_count, 1);
  assert.equal(first.preview.pending_archival_requests, 1);
  assert.deepEqual(Object.keys(first.preview).sort(), ['church_id', 'slug', 'official_name', 'status',
    'content_version', 'schedule_updated_at', 'passenger_requests', 'driver_offers', 'pending_responses',
    'agreements', 'administrator_count', 'pending_archival_requests', 'pending_invitations'].sort());
  for (const forbidden of [ids.passenger, ids.driver, ids.meeting, 'example.test', 'Synthetic Private']) {
    assert.equal(JSON.stringify(first.preview).includes(forbidden), false);
  }
  assert.equal(sql(`select token_hash <> ${literal(first.token)} and token_hash ~ '^[0-9a-f]{64}$'
    from ops.owner_operation where id = ${literal(first.operation_id)}::uuid;`), 't');
  sql(asOperator(executeSql(first, 'f'.repeat(64))), '42501');
  sql(asOperator(executeSql(first), otherRole), '42501');
  sql(`update app.church set content_version = content_version + 1 where id = ${literal(ids.church)}::uuid;`);
  sql(asOperator(executeSql(first)), 'PT409');
  const expired = prepare();
  sql(`update ops.owner_operation set prepared_at = now() - interval '16 minutes',
    expires_at = now() - interval '1 minute' where id = ${literal(expired.operation_id)}::uuid;`);
  sql(asOperator(executeSql(expired)), '42501');

  const requestInsert = (requestId) => `insert into app.passenger_request(id, author_account_id, church_id,
    desired_arrival_at, timezone, total_passengers, child_seat_required, return_required,
    remaining_passengers, terms_version) values (${literal(requestId)}::uuid, ${literal(ids.passenger)}::uuid,
    ${literal(ids.church)}::uuid, now() + interval '3 days', 'UTC', 1, false, false, 1, 'synthetic-owner-test');`;
  const beforeNewRide = prepare();
  sql(requestInsert(ids.request));
  sql(asOperator(executeSql(beforeNewRide)), 'PT409');
  const blocked = prepare();
  assert.equal(blocked.preview.passenger_requests, 1);
  sql(asOperator(executeSql(blocked)), 'PT409');
  sql(`insert into app.driver_offer_occurrence(id, publication_key, author_account_id, church_id,
    departure_at, arrival_at, timezone, origin_place_id, total_seats, max_detour_km,
    children_allowed, driver_child_seat_available, return_available) values
    (${literal(ids.offer)}::uuid, ${literal(randomUUID())}::uuid, ${literal(ids.driver)}::uuid,
     ${literal(ids.church)}::uuid, now() + interval '3 days' - interval '1 hour', now() + interval '3 days',
     'UTC', ${literal(ids.origin)}::uuid, 2, 5, false, false, false);
    insert into app.passenger_request_place(request_id, user_place_id, position)
      values (${literal(ids.request)}::uuid, ${literal(ids.meeting)}::uuid, 1);
    insert into app.ride_condition_snapshot(id, passenger_request_id, driver_occurrence_id, church_id,
      selected_request_place_id, passenger_count, scheduled_arrival_at, timezone, children_count,
      child_seat_required, children_allowed, driver_child_seat_available, passenger_return_required,
      driver_return_available, max_detour_km, request_content_version, occurrence_conditions_version)
    select ${literal(ids.snapshot)}::uuid, ${literal(ids.request)}::uuid, id, church_id,
      ${literal(ids.meeting)}::uuid, 1, arrival_at, timezone, 0, false, false, false, false, false, 5, 1, 1
      from app.driver_offer_occurrence where id = ${literal(ids.offer)}::uuid;
    insert into app.ride_response(id, direction, passenger_account_id, driver_account_id, passenger_request_id,
      driver_occurrence_id, selected_request_place_id, offered_passenger_count, conditions_snapshot_id, status, expires_at)
    values (${literal(ids.response)}::uuid, 'driver_to_passenger', ${literal(ids.passenger)}::uuid,
      ${literal(ids.driver)}::uuid, ${literal(ids.request)}::uuid, ${literal(ids.offer)}::uuid,
      ${literal(ids.meeting)}::uuid, 1, ${literal(ids.snapshot)}::uuid, 'await_passenger', now() + interval '2 days');
    update app.passenger_request set status = 'cancelled', closed_at = clock_timestamp()
      where id = ${literal(ids.request)}::uuid;`);
  const responseBlocked = prepare();
  assert.equal(responseBlocked.preview.driver_offers, 1);
  assert.equal(responseBlocked.preview.pending_responses, 1);
  sql(asOperator(executeSql(responseBlocked)), 'PT409');
  sql(`update app.ride_response set status = 'accepted' where id = ${literal(ids.response)}::uuid;
    insert into app.ride_agreement(id, response_id, driver_occurrence_id, passenger_request_id,
      driver_account_id, passenger_account_id, confirmed_passenger_count, active_snapshot_id,
      selected_exact_place_id, contact_visible_until, exact_data_delete_due_at)
    select ${literal(ids.agreement)}::uuid, id, driver_occurrence_id, passenger_request_id,
      driver_account_id, passenger_account_id, 1, conditions_snapshot_id, selected_request_place_id,
      now() + interval '4 days', now() + interval '5 days' from app.ride_response
      where id = ${literal(ids.response)}::uuid;
    update app.driver_offer_occurrence set status = 'cancelled', closed_at = clock_timestamp()
      where id = ${literal(ids.offer)}::uuid;`);
  const agreementBlocked = prepare();
  assert.equal(agreementBlocked.preview.passenger_requests, 0);
  assert.equal(agreementBlocked.preview.driver_offers, 0);
  assert.equal(agreementBlocked.preview.agreements, 1);
  sql(asOperator(executeSql(agreementBlocked)), 'PT409');
  sql(`update app.ride_agreement set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancelled_by_account_id = passenger_account_id where id = ${literal(ids.agreement)}::uuid;`);
  const archival = prepare();
  const archived = execute(archival);
  assert.equal(archived.status, 'archived');
  assert.equal(publicRead(), 't');
  assert.deepEqual(execute(archival), archived);
  sql(`select * from app.assert_transport_reference(${literal(ids.churchPublic)}::uuid, null, now() + interval '3 days');`, 'P0002');
  assert.equal(sql(`select status from app.church_archive_request where id = ${literal(ids.archiveRequest)}::uuid;`), 'resolved');
  assert.equal(sql(`select count(*) from app.ride_agreement where id = ${literal(ids.agreement)}::uuid;`), '1');
  sql(`update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp()
    where church_id = ${literal(ids.church)}::uuid;`);
  const missingAdministrator = prepare('restore_church');
  assert.equal(missingAdministrator.preview.administrator_count, 0);
  sql(asOperator(executeSql(missingAdministrator)), 'PT409');
  sql(`update app.church_admin_membership set status = 'active', ended_at = null
    where church_id = ${literal(ids.church)}::uuid;`);
  sql(asOperator(executeSql(missingAdministrator)), 'PT409');
  const restoration = prepare('restore_church');
  assert.equal(execute(restoration).status, 'published');
  assert.equal(publicRead(), 'f');
  assert.deepEqual(execute(archival), archived);
  assert.equal(churchStatus(), 'published');
  assert.equal(sql(`select count(*) from ops.audit_event where event_key =
    'owner-operation:' || ${literal(archival.operation_id)};`), '1');
  const audit = JSON.parse(sql(`select to_jsonb(event) from ops.audit_event as event
    where event_key = 'owner-operation:' || ${literal(archival.operation_id)};`));
  assert.equal(audit.actor_kind, 'operator');
  assert.equal(audit.actor_account_id, null);
  assert.equal(audit.support_reference, 'SYNTHETIC-OWNER-CASE');
  assert.deepEqual(audit.changed_fields, ['status', 'content_version']);
  assert.equal(JSON.stringify(audit).includes(archival.token), false);
  sql(`update ops.audit_event set reason_code = 'reviewed_restoration' where id = ${literal(audit.id)}::uuid;`, '55000');

  const raceOperation = prepare();
  const raceRequest = randomUUID();
  const race = await Promise.all([
    asyncSql(asOperator(executeSql(raceOperation))),
    asyncSql(`begin; select * from app.assert_transport_reference(${literal(ids.churchPublic)}::uuid,
      null, now() + interval '3 days'); ${requestInsert(raceRequest)} commit;`),
  ]);
  assert.equal(race.filter((result) => result.code === 0).length, 1);
  if (churchStatus() === 'archived') {
    assert.equal(race[1].state, 'P0002');
    assert.equal(sql(`select count(*) from app.passenger_request where id = ${literal(raceRequest)}::uuid;`), '0');
  } else {
    assert.equal(race[0].state, 'PT409');
    assert.equal(sql(`select count(*) from app.passenger_request where id = ${literal(raceRequest)}::uuid;`), '1');
  }
  process.stdout.write('Protected church lifecycle verification passed: role isolation, safe preview, token/actor/expiry, freshness, future-work guards, atomic archive/restore/audit, replay, and publication concurrency.\n');
} finally {
  // Exact synthetic fixture scope only; no remote target, truncation, or unrelated records.
  sql(`begin;
    delete from ops.owner_operation where church_id = ${literal(ids.church)}::uuid;
    delete from ops.audit_event where target_id = ${literal(ids.churchPublic)}::uuid;
    delete from app.ride_agreement where id = ${literal(ids.agreement)}::uuid;
    delete from app.ride_response where id = ${literal(ids.response)}::uuid;
    delete from app.ride_condition_snapshot where id = ${literal(ids.snapshot)}::uuid;
    delete from app.driver_offer_occurrence where church_id = ${literal(ids.church)}::uuid;
    delete from app.passenger_request where church_id = ${literal(ids.church)}::uuid;
    delete from private.user_place where id in (${literal(ids.meeting)}::uuid, ${literal(ids.origin)}::uuid);
    delete from app.church_archive_request where church_id = ${literal(ids.church)}::uuid;
    delete from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid;
    delete from app.content_translation where content_source_id in (select id from app.content_source
      where object_type = 'church' and object_id = ${literal(ids.church)}::uuid);
    delete from app.content_source where object_type = 'church' and object_id = ${literal(ids.church)}::uuid;
    delete from app.church where id = ${literal(ids.church)}::uuid;
    delete from app.account where id in (${literal(ids.passenger)}::uuid, ${literal(ids.driver)}::uuid);
    delete from auth.users where id in (${literal(ids.passenger)}::uuid, ${literal(ids.driver)}::uuid);
    drop role if exists ${otherRole};
    drop role if exists ${operatorLogin};
    commit;`);
}
