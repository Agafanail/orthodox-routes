import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Only the disposable local database fixture invokes this verifier. Policies are synthetic,
// restored exactly, and never constitute approved operational settings or provider verification.
export async function verifyComplaintRateBoundary({ admin, anonymous, clients, runSql, runSqlAsync }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const fields = ['complaint_rate_version', 'complaint_rate_window_seconds', 'complaint_network_limit',
    'complaint_mailbox_limit', 'complaint_global_limit', 'updated_at'];
  const original = JSON.parse(runSql(`select jsonb_build_object(${fields.map((field) => `${literal(field)}, ${field}`).join(',')})
    from ops.security_policy where singleton;`));
  assert.ok(fields.filter((field) => field !== 'updated_at').every((field) => original[field] === null));
  assert.equal(runSql('select count(*) from ops.complaint_rate_bucket;'), '0');
  const stem = `rate-${randomUUID()}`;
  const versions = new Set();
  let version;
  const key = () => randomBytes(32).toString('hex');
  const networkA = key(); const networkB = key(); const mailboxA = key(); const mailboxB = key();
  const call = (client, name, args) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  const consume = async (network, mailbox) => {
    const result = await call(admin, 'consume_complaint_rate_limit', { p_network_key: network, p_mailbox_key: mailbox });
    assert.equal(result.error, null, 'Synthetic complaint rate operation failed.');
    return result.data;
  };
  const configure = (suffix, network = 5, mailbox = 5, global = 20) => {
    version = `${stem}-${suffix}`; versions.add(version);
    runSql(`update ops.security_policy set complaint_rate_version = ${literal(version)},
      complaint_rate_window_seconds = 60, complaint_network_limit = ${network},
      complaint_mailbox_limit = ${mailbox}, complaint_global_limit = ${global}, updated_at = clock_timestamp() where singleton;`);
  };
  const rows = () => JSON.parse(runSql(`select coalesce(jsonb_agg(to_jsonb(bucket) order by scope, rate_key), '[]'::jsonb)
    from ops.complaint_rate_bucket as bucket where policy_version = ${literal(version)};`));
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (runSql(condition) === 't') return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('The synthetic complaint-rate lock barrier was not reached.');
  };
  try {
    assert.equal(await consume(networkA, mailboxA), 'unavailable');
    assert.equal(runSql('select count(*) from ops.complaint_rate_bucket;'), '0');
    for (const client of [anonymous, ...clients]) {
      assert.ok((await call(client, 'consume_complaint_rate_limit', { p_network_key: networkA, p_mailbox_key: mailboxA })).error);
      assert.ok((await call(client, 'expire_complaint_rate_buckets', { p_limit: 1 })).error);
    }
    assert.throws(() => runSql(`begin; update ops.security_policy set complaint_network_limit = 1 where singleton; rollback;`));
    assert.throws(() => runSql(`begin; update ops.security_policy set complaint_rate_version = 'partial' where singleton; rollback;`));
    configure('network', 1);
    for (const assignment of ["complaint_rate_version = 'unsafe version'", 'complaint_rate_window_seconds = 59',
      'complaint_rate_window_seconds = 86401', 'complaint_global_limit = 0', 'complaint_mailbox_limit = null']) {
      assert.throws(() => runSql(`begin; update ops.security_policy set ${assignment} where singleton; rollback;`));
    }
    for (const invalid of [null, '', 'raw@example.test', '192.0.2.1', 'G'.repeat(64), 'a'.repeat(65)]) {
      assert.equal(await consume(invalid, mailboxA), 'unavailable');
      assert.equal(await consume(networkA, invalid), 'unavailable');
    }
    assert.deepEqual(rows(), []);
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    let before = rows();
    assert.equal(before.length, 3);
    assert.equal(await consume(networkA, mailboxB), 'rate_limited');
    assert.deepEqual(rows(), before, 'Network denial partially consumed or created another dimension.');
    assert.equal(await consume(networkB, mailboxA), 'allowed');
    assert.equal(rows().find((row) => row.scope === 'global').request_count, 2);

    configure('mailbox', 5, 1);
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    before = rows();
    assert.equal(await consume(networkB, mailboxA), 'rate_limited');
    assert.deepEqual(rows(), before, 'Mailbox denial partially consumed or created another dimension.');
    assert.equal(await consume(networkA, mailboxB), 'allowed');

    configure('global', 5, 5, 1);
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    before = rows();
    assert.equal(await consume(networkB, mailboxB), 'rate_limited');
    assert.deepEqual(rows(), before, 'Exhausted global budget allowed attacker-shaped key growth.');

    configure('race', 1, 5);
    const concurrent = await Promise.all([consume(networkA, mailboxA), consume(networkA, mailboxB)]);
    assert.deepEqual(concurrent.sort(), ['allowed', 'rate_limited']);
    assert.equal(rows().length, 3);
    assert.ok(rows().every((row) => row.request_count === 1));

    configure('scopes');
    assert.equal(await consume(networkA, networkA), 'allowed');
    assert.equal(rows().length, 3, 'Identical digests collapsed distinct policy dimensions.');

    configure('rollback');
    try {
      runSql(`create function app.synthetic_complaint_rate_failure() returns trigger language plpgsql as $$ begin
        if new.policy_version = ${literal(version)} and new.scope = 'mailbox' then raise exception 'Synthetic late rate failure.'; end if;
        return new; end; $$;
        create trigger synthetic_complaint_rate_failure before insert on ops.complaint_rate_bucket
          for each row execute function app.synthetic_complaint_rate_failure();`);
      assert.ok((await call(admin, 'consume_complaint_rate_limit', { p_network_key: networkA, p_mailbox_key: mailboxA })).error);
      assert.deepEqual(rows(), [], 'Late failure committed a partial multi-dimensional budget.');
    } finally {
      runSql('drop trigger if exists synthetic_complaint_rate_failure on ops.complaint_rate_bucket; drop function if exists app.synthetic_complaint_rate_failure();');
    }

    configure('expiry', 1, 1);
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    runSql(`update ops.complaint_rate_bucket set window_started_at = window_started_at - interval '61 seconds',
      window_ends_at = window_ends_at - interval '61 seconds', updated_at = updated_at - interval '61 seconds'
      where policy_version = ${literal(version)};`);
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    assert.ok(rows().every((row) => row.request_count === 1));
    assert.equal(runSql(`select bool_and(window_ends_at - window_started_at = interval '60 seconds')
      from ops.complaint_rate_bucket where policy_version = ${literal(version)};`), 't');

    // A request arriving before expiry waits behind the real shared lock. It must evaluate the
    // deadline after that wait, not falsely reject from a stale pre-lock database timestamp.
    runSql(`update ops.complaint_rate_bucket set window_started_at = clock_timestamp() - interval '58 seconds',
      window_ends_at = clock_timestamp() + interval '2 seconds', updated_at = clock_timestamp()
      where policy_version = ${literal(version)};`);
    const barrier = `synthetic-rate-${randomUUID()}`;
    const holding = runSqlAsync(`begin; set local application_name = ${literal(barrier)};
      select pg_advisory_xact_lock(hashtextextended('complaint-rate-boundary:v1', 0)); select pg_sleep(4); commit;`);
    void holding.catch(() => {}); // Observe early failures; the original promise is still awaited below.
    let waiting;
    try {
      await waitFor(`select exists (select 1 from pg_stat_activity where application_name = ${literal(barrier)} and wait_event = 'PgSleep');`);
      waiting = consume(networkA, mailboxA);
      void waiting.catch(() => {});
      await waitFor(`select exists (select 1 from pg_stat_activity where wait_event = 'advisory'
        and query like '%consume_complaint_rate_limit%' and pid <> pg_backend_pid());`);
      assert.equal(runSql(`select bool_and(window_ends_at > clock_timestamp()) from ops.complaint_rate_bucket
        where policy_version = ${literal(version)};`), 't', 'The request did not reach the barrier before expiry.');
      assert.equal(await waiting, 'allowed');
    } finally {
      await holding;
      if (waiting) await waiting;
    }

    // Only exact synthetic versions are removed here; the real cleanup itself must be bounded
    // and preserve the deliberately fresh three-row shield.
    runSql(`delete from ops.complaint_rate_bucket where policy_version in (${[...versions].map(literal).join(',')});`);
    configure('expired');
    assert.equal(await consume(networkA, mailboxA), 'allowed');
    const expiredVersion = version;
    runSql(`update ops.complaint_rate_bucket set window_started_at = window_started_at - interval '61 seconds',
      window_ends_at = window_ends_at - interval '61 seconds', updated_at = updated_at - interval '61 seconds'
      where policy_version = ${literal(expiredVersion)};`);
    configure('fresh');
    assert.equal(await consume(networkB, mailboxB), 'allowed');
    const fresh = rows();
    let cleanup = await call(admin, 'expire_complaint_rate_buckets', { p_limit: 1 });
    assert.equal(cleanup.error, null); assert.equal(cleanup.data, 1);
    assert.equal(runSql(`select count(*) from ops.complaint_rate_bucket where policy_version = ${literal(expiredVersion)};`), '2');
    cleanup = await call(admin, 'expire_complaint_rate_buckets', { p_limit: 100 });
    assert.equal(cleanup.error, null); assert.equal(cleanup.data, 2);
    assert.deepEqual(rows(), fresh);
    for (const invalid of [0, 101, null]) assert.ok((await call(admin, 'expire_complaint_rate_buckets', { p_limit: invalid })).error);
    for (const signature of ['api.consume_complaint_rate_limit(text,text)', 'api.expire_complaint_rate_buckets(integer)']) {
      assert.equal(runSql(`select has_function_privilege('anon', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('authenticated', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('service_role', ${literal(signature)}, 'EXECUTE')::text;`), 'false:false:true');
      assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(signature)}::regprocedure and prosecdef
        and proconfig @> array['search_path=""','lock_timeout=5s'];`), '1');
    }
    assert.equal(runSql(`select count(*) from information_schema.role_table_grants where table_schema = 'ops'
      and table_name in ('security_policy','complaint_rate_bucket') and grantee in ('anon','authenticated','service_role');`), '0');
    assert.equal(runSql(`select count(*) from pg_class where oid = 'ops.complaint_rate_bucket'::regclass
      and relrowsecurity and relforcerowsecurity;`), '1');
  } finally {
    runSql(`drop trigger if exists synthetic_complaint_rate_failure on ops.complaint_rate_bucket;
      drop function if exists app.synthetic_complaint_rate_failure();
      update ops.security_policy set ${fields.map((field) => `${field} = ${original[field] === null ? 'null' : literal(original[field])}`).join(',')}
        where singleton;
      ${versions.size ? `delete from ops.complaint_rate_bucket where policy_version in (${[...versions].map(literal).join(',')});` : ''}`);
  }
}
