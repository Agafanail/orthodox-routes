import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function verifyChurchOwnerInviteCancellation({ sql, asyncSql, asOperator, literal, ids,
  execute, executeSql, expectRefusal, transportDigest, definitions, otherRole, waitForDatabaseCondition }) {
  const reference = 'SYNTHETIC-INVITE-REVIEW';
  const prepareSql = (id) => `select ops.prepare_church_invite_cancellation(${literal(ids.churchPublic)}::uuid,
    ${literal(id)}::uuid, ${literal(reference)});`;
  const prepare = (id) => JSON.parse(sql(asOperator(prepareSql(id))));
  const member = sql(`select id from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid
    and account_id = ${literal(ids.passenger)}::uuid and status = 'active';`);
  const beforeTransport = transportDigest();
  const beforeChurch = sql(`select to_jsonb(church) from app.church where id = ${literal(ids.church)}::uuid;`);
  const beforeMembers = () => sql(`select jsonb_agg(to_jsonb(member) order by member.id)
    from app.church_admin_membership as member where church_id = ${literal(ids.church)}::uuid;`);
  const originalMembers = beforeMembers();
  const createInvite = (transfer = false) => {
    const id = randomUUID(); const publicId = randomUUID(); const token = randomBytes(32).toString('hex');
    sql(`insert into app.church_admin_invite(id, public_id, church_id, sender_account_id, transfer_membership_id,
      invite_email, token_hash, issued_at, expires_at) values (${literal(id)}::uuid, ${literal(publicId)}::uuid,
      ${literal(ids.church)}::uuid, ${literal(ids.passenger)}::uuid, ${transfer ? `${literal(member)}::uuid` : 'null'},
      ${literal(transfer ? `owner-driver-${ids.church}@example.test` : `owner-cancel-${id}@example.test`)},
      ${literal(createHash('sha256').update(token).digest('hex'))}, now(), now() + interval '7 days');
      insert into private.church_invite_mail(invite_id, token_value)
        values (${literal(id)}::uuid, ${literal(token)});`);
    return { id, publicId, token };
  };
  const state = (invitation) => sql(`select state from app.church_admin_invite where id = ${literal(invitation.id)}::uuid;`);
  // Parent cleanup owns this exact synthetic church, including FK-referenced invitations.
  for (const denied of ['anon', 'authenticated', 'service_role']) {
    sql(`set role ${denied}; ${prepareSql(randomUUID())}`, '42501');
    sql(`set role ${denied}; select ops.apply_church_invite_cancellation(${literal(randomUUID())}::uuid);`, '42501');
  }
  sql(asOperator(`select ops.apply_church_invite_cancellation(${literal(randomUUID())}::uuid);`), '42501');
  sql(asOperator(prepareSql(randomUUID())), 'PT409');
  const invitation = createInvite(); const untouched = createInvite();
  const untouchedDigest = sql(`select to_jsonb(mail) from private.church_invite_mail as mail where invite_id = ${literal(untouched.id)}::uuid;`);
  const prepared = prepare(invitation.publicId);
  assert.equal(prepared.preview.invite_id, invitation.publicId);
  assert.equal(prepared.operation_type, 'cancel_church_invite');
  for (const forbidden of [invitation.id, invitation.token, ids.passenger, ids.driver, '@', 'pending_invite_ids']) {
    assert.equal(JSON.stringify(prepared.preview).includes(forbidden), false);
  }
  expectRefusal(prepared, 'f'.repeat(64));
  sql(asOperator(executeSql(prepared), otherRole), '42501');
  const expired = prepare(invitation.publicId);
  sql(`update ops.owner_operation set prepared_at = now() - interval '16 minutes', expires_at = now() - interval '1 minute'
    where id = ${literal(expired.operation_id)}::uuid;`);
  expectRefusal(expired);
  const failing = prepare(invitation.publicId); const failedStatement = executeSql(failing);
  try {
    sql(`create function app.synthetic_owner_invite_failure() returns trigger language plpgsql as $$ begin
      if new.id = ${literal(failing.operation_id)}::uuid then raise exception 'Synthetic private invite failure'; end if;
      return new; end; $$;
      create trigger synthetic_owner_invite_failure before update on ops.owner_operation
        for each row execute function app.synthetic_owner_invite_failure();`);
    assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
    assert.equal(state(invitation), 'pending');
    assert.equal(sql(`select token_value from private.church_invite_mail where invite_id = ${literal(invitation.id)}::uuid;`), invitation.token);
    assert.equal(sql(`select count(*) from ops.audit_event where event_key = ${literal(`owner-operation:${failing.operation_id}`)};`), '0');
  } finally {
    sql('drop trigger if exists synthetic_owner_invite_failure on ops.owner_operation; drop function if exists app.synthetic_owner_invite_failure();');
  }
  assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
  const lease = randomUUID(); const job = sql(`update private.church_invite_mail set state = 'claimed',
    lease_token = ${literal(lease)}::uuid, lease_until = now() + interval '1 minute', attempt_count = 1
    where invite_id = ${literal(invitation.id)}::uuid returning dispatch_id;`);
  const operation = prepare(invitation.publicId); const result = execute(operation);
  assert.equal(result.status, 'cancelled'); assert.equal(result.invite_id, invitation.publicId);
  assert.equal(state(invitation), 'cancelled');
  assert.equal(sql(`select state = 'cancelled' and token_value = repeat('0',64) and lease_token is null
    and lease_until is null from private.church_invite_mail where invite_id = ${literal(invitation.id)}::uuid;`), 't');
  assert.equal(sql(`set role service_role; select api.church_invite_worker_complete(${literal(job)}::uuid,
    ${literal(lease)}::uuid, 'sent', 'synthetic-provider-reference');`), 'f');
  assert.deepEqual(execute(operation), result);
  expectRefusal(prepared);
  sql(asOperator(prepareSql(invitation.publicId)), 'PT409');
  assert.equal(state(untouched), 'pending');
  assert.equal(sql(`select to_jsonb(mail) from private.church_invite_mail as mail where invite_id = ${literal(untouched.id)}::uuid;`), untouchedDigest);
  const audit = JSON.parse(sql(`select to_jsonb(event) from ops.audit_event as event
    where event_key = ${literal(`owner-operation:${operation.operation_id}`)};`));
  assert.equal(audit.action_type, 'invite.cancelled'); assert.equal(audit.reason_code, 'reviewed_invite_cancellation');
  assert.equal(audit.actor_kind, 'operator'); assert.deepEqual(audit.changed_fields, ['administrator_invitation']);
  for (const value of [invitation.token, invitation.publicId, ids.passenger, '@']) assert.equal(JSON.stringify(audit).includes(value), false);
  assert.equal(beforeMembers(), originalMembers);
  // Free the ordinary reservation before testing a same-seat transfer against real authenticated acceptance.
  execute(prepare(untouched.publicId));
  const transfer = createInvite(true);
  const cancellation = prepare(transfer.publicId); const cancellationStatement = executeSql(cancellation);
  const gateName = `owner-invite-gate-${transfer.id}`;
  const gate = asyncSql(`set application_name = ${literal(gateName)}; begin;
    select pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || ${literal(ids.church)}::text, 0));
    select pg_sleep(4); commit;`);
  const contenders = []; let results;
  try {
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(gateName)} and wait_event = 'PgSleep')`);
    contenders.push(asyncSql(asOperator(`set application_name = ${literal(`${gateName}-cancel`)}; ${cancellationStatement}`)));
    contenders.push(asyncSql(`set application_name = ${literal(`${gateName}-accept`)};
      select set_config('request.jwt.claim.sub', ${literal(ids.driver)}, false); set role authenticated;
      select api.accept_church_admin_invite(${literal(transfer.publicId)}::uuid, ${literal(transfer.token)});`));
    await waitForDatabaseCondition(`(select count(*) from pg_stat_activity where application_name in
      (${literal(`${gateName}-cancel`)}, ${literal(`${gateName}-accept`)}) and wait_event = 'advisory') = 2`);
    results = await Promise.all(contenders); assert.equal((await gate).code, 0);
  } finally { await Promise.all([gate, ...contenders]); }
  assert.equal(results[0].code, 0);
  const cancelResult = JSON.parse(results[0].stdout);
  if (state(transfer) === 'accepted') {
    assert.equal(cancelResult.execution_result, 'refused'); assert.equal(results[1].code, 0);
  } else {
    assert.equal(state(transfer), 'cancelled'); assert.equal(cancelResult.status, 'cancelled');
    assert.notEqual(results[1].code, 0); assert.equal(results[1].state, '42501');
    assert.equal(beforeMembers(), originalMembers);
  }
  assert.equal(transportDigest(), beforeTransport);
  assert.equal(sql(`select to_jsonb(church) from app.church where id = ${literal(ids.church)}::uuid;`), beforeChurch);
  // Every actual versioned extension must remain intact when earlier checkpoints are reapplied.
  const snapshot = definitions();
  for (const file of ['20261019110000_church_owner_invite_cancellation.sql',
    '20261019100000_church_admin_removal.sql', '20261017060000_church_owner_hiding.sql']) {
    sql(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  assert.equal(definitions(), snapshot);
  assert.deepEqual(execute(operation), result);
  process.stdout.write('Reviewed invitation cancellation verified: exact scope, token/lease revocation, rollback, actual acceptance race, and replay.\n');
}
