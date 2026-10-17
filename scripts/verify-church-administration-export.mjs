import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reuses only the disposable local church fixture; no provider or new identity association.
export async function verifyChurchAdministrationExport({ clients, identities, anonymous, admin, rpc, rpcFailure,
  hiddenChurchId, acceptedInviteId, forbidden, runSql }) {
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const shapes = {
    memberships: ['membership_id', 'church_id', 'status', 'access_source', 'accepted_at', 'ended_at', 'created_at', 'updated_at'],
    invitations: ['invitation_id', 'church_id', 'sent_by_me', 'accepted_by_me', 'transfers_position', 'status',
      'issued_at', 'expires_at', 'last_sent_at', 'decided_at'],
    events: ['event_id', 'church_id', 'event_type', 'acted_by_me', 'about_me', 'occurred_at'],
    archival_requests: ['request_id', 'church_id', 'status', 'requested_at', 'cancelled_at', 'resolved_at'],
  };
  const exportOwn = async (client) => (await rpc(client, 'export_current_account_data')).church_administration;
  const sections = await Promise.all(clients.map(exportOwn));
  const ids = (query) => JSON.parse(runSql(`select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from (${query}) as source;`));
  for (const [index, section] of sections.entries()) {
    assert.deepEqual(Object.keys(section).sort(), ['schema_version', ...Object.keys(shapes)].sort());
    assert.equal(section.schema_version, 1);
    for (const [key, shape] of Object.entries(shapes)) {
      for (const row of section[key]) assert.deepEqual(Object.keys(row).sort(), [...shape].sort());
    }
    for (const value of [...identities.flatMap((identity) => [identity.email, identity.phone, identity.id]), ...forbidden]) {
      if (value) assert.equal(JSON.stringify(section).includes(value), false, 'Administration export leaked excluded content.');
    }
    const actor = `${literal(identities[index].id)}::uuid`;
    assert.deepEqual(section.memberships.map((item) => item.membership_id).sort(), ids(
      `select public_id as id from app.church_admin_membership where account_id = ${actor}`));
    assert.deepEqual(section.invitations.map((item) => item.invitation_id).sort(), ids(
      `select public_id as id from app.church_admin_invite where sender_account_id = ${actor} or accepted_account_id = ${actor}`));
    assert.deepEqual(section.events.map((item) => item.event_id).sort(), ids(
      `select id from app.church_admin_event where actor_account_id = ${actor} or subject_account_id = ${actor}`));
    assert.deepEqual(section.archival_requests.map((item) => item.request_id).sort(), ids(
      `select public_id as id from app.church_archive_request where requested_by = ${actor}`));
  }
  // The accepted recipient at index 2 later leaves the second church in the real fixture flow.
  assert.ok(sections[2].memberships.some((item) => item.status === 'ended'));
  assert.ok(sections[2].invitations.some((item) => item.invitation_id === acceptedInviteId && item.accepted_by_me));
  assert.ok(sections[1].invitations.some((item) => item.invitation_id === acceptedInviteId && item.sent_by_me));
  assert.ok(sections.some((section) => section.archival_requests.length > 0));
  for (const key of Object.keys(shapes)) assert.deepEqual(sections[4][key], []);
  await rpcFailure(anonymous, 'export_current_account_data');
  await rpcFailure(admin, 'export_current_account_data');
  await rpcFailure(clients[4], 'export_current_account_data', { p_account_id: identities[0].id });
  try {
    runSql(`update app.church set status = 'hidden' where public_id = ${literal(hiddenChurchId)}::uuid;
      update app.account set status = 'restricted' where id = ${literal(identities[2].id)}::uuid;`);
    assert.deepEqual(await exportOwn(clients[2]), sections[2]);
  } finally {
    runSql(`update app.church set status = 'published' where public_id = ${literal(hiddenChurchId)}::uuid;
      update app.account set status = 'active' where id = ${literal(identities[2].id)}::uuid;`);
  }
  const definitions = () => runSql(`select jsonb_agg(jsonb_build_object('oid', oid,
    'definition', pg_get_functiondef(oid), 'acl', proacl) order by oid) from pg_proc
    where oid in ('api.export_current_account_data()'::regprocedure, 'app.export_church_administration(uuid)'::regprocedure);`);
  const before = definitions();
  runSql(readFileSync(new URL('../supabase/migrations/20261017090000_church_administration_export.sql', import.meta.url), 'utf8'));
  assert.equal(definitions(), before);
  assert.deepEqual(await exportOwn(clients[0]), sections[0]);
  assert.deepEqual(await exportOwn(clients[2]), sections[2]);
  for (const index of ['church_admin_membership_export_account', 'church_admin_invite_export_sender',
    'church_admin_invite_export_recipient', 'church_admin_event_export_actor',
    'church_admin_event_export_subject', 'church_archive_request_export_account']) {
    assert.equal(runSql(`select count(*) from pg_index where indexrelid = ${literal(`app.${index}`)}::regclass
      and indisvalid and indisready;`), '1');
  }
  assert.equal(runSql(`select count(*) from (values ('anon'),('authenticated'),('service_role')) as roles(name)
    where has_function_privilege(roles.name, 'app.export_church_administration(uuid)', 'EXECUTE');`), '0');
  assert.equal(runSql(`select has_function_privilege('anon', 'api.export_current_account_data()', 'EXECUTE')::text || ':' ||
    has_function_privilege('authenticated', 'api.export_current_account_data()', 'EXECUTE')::text || ':' ||
    has_function_privilege('service_role', 'api.export_current_account_data()', 'EXECUTE')::text;`), 'false:true:false');
}
