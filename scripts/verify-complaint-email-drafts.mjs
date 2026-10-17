import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Called only by the existing local-container My Trips fixture; no remote configuration entry point.
export async function verifyComplaintEmailDrafts({ admin, anonymous, clients, identities, churchId, agreementId,
  nearDeadlineAgreementId, runSql, runSqlAsync }) {
  const token = () => randomBytes(32).toString('hex');
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const clientKeys = new Set();
  const request = (overrides = {}) => {
    const input = {
      p_target_type: 'church', p_target_id: churchId, p_reporter_account_id: null,
      p_category: 'incorrect_information', p_description: 'Synthetic private complaint\nSecond line.',
      p_reply_email: 'SYNTHETIC-COMPLAINT@EXAMPLE.TEST', p_language: 'en',
      p_client_key: randomUUID(), p_resume_token: token(), p_email_token: token(), ...overrides,
    };
    clientKeys.add(input.p_client_key);
    return input;
  };
  const call = async (client, name, args) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  const prepare = async (input) => {
    const result = await call(admin, 'prepare_complaint_email_draft', input);
    assert.equal(result.error, null);
    return result.data;
  };
  const row = (id) => JSON.parse(runSql(`select to_jsonb(draft) from private.complaint_email_draft as draft where id = ${literal(id)}::uuid;`));
  const verify = async (proof) => {
    const result = await call(admin, 'verify_complaint_email_draft', { p_email_token: proof });
    assert.equal(result.error, null);
    return result.data;
  };
  try {
    const accountProof = () => runSql(`select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object(
      'account', to_jsonb(account), 'contact', to_jsonb(contact)) order by account.id)::text, 'UTF8'), 'sha256'), 'hex')
      from app.account as account join private.account_contact as contact on contact.account_id = account.id
      where account.id in (${identities.map((identity) => `${literal(identity.id)}::uuid`).join(',')});`);
    const accountProofBefore = accountProof();
    const input = request();
    for (const client of [anonymous, clients[0], clients[4]]) {
      for (const [name, args] of [
        ['prepare_complaint_email_draft', input],
        ['verify_complaint_email_draft', { p_email_token: input.p_email_token }],
        ['expire_complaint_email_drafts', { p_limit: 1 }],
      ]) assert.ok((await call(client, name, args)).error);
    }
    for (const overrides of [
      { p_resume_token: null }, { p_email_token: null }, { p_email_token: input.p_resume_token },
      { p_client_key: null }, { p_language: 'unsupported' }, { p_reply_email: 'not-an-email' },
      { p_reply_email: 'invalid\u0001@example.test' }, { p_description: '\n\r ' },
      { p_description: 'x'.repeat(4001) }, { p_description: 'private\u0001text' },
      { p_category: 'no_show' }, { p_target_id: randomUUID() }, { p_reporter_account_id: randomUUID() },
      { p_target_type: 'ride_agreement', p_target_id: agreementId, p_category: 'no_show' },
      { p_target_type: 'ride_agreement', p_target_id: agreementId, p_category: 'no_show', p_reporter_account_id: identities[4].id },
    ]) {
      const invalidInput = { ...input, ...overrides };
      const result = await call(admin, 'prepare_complaint_email_draft', invalidInput);
      assert.ok(result.error);
      assert.equal(JSON.stringify(result.error).includes(input.p_description), false);
      assert.equal(JSON.stringify(result.error).includes(input.p_reply_email), false);
    }
    const concurrent = await Promise.all([1, 2].map(() => call(admin, 'prepare_complaint_email_draft', input)));
    assert.equal(concurrent[0].error, null);
    assert.equal(concurrent[1].error, null);
    const prepared = concurrent[0].data;
    assert.deepEqual(concurrent[1].data, prepared);
    assert.deepEqual(Object.keys(prepared).sort(), ['draft_id', 'expires_at', 'status']);
    assert.equal(prepared.status, 'pending_email');
    const stored = row(prepared.draft_id);
    assert.equal(stored.reply_email, input.p_reply_email.toLowerCase());
    assert.equal(stored.description, input.p_description);
    assert.equal(new Date(stored.expires_at).getTime() - new Date(stored.created_at).getTime(), 900_000);
    for (const clearToken of [input.p_resume_token, input.p_email_token]) {
      assert.equal(JSON.stringify(stored).includes(clearToken), false);
      assert.equal(JSON.stringify(prepared).includes(clearToken), false);
    }
    for (const overrides of [{ p_description: 'Different private input' }, { p_reply_email: 'other@example.test' },
      { p_resume_token: token() }, { p_email_token: token() }, { p_reporter_account_id: identities[0].id }]) {
      assert.ok((await call(admin, 'prepare_complaint_email_draft', { ...input, ...overrides })).error);
    }
    assert.equal(await verify(input.p_resume_token), null, 'A pre-email resume secret must not prove mailbox ownership.');
    assert.equal(await verify(token()), null);
    assert.equal(await verify(null), null);
    assert.equal(row(prepared.draft_id).state, 'pending_email');
    runSql(`begin; select api.verify_complaint_email_draft(${literal(input.p_email_token)});
      do $assert$ begin
        if not exists (select 1 from private.complaint_email_draft where id = ${literal(prepared.draft_id)}::uuid
          and state = 'email_verified' and verified_at is not null) then raise exception 'Draft proof was not updated.'; end if;
      end; $assert$; rollback;`);
    assert.equal(row(prepared.draft_id).state, 'pending_email');
    assert.equal(row(prepared.draft_id).verified_at, null);
    const verifiedConcurrently = await Promise.all([1, 2].map(() => verify(input.p_email_token)));
    const verified = verifiedConcurrently[0];
    assert.deepEqual(verifiedConcurrently[1], verified);
    assert.equal(verified.status, 'email_verified');
    const verifiedRow = row(prepared.draft_id);
    assert.ok(verifiedRow.verified_at);
    assert.deepEqual(await verify(input.p_email_token), verified);
    assert.equal(row(prepared.draft_id).verified_at, verifiedRow.verified_at);
    assert.deepEqual(await prepare(input), verified);
    assert.equal(runSql(`select count(*) from ops.audit_event where target_id = ${literal(prepared.draft_id)}::uuid;`), '0');

    const boundaryInput = request();
    const boundary = await prepare(boundaryInput);
    runSql(`begin;
      do $assert$ declare deadline timestamptz; begin
        select expires_at into strict deadline from private.complaint_email_draft where id = ${literal(boundary.draft_id)}::uuid;
        if app.expire_complaint_email_draft(${literal(boundary.draft_id)}::uuid, deadline - interval '1 microsecond') then
          raise exception 'A live draft expired before its deadline.'; end if;
        if not app.expire_complaint_email_draft(${literal(boundary.draft_id)}::uuid, deadline) then
          raise exception 'A draft did not expire at its exact deadline.'; end if;
      end; $assert$; rollback;`);
    assert.equal(row(boundary.draft_id).state, 'pending_email');
    const lockName = `complaint-draft-${randomUUID()}`;
    const holdingLock = runSqlAsync(`begin; set local application_name = ${literal(lockName)};
      update private.complaint_email_draft set expires_at = clock_timestamp() + interval '300 milliseconds'
        where id = ${literal(boundary.draft_id)}::uuid;
      select pg_sleep(2); commit;`);
    // Observe the lock holder before starting the request; do not depend on network timing.
    try {
      let locked = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        locked = runSql(`select exists (select 1 from pg_stat_activity
          where application_name = ${literal(lockName)} and wait_event = 'PgSleep');`) === 't';
        if (locked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(locked, 'The concurrent expiry fixture must hold the draft row.');
      assert.equal((await verify(boundaryInput.p_email_token)).status, 'expired',
        'Verification must evaluate expiry after acquiring the row lock.');
    } finally { await holdingLock; }
    assert.equal(row(boundary.draft_id).verified_at, null);

    const ownedInput = request({ p_target_type: 'ride_agreement', p_target_id: agreementId,
      p_reporter_account_id: identities[2].id, p_category: 'no_show' });
    const owned = await prepare(ownedInput);
    const ownExport = await call(clients[2], 'export_current_account_data', {});
    assert.equal(ownExport.error, null);
    assert.equal(ownExport.data.complaint_email_drafts.length, 1);
    const ownDraft = ownExport.data.complaint_email_drafts[0];
    assert.equal(ownDraft.draft_id, owned.draft_id);
    assert.equal(ownDraft.reply_email, ownedInput.p_reply_email.toLowerCase());
    assert.equal(ownDraft.description, ownedInput.p_description);
    assert.deepEqual(Object.keys(ownDraft).sort(), ['draft_id', 'target_type', 'target_id', 'category', 'description',
      'reply_email', 'language', 'status', 'created_at', 'expires_at', 'verified_at'].sort());
    const otherExport = await call(clients[4], 'export_current_account_data', {});
    assert.equal(otherExport.error, null);
    assert.deepEqual(otherExport.data.complaint_email_drafts, []);
    assert.equal(JSON.stringify(ownDraft).includes(ownedInput.p_resume_token), false);
    assert.equal(JSON.stringify(ownDraft).includes(ownedInput.p_email_token), false);
    assert.equal(JSON.stringify(ownDraft).includes('hash'), false);

    const nearDeadlineInput = request({ p_target_type: 'ride_agreement', p_target_id: nearDeadlineAgreementId,
      p_reporter_account_id: identities[2].id, p_category: 'no_show' });
    const nearDeadline = await prepare(nearDeadlineInput);
    const bounded = row(nearDeadline.draft_id);
    assert.ok(new Date(bounded.expires_at).getTime() - new Date(bounded.created_at).getTime() < 900_000);
    assert.equal(new Date(bounded.expires_at).getTime(), new Date(runSql(`select snapshot.scheduled_arrival_at + interval '30 days'
      from app.ride_agreement as agreement join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      where agreement.public_id = ${literal(nearDeadlineAgreementId)}::uuid;`)).getTime());
    runSql(`update private.complaint_email_draft set created_at = created_at - interval '6 minutes',
      expires_at = expires_at - interval '6 minutes' where id = ${literal(nearDeadline.draft_id)}::uuid;`);
    assert.equal((await verify(nearDeadlineInput.p_email_token)).status, 'expired');
    assert.equal(row(nearDeadline.draft_id).description, null);

    // A source selected while public remains bound, without copying material into a public receipt.
    runSql(`update app.church set status = 'hidden' where public_id = ${literal(churchId)}::uuid;`);
    try {
      assert.equal((await verify(ownedInput.p_email_token)).status, 'email_verified');
      assert.ok((await call(admin, 'prepare_complaint_email_draft', request())).error);
    } finally { runSql(`update app.church set status = 'published' where public_id = ${literal(churchId)}::uuid;`); }

    const expires = await prepare(request());
    runSql(`update private.complaint_email_draft set created_at = created_at - interval '16 minutes',
      expires_at = expires_at - interval '16 minutes' where id = ${literal(expires.draft_id)}::uuid;`);
    const cleanup = await call(admin, 'expire_complaint_email_drafts', { p_limit: 1 });
    assert.equal(cleanup.error, null);
    assert.equal(cleanup.data, 1);
    const expired = row(expires.draft_id);
    assert.equal(expired.state, 'expired');
    for (const field of ['reporter_account_id', 'target_type', 'target_public_id', 'category', 'description', 'reply_email',
      'language', 'resume_hash', 'email_token_hash', 'input_digest', 'verified_at']) assert.equal(expired[field], null);
    assert.equal((await call(admin, 'expire_complaint_email_drafts', { p_limit: 100 })).data, 0);

    const lazyInput = request();
    const lazy = await prepare(lazyInput);
    runSql(`update private.complaint_email_draft set created_at = created_at - interval '16 minutes',
      expires_at = expires_at - interval '16 minutes' where id = ${literal(lazy.draft_id)}::uuid;`);
    assert.equal((await verify(lazyInput.p_email_token)).status, 'expired');
    assert.equal(await verify(lazyInput.p_email_token), null);
    assert.equal(row(lazy.draft_id).reply_email, null);
    assert.ok((await call(admin, 'prepare_complaint_email_draft', lazyInput)).error);
    assert.equal(row(owned.draft_id).state, 'email_verified', 'Cleanup must not clear unexpired verified drafts.');
    runSql(`update private.complaint_email_draft set created_at = created_at - interval '16 minutes',
      expires_at = expires_at - interval '16 minutes', verified_at = verified_at - interval '16 minutes'
      where id = ${literal(owned.draft_id)}::uuid;`);
    const expiredOwnExport = await call(clients[2], 'export_current_account_data', {});
    assert.equal(expiredOwnExport.error, null);
    assert.deepEqual(expiredOwnExport.data.complaint_email_drafts, []);
    assert.equal((await call(admin, 'expire_complaint_email_drafts', { p_limit: 1 })).data, 1);
    assert.equal(row(owned.draft_id).reply_email, null);
    assert.equal(row(owned.draft_id).verified_at, null);
    assert.equal(await verify(ownedInput.p_email_token), null);
    assert.equal(accountProof(), accountProofBefore, 'Email draft proof must not create or change account identity/contacts.');
    assert.equal(runSql(`select count(*) from information_schema.role_table_grants
      where table_schema = 'private' and table_name = 'complaint_email_draft'
      and grantee in ('anon','authenticated','service_role');`), '0');
    assert.equal(runSql(`select count(*) from pg_class where oid = 'private.complaint_email_draft'::regclass
      and relrowsecurity and relforcerowsecurity;`), '1');
    for (const signature of ['app.resolve_complaint_target(text,uuid,uuid)', 'app.expire_complaint_email_draft(uuid,timestamptz)',
      'app.export_complaint_email_drafts(uuid)']) {
      assert.equal(runSql(`select count(*) from (values ('anon'),('authenticated'),('service_role')) as roles(name)
        where has_function_privilege(roles.name, ${literal(signature)}, 'EXECUTE');`), '0');
    }
    for (const signature of ['api.prepare_complaint_email_draft(text,uuid,uuid,text,text,text,text,uuid,text,text)',
      'api.verify_complaint_email_draft(text)', 'api.expire_complaint_email_drafts(integer)']) {
      assert.equal(runSql(`select has_function_privilege('anon', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('authenticated', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('service_role', ${literal(signature)}, 'EXECUTE')::text;`), 'false:false:true');
      assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(signature)}::regprocedure and prosecdef
        and proconfig @> array['search_path=""','lock_timeout=5s'];`), '1');
    }
  } finally {
    if (clientKeys.size) runSql(`delete from private.complaint_email_draft where client_key in (${[...clientKeys].map(literal).join(',')});`);
  }
}
