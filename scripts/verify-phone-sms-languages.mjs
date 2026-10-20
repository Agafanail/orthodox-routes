import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The caller supplies only its exact disposable local container, own synthetic account, and protected Data API clients.
export async function verifyPhoneSmsLanguages({ container, runSql, rpc, client, admin, accountId }) {
  const sql = (statement, options) => runSql(container, statement, options);
  const original = await rpc(client, 'current_account');
  const languages = ['de', 'en', 'it', 'ro', 'ru', 'uk'];
  const claim = async (id, name = 'phone_worker_claim_delivery_v2') => {
    const lease = randomUUID(); const result = await admin.schema('api').rpc(name, { p_attempt_id: id, p_lease_token: lease });
    assert.equal(result.error, null); return { items: result.data, lease };
  };
  const complete = async (id, lease) => {
    assert.equal(await rpc(admin, 'phone_worker_complete_delivery', { p_attempt_id: id, p_lease_token: lease,
      p_delivered: false, p_provider_adapter: 'local-sms-template-test', p_provider_reference: null }), true);
  };
  const profile = (language) => rpc(client, 'update_current_account_profile', {
    p_display_name: original.display_name, p_preferred_language: language,
  });
  const ageRequests = () => sql(`update ops.phone_verification_attempt set requested_at = requested_at - interval '2 minutes'
    where account_id = '${accountId}';`);
  const expireLease = (id) => sql(`update ops.phone_verification_delivery set leased_at = now() - interval '6 minutes',
    lease_until = now() - interval '1 second'
    where attempt_id = '${id}';`);
  const sourceDigest = () => sql(`select encode(extensions.digest(convert_to(coalesce(
    jsonb_agg(to_jsonb(attempt) - array['sms_language','sms_template_version'] order by attempt.id)::text,
    'null'), 'UTF8'), 'sha256'), 'hex') from ops.phone_verification_attempt as attempt where account_id = '${accountId}';`);
  try {
    for (const language of languages) {
      ageRequests(); await profile(language);
      const requested = await rpc(client, 'request_phone_change', { p_phone_e164: '+390000000190', p_client_key: randomUUID() });
      assert.equal(requested.status, 'queued');
      assert.equal(sql(`select sms_template_version = 2 and sms_language = '${language}'
        from ops.phone_verification_attempt where id = '${requested.attempt_id}';`), 't');
      const oldWorker = await claim(requested.attempt_id, 'phone_worker_claim_delivery');
      assert.deepEqual(oldWorker.items, []);
      assert.equal(sql(`select state from ops.phone_verification_delivery where attempt_id = '${requested.attempt_id}';`), 'queued');
      await profile(language === 'en' ? 'ru' : 'en');
      const first = await claim(requested.attempt_id);
      assert.equal(first.items.length, 1); assert.equal(first.items[0].sms_template_version, 2);
      assert.equal(first.items[0].sms_language, language);
      assert.deepEqual((await claim(requested.attempt_id)).items, []);
      expireLease(requested.attempt_id);
      const retried = await claim(requested.attempt_id);
      assert.deepEqual(retried.items, first.items, 'Reclaim preserves exact code/template/language payload.');
      sql(`update ops.phone_verification_attempt set sms_language = '${language === 'en' ? 'ru' : 'en'}'
        where id = '${requested.attempt_id}';`, { expectFailure: true });
      await complete(requested.attempt_id, retried.lease);
      assert.equal(sql(`select count(*) from ops.phone_verification_delivery where attempt_id = '${requested.attempt_id}';`), '0');
    }
    // A deliberately legacy synthetic attempt models a request already accepted by an older deployed worker.
    const legacyId = randomUUID();
    sql(`insert into ops.phone_verification_attempt(id, account_id, client_key, phone_e164, code_salt, code_digest,
      requested_at, expires_at, sms_template_version, sms_language) values ('${legacyId}', '${accountId}', '${randomUUID()}',
      '+390000000190', repeat('a',32), app.phone_code_digest(repeat('a',32), '123456'), now(), now() + interval '10 minutes', 1, 'ru');
      insert into ops.phone_verification_delivery(attempt_id, code) values ('${legacyId}', '123456');`);
    const old = await claim(legacyId, 'phone_worker_claim_delivery');
    assert.equal(old.items.length, 1);
    assert.deepEqual(Object.keys(old.items[0]).sort(), ['attempt_id', 'phone_e164', 'verification_code', 'expires_at'].sort());
    assert.equal(old.items[0].verification_code, '123456');
    expireLease(legacyId);
    const compatible = await claim(legacyId);
    assert.equal(compatible.items[0].sms_template_version, 1); assert.equal(compatible.items[0].sms_language, 'ru');
    for (const key of Object.keys(old.items[0])) assert.equal(compatible.items[0][key], old.items[0][key]);
    await complete(legacyId, compatible.lease);
    const definitions = () => sql(`select jsonb_agg(jsonb_build_object('oid', routine.oid,
      'definition', pg_get_functiondef(routine.oid), 'acl', routine.proacl) order by routine.oid)
      from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname in ('api','ops') and routine.prokind = 'f';`);
    const migration = readFileSync(new URL('../supabase/migrations/20261019130000_phone_sms_languages.sql', import.meta.url), 'utf8');
    const beforeDefinitions = definitions(); const beforeRows = sourceDigest();
    const frozen = sql(`select jsonb_agg(jsonb_build_array(id, sms_template_version, sms_language) order by id)
      from ops.phone_verification_attempt where account_id = '${accountId}';`);
    // Reconstruct only the previous feature shape inside a rolled-back disposable transaction, then apply the actual migration.
    const upgraded = sql(`begin;
      alter table ops.phone_verification_attempt drop column sms_template_version cascade, drop column sms_language cascade;
      ${migration}
      select 'SMS_BACKFILL:' || bool_and(sms_template_version = 1 and sms_language = 'ru')::text
        from ops.phone_verification_attempt where account_id = '${accountId}';
      rollback;`);
    assert.ok(upgraded.split(/\r?\n/).includes('SMS_BACKFILL:true'));
    assert.equal(sourceDigest(), beforeRows); assert.equal(definitions(), beforeDefinitions);
    sql(migration);
    assert.equal(sourceDigest(), beforeRows); assert.equal(definitions(), beforeDefinitions);
    assert.equal(sql(`select jsonb_agg(jsonb_build_array(id, sms_template_version, sms_language) order by id)
      from ops.phone_verification_attempt where account_id = '${accountId}';`), frozen);
    assert.equal(sql(`select count(*) from (values ('anon'),('authenticated'),('service_role')) as roles(name)
      where has_function_privilege(roles.name, 'ops.claim_phone_verification_delivery_target(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(roles.name, 'ops.freeze_phone_sms_template()', 'EXECUTE');`), '0');
    assert.equal(sql(`select count(*) from (values ('anon'),('authenticated')) as roles(name)
      where has_function_privilege(roles.name, 'api.phone_worker_claim_delivery_v2(uuid,uuid)', 'EXECUTE');`), '0');
    assert.equal(sql(`select count(*) from pg_proc where oid in (
      'api.phone_worker_claim_delivery_v2(uuid,uuid)'::regprocedure,
      'ops.claim_phone_verification_delivery_target(uuid,uuid)'::regprocedure,
      'ops.freeze_phone_sms_template()'::regprocedure) and prosecdef and proconfig @> array['search_path=""'];`), '3');
    process.stdout.write('Phone SMS language verification passed: frozen six-language requests/reclaims, legacy separation, actual backfill/replay, and grants.\n');
  } finally {
    await profile(original.preferred_language);
    // Existing parent cleanup removes only this synthetic account and its cascading attempts/delivery material.
  }
}
