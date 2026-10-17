import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Runs after exact draft-fixture cleanup, solely inside the existing local-container suite.
export async function verifyComplaintProofMail({ admin, anonymous, clients, churchId, runSql }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const token = () => randomBytes(32).toString('hex');
  const keys = [];
  const call = async (client, name, args) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  const row = (id) => JSON.parse(runSql(`select to_jsonb(draft) from private.complaint_email_draft as draft where id = ${literal(id)}::uuid;`));
  const prepare = async () => {
    const input = { p_target_type: 'church', p_target_id: churchId, p_reporter_account_id: null,
      p_category: 'incorrect_information', p_description: 'Synthetic mail-only complaint input.',
      p_reply_email: 'synthetic-proof@example.test', p_language: 'en', p_client_key: randomUUID(),
      p_resume_token: token(), p_email_token: token() };
    keys.push(input.p_client_key);
    const result = await call(admin, 'prepare_complaint_email_draft', input);
    assert.equal(result.error, null);
    return { input, receipt: result.data };
  };
  const claim = async (lease = randomUUID()) => {
    const result = await call(admin, 'complaint_proof_mail_claim', { p_lease_token: lease });
    assert.equal(result.error, null);
    return { lease, data: result.data };
  };
  const complete = async (job, lease, outcome) => {
    const result = await call(admin, 'complaint_proof_mail_complete', { p_job_id: job, p_lease_token: lease, p_outcome: outcome });
    assert.equal(result.error, null);
    return result.data;
  };
  const verify = async (proof) => {
    const result = await call(admin, 'verify_complaint_email_draft', { p_email_token: proof });
    assert.equal(result.error, null);
    return result.data;
  };
  const due = (id) => runSql(`update private.complaint_email_draft set mail_next_at = clock_timestamp() - interval '1 second'
    where id = ${literal(id)}::uuid;`);
  try {
    for (const client of [anonymous, clients[0]]) for (const [name, args] of [
      ['complaint_proof_mail_claim', { p_lease_token: randomUUID() }],
      ['complaint_proof_mail_complete', { p_job_id: randomUUID(), p_lease_token: randomUUID(), p_outcome: 'sent' }],
    ]) assert.ok((await call(client, name, args)).error);
    assert.equal((await claim(null)).data, null);
    const fixture = await prepare();
    const [a, b] = await Promise.all([claim(), claim()]);
    const first = a.data ? a : b;
    assert.equal([a, b].filter((item) => item.data !== null).length, 1);
    assert.equal(first.data.draft_id, fixture.receipt.draft_id);
    assert.equal(first.data.destination_email, fixture.input.p_reply_email);
    assert.equal(first.data.attempt_count, 1);
    assert.deepEqual(Object.keys(first.data).sort(), ['draft_id', 'job_id', 'attempt_count', 'destination_email',
      'language', 'email_token', 'expires_at', 'lease_until'].sort());
    assert.match(first.data.email_token, /^[0-9a-f]{64}$/);
    assert.notEqual(first.data.email_token, fixture.input.p_email_token);
    assert.equal(await verify(fixture.input.p_email_token), null);
    assert.equal(await verify(fixture.input.p_resume_token), null);
    assert.equal(JSON.stringify(row(fixture.receipt.draft_id)).includes(first.data.email_token), false);
    assert.equal(await complete(first.data.job_id, randomUUID(), 'sent'), false);
    assert.equal(await complete(first.data.job_id, first.lease, 'invalid'), false);
    assert.equal(await complete(first.data.job_id, first.lease, 'temporary_failure'), true);
    assert.equal(await complete(first.data.job_id, first.lease, 'sent'), false);
    assert.equal((await claim()).data, null, 'Backoff must prevent immediate retry.');
    const retryPrepare = await call(admin, 'prepare_complaint_email_draft', fixture.input);
    assert.equal(retryPrepare.error, null);
    assert.deepEqual(retryPrepare.data, fixture.receipt, 'Token rotation must not break original prepare retries.');
    due(fixture.receipt.draft_id);
    const second = await claim();
    assert.equal(second.data.attempt_count, 2);
    assert.notEqual(second.data.email_token, first.data.email_token);
    assert.notEqual(second.data.job_id, first.data.job_id);
    assert.equal(await verify(first.data.email_token), null);
    assert.equal(await complete(first.data.job_id, first.lease, 'sent'), false);
    assert.equal((await verify(second.data.email_token)).status, 'email_verified');
    assert.equal(await complete(second.data.job_id, second.lease, 'sent'), true);
    assert.equal(row(fixture.receipt.draft_id).mail_state, 'closed');
    assert.equal((await claim()).data, null);

    const retry = await prepare();
    const acceptedDelivery = await claim();
    assert.equal(await complete(acceptedDelivery.data.job_id, acceptedDelivery.lease, 'sent'), true);
    assert.equal(row(retry.receipt.draft_id).mail_state, 'sent');
    assert.equal(row(retry.receipt.draft_id).state, 'pending_email', 'Mail acceptance is not mailbox proof.');
    assert.equal((await claim()).data, null);
    const rejectedDelivery = await prepare();
    const rejectedLease = await claim();
    assert.equal(await complete(rejectedLease.data.job_id, rejectedLease.lease, 'permanent_failure'), true);
    assert.equal(row(rejectedDelivery.receipt.draft_id).mail_state, 'failed');
    assert.equal(row(rejectedDelivery.receipt.draft_id).state, 'pending_email');
    assert.equal((await claim()).data, null);

    const abandoned = await prepare();
    const beforeRollback = row(abandoned.receipt.draft_id);
    runSql(`begin; select api.complaint_proof_mail_claim(${literal(randomUUID())}::uuid); rollback;`);
    assert.deepEqual(row(abandoned.receipt.draft_id), beforeRollback);
    let current = await claim();
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      runSql(`update private.complaint_email_draft set mail_lease_until = clock_timestamp() - interval '1 second'
        where id = ${literal(abandoned.receipt.draft_id)}::uuid;`);
      assert.equal(await complete(current.data.job_id, current.lease, 'sent'), false);
      const previous = current;
      current = await claim();
      assert.equal(current.data.attempt_count, attempt);
      assert.notEqual(current.data.email_token, previous.data.email_token);
      assert.equal(await verify(previous.data.email_token), null);
    }
    runSql(`update private.complaint_email_draft set mail_lease_until = clock_timestamp() - interval '1 second'
      where id = ${literal(abandoned.receipt.draft_id)}::uuid;`);
    assert.equal((await claim()).data, null);
    assert.equal(row(abandoned.receipt.draft_id).mail_state, 'failed');
    assert.equal(row(abandoned.receipt.draft_id).mail_job_id, null);
    assert.equal(await complete(current.data.job_id, current.lease, 'sent'), false);
    // Delivery outcome is not mailbox proof, and an unknown final acknowledgement must not revoke a delivered link.
    assert.equal(row(abandoned.receipt.draft_id).state, 'pending_email');
    assert.equal((await verify(current.data.email_token)).status, 'email_verified');

    const expiry = await prepare();
    const expiring = await claim();
    runSql(`update private.complaint_email_draft set created_at = created_at - interval '16 minutes',
      expires_at = expires_at - interval '16 minutes' where id = ${literal(expiry.receipt.draft_id)}::uuid;`);
    assert.equal(await complete(expiring.data.job_id, expiring.lease, 'sent'), false);
    const cleared = row(expiry.receipt.draft_id);
    assert.equal(cleared.state, 'expired');
    assert.equal(cleared.mail_state, 'closed');
    for (const field of ['description', 'reply_email', 'email_token_hash', 'resume_hash', 'mail_job_id',
      'mail_lease_hash', 'mail_lease_until']) assert.equal(cleared[field], null);
    assert.equal((await claim()).data, null);
    for (const signature of ['api.complaint_proof_mail_claim(uuid)', 'api.complaint_proof_mail_complete(uuid,uuid,text)']) {
      assert.equal(runSql(`select has_function_privilege('anon', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('authenticated', ${literal(signature)}, 'EXECUTE')::text || ':' ||
        has_function_privilege('service_role', ${literal(signature)}, 'EXECUTE')::text;`), 'false:false:true');
      assert.equal(runSql(`select count(*) from pg_proc where oid = ${literal(signature)}::regprocedure
        and prosecdef and proconfig @> array['search_path=""','lock_timeout=5s'];`), '1');
    }
  } finally {
    if (keys.length) runSql(`delete from private.complaint_email_draft where client_key in (${keys.map(literal).join(',')});`);
  }
}
