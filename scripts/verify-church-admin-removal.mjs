import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Reuse only the parent verifier's disposable local container and exact synthetic church/accounts.
export async function verifyChurchAdminRemoval({ sql, asyncSql, asOperator, literal, ids,
  execute, executeSql, expectRefusal, transportDigest, definitions, otherRole, waitForDatabaseCondition }) {
  const memberId = randomUUID(); const memberPublic = randomUUID(); const inviteId = randomUUID();
  const firstMember = sql(`select public_id from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid
    and account_id = ${literal(ids.passenger)}::uuid and status = 'active';`);
  const prepareSql = (membership = memberPublic, church = ids.churchPublic) =>
    `select ops.prepare_church_admin_removal(${literal(church)}::uuid, ${literal(membership)}::uuid, 'SYNTHETIC-REMOVAL');`;
  const prepare = (membership) => JSON.parse(sql(asOperator(prepareSql(membership))));
  const state = () => sql(`select status from app.church_admin_membership where id = ${literal(memberId)}::uuid;`);
  const reactivate = () => sql(`update app.church_admin_membership set status = 'active', ended_at = null
    where id = ${literal(memberId)}::uuid;`);
  const beforeTransport = transportDigest();
  const beforeChurch = sql(`select to_jsonb(church) from app.church where id = ${literal(ids.church)}::uuid;`);
  const assertNoDomainChange = (operation) => {
    assert.equal(state(), 'active');
    assert.equal(sql(`select count(*) from ops.audit_event where event_key = ${literal(`owner-operation:${operation.operation_id}`)};`), '0');
    assert.equal(sql(`select count(*) from app.notification where event_type = 'church.admin.removed'
      and object_public_id = ${literal(ids.churchPublic)}::uuid;`), '0');
  };
  try {
    for (const denied of ['anon', 'authenticated', 'service_role']) {
      sql(`set role ${denied}; ${prepareSql()}`, '42501');
      sql(`set role ${denied}; select ops.apply_church_admin_removal(${literal(randomUUID())}::uuid);`, '42501');
    }
    sql(asOperator(`select ops.apply_church_admin_removal(${literal(randomUUID())}::uuid);`), '42501');
    sql(asOperator(prepareSql(firstMember)), 'PT409'); // final administrator
    sql(`insert into app.church_admin_membership(id, public_id, church_id, account_id, access_source)
      values (${literal(memberId)}::uuid, ${literal(memberPublic)}::uuid, ${literal(ids.church)}::uuid,
        ${literal(ids.driver)}::uuid, 'protected_repair');`);
    sql(asOperator(prepareSql(randomUUID())), 'PT409');
    sql(asOperator(prepareSql(memberPublic, randomUUID())), 'P0002');
    const prepared = prepare();
    assert.equal(prepared.operation_type, 'remove_church_admin');
    assert.equal(prepared.preview.membership_id, memberPublic);
    assert.equal(prepared.preview.administrator_count, 2);
    for (const forbidden of [ids.driver, ids.passenger, memberId, '@', 'administrator_ids']) {
      assert.equal(JSON.stringify(prepared.preview).includes(forbidden), false);
    }
    expectRefusal(prepared, 'f'.repeat(64));
    sql(asOperator(executeSql(prepared), otherRole), '42501');
    sql(`update ops.owner_operation set prepared_at = now() - interval '16 minutes',
      expires_at = now() - interval '1 minute' where id = ${literal(prepared.operation_id)}::uuid;`);
    expectRefusal(prepared);
    assertNoDomainChange(prepared);

    const stale = prepare();
    sql(`update app.church_admin_membership set status = 'transferring' where id = ${literal(memberId)}::uuid;`);
    expectRefusal(stale);
    reactivate();
    const transfer = prepare();
    sql(`insert into app.church_admin_invite(id, church_id, sender_account_id, transfer_membership_id,
      invite_email, token_hash, issued_at, expires_at) values (${literal(inviteId)}::uuid,
      ${literal(ids.church)}::uuid, ${literal(ids.driver)}::uuid, ${literal(memberId)}::uuid,
      'synthetic-removal@example.test', repeat('a',64), now(), now() + interval '7 days');`);
    sql(asOperator(prepareSql()), 'PT409');
    expectRefusal(transfer);
    sql(`delete from app.church_admin_invite where id = ${literal(inviteId)}::uuid;`);
    const lostLast = prepare();
    sql(`update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp()
      where church_id = ${literal(ids.church)}::uuid and account_id = ${literal(ids.passenger)}::uuid;`);
    expectRefusal(lostLast);
    sql(`update app.church_admin_membership set status = 'active', ended_at = null
      where public_id = ${literal(firstMember)}::uuid;`);

    const failure = prepare();
    const failedStatement = executeSql(failure);
    try {
      sql(`create function app.synthetic_owner_removal_failure() returns trigger language plpgsql as $$ begin
        if new.id = ${literal(failure.operation_id)}::uuid then raise exception 'Synthetic private removal failure'; end if;
        return new; end; $$;
        create trigger synthetic_owner_removal_failure before update on ops.owner_operation
          for each row execute function app.synthetic_owner_removal_failure();`);
      assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
      assertNoDomainChange(failure);
    } finally {
      sql('drop trigger if exists synthetic_owner_removal_failure on ops.owner_operation; drop function if exists app.synthetic_owner_removal_failure();');
    }
    assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
  } finally {
    // Invitations never grant/remove access as a side effect of an owner exclusion.
    sql(`delete from app.church_admin_invite where id = ${literal(inviteId)}::uuid;`);
  }
  // Separate prepared operations compete for the same reviewed membership; exactly one can succeed.
  const left = prepare(); const right = prepare();
  const leftStatement = executeSql(left); const rightStatement = executeSql(right);
  const gateName = `removal-gate-${memberId}`;
  const gate = asyncSql(`set application_name = ${literal(gateName)}; begin;
    select pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || ${literal(ids.church)}::text, 0));
    select pg_sleep(4); commit;`);
  const contenders = []; let concurrent;
  try {
    await waitForDatabaseCondition(`exists (select 1 from pg_stat_activity where application_name = ${literal(gateName)}
      and wait_event = 'PgSleep')`);
    contenders.push(...[leftStatement, rightStatement].map((statement, index) => asyncSql(asOperator(
      `set application_name = ${literal(`${gateName}-${index}`)}; ${statement}`))));
    await waitForDatabaseCondition(`(select count(*) from pg_stat_activity
      where application_name in (${literal(`${gateName}-0`)}, ${literal(`${gateName}-1`)}) and wait_event = 'advisory') = 2`);
    concurrent = await Promise.all(contenders);
    assert.equal((await gate).code, 0);
  } finally { await Promise.all([gate, ...contenders]); }
  assert.ok(concurrent.every((result) => result.code === 0));
  const results = concurrent.map((result) => JSON.parse(result.stdout));
  assert.deepEqual(results.map((result) => result.status ?? result.execution_result).sort(), ['refused', 'removed']);
  const winner = results.find((result) => result.status === 'removed');
  const operation = winner.operation_id === left.operation_id ? left : right;
  assert.equal(state(), 'ended');
  assert.equal(winner.membership_id, memberPublic);
  assert.deepEqual(execute(operation), winner);
  assert.equal(sql(`select count(*) from app.notification where event_type = 'church.admin.removed'
    and object_public_id = ${literal(ids.churchPublic)}::uuid;`), '2');
  assert.equal(sql(`select count(distinct recipient_account_id) = 2 and bool_and(
      safe_parameters = jsonb_build_object('church_id', ${literal(ids.churchPublic)}::uuid)
      and localization_key = 'notifications.church_admin_removed') from app.notification
    where event_type = 'church.admin.removed' and object_public_id = ${literal(ids.churchPublic)}::uuid;`), 't');
  assert.equal(sql(`select count(*) from app.church_admin_event where church_id = ${literal(ids.church)}::uuid
    and event_type = 'membership.removed' and actor_account_id is null
    and subject_account_id = ${literal(ids.driver)}::uuid;`), '1');
  const audit = JSON.parse(sql(`select to_jsonb(event) from ops.audit_event as event
    where event_key = ${literal(`owner-operation:${operation.operation_id}`)};`));
  assert.equal(audit.actor_kind, 'operator');
  assert.equal(audit.reason_code, 'reviewed_membership_removal');
  assert.equal(audit.action_type, 'membership.removed');
  assert.deepEqual(audit.changed_fields, ['administrator_membership']);
  for (const privateValue of [operation.token, ids.driver, memberPublic]) assert.equal(JSON.stringify(audit).includes(privateValue), false);
  assert.equal(sql(`select set_config('request.jwt.claim.sub', ${literal(ids.driver)}, false);
    set role authenticated; select api.current_managed_churches()::text;`).split(/\r?\n/).at(-1), '[]');
  assert.equal(transportDigest(), beforeTransport);
  assert.equal(sql(`select to_jsonb(church) from app.church where id = ${literal(ids.church)}::uuid;`), beforeChurch);
  // Re-entry is a distinct membership lifecycle; replay cannot remove the replacement grant.
  const replacementId = randomUUID(); const replacementPublic = randomUUID();
  sql(`insert into app.church_admin_membership(id, public_id, church_id, account_id, access_source)
    values (${literal(replacementId)}::uuid, ${literal(replacementPublic)}::uuid, ${literal(ids.church)}::uuid,
      ${literal(ids.driver)}::uuid, 'protected_repair');`);
  assert.deepEqual(execute(operation), winner);
  assert.equal(sql(`select status from app.church_admin_membership where id = ${literal(replacementId)}::uuid;`), 'active');
  const hidden = prepare(replacementPublic);
  sql(`update app.church set status = 'hidden' where id = ${literal(ids.church)}::uuid;`);
  expectRefusal(hidden);
  assert.equal(execute(prepare(replacementPublic)).status, 'removed');
  sql(`update app.church set status = 'published' where id = ${literal(ids.church)}::uuid;`);
  const beforeReplay = definitions();
  sql(readFileSync(new URL('../supabase/migrations/20261019100000_church_admin_removal.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../supabase/migrations/20261017060000_church_owner_hiding.sql', import.meta.url), 'utf8'));
  assert.equal(definitions(), beforeReplay);
  assert.equal(execute(operation).status, 'removed');
  process.stdout.write('Reviewed church administrator exclusion verified with synthetic-only grants, failures, races, history, notifications, and replay.\n');
}
