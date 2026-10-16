import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createOwnerQuery } from './church-owner-command.mjs';

// This verifier has no remote URL/credential option: only the exact disposable local container.
const inventory = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
const container = inventory.stdout?.split(/\r?\n/).find((name) => name === 'supabase_db_orthodox-routes');
if (inventory.status !== 0 || !container) throw new Error('The local-only owner-operation test database is unavailable.');
const testPassword = randomBytes(32).toString('hex');
const args = (actor) => ['exec', '-i', ...(actor === 'postgres' ? [] : ['-e', `PGPASSWORD=${testPassword}`]),
  container, 'psql', ...(actor === 'postgres' ? [] : ['-h', '127.0.0.1']), '-U', actor, '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-qAt', '-f', '-'];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const role = 'orthodox_routes_church_operator';
const operatorLogin = 'orthodox_routes_church_operator_test';
const otherRole = 'orthodox_routes_church_operator_test_other';
const ids = Object.fromEntries(['church', 'churchPublic', 'passenger', 'driver', 'meeting', 'origin',
  'request', 'offer', 'snapshot', 'response', 'agreement', 'archiveRequest', 'legal', 'serviceSeries'].map((name) => [name, randomUUID()]));
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
const startAttempt = (operation) => JSON.parse(sql(asOperator(
  `select ops.begin_church_lifecycle_attempt($1::uuid, $2::text)\n\\bind ${literal(operation.operation_id)} ${literal(operation.token)} \\g\n`,
))).attempt_id;
const executeSql = (operation, token = operation.token, attemptId = startAttempt(operation)) =>
  `select ops.execute_church_lifecycle($1::uuid, $2::text, $3::uuid)\n\\bind ${literal(operation.operation_id)} ${literal(token)} ${literal(attemptId)} \\g\n`;
const execute = (operation) => JSON.parse(sql(asOperator(executeSql(operation))));
const expectRefusal = (operation, token = operation.token) => {
  assert.deepEqual(JSON.parse(sql(asOperator(executeSql(operation, token)))),
    { operation_id: operation.operation_id, execution_result: 'refused' });
};
const outcomeSql = (operation) =>
  `select ops.church_lifecycle_result($1::uuid)\n\\bind ${literal(operation.operation_id)} \\g\n`;
const outcome = (operation) => JSON.parse(sql(asOperator(outcomeSql(operation))));
const churchStatus = () => sql(`select status from app.church where id = ${literal(ids.church)}::uuid;`);
const publicRead = () => sql(`set role anon; select api.transport_church_by_slug(${literal(slug)}) is null;`);

async function waitForDatabaseCondition(condition) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (sql(`select ${condition};`) === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The synthetic concurrency barrier was not reached.');
}

