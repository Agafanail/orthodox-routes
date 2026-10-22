import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Disposable database only. Synthetic settings are restored, not deployment defaults.
export async function verifyComplaintVerificationBoundary({ admin, anonymous, clients, runSql, runSqlAsync }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const fields = ['complaint_verify_rate_version', 'complaint_verify_window_seconds', 'complaint_verify_network_limit',
    'complaint_verify_draft_limit', 'complaint_verify_global_limit', 'updated_at'];
  const original = JSON.parse(runSql(`select jsonb_build_object(${fields.map((field) => `${literal(field)}, ${field}`).join(',')})
    from ops.security_policy where singleton;`));
  assert.ok(fields.filter((field) => field !== 'updated_at').every((field) => original[field] === null));
  assert.equal(runSql('select count(*) from ops.complaint_verification_rate_bucket;'), '0');
  const versions = new Set(), stem = `verify-${randomUUID()}`;
  let version;
  const key = () => randomBytes(32).toString('hex');
  const networkA = key(), networkB = key(), draftA = key(), draftB = key();
  const call = (client, name, args) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  const consume = async (network = networkA, draft = draftA) => {
    const result = await call(admin, 'consume_complaint_verification_rate_limit', { p_network_key: network, p_draft_key: draft });
    assert.equal(result.error, null, 'Synthetic verification budget failed.'); return result.data;
  };
  const configure = (suffix, network = 5, draft = 5, global = 20) => {
    version = `${stem}-${suffix}`; versions.add(version);
    runSql(`update ops.security_policy set complaint_verify_rate_version = ${literal(version)},
      complaint_verify_window_seconds = 60, complaint_verify_network_limit = ${network},
      complaint_verify_draft_limit = ${draft}, complaint_verify_global_limit = ${global}, updated_at = clock_timestamp() where singleton;`);
  };
  const rows = () => JSON.parse(runSql(`select coalesce(jsonb_agg(to_jsonb(bucket) order by scope, rate_key), '[]'::jsonb)
    from ops.complaint_verification_rate_bucket as bucket where policy_version = ${literal(version)};`));
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (runSql(condition) === 't') return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('Synthetic verification-rate barrier was not reached.');
  };
  const tableSignature = () => runSql(`select jsonb_build_object('functions',
    (select jsonb_agg(jsonb_build_object('name', oid::regprocedure::text, 'definition', pg_get_functiondef(oid), 'acl', proacl)
      order by oid::regprocedure::text) from pg_proc where oid in (
        'api.consume_complaint_verification_rate_limit(text,text)'::regprocedure,
        'api.expire_complaint_verification_rate_buckets(integer)'::regprocedure)),
    'table', (select jsonb_build_object('rls', relrowsecurity, 'force', relforcerowsecurity, 'acl', relacl)
      from pg_class where oid = 'ops.complaint_verification_rate_bucket'::regclass));`);
  try {
    assert.equal(await consume(), 'unavailable');
    for (const client of [anonymous, ...clients]) {
      assert.ok((await call(client, 'consume_complaint_verification_rate_limit', { p_network_key: networkA, p_draft_key: draftA })).error);
      assert.ok((await call(client, 'expire_complaint_verification_rate_buckets', { p_limit: 1 })).error);
    }
    assert.throws(() => runSql('begin; update ops.security_policy set complaint_verify_draft_limit = 1 where singleton; rollback;'));
    configure('network', 1);
    for (const assignment of ["complaint_verify_rate_version = 'unsafe version'", 'complaint_verify_window_seconds = 59',
      'complaint_verify_window_seconds = 86401', 'complaint_verify_global_limit = 0', 'complaint_verify_draft_limit = null']) {
      assert.throws(() => runSql(`begin; update ops.security_policy set ${assignment} where singleton; rollback;`));
    }
    for (const invalid of [null, '', '192.0.2.1', 'private@example.test', 'G'.repeat(64), 'a'.repeat(65)]) {
      assert.equal(await consume(invalid, draftA), 'unavailable');
      assert.equal(await consume(networkA, invalid), 'unavailable');
    }
    assert.deepEqual(rows(), []);
    assert.equal(await consume(), 'allowed');
    let before = rows();
    assert.equal(await consume(networkA, draftB), 'rate_limited'); assert.deepEqual(rows(), before);
    assert.equal(await consume(networkB, draftA), 'allowed');
    configure('draft', 5, 1);
    assert.equal(await consume(), 'allowed'); before = rows();
    assert.equal(await consume(networkB, draftA), 'rate_limited'); assert.deepEqual(rows(), before);
    configure('global', 5, 5, 1);
    assert.equal(await consume(), 'allowed'); before = rows();
    assert.equal(await consume(networkB, draftB), 'rate_limited'); assert.deepEqual(rows(), before);
    configure('concurrent', 5, 5, 1);
    assert.deepEqual((await Promise.all([consume(), consume()])).sort(), ['allowed', 'rate_limited']);
    assert.equal(rows().length, 3); assert.ok(rows().every((row) => row.request_count === 1));
    configure('scopes');
    assert.equal(await consume(networkA, networkA), 'allowed'); assert.equal(rows().length, 3);
    configure('rollback');
    runSql(`begin; select api.consume_complaint_verification_rate_limit(${literal(networkA)}, ${literal(draftA)}); rollback;`);
    assert.deepEqual(rows(), []);
    configure('late-error');
    try {
      runSql(`create function app.synthetic_verification_rate_failure() returns trigger language plpgsql as $$ begin
        if new.policy_version = ${literal(version)} and new.scope = 'draft' then raise exception 'Synthetic late failure.'; end if;
        return new; end; $$;
        create trigger synthetic_verification_rate_failure before insert on ops.complaint_verification_rate_bucket
          for each row execute function app.synthetic_verification_rate_failure();`);
      assert.ok((await call(admin, 'consume_complaint_verification_rate_limit', { p_network_key: networkA, p_draft_key: draftA })).error);
      assert.deepEqual(rows(), []);
    } finally {
      runSql('drop trigger if exists synthetic_verification_rate_failure on ops.complaint_verification_rate_bucket; drop function if exists app.synthetic_verification_rate_failure();');
    }
    configure('expiry', 1, 1);
    assert.equal(await consume(), 'allowed');
    runSql(`update ops.complaint_verification_rate_bucket set window_started_at = clock_timestamp() - interval '58 seconds',
      window_ends_at = clock_timestamp() + interval '2 seconds', updated_at = clock_timestamp() where policy_version = ${literal(version)};`);
    const barrier = `synthetic-verify-rate-${randomUUID()}`;
    const holding = runSqlAsync(`begin; set local application_name = ${literal(barrier)};
      select pg_advisory_xact_lock(hashtextextended('complaint-verification-rate:v1', 0)); select pg_sleep(4); commit;`);
    void holding.catch(() => {});
    let waiting;
    try {
      await waitFor(`select exists (select 1 from pg_stat_activity where application_name = ${literal(barrier)} and wait_event = 'PgSleep');`);
      waiting = consume(); void waiting.catch(() => {});
      await waitFor(`select exists (select 1 from pg_stat_activity where wait_event = 'advisory'
        and query like '%consume_complaint_verification_rate_limit%' and pid <> pg_backend_pid());`);
      assert.equal(runSql(`select bool_and(window_ends_at > clock_timestamp()) from ops.complaint_verification_rate_bucket
        where policy_version = ${literal(version)};`), 't');
      assert.equal(await waiting, 'allowed'); assert.ok(rows().every((row) => row.request_count === 1));
    } finally { await holding; if (waiting) await waiting; }
    before = rows(); const signature = tableSignature();
    runSql(readFileSync(new URL('../supabase/migrations/20261022130000_complaint_verification_boundary.sql', import.meta.url), 'utf8'));
    assert.equal(tableSignature(), signature); assert.deepEqual(rows(), before);
    runSql(`delete from ops.complaint_verification_rate_bucket where policy_version in (${[...versions].map(literal).join(',')});`);
    configure('expired'); assert.equal(await consume(), 'allowed'); const expiredVersion = version;
    runSql(`update ops.complaint_verification_rate_bucket set window_started_at = window_started_at - interval '61 seconds',
      window_ends_at = window_ends_at - interval '61 seconds', updated_at = updated_at - interval '61 seconds' where policy_version = ${literal(version)};`);
    configure('fresh'); assert.equal(await consume(networkB, draftB), 'allowed'); before = rows();
    let cleanup = await call(admin, 'expire_complaint_verification_rate_buckets', { p_limit: 1 });
    assert.equal(cleanup.error, null); assert.equal(cleanup.data, 1);
    assert.equal(runSql(`select count(*) from ops.complaint_verification_rate_bucket where policy_version = ${literal(expiredVersion)};`), '2');
    cleanup = await call(admin, 'expire_complaint_verification_rate_buckets', { p_limit: 100 });
    assert.equal(cleanup.error, null); assert.equal(cleanup.data, 2); assert.deepEqual(rows(), before);
    for (const invalid of [0, 101, null]) assert.ok((await call(admin, 'expire_complaint_verification_rate_buckets', { p_limit: invalid })).error);
    for (const name of ['api.consume_complaint_verification_rate_limit(text,text)', 'api.expire_complaint_verification_rate_buckets(integer)']) {
      assert.equal(runSql(`select has_function_privilege('anon', ${literal(name)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('authenticated', ${literal(name)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('service_role', ${literal(name)}, 'EXECUTE')::text;`), 'false:false:true');
      assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(name)}::regprocedure and prosecdef
        and proconfig @> array['search_path=""','lock_timeout=5s'];`), '1');
    }
    assert.equal(runSql(`select count(*) from pg_class where oid = 'ops.complaint_verification_rate_bucket'::regclass
      and relrowsecurity and relforcerowsecurity;`), '1');
    assert.equal(runSql(`select count(*) from information_schema.role_table_grants where table_schema = 'ops'
      and table_name in ('security_policy','complaint_verification_rate_bucket') and grantee in ('anon','authenticated','service_role');`), '0');
    assert.equal(runSql('select count(*) from ops.complaint_rate_bucket;'), '0', 'Verification changed preparation budgets.');
  } finally {
    runSql(`drop trigger if exists synthetic_verification_rate_failure on ops.complaint_verification_rate_bucket;
      drop function if exists app.synthetic_verification_rate_failure();
      update ops.security_policy set ${fields.map((field) => `${field} = ${original[field] === null ? 'null' : literal(original[field])}`).join(',')} where singleton;
      ${versions.size ? `delete from ops.complaint_verification_rate_bucket where policy_version in (${[...versions].map(literal).join(',')});` : ''}`);
  }
}
