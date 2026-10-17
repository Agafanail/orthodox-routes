import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Existing local-only church fixture owns all synthetic rows and exact teardown.
export async function verifyHiddenScheduleRepairs({ actor, outsiders, anonymous, rpc, rpcFailure,
  churchId, churchSlug, recurringArgs, runSql }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const offset = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const churchInternal = `(select id from app.church where public_id = ${literal(churchId)}::uuid)`;
  const service = (id) => JSON.parse(runSql(`select to_jsonb(item) from app.service_occurrence as item where public_id = ${literal(id)}::uuid;`));
  const oneOffArgs = { p_church_id: churchId, p_source_name: 'Synthetic hidden one-off', p_source_description: null,
    p_starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), p_client_key: randomUUID() };
  assert.equal(runSql(`select status from app.church where id = ${churchInternal};`), 'published');
  try {
    runSql(`update app.church set status = 'hidden' where id = ${churchInternal};`);
    for (const outsider of outsiders) await rpcFailure(outsider, 'create_one_off_service', oneOffArgs);
    const once = await rpc(actor, 'create_one_off_service', oneOffArgs);
    const content = await rpc(actor, 'update_one_off_service_content', { p_service_id: once.service_id,
      p_source_name: 'Synthetic repaired hidden one-off', p_source_description: null,
      p_expected_version: once.version, p_client_key: randomUUID() });
    const time = await rpc(actor, 'update_one_off_service_time', { p_service_id: once.service_id,
      p_starts_at: new Date(Date.parse(oneOffArgs.p_starts_at) + 3_600_000).toISOString(),
      p_expected_version: content.version, p_client_key: randomUUID() });
    await rpc(actor, 'preview_one_off_service_cancellation', { p_service_id: once.service_id });
    await rpc(actor, 'cancel_one_off_service', { p_service_id: once.service_id,
      p_expected_version: time.version, p_client_key: randomUUID() });
    assert.equal(service(once.service_id).status, 'cancelled');
    const recurring = await rpc(actor, 'create_recurring_service', { ...recurringArgs,
      p_source_name: 'Synthetic hidden weekly', p_local_start_time: '20:03:00', p_client_key: randomUUID() });
    const dates = JSON.parse(runSql(`select jsonb_agg(to_jsonb(item) order by item.local_date)
      from app.service_occurrence as item join app.service_series as series on series.id = item.source_series_id
      where series.public_id = ${literal(recurring.series_id)}::uuid;`));
    assert.equal(dates.length, 3);
    await rpc(actor, 'update_recurring_service_date_content', { p_service_id: dates[0].public_id,
      p_source_name: 'Synthetic repaired hidden date', p_source_description: null,
      p_expected_version: dates[0].version, p_client_key: randomUUID() });
    await rpc(actor, 'reschedule_recurring_service_date', { p_service_id: dates[0].public_id,
      p_starts_at: new Date(Date.parse(dates[0].starts_at) + 300_000).toISOString(),
      p_expected_version: service(dates[0].public_id).version, p_client_key: randomUUID() });
    const anchor = { p_service_id: dates[1].public_id };
    let future = await rpc(actor, 'preview_recurring_service_future_content', anchor);
    await rpc(actor, 'update_recurring_service_future_content', { ...anchor,
      p_source_name: 'Synthetic repaired hidden weekly', p_source_description: null,
      p_expected_series_version: future.series_version, p_expected_schedule_updated_at: future.schedule_updated_at,
      p_client_key: randomUUID() });
    future = await rpc(actor, 'preview_recurring_service_future_time', anchor);
    await rpc(actor, 'reschedule_recurring_service_future', { ...anchor, p_local_start_time: '20:13:00',
      p_expected_series_version: future.series_version, p_expected_schedule_updated_at: future.schedule_updated_at,
      p_client_key: randomUUID() });
    future = await rpc(actor, 'preview_recurring_service_extension', anchor);
    await rpc(actor, 'extend_recurring_service', { ...anchor, p_ends_on: offset(future.ends_on, 7),
      p_expected_series_version: future.series_version, p_expected_schedule_updated_at: future.schedule_updated_at,
      p_client_key: randomUUID() });
    await rpc(actor, 'preview_recurring_service_date_cancellation', { p_service_id: dates[0].public_id });
    await rpc(actor, 'cancel_recurring_service_date', { p_service_id: dates[0].public_id,
      p_expected_version: service(dates[0].public_id).version, p_client_key: randomUUID() });
    const cancellation = await rpc(actor, 'preview_recurring_service_future_cancellation', anchor);
    await rpc(actor, 'cancel_recurring_service_future', { ...anchor,
      p_expected_series_version: cancellation.series_version, p_client_key: randomUUID() });
    assert.equal(service(dates[1].public_id).status, 'cancelled');
    for (const outsider of outsiders) {
      await rpcFailure(outsider, 'preview_recurring_service_extension', anchor);
      await rpcFailure(outsider, 'update_one_off_service_content', { p_service_id: once.service_id,
        p_source_name: 'Unauthorized repair', p_source_description: null,
        p_expected_version: service(once.service_id).version, p_client_key: randomUUID() });
    }
    assert.equal(await rpc(anonymous, 'transport_church_by_slug', { p_slug: churchSlug }), null);
    assert.deepEqual(await rpc(anonymous, 'published_church_schedule', { p_church_id: churchId, p_limit: 100 }), []);
    assert.match(runSql(`select app.assert_transport_reference(${literal(churchId)}::uuid, null, now() + interval '3 days');`,
      { expectFailure: true }), /unavailable/);
    runSql(`update app.church set status = 'archived' where id = ${churchInternal};`);
    await rpcFailure(actor, 'create_one_off_service', { ...oneOffArgs, p_client_key: randomUUID() });
  } finally {
    runSql(`update app.church set status = 'published' where id = ${churchInternal};`);
  }
}
