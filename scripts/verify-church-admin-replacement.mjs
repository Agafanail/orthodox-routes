import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function verifyChurchAdminReplacement({ sql, asyncSql, asOperator, literal, ids,
  execute, executeSql, expectRefusal, transportDigest, definitions, otherRole, waitForDatabaseCondition }) {
  const accountId = ids.replacementAccount; const accountPublic = randomUUID();
  const outgoing = JSON.parse(sql(`select jsonb_build_object('id', id, 'public_id', public_id, 'account_id', account_id)
    from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid and status = 'active';`));
  sql(`insert into auth.users(id, email, email_confirmed_at) values (${literal(accountId)}::uuid,
    'owner-replacement-${ids.church}@example.test', now());
    insert into app.account(id, public_id, display_name, preferred_language, adult_declared_at)
      values (${literal(accountId)}::uuid, ${literal(accountPublic)}::uuid, 'Synthetic Verified Representative', 'en', now());
    insert into private.account_contact(account_id, email_normalized, phone_e164, phone_verified_at)
      values (${literal(accountId)}::uuid, 'owner-replacement-${ids.church}@example.test', '+393990000098', now());
    insert into app.legal_acceptance(account_id, document_version_id, acceptance_type, evidence_language, evidence_context)
      values (${literal(accountId)}::uuid, ${literal(ids.legal)}::uuid, 'terms_explicit', 'en', 'account_foundation_v1');`);
  const prepareSql = (member = outgoing.public_id, incoming = accountPublic) =>
    `select ops.prepare_church_admin_replacement(${literal(ids.churchPublic)}::uuid, ${literal(member)}::uuid,
      ${literal(incoming)}::uuid, 'SYNTHETIC-REPRESENTATIVE');`;
  const prepare = () => JSON.parse(sql(asOperator(prepareSql())));
  const members = () => sql(`select jsonb_agg(to_jsonb(member) order by member.id) from app.church_admin_membership as member
    where church_id = ${literal(ids.church)}::uuid;`);
  const originalMembers = members(); const beforeTransport = transportDigest();
  const church = () => sql(`select to_jsonb(church) from app.church where id = ${literal(ids.church)}::uuid;`);
  const originalChurch = church();
  const assertUnchanged = () => { assert.equal(members(), originalMembers); assert.equal(transportDigest(), beforeTransport); };
  for (const denied of ['anon', 'authenticated', 'service_role']) {
    sql(`set role ${denied}; ${prepareSql()}`, '42501');
    sql(`set role ${denied}; select ops.apply_church_admin_replacement(${literal(randomUUID())}::uuid);`, '42501');
  }
  for (const call of [`ops.apply_church_admin_replacement(${literal(randomUUID())}::uuid)`,
    `ops.lock_church_replacement_actor(${literal(accountId)}::uuid)`,
    `ops.church_admin_replacement_fingerprint(${literal(ids.church)}::uuid, ${literal(accountId)}::uuid)`]) {
    sql(asOperator(`select ${call};`), '42501');
  }
  sql(asOperator(prepareSql(randomUUID())), 'PT409');
  sql(asOperator(prepareSql(outgoing.public_id, randomUUID())), '42501');
  const outgoingPublic = sql(`select public_id from app.account where id = ${literal(outgoing.account_id)}::uuid;`);
  sql(asOperator(prepareSql(outgoing.public_id, outgoingPublic)), '42501');
  // Every independent confirmed-user factor is authoritative; no ordinary ride channel is required.
  for (const [disable, restore] of [
    [`update auth.users set email_confirmed_at = null where id = ${literal(accountId)}::uuid`,
      `update auth.users set email_confirmed_at = now() where id = ${literal(accountId)}::uuid`],
    [`update private.account_contact set phone_verified_at = null where account_id = ${literal(accountId)}::uuid`,
      `update private.account_contact set phone_verified_at = now() where account_id = ${literal(accountId)}::uuid`],
    [`update app.account set adult_declared_at = null where id = ${literal(accountId)}::uuid`,
      `update app.account set adult_declared_at = now() where id = ${literal(accountId)}::uuid`],
    [`update app.account set status = 'restricted' where id = ${literal(accountId)}::uuid`,
      `update app.account set status = 'active' where id = ${literal(accountId)}::uuid`],
    [`delete from app.legal_acceptance where account_id = ${literal(accountId)}::uuid`,
      `insert into app.legal_acceptance(account_id, document_version_id, acceptance_type, evidence_language, evidence_context)
        values (${literal(accountId)}::uuid, ${literal(ids.legal)}::uuid, 'terms_explicit', 'en', 'account_foundation_v1')`],
  ]) {
    try { sql(`${disable};`); sql(asOperator(prepareSql()), '42501'); }
    finally { sql(`${restore};`); }
  }
  sql(`update private.notification_preference set ride_email_enabled = false, web_push_enabled = false
    where account_id = ${literal(accountId)}::uuid;`);
  const safe = prepare();
  assert.equal(safe.operation_type, 'replace_church_admin');
  assert.equal(safe.preview.administrator_count, 1);
  assert.equal(safe.preview.membership_id, outgoing.public_id);
  assert.equal(safe.preview.replacement_account_id, accountPublic);
  for (const forbidden of [accountId, outgoing.account_id, '@', 'Synthetic Verified', '+393990', 'replacement_state']) {
    assert.equal(JSON.stringify(safe.preview).includes(forbidden), false);
  }
  expectRefusal(safe, 'f'.repeat(64));
  sql(asOperator(executeSql(safe), otherRole), '42501');
  const stale = prepare();
  sql(`update app.account set updated_at = clock_timestamp() where id = ${literal(accountId)}::uuid;`);
  expectRefusal(stale); assertUnchanged();
  const noLongerEligible = prepare();
  try {
    sql(`update app.account set status = 'restricted' where id = ${literal(accountId)}::uuid;`);
    expectRefusal(noLongerEligible); assertUnchanged();
  } finally { sql(`update app.account set status = 'active' where id = ${literal(accountId)}::uuid;`); }
  const invitationId = randomUUID();
  try {
    sql(`insert into app.church_admin_invite(id, church_id, sender_account_id, transfer_membership_id,
      invite_email, token_hash, issued_at, expires_at) values (${literal(invitationId)}::uuid,
      ${literal(ids.church)}::uuid, ${literal(outgoing.account_id)}::uuid, ${literal(outgoing.id)}::uuid,
      'synthetic-replacement-pending@example.test', repeat('a',64), now(), now() + interval '7 days');`);
    sql(asOperator(prepareSql()), 'PT409'); assertUnchanged();
  } finally { sql(`delete from app.church_admin_invite where id = ${literal(invitationId)}::uuid;`); }
  const failing = prepare(); const failedStatement = executeSql(failing);
  try {
    sql(`create function app.synthetic_owner_replacement_failure() returns trigger language plpgsql as $$ begin
      if new.id = ${literal(failing.operation_id)}::uuid then raise exception 'Synthetic private replacement failure'; end if;
      return new; end; $$;
      create trigger synthetic_owner_replacement_failure before update on ops.owner_operation
        for each row execute function app.synthetic_owner_replacement_failure();`);
    assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error'); assertUnchanged();
    assert.equal(sql(`select count(*) from app.notification where event_type = 'church.admin.replaced'
      and object_public_id = ${literal(ids.churchPublic)}::uuid;`), '0');
  } finally {
    sql('drop trigger if exists synthetic_owner_replacement_failure on ops.owner_operation; drop function if exists app.synthetic_owner_replacement_failure();');
  }
  assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
  // An additional incoming-identity row wait must not extend the existing capability deadline.
  const expiresWhileWaiting = prepare(); const expiryStatement = executeSql(expiresWhileWaiting);
  sql(`with instant as materialized (select clock_timestamp() as value)
    update ops.owner_operation set prepared_at = instant.value - interval '15 minutes' + interval '3 seconds',
    expires_at = instant.value + interval '3 seconds' from instant where id = ${literal(expiresWhileWaiting.operation_id)}::uuid;`);
  const gateName = `replacement-gate-${accountId}`;
  const gate = asyncSql(`set application_name = ${literal(gateName)}; begin;
    select id from auth.users where id = ${literal(accountId)}::uuid for update; select pg_sleep(4); commit;`);
  let waiter;
  try {
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(gateName)} and wait_event = 'PgSleep')`);
    waiter = asyncSql(asOperator(`set application_name = ${literal(`${gateName}-wait`)}; ${expiryStatement}`));
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${gateName}-wait`)} and wait_event_type = 'Lock')`);
    assert.equal(sql(`select expires_at > clock_timestamp() from ops.owner_operation
      where id = ${literal(expiresWhileWaiting.operation_id)}::uuid;`), 't');
    const result = await waiter; assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).execution_result, 'refused'); assertUnchanged();
  } finally { await Promise.all([gate, waiter].filter(Boolean)); }
  const privateState = () => sql(`select jsonb_agg(jsonb_build_object('account', to_jsonb(account), 'identity', to_jsonb(identity),
    'contact', to_jsonb(contact)) order by account.id) from app.account as account join auth.users as identity on identity.id = account.id
    join private.account_contact as contact on contact.account_id = account.id where account.id in
      (${literal(accountId)}::uuid, ${literal(outgoing.account_id)}::uuid);`);
  const beforePrivate = privateState();
  const operation = prepare(); const otherOperation = prepare();
  const statements = [executeSql(operation), executeSql(otherOperation)];
  const results = await Promise.all(statements.map((statement) => asyncSql(asOperator(statement))));
  assert.ok(results.every((result) => result.code === 0));
  const values = results.map((result) => JSON.parse(result.stdout));
  assert.deepEqual(values.map((value) => value.status ?? value.execution_result).sort(), ['refused', 'replaced']);
  const result = values.find((value) => value.status === 'replaced');
  const winner = result.operation_id === operation.operation_id ? operation : otherOperation;
  assert.equal(result.membership_id, outgoing.public_id); assert.equal(result.replacement_account_id, accountPublic);
  assert.equal(sql(`select count(*) from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid
    and status in ('active','transferring');`), '1');
  assert.equal(sql(`select account_id = ${literal(accountId)}::uuid and access_source = 'protected_repair'
    from app.church_admin_membership where public_id = ${literal(result.replacement_membership_id)}::uuid;`), 't');
  assert.equal(sql(`select status from app.church_admin_membership where id = ${literal(outgoing.id)}::uuid;`), 'ended');
  assert.deepEqual(execute(winner), result);
  assert.equal(privateState(), beforePrivate); assert.equal(transportDigest(), beforeTransport); assert.equal(church(), originalChurch);
  for (const [actor, expected] of [[accountId, '1'], [outgoing.account_id, '0']]) {
    assert.equal(sql(`select set_config('request.jwt.claim.sub', ${literal(actor)}, false);
      set role authenticated; select jsonb_array_length(api.current_managed_churches());`).split(/\r?\n/).at(-1), expected);
  }
  assert.equal(sql(`select not ride_email_enabled and not web_push_enabled from private.notification_preference
    where account_id = ${literal(accountId)}::uuid;`), 't');
  for (const [actor, memberId, status] of [[accountId, result.replacement_membership_id, 'active'],
    [outgoing.account_id, outgoing.public_id, 'ended']]) {
    assert.equal(sql(`select set_config('request.jwt.claim.sub', ${literal(actor)}, false); set role authenticated;
      select exists (select 1 from jsonb_array_elements(api.export_current_account_data()->'church_administration'->'memberships') as entry(value)
        where value->>'membership_id' = ${literal(memberId)} and value->>'status' = ${literal(status)});`).split(/\r?\n/).at(-1), 't');
  }
  assert.equal(sql(`select count(distinct recipient_account_id) = 2 and bool_and(
    localization_key = 'notifications.church_admin_removed' and safe_parameters = jsonb_build_object('church_id', ${literal(ids.churchPublic)}::uuid))
    from app.notification where event_type = 'church.admin.replaced' and object_public_id = ${literal(ids.churchPublic)}::uuid;`), 't');
  const audit = JSON.parse(sql(`select to_jsonb(event) from ops.audit_event as event where event_key = ${literal(`owner-operation:${winner.operation_id}`)};`));
  assert.equal(audit.actor_kind, 'operator'); assert.equal(audit.action_type, 'membership.transferred');
  assert.equal(audit.reason_code, 'reviewed_membership_replacement'); assert.deepEqual(audit.changed_fields, ['administrator_membership']);
  for (const forbidden of [winner.token, accountId, accountPublic, '@', outgoing.public_id]) assert.equal(JSON.stringify(audit).includes(forbidden), false);
  const snapshot = definitions();
  for (const file of ['20261019120000_church_admin_replacement.sql', '20261019110000_church_owner_invite_cancellation.sql',
    '20261019100000_church_admin_removal.sql', '20261017060000_church_owner_hiding.sql']) {
    sql(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  assert.equal(definitions(), snapshot); assert.deepEqual(execute(winner), result);
  process.stdout.write('Reviewed church seat replacement verified: confirmed-user factors, last-seat swap, rollback, row-wait expiry, no identity/history transfer, and replay.\n');
}