async function verifyRegularPublicationRace() {
  const gateKey = 197042611;
  const gate = spawn('docker', args('postgres'), { windowsHide: true, timeout: 20_000 });
  gate.stderr.resume();
  const gateClosed = new Promise((resolve) => gate.on('close', resolve));
  const gateReady = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('The synthetic publication gate did not open.')), 5_000);
    let output = '';
    gate.stdout.on('data', (data) => {
      output += data;
      if (output.includes('SYNTHETIC_GATE_READY')) { clearTimeout(deadline); resolve(); }
    });
    gate.on('error', (error) => { clearTimeout(deadline); reject(error); });
  });
  let publisher; let archival;
  try {
    gate.stdin.write(`begin; select pg_advisory_xact_lock(${gateKey});\n\\echo SYNTHETIC_GATE_READY\n`);
    await gateReady;
    sql(`create function app.synthetic_owner_series_gate() returns trigger language plpgsql as $$
      begin
        if new.church_id = ${literal(ids.church)}::uuid then perform pg_advisory_xact_lock(${gateKey}); end if;
        return new;
      end; $$;
      create trigger synthetic_owner_series_gate before insert on app.driver_offer_series
        for each row execute function app.synthetic_owner_series_gate();`);
    const operation = prepare();
    const origin = { address: 'Synthetic Owner Series Origin', locality: 'Synthetic City',
      country_code: 'IT', lat: 45.0, lng: 7.61, source_kind: 'user_confirmed_geocode' };
    publisher = asyncSql(`set application_name = 'synthetic-owner-series-publish';
      select set_config('request.jwt.claim.sub', ${literal(ids.driver)}, false);
      set role authenticated;
      select api.publish_driver_series(${literal(ids.churchPublic)}::uuid,
        array[0,1,2,3,4,5,6]::smallint[], '09:00'::time, '10:00'::time, 'UTC',
        current_date + 3, current_date + 3, 2, 5, false, false, false, null,
        ${literal(JSON.stringify(origin))}::jsonb, ${literal(randomUUID())}::uuid);`);
    await waitForDatabaseCondition(`exists (select 1 from pg_locks as lock
      join pg_stat_activity as activity on activity.pid = lock.pid
      where activity.application_name = 'synthetic-owner-series-publish' and not lock.granted)`);
    archival = asyncSql(asOperator(`set application_name = 'synthetic-owner-series-archive'; ${executeSql(operation)}`));
    // Before either insert's FK exists, the archive must already wait for the publisher's church lock.
    await waitForDatabaseCondition(`exists (select 1 from pg_locks as lock
      join pg_stat_activity as activity on activity.pid = lock.pid
      where activity.application_name = 'synthetic-owner-series-archive' and not lock.granted)`);
    gate.stdin.end('commit;\n\\quit\n');
    const results = await Promise.all([publisher, archival]);
    assert.equal(results[0].code, 0, 'The real regular-publication RPC must finish.');
    assert.equal(results[1].code, 0);
    assert.equal(JSON.parse(results[1].stdout).execution_result, 'refused');
    assert.equal(churchStatus(), 'published');
    assert.equal(sql(`select count(*) from app.driver_offer_occurrence where church_id = ${literal(ids.church)}::uuid
      and status = 'active';`), '1');
  } finally {
    if (!gate.stdin.destroyed && !gate.stdin.writableEnded) gate.stdin.end('rollback;\n\\quit\n');
    await gateClosed;
    await Promise.all([publisher, archival].filter(Boolean));
    sql(`drop trigger if exists synthetic_owner_series_gate on app.driver_offer_series;
      drop function if exists app.synthetic_owner_series_gate();`);
  }
}

