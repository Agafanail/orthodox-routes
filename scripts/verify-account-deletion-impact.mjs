import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Invoked only by the disposable My Trips fixture. No deletion or provider call occurs.
export async function verifyAccountDeletionImpact({ clients, identities, anonymous, admin, churches,
  listingRequestId, rpc, runSql }) {
  const name = 'current_account_deletion_impact';
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const keys = ['schema_version', 'evaluated_at', 'future_passenger_requests', 'future_driver_occurrences',
    'future_driver_series', 'pending_future_responses', 'future_agreements', 'administrator_churches',
    'final_administrator_churches', 'requires_administrator_resolution'];
  const counts = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'evaluated_at'));
  const read = (client) => rpc(client, name);
  const expectFailure = async (client, args = {}) => {
    const result = await client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
    assert.ok(result.error, 'Deletion impact escaped its authenticated own-account boundary.');
  };
  const subjects = identities.map((item) => `${literal(item.id)}::uuid`).join(',');
  const fingerprint = () => runSql(`select encode(extensions.digest(convert_to(jsonb_build_object(
    'accounts', (select jsonb_agg(to_jsonb(item) order by item.id) from app.account as item where id in (${subjects})),
    'contacts', (select jsonb_agg(to_jsonb(item) order by item.account_id) from private.account_contact as item where account_id in (${subjects})),
    'requests', (select jsonb_agg(to_jsonb(item) order by item.id) from app.passenger_request as item where author_account_id in (${subjects})),
    'offers', (select jsonb_agg(to_jsonb(item) order by item.id) from app.driver_offer_occurrence as item where author_account_id in (${subjects})),
    'series', (select jsonb_agg(to_jsonb(item) order by item.id) from app.driver_offer_series as item where author_account_id in (${subjects})),
    'agreements', (select jsonb_agg(to_jsonb(item) order by item.id) from app.ride_agreement as item
      where driver_account_id in (${subjects}) or passenger_account_id in (${subjects})),
    'responses', (select jsonb_agg(to_jsonb(item) order by item.id) from app.ride_response as item
      where driver_account_id in (${subjects}) or passenger_account_id in (${subjects})),
    'snapshots', (select jsonb_agg(to_jsonb(item) order by item.id) from app.ride_condition_snapshot as item),
    'audit_count', (select count(*) from ops.audit_event)
  )::text, 'UTF8'), 'sha256'), 'hex');`);
  const before = fingerprint();
  const views = await Promise.all(clients.map(read));
  for (const view of views) {
    assert.deepEqual(Object.keys(view).sort(), [...keys].sort());
    assert.equal(view.schema_version, 1);
    assert.ok(Number.isFinite(Date.parse(view.evaluated_at)));
    for (const key of keys.filter((key) => !['schema_version', 'evaluated_at', 'requires_administrator_resolution'].includes(key))) {
      assert.ok(Number.isSafeInteger(view[key]) && view[key] >= 0);
    }
    assert.equal(view.requires_administrator_resolution, view.final_administrator_churches > 0);
    assert.equal(view.administrator_churches, 0);
  }
  assert.ok(views[0].future_passenger_requests > 0);
  assert.ok(views[2].future_agreements > 0);
  assert.ok(views[3].future_agreements > 0);
  assert.ok(views[3].future_driver_occurrences > 0);
  assert.ok(views[3].future_driver_series > 0);
  for (const key of keys.filter((key) => !['schema_version', 'evaluated_at', 'requires_administrator_resolution'].includes(key))) {
    assert.equal(views[4][key], 0, 'Unrelated account inherited another participant impact.');
  }
  await expectFailure(anonymous);
  await expectFailure(admin);
  await expectFailure(clients[4], { p_account_id: identities[0].id });
  assert.equal(fingerprint(), before, 'Informational impact read mutated protected domain data.');

  // Rollback-only database fixtures exercise eligibility/time boundaries without changing the real flow.
  const withinFixture = (actorIndex, setup) => {
    const output = runSql(`begin; ${setup}
      set local role authenticated;
      select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: identities[actorIndex].id, role: 'authenticated' }))}, true);
      select api.current_account_deletion_impact(); rollback;`);
    return JSON.parse(output.split(/\r?\n/).filter((line) => line.startsWith('{')).at(-1));
  };
  for (const state of ['email_verified', 'restricted']) {
    const view = withinFixture(4, `update app.account set status = ${literal(state)}, adult_declared_at = null
      where id = ${literal(identities[4].id)}::uuid;
      update private.account_contact set phone_verified_at = null where account_id = ${literal(identities[4].id)}::uuid;
      update private.notification_preference set ride_email_enabled = false, web_push_enabled = false
        where account_id = ${literal(identities[4].id)}::uuid;
      delete from app.legal_acceptance where account_id = ${literal(identities[4].id)}::uuid;`);
    assert.deepEqual(counts(view), counts(views[4]));
  }
  const boundary = withinFixture(0, `update app.passenger_request set desired_arrival_at = current_timestamp
    where public_id = ${literal(listingRequestId)}::uuid;`);
  assert.equal(boundary.future_passenger_requests, views[0].future_passenger_requests - 1);
  assert.equal(fingerprint(), before);

  const membershipIds = [randomUUID(), randomUUID(), randomUUID()];
  const churchInternal = (index) => `(select id from app.church where public_id = ${literal(churches[index].id)}::uuid)`;
  try {
    runSql(`insert into app.church_admin_membership(id, church_id, account_id, access_source)
      values (${literal(membershipIds[0])}::uuid, ${churchInternal(0)}, ${literal(identities[0].id)}::uuid, 'protected_repair'),
      (${literal(membershipIds[1])}::uuid, ${churchInternal(1)}, ${literal(identities[0].id)}::uuid, 'protected_repair');`);
    let own = await read(clients[0]);
    assert.equal(own.administrator_churches, 2);
    assert.equal(own.final_administrator_churches, 2);
    assert.equal(own.requires_administrator_resolution, true);
    assert.deepEqual(counts(await read(clients[4])), counts(views[4]));
    runSql(`insert into app.church_admin_membership(id, church_id, account_id, access_source, status)
      values (${literal(membershipIds[2])}::uuid, ${churchInternal(0)}, ${literal(identities[1].id)}::uuid, 'protected_repair', 'transferring');`);
    own = await read(clients[0]);
    assert.equal(own.final_administrator_churches, 1);
    assert.equal((await read(clients[1])).final_administrator_churches, 0);
    runSql(`update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = ${literal(membershipIds[2])}::uuid;`);
    assert.equal((await read(clients[0])).final_administrator_churches, 2);
    // Visibility alone never ends the final membership; protected support resolution must do that.
    for (const state of ['hidden', 'archived']) {
      runSql(`update app.church set status = ${literal(state)} where id = ${churchInternal(1)};`);
      assert.equal((await read(clients[0])).final_administrator_churches, 2);
    }
  } finally {
    runSql(`delete from app.church_admin_membership where id in (${membershipIds.map((id) => `${literal(id)}::uuid`).join(',')});
      update app.church set status = 'published' where id = ${churchInternal(1)};`);
  }
  assert.equal(fingerprint(), before);
  assert.equal(runSql(`select has_function_privilege('anon', 'api.current_account_deletion_impact()', 'EXECUTE')::text || ':' ||
    has_function_privilege('authenticated', 'api.current_account_deletion_impact()', 'EXECUTE')::text || ':' ||
    has_function_privilege('service_role', 'api.current_account_deletion_impact()', 'EXECUTE')::text;`), 'false:true:false');
  assert.equal(runSql(`select count(*) from pg_proc where oid = 'api.current_account_deletion_impact()'::regprocedure
    and prosecdef and provolatile = 's' and proconfig @> array['search_path=""'];`), '1');
}
