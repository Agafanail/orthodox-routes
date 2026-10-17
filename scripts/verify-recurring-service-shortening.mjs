import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Only the existing disposable local church-administration fixture invokes this verifier.
// Its parent owns exact church/account teardown, including these series and related synthetic rows.
export async function verifyRecurringServiceShortening({ actor, outsiders, rpc, rpcFailure, rpcConflict,
  recurringArgs, requestAuthorId, runSql }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const later = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const create = async (time, end) => rpc(actor, 'create_recurring_service', { ...recurringArgs,
    p_source_name: `Synthetic shortening ${randomUUID()}`, p_local_start_time: time,
    p_ends_on: end, p_client_key: randomUUID() });
  const rows = (seriesId) => JSON.parse(runSql(`select jsonb_agg(to_jsonb(service) order by service.local_date, service.id)
    from app.service_occurrence as service join app.service_series as series on series.id = service.source_series_id
    where series.public_id = ${literal(seriesId)}::uuid;`));
  const preview = (serviceId, end) => rpc(actor, 'preview_recurring_service_shortening', { p_service_id: serviceId, p_ends_on: end });
  const input = (value) => ({ p_service_id: value.selected_service_id, p_ends_on: value.proposed_ends_on,
    p_expected_series_version: value.series_version, p_expected_schedule_updated_at: value.schedule_updated_at,
    p_client_key: randomUUID() });
  const series = await create('19:37:00', later(recurringArgs.p_starts_on, 21));
  const original = rows(series.series_id);
  assert.equal(original.length, 4);
  await rpc(actor, 'cancel_recurring_service_date', { p_service_id: original[1].public_id,
    p_expected_version: original[1].version, p_client_key: randomUUID() });
  const retained = rows(series.series_id).slice(0, 2);
  const end = later(recurringArgs.p_starts_on, 9); // Deliberately not a weekly slot boundary.
  const requestId = randomUUID();
  runSql(`insert into app.passenger_request (public_id, author_account_id, church_id, service_occurrence_id,
    desired_arrival_at, timezone, service_name_snapshot, total_passengers, child_seat_required,
    return_required, remaining_passengers, terms_version)
    select ${literal(requestId)}::uuid, ${literal(requestAuthorId)}::uuid, service.church_id, service.id,
      service.starts_at, service.timezone, service.source_name, 1, false, false, 1, 'synthetic-shortening'
    from app.service_occurrence as service where service.id = ${literal(original[2].id)}::uuid;`);
  const rideDigest = () => runSql(`select encode(extensions.digest(convert_to(jsonb_build_object(
    'request', (select to_jsonb(request) from app.passenger_request as request where public_id = ${literal(requestId)}::uuid),
    'agreements', (select jsonb_agg(to_jsonb(agreement) order by agreement.id) from app.ride_agreement as agreement),
    'snapshots', (select jsonb_agg(to_jsonb(snapshot) order by snapshot.id) from app.ride_condition_snapshot as snapshot)
    )::text, 'UTF8'), 'sha256'), 'hex');`);
  const ridesBefore = rideDigest();
  const impact = await preview(original[0].public_id, end);
  assert.equal(impact.service_count, 2);
  assert.equal(impact.passenger_requests, 1);
  assert.equal(impact.first_removed_local_date, original[2].local_date);
  assert.equal(impact.selected_service_id, original[0].public_id);
  const args = input(impact);
  for (const outsider of outsiders) {
    await rpcFailure(outsider, 'preview_recurring_service_shortening', { p_service_id: args.p_service_id, p_ends_on: end });
    await rpcFailure(outsider, 'shorten_recurring_service', args);
  }
  for (const invalid of [null, 'infinity', '-infinity', later(original[0].local_date, -1), later(original[3].local_date, 1)]) {
    await rpcFailure(actor, 'preview_recurring_service_shortening', { p_service_id: args.p_service_id, p_ends_on: invalid });
    await rpcFailure(actor, 'shorten_recurring_service', { ...args, p_ends_on: invalid });
  }
  await rpcFailure(actor, 'shorten_recurring_service', { ...args, p_expected_schedule_updated_at: null });
  const beforeRollback = rows(series.series_id);
  // Inject a late failure after nested cancellation, its notifications/audit, and the exact-bound update.
  try {
    runSql(`create function app.synthetic_shortening_failure() returns trigger language plpgsql as $$ begin
      if new.operation_type = 'shorten_recurring_service' and new.client_key = ${literal(args.p_client_key)}::uuid
        then raise exception 'Synthetic shortening failure.'; end if; return new; end; $$;
      create trigger synthetic_shortening_failure before insert on private.church_operation
        for each row execute function app.synthetic_shortening_failure();`);
    await rpcFailure(actor, 'shorten_recurring_service', args);
    assert.deepEqual(rows(series.series_id), beforeRollback);
    const rolledBack = await preview(args.p_service_id, end);
    assert.equal(rolledBack.schedule_updated_at, impact.schedule_updated_at);
    assert.equal(rolledBack.ends_on, impact.ends_on);
    assert.equal(rolledBack.series_version, impact.series_version);
    assert.equal(rideDigest(), ridesBefore);
    assert.equal(runSql(`select count(*) from app.notification where event_type = 'church.service.cancelled'
      and object_public_id = ${literal(original[2].public_id)}::uuid;`), '0');
  } finally {
    runSql('drop trigger if exists synthetic_shortening_failure on private.church_operation; drop function if exists app.synthetic_shortening_failure();');
  }
  const saved = await rpc(actor, 'shorten_recurring_service', args);
  assert.equal(saved.ends_on, end);
  assert.equal(saved.cancelled_service_count, 2);
  assert.equal(saved.series_version, impact.series_version + 1);
  assert.deepEqual(rows(series.series_id).slice(0, 2), retained);
  assert.ok(rows(series.series_id).slice(2).every((service) => service.status === 'cancelled'));
  assert.equal(rideDigest(), ridesBefore);
  const notificationCount = () => runSql(`select count(*) from app.notification where recipient_account_id = ${literal(requestAuthorId)}::uuid
    and event_type = 'church.service.cancelled' and object_public_id = ${literal(original[2].public_id)}::uuid and safe_route = '/trips';`);
  assert.equal(notificationCount(), '1');
  assert.deepEqual(await rpc(actor, 'shorten_recurring_service', args), saved);
  assert.equal(notificationCount(), '1');
  await rpcFailure(actor, 'shorten_recurring_service', { ...args, p_ends_on: later(end, -1) });
  await rpcConflict(actor, 'shorten_recurring_service', { ...args, p_client_key: randomUUID() });
  const current = await preview(args.p_service_id, end);
  assert.equal(current.service_count, 0);
  const noOp = await rpc(actor, 'shorten_recurring_service', input(current));
  assert.equal(noOp.series_version, saved.series_version);
  assert.equal(noOp.cancelled_service_count, 0);
  assert.equal((await preview(args.p_service_id, end)).schedule_updated_at, current.schedule_updated_at);
  assert.equal(runSql(`select app.materialize_service_series(id, now() + interval '40 days')
    from app.service_series where public_id = ${literal(series.series_id)}::uuid;`), '0');
  assert.equal(rows(series.series_id).filter((service) => service.status === 'scheduled').length, 1);

  const race = await create('19:38:00', later(recurringArgs.p_starts_on, 21));
  const raceSelected = rows(race.series_id)[0].public_id;
  const racePreview = await preview(raceSelected, later(recurringArgs.p_starts_on, 9));
  const concurrent = await Promise.all([8, 9].map((days) => actor.schema('api').rpc('shorten_recurring_service', {
    ...input(racePreview), p_ends_on: later(recurringArgs.p_starts_on, days),
  }).abortSignal(AbortSignal.timeout(10_000))));
  assert.equal(concurrent.filter((item) => !item.error).length, 1);
  assert.equal(concurrent.filter((item) => item.status === 409 && item.error?.code === 'PT409').length, 1);

  const unlimited = await create('19:39:00', null);
  const unlimitedSelected = rows(unlimited.series_id)[0].public_id;
  const unlimitedEnd = later(recurringArgs.p_starts_on, 5);
  const unlimitedSaved = await rpc(actor, 'shorten_recurring_service', input(await preview(unlimitedSelected, unlimitedEnd)));
  assert.equal(unlimitedSaved.ends_on, unlimitedEnd);
  assert.ok(unlimitedSaved.cancelled_service_count > 0);

  const far = await create('19:40:00', later(recurringArgs.p_starts_on, 400));
  const farRows = rows(far.series_id);
  const farEnd = later(recurringArgs.p_starts_on, 300);
  const farPreview = await preview(farRows[0].public_id, farEnd);
  assert.equal(farPreview.service_count, 0);
  assert.equal(farPreview.first_removed_local_date, null);
  const farSaved = await rpc(actor, 'shorten_recurring_service', input(farPreview));
  assert.equal(farSaved.ends_on, farEnd);
  assert.equal(farSaved.series_version, farPreview.series_version + 1);
  assert.equal(farSaved.cancelled_service_count, 0);
  assert.deepEqual(rows(far.series_id), farRows);
  const farChurch = `(select church_id from app.service_series where public_id = ${literal(far.series_id)}::uuid)`;
  try {
    runSql(`update app.church set status = 'hidden' where id = ${farChurch};`);
    const hiddenEnd = later(farEnd, -1);
    const hiddenPreview = await preview(farRows[0].public_id, hiddenEnd);
    const hiddenSaved = await rpc(actor, 'shorten_recurring_service', input(hiddenPreview));
    assert.equal(hiddenSaved.ends_on, hiddenEnd);
    assert.equal(hiddenSaved.series_version, farSaved.series_version + 1);
    assert.deepEqual(rows(far.series_id), farRows);
    for (const outsider of outsiders) {
      await rpcFailure(outsider, 'shorten_recurring_service', input(hiddenPreview));
    }
    runSql(`update app.church set status = 'archived' where id = ${farChurch};`);
    await rpcFailure(actor, 'preview_recurring_service_shortening', {
      p_service_id: farRows[0].public_id, p_ends_on: hiddenEnd,
    });
    await rpcFailure(actor, 'shorten_recurring_service', input(hiddenPreview));
  } finally {
    runSql(`update app.church set status = 'published' where id = ${farChurch};`);
  }
  for (const signature of ['api.preview_recurring_service_shortening(uuid,date)',
    'api.shorten_recurring_service(uuid,date,integer,timestamptz,uuid)']) {
    assert.equal(runSql(`select has_function_privilege('anon', ${literal(signature)}, 'EXECUTE')::text || ':' ||
      has_function_privilege('authenticated', ${literal(signature)}, 'EXECUTE')::text || ':' ||
      has_function_privilege('service_role', ${literal(signature)}, 'EXECUTE')::text;`), 'false:true:false');
    assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(signature)}::regprocedure
      and prosecdef and proconfig @> array['search_path=""'];`), '1');
  }
}