try {
  const materializerSnapshot = () => sql(`select jsonb_build_object(
    'definition', encode(extensions.digest(convert_to(pg_get_functiondef(routine.oid), 'UTF8'), 'sha256'), 'hex'),
    'acl', routine.proacl::text) from pg_proc as routine
    where routine.oid = 'app.materialize_service_series(uuid,timestamptz)'::regprocedure;`);
  const existingMaterializer = materializerSnapshot();
  sql(readFileSync(new URL('../supabase/migrations/20261016230000_archive_safe_schedule_materialization.sql', import.meta.url), 'utf8'));
  assert.equal(materializerSnapshot(), existingMaterializer, 'Migration replay must preserve the exact definition and grants.');
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
    insert into app.service_series(id, church_id, source_name, weekdays, local_start_time, timezone,
      starts_on, ends_on, created_by) values (${literal(ids.serviceSeries)}::uuid, ${literal(ids.church)}::uuid,
      'Synthetic Owner Recurring', array[0,1,2,3,4,5,6]::smallint[], '10:00'::time, 'UTC',
      current_date + 3, current_date + 9, ${literal(ids.passenger)}::uuid);
    insert into private.user_place(id, owner_account_id, exact_address, public_area_name) values
      (${literal(ids.meeting)}::uuid, ${literal(ids.passenger)}::uuid, 'Synthetic Private Meeting', 'Synthetic Area'),
      (${literal(ids.origin)}::uuid, ${literal(ids.driver)}::uuid, 'Synthetic Private Origin', 'Synthetic Area');
    create role ${operatorLogin} login password ${literal(testPassword)};
    create role ${otherRole} login password ${literal(testPassword)};
    grant ${role} to ${operatorLogin}, ${otherRole};
    commit;`);

  assert.equal(sql(asOperator('select session_user::text;')), operatorLogin);
  assert.equal(sql(asOperator('select session_user::text;', otherRole)), otherRole);
  // Exercise the real runner's psql conditional/exit syntax without any remote connection.
  // The broad fixture identity must be refused before the parameter-bearing call is sent.
  const refusedRunnerQuery = createOwnerQuery({ service: 'unused_local_fixture', childEnv: {} },
    (_command, _args, settings) => spawnSync('docker', args('postgres'), { ...settings, env: process.env }));
  assert.throws(() => refusedRunnerQuery('select ops.church_lifecycle_result($1::uuid)', [randomUUID()]),
    /Protected church operation failed/);
  for (const denied of ['anon', 'authenticated', 'service_role']) {
    sql(`set role ${denied}; ${prepareSql()}`, '42501');
    sql(`set role ${denied}; select ops.execute_church_lifecycle(${literal(randomUUID())}::uuid, repeat('a',64), ${literal(randomUUID())}::uuid);`, '42501');
    sql(`set role ${denied}; select ops.begin_church_lifecycle_attempt(${literal(randomUUID())}::uuid, repeat('a',64));`, '42501');
    sql(`set role ${denied}; select ops.church_lifecycle_result(${literal(randomUUID())}::uuid);`, '42501');
  }
  for (const table of ['ops.owner_operation', 'ops.audit_event', 'app.church', 'private.account_contact']) {
    sql(asOperator(`select * from ${table};`), '42501');
  }
  sql(asOperator(`select ops.church_lifecycle_state(${literal(ids.church)}::uuid);`), '42501');
  sql(asOperator(`select ops.apply_church_lifecycle(${literal(randomUUID())}::uuid, repeat('a',64));`), '42501');
  sql(asOperator(prepareSql('drop_church')), '22023');
  sql(asOperator(prepareSql('archive_church', 'private@example.test')), '22023');
  assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'ops.owner_operation'::regclass;`), 't');
  const first = prepare();
  assert.deepEqual(outcome(first), { operation_id: first.operation_id, operation_type: 'archive_church',
    church_id: ids.churchPublic, state: 'prepared', latest_attempt: null });
  sql(asOperator(`select ops.begin_church_lifecycle_attempt(${literal(first.operation_id)}::uuid,
    ${literal(first.token)});`, otherRole), '42501');
  sql(asOperator(outcomeSql(first), otherRole), '42501');
  sql(asOperator(outcomeSql({ operation_id: randomUUID() })), '42501');
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
  expectRefusal(first, 'f'.repeat(64));
  sql(asOperator(executeSql(first), otherRole), '42501');
  sql(`update app.church set content_version = content_version + 1 where id = ${literal(ids.church)}::uuid;`);
  expectRefusal(first);
  const expired = prepare();
  sql(`update ops.owner_operation set prepared_at = now() - interval '16 minutes',
    expires_at = now() - interval '1 minute' where id = ${literal(expired.operation_id)}::uuid;`);
  expectRefusal(expired);
  assert.equal(outcome(expired).state, 'expired');

  // A start must already be committed, not be rolled back with the execution transaction.
  sql(asOperator(`do $$ declare attempt jsonb; begin
    attempt := ops.begin_church_lifecycle_attempt(${literal(first.operation_id)}::uuid, ${literal(first.token)});
    perform ops.execute_church_lifecycle(${literal(first.operation_id)}::uuid, ${literal(first.token)},
      (attempt->>'attempt_id')::uuid);
    end; $$;`), '42501');
  sql(asOperator(`select ops.begin_church_lifecycle_attempt(${literal(first.operation_id)}::uuid, repeat('f',64));`), '42501');
  sql(asOperator(`select ops.execute_church_lifecycle(${literal(first.operation_id)}::uuid, ${literal(first.token)},
    ${literal(randomUUID())}::uuid);`), '42501');

  const failing = prepare();
  const failedAttempt = startAttempt(failing);
  const privateError = `Synthetic private failure ${failing.token}`;
  try {
    sql(`create function app.synthetic_owner_failure() returns trigger language plpgsql as $$ begin
      if new.id = ${literal(failing.operation_id)}::uuid then raise exception using message = ${literal(privateError)}; end if;
      return new; end; $$;
      create trigger synthetic_owner_failure before update on ops.owner_operation
        for each row execute function app.synthetic_owner_failure();`);
    const result = sql(asOperator(executeSql(failing, failing.token, failedAttempt)));
    assert.deepEqual(JSON.parse(result), { operation_id: failing.operation_id, execution_result: 'error' });
    assert.equal(result.includes(failing.token), false);
    assert.equal(churchStatus(), 'published');
    assert.equal(outcome(failing).state, 'prepared');
    assert.equal(outcome(failing).latest_attempt.state, 'error');
    assert.equal(sql(`select status from app.church_archive_request where id = ${literal(ids.archiveRequest)}::uuid;`), 'pending');
    assert.equal(sql(`select count(*) from ops.audit_event where target_id = ${literal(ids.churchPublic)}::uuid;`), '0');
  } finally {
    sql('drop trigger if exists synthetic_owner_failure on ops.owner_operation; drop function if exists app.synthetic_owner_failure();');
  }
  assert.equal(JSON.parse(sql(asOperator(executeSql(failing, failing.token, failedAttempt)))).execution_result, 'error');
  assert.equal(churchStatus(), 'published', 'Replaying a finished failure must not execute a now-valid transition.');
  assert.equal(sql(`select count(*) from ops.audit_event
    where event_key = ${literal(`owner-attempt:${failedAttempt}:finished`)};`), '1');

  const interrupted = prepare();
  const interruptedAttempt = startAttempt(interrupted);
  try {
    sql(`create function app.synthetic_owner_failure() returns trigger language plpgsql as $$ begin
      if new.id = ${literal(interrupted.operation_id)}::uuid then perform pg_sleep(1); end if;
      return new; end; $$;
      create trigger synthetic_owner_failure before update on ops.owner_operation
        for each row execute function app.synthetic_owner_failure();`);
    sql(asOperator(`set statement_timeout = '100ms'; ${executeSql(interrupted, interrupted.token, interruptedAttempt)}`), '57014');
    assert.equal(churchStatus(), 'published');
    assert.equal(outcome(interrupted).state, 'prepared');
    assert.deepEqual(outcome(interrupted).latest_attempt, { attempt_id: interruptedAttempt, state: 'unfinished' });
    assert.equal(sql(`select count(*) from ops.audit_event
      where event_key = ${literal(`owner-attempt:${interruptedAttempt}:started`)};`), '1');
  } finally {
    sql('drop trigger if exists synthetic_owner_failure on ops.owner_operation; drop function if exists app.synthetic_owner_failure();');
  }

  const requestInsert = (requestId) => `insert into app.passenger_request(id, author_account_id, church_id,
    desired_arrival_at, timezone, total_passengers, child_seat_required, return_required,
    remaining_passengers, terms_version) values (${literal(requestId)}::uuid, ${literal(ids.passenger)}::uuid,
    ${literal(ids.church)}::uuid, now() + interval '3 days', 'UTC', 1, false, false, 1, 'synthetic-owner-test');`;
  const beforeNewRide = prepare();
  sql(requestInsert(ids.request));
  expectRefusal(beforeNewRide);
  const blocked = prepare();
  assert.equal(blocked.preview.passenger_requests, 1);
  expectRefusal(blocked);
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
  expectRefusal(responseBlocked);
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
  expectRefusal(agreementBlocked);
  sql(`update app.ride_agreement set status = 'cancelled', cancelled_at = clock_timestamp(),
    cancelled_by_account_id = passenger_account_id where id = ${literal(ids.agreement)}::uuid;`);
  const archival = prepare();
  // Capture exactly what the scheduler discovers before archival, without materializing yet.
  const previouslySelectedSeries = sql(`select series.id from app.service_series as series
    join app.church as church on church.id = series.church_id
    where series.id = ${literal(ids.serviceSeries)}::uuid and church.status in ('published', 'hidden');`);
  assert.equal(previouslySelectedSeries, ids.serviceSeries);
  const archivalAttempt = startAttempt(archival);
  const concurrentArchive = await Promise.all([
    asyncSql(asOperator(executeSql(archival, archival.token, archivalAttempt))),
    asyncSql(asOperator(executeSql(archival, archival.token, archivalAttempt))),
  ]);
  assert.equal(concurrentArchive[0].code, 0);
  assert.equal(concurrentArchive[1].code, 0);
  const archived = JSON.parse(concurrentArchive[0].stdout);
  assert.deepEqual(JSON.parse(concurrentArchive[1].stdout), archived);
  assert.equal(outcome(archival).state, 'succeeded');
  assert.equal(outcome(archival).latest_attempt.state, 'success');
  assert.equal(sql(`select count(*) from ops.audit_event
    where event_key = ${literal(`owner-attempt:${archivalAttempt}:finished`)};`), '1');
  assert.equal(archived.status, 'archived');
  assert.equal(publicRead(), 't');
  assert.equal(sql(`select app.materialize_service_series(${literal(previouslySelectedSeries)}::uuid, now());`), '0');
  assert.equal(sql(`select materialized_through is null from app.service_series where id = ${literal(ids.serviceSeries)}::uuid;`), 't');
  assert.equal(sql(`select count(*) from app.service_occurrence where source_series_id = ${literal(ids.serviceSeries)}::uuid;`), '0');
  assert.deepEqual(execute(archival), archived);
  sql(`select * from app.assert_transport_reference(${literal(ids.churchPublic)}::uuid, null, now() + interval '3 days');`, 'P0002');
  assert.equal(sql(`select status from app.church_archive_request where id = ${literal(ids.archiveRequest)}::uuid;`), 'resolved');
  assert.equal(sql(`select count(*) from app.ride_agreement where id = ${literal(ids.agreement)}::uuid;`), '1');
  sql(`update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp()
    where church_id = ${literal(ids.church)}::uuid;`);
  const missingAdministrator = prepare('restore_church');
  assert.equal(missingAdministrator.preview.administrator_count, 0);
  expectRefusal(missingAdministrator);
  sql(`update app.church_admin_membership set status = 'active', ended_at = null
    where church_id = ${literal(ids.church)}::uuid;`);
  expectRefusal(missingAdministrator);
  const restoration = prepare('restore_church');
  assert.equal(execute(restoration).status, 'published');
  assert.equal(sql(`select app.materialize_service_series(${literal(previouslySelectedSeries)}::uuid, now());`), '7');
  assert.equal(sql(`select app.materialize_service_series(${literal(previouslySelectedSeries)}::uuid, now());`), '0');
  // Hidden-page materialization was already allowed and must remain available.
  sql(`update app.church set status = 'hidden' where id = ${literal(ids.church)}::uuid;
    update app.service_series set ends_on = ends_on + 3 where id = ${literal(ids.serviceSeries)}::uuid;`);
  assert.equal(sql(`select app.materialize_service_series(${literal(previouslySelectedSeries)}::uuid, now());`), '3');
  sql(`update app.church set status = 'published' where id = ${literal(ids.church)}::uuid;`);
  assert.equal(publicRead(), 'f');
  assert.deepEqual(execute(archival), archived);
  assert.equal(churchStatus(), 'published');
  assert.equal(outcome(archival).state, 'succeeded');
  assert.equal(sql(`select count(*) from ops.audit_event where event_key =
    'owner-operation:' || ${literal(archival.operation_id)};`), '1');
  sql(`insert into ops.audit_event(event_key, actor_kind, actor_account_id, action_type, target_type,
    target_id, result, changed_fields) values ('synthetic-refused-domain', 'account', ${literal(ids.passenger)}::uuid,
    'church.content_updated', 'church', ${literal(ids.churchPublic)}::uuid, 'refused', array['content_version']);`, '23514');
  for (const protectedValue of [first.token, failing.token, interrupted.token, archival.token, privateError]) {
    assert.equal(sql(`select coalesce(bool_and(position(${literal(protectedValue)} in to_jsonb(event)::text) = 0), true)
      from ops.audit_event as event where target_type = 'owner_operation' and target_id in (
        select id from ops.owner_operation where church_id = ${literal(ids.church)}::uuid);`), 't');
  }
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
  assert.equal(race.filter((result, index) => result.code === 0
    && (index === 1 || JSON.parse(result.stdout).status === 'archived')).length, 1);
  if (churchStatus() === 'archived') {
    assert.equal(race[1].state, 'P0002');
    assert.equal(sql(`select count(*) from app.passenger_request where id = ${literal(raceRequest)}::uuid;`), '0');
  } else {
    assert.equal(race[0].code, 0);
    assert.equal(JSON.parse(race[0].stdout).execution_result, 'refused');
    assert.equal(sql(`select count(*) from app.passenger_request where id = ${literal(raceRequest)}::uuid;`), '1');
  }
  sql(`delete from app.passenger_request where id = ${literal(raceRequest)}::uuid;
    update auth.users set email_confirmed_at = now() where id = ${literal(ids.driver)}::uuid;
    update app.account set adult_declared_at = now() where id = ${literal(ids.driver)}::uuid;
    update private.account_contact set phone_e164 = '+393990000099', phone_verified_at = now()
      where account_id = ${literal(ids.driver)}::uuid;
    insert into app.legal_document_version(id, document_type, version, language_codes, effective_at, status, content_hash)
      values (${literal(ids.legal)}::uuid, 'terms', ${literal(slug)}, array['en'], now(), 'published', repeat('a',64));
    insert into app.legal_acceptance(account_id, document_version_id, acceptance_type, evidence_language, evidence_context)
      values (${literal(ids.driver)}::uuid, ${literal(ids.legal)}::uuid, 'terms_explicit', 'en', 'account_foundation_v1');`);
  if (churchStatus() === 'archived') execute(prepare('restore_church'));
  await verifyRegularPublicationRace();
} finally {
  // Exact synthetic fixture scope only; no remote target, truncation, or unrelated records.
  sql(`begin;
    drop trigger if exists synthetic_owner_failure on ops.owner_operation;
    drop function if exists app.synthetic_owner_failure();
    delete from ops.audit_event where target_type = 'owner_operation' and target_id in (
      select id from ops.owner_operation where church_id = ${literal(ids.church)}::uuid);
    delete from ops.owner_operation where church_id = ${literal(ids.church)}::uuid;
    delete from ops.audit_event where target_id = ${literal(ids.churchPublic)}::uuid;
    delete from app.ride_agreement where id = ${literal(ids.agreement)}::uuid;
    delete from app.ride_response where id = ${literal(ids.response)}::uuid;
    alter table app.ride_condition_snapshot disable trigger prevent_ride_snapshot_update;
    delete from app.ride_condition_snapshot where id = ${literal(ids.snapshot)}::uuid;
    alter table app.ride_condition_snapshot enable trigger prevent_ride_snapshot_update;
    delete from app.driver_offer_occurrence where church_id = ${literal(ids.church)}::uuid;
    delete from app.driver_offer_series where church_id = ${literal(ids.church)}::uuid;
    delete from app.passenger_request where church_id = ${literal(ids.church)}::uuid;
    delete from private.user_place where owner_account_id in (${literal(ids.passenger)}::uuid, ${literal(ids.driver)}::uuid);
    delete from app.church_archive_request where church_id = ${literal(ids.church)}::uuid;
    delete from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid;
    delete from app.content_translation where content_source_id in (select id from app.content_source
      where object_type = 'service_occurrence' and object_id in (select id from app.service_occurrence
        where source_series_id = ${literal(ids.serviceSeries)}::uuid));
    delete from app.content_source where object_type = 'service_occurrence' and object_id in (
      select id from app.service_occurrence where source_series_id = ${literal(ids.serviceSeries)}::uuid);
    delete from app.service_occurrence where source_series_id = ${literal(ids.serviceSeries)}::uuid;
    delete from app.service_series where id = ${literal(ids.serviceSeries)}::uuid;
    delete from app.content_translation where content_source_id in (select id from app.content_source
      where object_type = 'church' and object_id = ${literal(ids.church)}::uuid);
    delete from app.content_source where object_type = 'church' and object_id = ${literal(ids.church)}::uuid;
    delete from app.church where id = ${literal(ids.church)}::uuid;
    delete from app.account where id in (${literal(ids.passenger)}::uuid, ${literal(ids.driver)}::uuid);
    delete from app.legal_document_version where id = ${literal(ids.legal)}::uuid;
    delete from auth.users where id in (${literal(ids.passenger)}::uuid, ${literal(ids.driver)}::uuid);
    drop role if exists ${otherRole};
    drop role if exists ${operatorLogin};
    commit;`);
}
process.stdout.write('Protected church lifecycle verification passed: role isolation, safe preview, token/actor/expiry, freshness, future-work guards, atomic archive/restore/audit, replay, real regular-publication concurrency, and exact cleanup.\n');
