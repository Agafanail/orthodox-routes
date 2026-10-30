import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syntheticPlace } from './synthetic-geo.mjs';

// State-only fixtures, not real account deletion or Auth revocation. Reuse the
// same actually authenticated HTTP client: its signed session is deliberately still valid.
export async function verifyAccountLifecycleReadBoundary({ actor, accountId, agreementId, cancellableAgreementId, restorableRequestId, call, sql, literal }) {
  const target = `id = ${literal(accountId)}::uuid`;
  const original = JSON.parse(sql(`select jsonb_build_object('status', status,
    'updated_at', updated_at, 'deleted_at', deleted_at) from app.account where ${target};`));
  const reads = [
    ['get_agreement_contacts', { p_agreement_id: agreementId }],
    ['get_agreement_exact_place', { p_agreement_id: agreementId }],
    ['current_transport_items', {}], ['current_ride_agreements', {}], ['current_account', {}],
    ['current_notifications', {}], ['list_saved_places', {}], ['current_account_deletion_confirmation', {}],
    ['export_current_account_data', {}], ['current_account_deletion_impact', {}],
    ['current_my_trips', {}], ['get_my_trip_details', { p_agreement_id: agreementId }],
  ];
  let savedPlaceId;
  let deletionRequestId;
  try {
    const deletionRequest = await call('request_account_deletion_confirmation', { p_client_key: randomUUID() });
    assert.equal(Boolean(deletionRequest.error), false); assert.equal(typeof deletionRequest.data?.request_id, 'string');
    deletionRequestId = deletionRequest.data.request_id;
    const saved = await call('save_place', { p_place: syntheticPlace(45.0611, 7.6721,
      'Lifecycle boundary synthetic saved entrance', 'Torino', { label: 'Synthetic lifecycle place' }) });
    assert.equal(Boolean(saved.error), false); assert.equal(typeof saved.data?.place_id, 'string');
    savedPlaceId = saved.data.place_id;
    sql(`update app.account set status = 'restricted', updated_at = clock_timestamp() where ${target};`);
    for (const [name, args] of reads) {
      const result = await call(name, args);
      assert.equal(Boolean(result.error), false, `Restricted-account safe read was removed: ${name}.`);
      assert.equal(Boolean(result.data), true, `Restricted-account safe read disappeared: ${name}.`);
      if (name === 'list_saved_places') assert.equal(result.data.some((place) => place.place_id === savedPlaceId), true);
    }
    const cancelled = await call('cancel_ride_agreement', { p_agreement_id: cancellableAgreementId, p_client_key: randomUUID() });
    assert.equal(Boolean(cancelled.error), false); assert.equal(cancelled.data?.status === 'cancelled', true);
    const positive = await call('restore_passenger_request', { p_request_id: restorableRequestId, p_client_key: randomUUID() });
    assert.equal(Boolean(positive.error), true, 'Restricted participation was accidentally enabled.');
    for (const status of ['deleting', 'deleted']) {
      sql(`update app.account set status = ${literal(status)}, updated_at = clock_timestamp(),
        deleted_at = case when ${literal(status)} = 'deleted' then clock_timestamp() else null end where ${target};`);
      const identity = await actor.auth.getUser();
      assert.equal(Boolean(identity.error), false); assert.equal(identity.data.user?.id === accountId, true);
      const eligibility = await call('current_eligibility', {});
      assert.equal(Boolean(eligibility.error), false); assert.equal(eligibility.data.eligible, false);
      assert.equal(eligibility.data.account_status, status);
      assert.equal(eligibility.data.reasons.includes('account_state_not_permitted'), true);
      assert.deepEqual(Object.keys(eligibility.data).sort(), [
        'account_exists', 'account_state_permitted', 'account_status', 'adult_declared', 'current_terms_accepted',
        'current_terms_version', 'eligible', 'email_verified', 'phone_verified', 'reasons',
      ]);
      for (const [name, args] of reads) {
        const result = await call(name, args);
        // Never print the private response on a failing assertion.
        assert.equal(Boolean(result.error), true, `Still-valid ${status} session obtained private data through ${name}.`);
        assert.equal(result.data === null, true);
      }
    }
    const definition = () => sql(`select jsonb_agg(jsonb_build_object('definition', md5(pg_get_functiondef(routine.oid)),
      'acl', routine.proacl::text) order by routine.oid) from pg_proc as routine where routine.oid in (
        'app.current_actor_id()'::regprocedure, 'api.current_eligibility()'::regprocedure);`);
    const expected = definition();
    sql(readFileSync(new URL('../supabase/migrations/20261029140000_account_lifecycle_read_boundary.sql', import.meta.url), 'utf8'));
    assert.equal(definition(), expected);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege(${literal(role)}, 'app.current_actor_id()', 'EXECUTE')::text;`), 'false');
      assert.equal(sql(`select has_function_privilege(${literal(role)}, 'api.current_eligibility()', 'EXECUTE')::text;`),
        role === 'authenticated' ? 'true' : 'false');
    }
    assert.equal(sql(`select count(*) from pg_proc where oid = 'app.current_actor_id()'::regprocedure
      and provolatile = 's' and not prosecdef and proconfig @> array['search_path=""'];`), '1');
    process.stdout.write('Account lifecycle read boundary: same valid Auth session denied in deleting/deleted states, restricted safe reads retained.\n');
  } finally {
    sql(`update app.account set status = ${literal(original.status)}, updated_at = ${literal(original.updated_at)}::timestamptz,
      deleted_at = ${original.deleted_at ? `${literal(original.deleted_at)}::timestamptz` : 'null'} where ${target};`);
    if (savedPlaceId) sql(`delete from private.user_place where public_id = ${literal(savedPlaceId)}::uuid
      and owner_account_id = ${literal(accountId)}::uuid;`);
    if (deletionRequestId) sql(`delete from ops.audit_event where target_type = 'deletion_request' and target_id = ${literal(deletionRequestId)}::uuid;
      delete from ops.deletion_request where id = ${literal(deletionRequestId)}::uuid and subject_auth_id = ${literal(accountId)}::uuid;`);
  }
}
