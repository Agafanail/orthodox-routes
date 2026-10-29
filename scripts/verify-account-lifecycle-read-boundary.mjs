import assert from 'node:assert/strict';

// State-only fixtures, not real account deletion or Auth revocation. Reuse the
// same actually authenticated HTTP client: its signed session is deliberately still valid.
export async function verifyAccountLifecycleReadBoundary({ actor, accountId, agreementId, call, sql, literal }) {
  const target = `id = ${literal(accountId)}::uuid`;
  const original = JSON.parse(sql(`select jsonb_build_object('status', status,
    'updated_at', updated_at, 'deleted_at', deleted_at) from app.account where ${target};`));
  const reads = [
    ['get_agreement_contacts', { p_agreement_id: agreementId }],
    ['get_agreement_exact_place', { p_agreement_id: agreementId }],
    ['current_transport_items', {}], ['current_ride_agreements', {}], ['current_account', {}],
    ['current_notifications', {}], ['list_saved_places', {}],
    ['export_current_account_data', {}], ['current_account_deletion_impact', {}],
  ];
  try {
    sql(`update app.account set status = 'restricted', updated_at = clock_timestamp() where ${target};`);
    for (const [name, args] of reads) {
      const result = await call(name, args);
      assert.equal(Boolean(result.error), false, `Restricted-account safe read was removed: ${name}.`);
      assert.equal(Boolean(result.data), true, `Restricted-account safe read disappeared: ${name}.`);
    }
    for (const status of ['deleting', 'deleted']) {
      sql(`update app.account set status = ${literal(status)}, updated_at = clock_timestamp(),
        deleted_at = case when ${literal(status)} = 'deleted' then clock_timestamp() else null end where ${target};`);
      const identity = await actor.auth.getUser();
      assert.equal(Boolean(identity.error), false); assert.equal(identity.data.user?.id === accountId, true);
      for (const [name, args] of reads) {
        const result = await call(name, args);
        // Never print the private response on a failing assertion.
        assert.equal(Boolean(result.error), true, `Still-valid ${status} session obtained private data through ${name}.`);
        assert.equal(result.data === null, true);
      }
    }
    process.stdout.write('Account lifecycle read boundary: same valid Auth session denied in deleting/deleted states, restricted safe reads retained.\n');
  } finally {
    sql(`update app.account set status = ${literal(original.status)}, updated_at = ${literal(original.updated_at)}::timestamptz,
      deleted_at = ${original.deleted_at ? `${literal(original.deleted_at)}::timestamptz` : 'null'} where ${target};`);
  }
}
