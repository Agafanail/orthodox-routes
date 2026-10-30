import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function verifyChurchAdministrationCases({ sql, asyncSql, asOperator, literal, ids,
  execute, executeSql, expectRefusal, transportDigest, definitions, otherRole }) {
  const outgoing = JSON.parse(sql(`select jsonb_build_object('id', id, 'public_id', public_id, 'account_id', account_id)
    from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid and status = 'active';`));
  // Complete only this existing synthetic incoming identity's authoritative factors.
  sql(`update auth.users set email_confirmed_at = clock_timestamp() where id = ${literal(ids.passenger)}::uuid;
    update app.account set adult_declared_at = clock_timestamp() where id = ${literal(ids.passenger)}::uuid;
    update private.account_contact set phone_e164 = '+393990000097', phone_verified_at = clock_timestamp()
      where account_id = ${literal(ids.passenger)}::uuid;
    insert into app.legal_acceptance(account_id, document_version_id, acceptance_type, evidence_language, evidence_context)
      select ${literal(ids.passenger)}::uuid, ${literal(ids.legal)}::uuid, 'terms_explicit', 'en', 'account_foundation_v1'
      where not exists (select 1 from app.legal_acceptance where account_id = ${literal(ids.passenger)}::uuid
        and document_version_id = ${literal(ids.legal)}::uuid and acceptance_type = 'terms_explicit');`);
  const incoming = sql(`select public_id from app.account where id = ${literal(ids.passenger)}::uuid;`);
  const prepareSql = (reference = 'SYNTHETIC-FINAL-REPLACEMENT', member = outgoing.public_id) =>
    `select ops.prepare_church_administration_replacement(${literal(ids.churchPublic)}::uuid,
      ${literal(member)}::uuid, ${literal(incoming)}::uuid, ${literal(reference)});`;
  const prepare = () => JSON.parse(sql(asOperator(prepareSql())));
  const privateDigest = () => sql(`select md5(jsonb_agg(jsonb_build_array(to_jsonb(account), to_jsonb(identity),
      to_jsonb(contact)) order by account.id)::text) from app.account as account
    join auth.users as identity on identity.id = account.id join private.account_contact as contact on contact.account_id = account.id
    where account.id in (${literal(ids.passenger)}::uuid, ${literal(outgoing.account_id)}::uuid);`);
  const beforePrivate = privateDigest(); const beforeTransport = transportDigest();
  const members = () => sql(`select md5(jsonb_agg(to_jsonb(member) order by id)::text)
    from app.church_admin_membership as member where church_id = ${literal(ids.church)}::uuid;`);
  const originalMembers = members();
  const caseState = (id) => sql(`select state from ops.church_administration_case where id = ${literal(id)}::uuid;`);
  for (const denied of ['anon', 'authenticated', 'service_role']) {
    sql(`set role ${denied}; ${prepareSql()}`, '42501');
    sql(`set role ${denied}; select ops.prepare_church_administration_archival(
      ${literal(ids.churchPublic)}::uuid, ${literal(outgoing.public_id)}::uuid, 'SYNTHETIC-CASE');`, '42501');
    sql(`set role ${denied}; select * from ops.church_administration_case;`, '42501');
  }
  sql(asOperator('select * from ops.church_administration_case;'), '42501');
  sql(asOperator(`select ops.bind_church_administration_case(${literal(randomUUID())}::uuid, ${literal(outgoing.public_id)}::uuid);`), '42501');
  assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'ops.church_administration_case'::regclass;`), 't');
  sql(asOperator(prepareSql('private@example.test')), '22023');
  sql(asOperator(prepareSql('SYNTHETIC-FINAL-REPLACEMENT', randomUUID())), 'PT409');
  const additionalMember = randomUUID();
  try {
    sql(`insert into app.church_admin_membership(id, church_id, account_id, access_source)
      values (${literal(additionalMember)}::uuid, ${literal(ids.church)}::uuid, ${literal(ids.driver)}::uuid, 'protected_repair');`);
    sql(asOperator(prepareSql()), 'PT409');
    assert.equal(sql(`select count(*) from ops.church_administration_case where church_id = ${literal(ids.church)}::uuid;`), '0');
  } finally { sql(`delete from app.church_admin_membership where id = ${literal(additionalMember)}::uuid;`); }
  const first = prepare(); const caseId = first.preview.administration_case_id;
  assert.equal(typeof caseId, 'string'); assert.equal(first.preview.administrator_count, 1);
  assert.equal(first.preview.membership_id, outgoing.public_id);
  assert.equal(caseState(caseId), 'replacement_pending'); assert.equal(members(), originalMembers);
  for (const forbidden of [first.token, '@', ids.passenger, outgoing.account_id]) {
    assert.equal(JSON.stringify(first.preview).includes(forbidden), false);
    assert.equal(sql(`select position(${literal(forbidden)} in to_jsonb(support_case)::text) = 0
      from ops.church_administration_case as support_case where id = ${literal(caseId)}::uuid;`), 't');
  }
  expectRefusal(first, 'f'.repeat(64));
  sql(asOperator(executeSql(first), otherRole), '42501');
  sql(asOperator(prepareSql('SYNTHETIC-DIFFERENT-CASE')), 'PT409');
  const expired = prepare();
  sql(`with instant as materialized (select clock_timestamp() as value) update ops.owner_operation
    set prepared_at = instant.value - interval '16 minutes', expires_at = instant.value - interval '1 minute'
    from instant where id = ${literal(expired.operation_id)}::uuid;`);
  expectRefusal(expired); assert.equal(members(), originalMembers); assert.equal(caseState(caseId), 'replacement_pending');
  // A fresh preview supersedes the old pending decision even before any church state changes.
  const superseding = prepare(); assert.equal(superseding.preview.administration_case_id, caseId);
  expectRefusal(first); assert.equal(members(), originalMembers); assert.equal(caseState(caseId), 'replacement_pending');
  const failedStatement = executeSql(superseding);
  try {
    sql(`create function app.synthetic_administration_case_failure() returns trigger language plpgsql as $$ begin
      if new.state = 'resolved' and new.id = ${literal(caseId)}::uuid then raise exception 'Synthetic private case failure'; end if;
      return new; end; $$;
      create trigger synthetic_administration_case_failure before update on ops.church_administration_case
        for each row execute function app.synthetic_administration_case_failure();`);
    assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
    assert.equal(members(), originalMembers); assert.equal(caseState(caseId), 'replacement_pending');
    assert.equal(sql(`select count(*) from ops.audit_event where event_key = ${literal(`owner-operation:${superseding.operation_id}`)};`), '0');
    assert.equal(sql(`select count(*) from app.notification where deduplication_key = ${literal(`church-admin-replaced:${superseding.operation_id}`)};`), '0');
  } finally {
    sql('drop trigger if exists synthetic_administration_case_failure on ops.church_administration_case; drop function if exists app.synthetic_administration_case_failure();');
  }
  assert.equal(JSON.parse(sql(asOperator(failedStatement))).execution_result, 'error');
  const winning = prepare(); const statement = executeSql(winning);
  const concurrent = await Promise.all([asyncSql(asOperator(statement)), asyncSql(asOperator(statement))]);
  assert.equal(concurrent.every((result) => result.code === 0), true);
  const replaced = JSON.parse(concurrent[0].stdout); assert.deepEqual(JSON.parse(concurrent[1].stdout), replaced);
  assert.equal(replaced.status, 'replaced'); assert.equal(caseState(caseId), 'resolved');
  assert.deepEqual(execute(winning), replaced);
  assert.equal(sql(`select count(*) from ops.audit_event where event_key in
    (${literal(`administration-case:${caseId}:opened`)}, ${literal(`administration-case:${caseId}:resolved`)});`), '2');
  assert.equal(sql(`select executed_operation_id = ${literal(winning.operation_id)}::uuid and
    replacement_membership_id = (select id from app.church_admin_membership where public_id = ${literal(replaced.replacement_membership_id)}::uuid)
    from ops.church_administration_case where id = ${literal(caseId)}::uuid;`), 't');
  assert.equal(privateDigest(), beforePrivate); assert.equal(transportDigest(), beforeTransport);

  // Earlier owner scenarios deliberately retain future synthetic transport. Resolve
  // only this fixture's authors/church through ordinary authenticated cancellations;
  // do not weaken the archival guard or assume those sources are already empty.
  const fixtureAuthors = [ids.passenger, ids.driver, ids.replacementAccount].map((id) => `${literal(id)}::uuid`).join(',');
  const cancelAsAuthor = (target, routine) => {
    const value = sql(`begin; select set_config('request.jwt.claim.sub', ${literal(target.author)}, true);
      set local role authenticated; select api.${routine}(${literal(target.public_id)}::uuid, ${literal(randomUUID())}::uuid); commit;`);
    assert.equal(JSON.parse(value.split(/\r?\n/).at(-1)).status, 'cancelled');
  };
  const offers = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('public_id', public_id, 'author', author_account_id)), '[]')
    from app.driver_offer_occurrence where church_id = ${literal(ids.church)}::uuid
      and author_account_id in (${fixtureAuthors}) and status in ('active','full') and arrival_at > clock_timestamp();`));
  for (const target of offers) cancelAsAuthor(target, 'cancel_driver_occurrence');
  const requests = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('public_id', public_id, 'author', author_account_id)), '[]')
    from app.passenger_request where church_id = ${literal(ids.church)}::uuid and author_account_id in (${fixtureAuthors})
      and status in ('active','partial','restore') and desired_arrival_at > clock_timestamp();`));
  for (const target of requests) cancelAsAuthor(target, 'cancel_passenger_request');
  const archiveTransport = transportDigest();
  const archiveSql = () => `select ops.prepare_church_administration_archival(${literal(ids.churchPublic)}::uuid,
    ${literal(replaced.replacement_membership_id)}::uuid, 'SYNTHETIC-FINAL-ARCHIVE');`;
  const newRequest = randomUUID(); let archived;
  try {
    sql(`insert into app.passenger_request(id, author_account_id, church_id, desired_arrival_at, timezone,
      total_passengers, child_seat_required, return_required, remaining_passengers, terms_version)
      values (${literal(newRequest)}::uuid, ${literal(ids.passenger)}::uuid, ${literal(ids.church)}::uuid,
        now() + interval '3 days', 'UTC', 1, false, false, 1, 'synthetic-owner-test');`);
    const blocked = JSON.parse(sql(asOperator(archiveSql())));
    assert.equal(blocked.preview.passenger_requests, 1); expectRefusal(blocked);
    assert.equal(caseState(blocked.preview.administration_case_id), 'archive_pending');
    assert.equal(sql(`select status from app.church_admin_membership where public_id = ${literal(replaced.replacement_membership_id)}::uuid;`), 'active');
  } finally { sql(`delete from app.passenger_request where id = ${literal(newRequest)}::uuid;`); }
  const archival = JSON.parse(sql(asOperator(archiveSql())));
  archived = execute(archival); assert.equal(archived.status, 'archived'); assert.deepEqual(execute(archival), archived);
  assert.equal(caseState(archival.preview.administration_case_id), 'resolved');
  assert.equal(sql(`select count(*) from app.church_admin_membership where church_id = ${literal(ids.church)}::uuid
    and status in ('active','transferring');`), '0');
  assert.equal(privateDigest(), beforePrivate); assert.equal(transportDigest(), archiveTransport);
  assert.equal(sql(`select count(*) from app.notification where event_type = 'church.admin.case_resolved'
    and object_public_id = ${literal(ids.churchPublic)}::uuid
    and safe_parameters = jsonb_build_object('church_id', ${literal(ids.churchPublic)}::uuid);`), '1');
  const snapshot = definitions();
  const constraints = () => sql(`select md5(jsonb_agg(pg_get_constraintdef(oid) order by conname)::text)
    from pg_constraint where conrelid in ('ops.audit_event'::regclass, 'ops.owner_operation'::regclass,
      'ops.church_administration_case'::regclass);`);
  const expectedConstraints = constraints();
  sql(readFileSync(new URL('../supabase/migrations/20261029150000_church_administration_cases.sql', import.meta.url), 'utf8'));
  sql(readFileSync(new URL('../supabase/migrations/20261030090000_church_case_reconciliation.sql', import.meta.url), 'utf8'));
  assert.equal(definitions(), snapshot); assert.equal(constraints(), expectedConstraints); assert.deepEqual(execute(archival), archived);
  for (const role of ['anon', 'authenticated', 'service_role', 'orthodox_routes_church_operator']) {
    for (const signature of ['ops.bind_church_administration_case(uuid,uuid)', 'ops.complete_church_administration_case()']) {
      assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`), 'f');
    }
    for (const signature of ['ops.prepare_church_administration_replacement(uuid,uuid,uuid,text)',
      'ops.prepare_church_administration_archival(uuid,uuid,text)']) {
      assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`),
        role === 'orthodox_routes_church_operator' ? 't' : 'f');
    }
  }
  process.stdout.write('Restricted final-administrator cases verified: preserved last seat, case-bound replacement/archival, stale decision refusal, late rollback, concurrent replay, future-work guard and exact scope.\n');
}
