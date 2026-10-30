import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function verifyChurchCaseReconciliation({ sql, asyncSql, asOperator, literal, ids,
  execute, executeSql, expectRefusal, transportDigest, definitions, otherRole, waitForDatabaseCondition }) {
  // The previous case scenario ends with an archived church and no current seat.
  // Provision one fresh synthetic position, then restore through the real owner protocol.
  const initialMember = randomUUID();
  sql(`insert into app.church_admin_membership(public_id, church_id, account_id, access_source)
    values (${literal(initialMember)}::uuid, ${literal(ids.church)}::uuid, ${literal(ids.passenger)}::uuid, 'protected_repair');`);
  const ordinaryPrepare = (action, reference) => JSON.parse(sql(asOperator(`select ops.prepare_church_lifecycle(
    ${literal(ids.churchPublic)}::uuid, ${literal(action)}, ${literal(reference)},
    ${literal(action === 'restore_church' ? 'reviewed_restoration' : 'reviewed_archival')});`)));
  assert.equal(execute(ordinaryPrepare('restore_church', 'SYNTHETIC-CASE-RESTORE')).status, 'published');
  const incoming = sql(`select public_id from app.account where id = ${literal(ids.replacementAccount)}::uuid;`);
  const sourceCaseOperation = JSON.parse(sql(asOperator(`select ops.prepare_church_administration_replacement(
    ${literal(ids.churchPublic)}::uuid, ${literal(initialMember)}::uuid, ${literal(incoming)}::uuid, 'SYNTHETIC-TRANSFER-CASE');`)));
  const caseId = sourceCaseOperation.preview.administration_case_id;
  const prepareSql = (selectedCase = caseId, reference = 'SYNTHETIC-TRANSFER-CASE', church = ids.churchPublic) =>
    `select ops.prepare_church_case_reconciliation(${literal(church)}::uuid, ${literal(selectedCase)}::uuid, ${literal(reference)});`;
  const prepare = () => JSON.parse(sql(asOperator(prepareSql())));
  for (const denied of ['anon', 'authenticated', 'service_role']) sql(`set role ${denied}; ${prepareSql()}`, '42501');
  for (const routine of [`ops.apply_church_case_reconciliation(${literal(randomUUID())}::uuid)`,
    `ops.church_case_reconciliation_fingerprint(${literal(caseId)}::uuid)`]) sql(asOperator(`select ${routine};`), '42501');
  sql(asOperator(prepareSql()), 'PT409'); // The last position is still occupied.
  sql(asOperator(prepareSql(randomUUID())), 'P0002');
  sql(asOperator(prepareSql(caseId, 'SYNTHETIC-WRONG-REFERENCE')), 'P0002');
  sql(asOperator(prepareSql(caseId, 'SYNTHETIC-TRANSFER-CASE', randomUUID())), 'P0002');
  const asAccount = (id, statement) => JSON.parse(sql(`begin;
    select set_config('request.jwt.claim.sub', ${literal(id)}, true); set local role authenticated;
    select to_jsonb(${statement}); commit;`).split(/\r?\n/).at(-1));
  const incomingEmail = sql(`select email_normalized from private.account_contact where account_id = ${literal(ids.replacementAccount)}::uuid;`);
  const preference = JSON.parse(sql(`select to_jsonb(preference) from private.notification_preference as preference
    where account_id = ${literal(ids.replacementAccount)}::uuid;`));
  let accepted;
  try {
    // Synthetic channel setup only; no provider or preference choice is activated for a real account.
    sql(`update private.notification_preference set ride_email_enabled = true where account_id = ${literal(ids.replacementAccount)}::uuid;`);
    const invitation = asAccount(ids.passenger, `api.invite_church_admin(${literal(ids.churchPublic)}::uuid,
      ${literal(incomingEmail)}, true, ${literal(randomUUID())}::uuid)`);
    const invitationToken = sql(`select mail.token_value from private.church_invite_mail as mail
      join app.church_admin_invite as invite on invite.id = mail.invite_id where invite.public_id = ${literal(invitation.invite_id)}::uuid;`);
    accepted = asAccount(ids.replacementAccount, `api.accept_church_admin_invite(${literal(invitation.invite_id)}::uuid, ${literal(invitationToken)})`);
    assert.equal(accepted.status, 'accepted');
  } finally {
    sql(`update private.notification_preference set ride_email_enabled = ${preference.ride_email_enabled},
      web_push_enabled = ${preference.web_push_enabled}, updated_at = ${literal(preference.updated_at)}::timestamptz
      where account_id = ${literal(ids.replacementAccount)}::uuid;`);
  }
  const state = (id = caseId) => sql(`select state from ops.church_administration_case where id = ${literal(id)}::uuid;`);
  assert.equal(state(), 'replacement_pending');
  assert.equal(sql(`select status from app.church_admin_membership where public_id = ${literal(initialMember)}::uuid;`), 'ended');
  expectRefusal(sourceCaseOperation); // Never claim its earlier protected replacement ran.
  const domainDigest = () => sql(`select md5(jsonb_build_object('church', (select to_jsonb(church) from app.church as church
      where id = ${literal(ids.church)}::uuid), 'members', (select jsonb_agg(to_jsonb(member) order by id)
      from app.church_admin_membership as member where church_id = ${literal(ids.church)}::uuid),
    'notifications', (select jsonb_agg(to_jsonb(notification) order by id) from app.notification as notification
      where object_public_id = ${literal(ids.churchPublic)}::uuid), 'accounts', (select jsonb_agg(
        jsonb_build_array(to_jsonb(account), to_jsonb(identity), to_jsonb(contact), to_jsonb(preference)) order by account.id)
      from app.account as account join auth.users as identity on identity.id = account.id
      join private.account_contact as contact on contact.account_id = account.id
      join private.notification_preference as preference on preference.account_id = account.id
      where account.id in (${literal(ids.passenger)}::uuid, ${literal(ids.replacementAccount)}::uuid)))::text);`)
    + transportDigest();
  const originalDomain = domainDigest();
  const first = prepare(); assert.equal(first.preview.administration_case_id, caseId);
  assert.equal(first.preview.membership_id, initialMember); assert.equal(first.preview.resolution, 'replacement');
  for (const forbidden of [first.token, incomingEmail, ids.passenger, ids.replacementAccount, '@']) {
    assert.equal(JSON.stringify(first.preview).includes(forbidden), false);
  }
  expectRefusal(first, 'f'.repeat(64)); sql(asOperator(executeSql(first), otherRole), '42501');
  const expired = prepare();
  sql(`with instant as materialized (select clock_timestamp() as value) update ops.owner_operation
    set prepared_at = instant.value - interval '16 minutes', expires_at = instant.value - interval '1 minute'
    from instant where id = ${literal(expired.operation_id)}::uuid;`);
  expectRefusal(expired);
  const expiresDuringCaseWait = prepare(); const expiryStatement = executeSql(expiresDuringCaseWait);
  sql(`with instant as materialized (select clock_timestamp() as value) update ops.owner_operation
    set prepared_at = instant.value - interval '15 minutes' + interval '3 seconds', expires_at = instant.value + interval '3 seconds'
    from instant where id = ${literal(expiresDuringCaseWait.operation_id)}::uuid;`);
  const gateName = `case-reconciliation-${caseId}`;
  const gate = asyncSql(`set application_name = ${literal(gateName)}; begin;
    select id from ops.church_administration_case where id = ${literal(caseId)}::uuid for update; select pg_sleep(4); commit;`);
  let waiter;
  try {
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(gateName)} and wait_event = 'PgSleep')`);
    waiter = asyncSql(asOperator(`set application_name = ${literal(`${gateName}-wait`)}; ${expiryStatement}`));
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${gateName}-wait`)} and wait_event_type = 'Lock')`);
    assert.equal(sql(`select expires_at > clock_timestamp() from ops.owner_operation where id = ${literal(expiresDuringCaseWait.operation_id)}::uuid;`), 't');
    const result = await waiter; assert.equal(result.code, 0); assert.equal(JSON.parse(result.stdout).execution_result, 'refused');
    assert.equal(state(), 'replacement_pending');
  } finally { await Promise.all([gate, waiter].filter(Boolean)); }
  const stale = prepare(); sql(`update ops.church_administration_case set updated_at = clock_timestamp() where id = ${literal(caseId)}::uuid;`);
  expectRefusal(stale); assert.equal(state(), 'replacement_pending');
  const failing = prepare(); const failingStatement = executeSql(failing);
  try {
    sql(`create function app.synthetic_case_reconciliation_failure() returns trigger language plpgsql as $$ begin
      if new.id = ${literal(failing.operation_id)}::uuid and new.state = 'succeeded' then raise exception 'Synthetic private reconciliation failure'; end if;
      return new; end; $$;
      create trigger synthetic_case_reconciliation_failure before update on ops.owner_operation
        for each row execute function app.synthetic_case_reconciliation_failure();`);
    assert.equal(JSON.parse(sql(asOperator(failingStatement))).execution_result, 'error'); assert.equal(state(), 'replacement_pending');
    assert.equal(sql(`select count(*) from ops.audit_event where event_key = ${literal(`owner-operation:${failing.operation_id}`)};`), '0');
  } finally {
    sql('drop trigger if exists synthetic_case_reconciliation_failure on ops.owner_operation; drop function if exists app.synthetic_case_reconciliation_failure();');
  }
  assert.equal(JSON.parse(sql(asOperator(failingStatement))).execution_result, 'error');
  const candidates = [prepare(), prepare()]; const statements = candidates.map((candidate) => executeSql(candidate));
  const concurrent = await Promise.all(statements.map((statement) => asyncSql(asOperator(statement))));
  assert.equal(concurrent.every((result) => result.code === 0), true);
  const results = concurrent.map((result) => JSON.parse(result.stdout));
  assert.deepEqual(results.map((result) => result.status ?? result.execution_result).sort(), ['reconciled', 'refused']);
  const result = results.find((entry) => entry.status === 'reconciled'); const winner = candidates.find((entry) => entry.operation_id === result.operation_id);
  assert.deepEqual(execute(winner), result); assert.equal(result.administration_case_id, caseId); assert.equal(result.resolution, 'replacement');
  assert.equal(state(), 'resolved'); assert.equal(domainDigest(), originalDomain);
  assert.equal(sql(`select resolution_source = 'observed_membership' and executed_operation_id = ${literal(winner.operation_id)}::uuid
    and replacement_membership_id is null from ops.church_administration_case where id = ${literal(caseId)}::uuid;`), 't');
  assert.equal(sql(`select state from ops.owner_operation where id = ${literal(sourceCaseOperation.operation_id)}::uuid;`), 'prepared');
  const audit = JSON.parse(sql(`select to_jsonb(event) from ops.audit_event as event where event_key = ${literal(`owner-operation:${winner.operation_id}`)};`));
  assert.equal(audit.action_type, 'church.administration_case_reconciled'); assert.equal(audit.reason_code, 'reviewed_administration_reconciliation');
  assert.deepEqual(audit.changed_fields, ['administration_case']);
  for (const forbidden of [winner.token, incomingEmail, initialMember]) assert.equal(JSON.stringify(audit).includes(forbidden), false);

  const archiveCase = JSON.parse(sql(asOperator(`select ops.prepare_church_administration_archival(
    ${literal(ids.churchPublic)}::uuid, ${literal(accepted.membership_id)}::uuid, 'SYNTHETIC-ARCHIVE-RECONCILE');`)));
  // A second synthetic accepted position lets the original subject use the real voluntary-exit API.
  sql(`insert into app.church_admin_membership(church_id, account_id, access_source)
    values (${literal(ids.church)}::uuid, ${literal(ids.passenger)}::uuid, 'protected_repair');`);
  assert.equal(execute(ordinaryPrepare('archive_church', 'SYNTHETIC-SEPARATE-ARCHIVE')).status, 'archived');
  assert.equal(asAccount(ids.replacementAccount, `api.leave_church_administration(${literal(ids.churchPublic)}::uuid)`), true);
  const archiveBefore = domainDigest();
  const archiveReconciliation = JSON.parse(sql(asOperator(prepareSql(archiveCase.preview.administration_case_id, 'SYNTHETIC-ARCHIVE-RECONCILE'))));
  assert.equal(archiveReconciliation.preview.resolution, 'archive'); assert.equal(execute(archiveReconciliation).status, 'reconciled');
  assert.equal(state(archiveCase.preview.administration_case_id), 'resolved'); assert.equal(domainDigest(), archiveBefore);
  const snapshot = definitions();
  sql(readFileSync(new URL('../supabase/migrations/20261029150000_church_administration_cases.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../supabase/migrations/20261030090000_church_case_reconciliation.sql', import.meta.url), 'utf8'));
  assert.equal(definitions(), snapshot); assert.equal(execute(archiveReconciliation).status, 'reconciled');
  for (const role of ['anon', 'authenticated', 'service_role', 'orthodox_routes_church_operator']) {
    assert.equal(sql(`select has_function_privilege(${literal(role)}, 'ops.prepare_church_case_reconciliation(uuid,uuid,text)', 'EXECUTE');`),
      role === 'orthodox_routes_church_operator' ? 't' : 'f');
    for (const signature of ['ops.church_case_reconciliation_fingerprint(uuid)', 'ops.apply_church_case_reconciliation(uuid)']) {
      assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`), 'f');
    }
  }
  process.stdout.write('Church case reconciliation verified: actual invitation transfer/voluntary exit, observed-state-only resolution, role/token/expiry/freshness including actual case-row wait, rollback, concurrent replay, no domain/notification changes and composed migration replay.\n');
}
