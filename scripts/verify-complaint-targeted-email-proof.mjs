import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable local My Trips fixture only; no public endpoint or real mailbox/provider.
export async function verifyComplaintTargetedEmailProof({ admin, anonymous, clients, churchId, identities, runSql, runSqlAsync }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const token = () => randomBytes(32).toString('hex'), keys = [];
  const call = async (client, name, args) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  const prepare = async () => {
    const input = { p_target_type: 'church', p_target_id: churchId, p_reporter_account_id: null,
      p_category: 'incorrect_information', p_description: 'Synthetic target-bound mailbox proof.',
      p_reply_email: 'target-proof@example.test', p_language: 'en', p_client_key: randomUUID(),
      p_resume_token: token(), p_email_token: token() };
    keys.push(input.p_client_key);
    const result = await call(admin, 'prepare_complaint_email_draft', input); assert.equal(result.error, null);
    return { input, id: result.data.draft_id };
  };
  const verify = async (id, proof) => {
    const result = await call(admin, 'verify_complaint_email_draft_v2', { p_draft_id: id, p_email_token: proof });
    assert.equal(result.error, null); return result.data;
  };
  const row = (id) => JSON.parse(runSql(`select to_jsonb(draft) from private.complaint_email_draft as draft where id = ${literal(id)}::uuid;`));
  const identitySnapshot = () => runSql(`select md5(jsonb_agg(jsonb_build_object('account', to_jsonb(account),
    'contact', to_jsonb(contact)) order by account.id)::text)
    from app.account as account join private.account_contact as contact on contact.account_id = account.id
    where account.id in (${identities.map(({ id }) => `${literal(id)}::uuid`).join(',')});`);
  const wait = async (condition) => {
    const deadline = performance.now() + 4500;
    while (performance.now() < deadline) {
      if (runSql(`select (${condition});`) === 't') return;
      await delay(10);
    }
    throw new Error('Targeted complaint proof lock barrier was not observed.');
  };
  try {
    const identityBefore = identitySnapshot();
    const a = await prepare(), lease = randomUUID();
    const claimed = await call(admin, 'complaint_proof_mail_claim', { p_lease_token: lease });
    assert.equal(claimed.error, null); assert.equal(claimed.data.draft_id, a.id);
    const proof = claimed.data.email_token, b = await prepare();
    const before = [row(a.id), row(b.id)];
    for (const client of [anonymous, clients[0], clients[4]]) {
      assert.ok((await call(client, 'verify_complaint_email_draft_v2', { p_draft_id: a.id, p_email_token: proof })).error);
    }
    for (const [id, invalid] of [[b.id, proof], [null, proof], [randomUUID(), proof], [a.id, a.input.p_email_token],
      [a.id, a.input.p_resume_token], [a.id, null], [a.id, 'malformed'], [a.id, token()]]) {
      assert.equal(await verify(id, invalid), null);
    }
    assert.deepEqual([row(a.id), row(b.id)], before, 'Mismatched target/proof must mutate neither draft or mail lease.');
    runSql(`begin; select api.verify_complaint_email_draft_v2(${literal(a.id)}::uuid, ${literal(proof)});
      do $assert$ begin if not exists (select 1 from private.complaint_email_draft
        where id = ${literal(a.id)}::uuid and state = 'email_verified') then raise exception 'Targeted verification did not run.'; end if; end; $assert$;
      rollback;`);
    assert.deepEqual(row(a.id), before[0]);
    const winners = await Promise.all([verify(a.id, proof), verify(a.id, proof)]);
    assert.deepEqual(winners[0], winners[1]); assert.equal(winners[0].status, 'email_verified');
    assert.deepEqual(Object.keys(winners[0]).sort(), ['draft_id', 'expires_at', 'status']);
    const verified = row(a.id);
    const legacy = await call(admin, 'verify_complaint_email_draft', { p_email_token: proof });
    assert.equal(legacy.error, null); assert.deepEqual(legacy.data, winners[0]);
    assert.equal(row(a.id).verified_at, verified.verified_at);
    const completion = await call(admin, 'complaint_proof_mail_complete', {
      p_job_id: claimed.data.job_id, p_lease_token: lease, p_outcome: 'temporary_failure',
    });
    assert.equal(completion.error, null); assert.equal(completion.data, true); assert.equal(row(a.id).mail_state, 'closed');
    assert.deepEqual(row(b.id), before[1]);

    for (const mode of ['expiry', 'rotation']) {
      const fixture = await prepare(), replacement = token(), marker = `target-proof-${randomUUID()}`;
      const change = mode === 'expiry' ? "expires_at = clock_timestamp() + interval '300 milliseconds'"
        : `email_token_hash = encode(extensions.digest(convert_to(${literal(replacement)}, 'UTF8'), 'sha256'), 'hex')`;
      const holder = runSqlAsync(`begin; set local application_name = ${literal(marker)};
        update private.complaint_email_draft set ${change} where id = ${literal(fixture.id)}::uuid;
        select pg_sleep(4); commit;`);
      void holder.catch(() => {}); // Join and rethrow below, never an unhandled fixture rejection.
      let pending;
      try {
        await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(marker)} and wait_event = 'PgSleep')`);
        pending = verify(fixture.id, fixture.input.p_email_token);
        void pending.catch(() => {});
        await wait(`exists (select 1 from pg_stat_activity where wait_event_type = 'Lock'
          and query like '%verify_complaint_email_draft_v2%')`);
        const result = await pending;
        if (mode === 'expiry') {
          assert.equal(result.status, 'expired'); assert.equal(row(fixture.id).verified_at, null);
          assert.equal(row(fixture.id).reply_email, null);
        } else {
          assert.equal(result, null); assert.equal(row(fixture.id).state, 'pending_email');
          assert.equal((await verify(fixture.id, replacement)).status, 'email_verified');
        }
      } finally { await holder; if (pending) await pending; }
    }
    assert.equal(identitySnapshot(), identityBefore);
    for (const signature of ['api.verify_complaint_email_draft(text)', 'api.verify_complaint_email_draft_v2(uuid,text)']) {
      assert.equal(runSql(`select has_function_privilege('anon', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('authenticated', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('service_role', ${literal(signature)}, 'EXECUTE')::text;`), 'false:false:true');
      assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(signature)}::regprocedure and prosecdef
        and proconfig @> array['search_path=""','lock_timeout=5s'];`), '1');
    }
    const definitions = () => runSql(`select md5(string_agg(pg_get_functiondef(routine.oid) || coalesce(routine.proacl::text, ''), '|' order by routine.oid))
      from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname in ('api', 'app') and routine.prokind = 'f';`);
    const beforeReplay = definitions();
    runSql(readFileSync(new URL('../supabase/migrations/20261022120000_complaint_targeted_email_proof.sql', import.meta.url), 'utf8'));
    assert.equal(definitions(), beforeReplay);
    process.stdout.write('Targeted complaint mailbox proof: exact target/proof refusal, real mail-token rotation, rollback/concurrency, post-lock expiry/rotation, legacy/grants/replay and unchanged identity.\n');
  } finally {
    if (keys.length) runSql(`delete from private.complaint_email_draft where client_key in (${keys.map(literal).join(',')});`);
  }
}
