import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase church-administration test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only integration configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for church-administration verification.');
  const container = result.stdout.split(/\r?\n/).map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function runSql(container, statement, { expectFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'The church-administration database operation unexpectedly succeeded.');
    return '';
  }
  if (result.status !== 0) fail('A synthetic church-administration database operation failed.');
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic church administrator could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Protected church-administration RPC failed: ${name}.`);
  return result.data;
}

async function rpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const compactSuffix = suffix.replaceAll('-', '');
const password = `Church-${suffix}-Aa1!`;
const identities = Array.from({ length: 5 }, (_, index) => ({
  email: `church-admin-${index + 1}-${suffix}@example.test`,
  name: `Church Administrator ${index + 1}`,
  phone: `+3900000010${index + 1}`,
}));
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const createdUserIds = [];

const churchArgs = (overrides = {}) => ({
  p_address_display: 'Via Test 10, Torino',
  p_client_key: randomUUID(),
  p_country_code: 'IT',
  p_lat: 45.0703,
  p_lng: 7.6869,
  p_locality: 'Torino',
  p_official_name: 'Synthetic Orthodox Church',
  p_slug: `synthetic-church-${compactSuffix}`,
  p_source_language: 'en',
  p_timezone: 'Europe/Rome',
  ...overrides,
});

try {
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email, email_confirm: true, password,
    });
    if (created.error || !created.data.user) fail('A synthetic church identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
  }

  const clients = identities.map(() => userClient(url, publicKey));
  for (let index = 0; index < clients.length; index += 1) {
    await signIn(clients[index], identities[index].email, password);
    await rpc(clients[index], 'create_account', {
      p_display_name: identities[index].name,
      p_phone_e164: identities[index].phone,
      p_preferred_language: 'en',
    });
    await rpc(clients[index], 'declare_adult');
  }
  runSql(container, `
    insert into app.legal_document_version (
      document_type, version, language_codes, effective_at, status, content_hash
    ) values (
      'terms', ${sqlLiteral(`church-test-${suffix}`)}, array['en'],
      now() - interval '1 hour', 'published', repeat('d', 64)
    );
  `);
  for (const client of clients) await rpc(client, 'accept_current_terms');
  runSql(container, `
    update private.account_contact set phone_verified_at = now()
    where account_id in (${identities.slice(0, 4).map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
  `);

  const anonymousCreate = await fetch(`${url}/rest/v1/rpc/create_church`, {
    method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: JSON.stringify(churchArgs()),
  });
  assert.ok([401, 403, 404].includes(anonymousCreate.status));
  await rpcFailure(clients[4], 'create_church', churchArgs({
    p_slug: `ineligible-church-${compactSuffix}`,
  }));

  const creationKey = randomUUID();
  const firstArgs = churchArgs({ p_client_key: creationKey });
  const created = await rpc(clients[0], 'create_church', firstArgs);
  assert.equal(created.status, 'created');
  assert.equal(created.slug, firstArgs.p_slug);
  assert.equal(created.safe_route, `/churches/${firstArgs.p_slug}`);
  assert.deepEqual(await rpc(clients[0], 'create_church', firstArgs), created);
  await rpcFailure(clients[0], 'create_church', {
    ...firstArgs, p_official_name: 'Changed input with reused key',
  });

  const publicChurch = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(publicChurch.church_id, created.church_id);
  assert.equal(publicChurch.official_name, firstArgs.p_official_name);
  assert.equal(publicChurch.address, firstArgs.p_address_display);

  const managedByCreator = await rpc(clients[0], 'current_managed_churches');
  assert.equal(managedByCreator.length, 1);
  assert.equal(managedByCreator[0].church_id, created.church_id);
  assert.equal(managedByCreator[0].administrator_count, 1);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const duplicateArgs = churchArgs({
    p_client_key: randomUUID(), p_lat: 45.0705, p_lng: 7.6871,
    p_official_name: 'Duplicate Attempt', p_slug: `duplicate-church-${compactSuffix}`,
  });
  const duplicate = await rpc(clients[1], 'create_church', duplicateArgs);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.church_id, created.church_id);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const suspicious = await rpc(clients[1], 'create_church', churchArgs({
    p_client_key: randomUUID(), p_lat: 46.0703, p_lng: 8.6869,
    p_official_name: 'Same Address Far Away', p_slug: `suspicious-church-${compactSuffix}`,
  }));
  assert.equal(suspicious.status, 'potential_duplicate');
  assert.equal(suspicious.church_id, undefined);

  const secondArgs = churchArgs({
    p_address_display: 'Piazza Test 20, Milano',
    p_client_key: randomUUID(),
    p_lat: 45.4642,
    p_lng: 9.19,
    p_locality: 'Milano',
    p_official_name: 'Second Synthetic Orthodox Church',
    p_slug: `second-synthetic-church-${compactSuffix}`,
  });
  const second = await rpc(clients[1], 'create_church', secondArgs);
  assert.equal(second.status, 'created');
  assert.equal((await rpc(clients[1], 'current_managed_churches'))[0].church_id, second.church_id);

  const firstInternalId = runSql(container,
    `select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[1].id)}::uuid, 'invite'),
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[2].id)}::uuid, 'invite');
  `);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[3].id)}::uuid, 'invite');
  `, { expectFailure: true });
  assert.equal(runSql(container, `select count(*) from app.church_admin_membership
    where church_id = ${sqlLiteral(firstInternalId)}::uuid and status = 'active';`), '3');

  assert.equal(runSql(container, `select count(*) from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role')
      and table_schema in ('app', 'private')
      and table_name in ('church_slug_history', 'church_admin_membership', 'church_admin_event', 'church_operation')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`), '0');
  assert.equal(runSql(container, `select count(*) from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'private')
      and relation.relname in ('church_slug_history', 'church_admin_membership', 'church_admin_event', 'church_operation')
      and relation.relrowsecurity and relation.relforcerowsecurity;`), '4');
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = ${sqlLiteral(firstInternalId)}::uuid
      and event_type in ('church.created', 'membership.joined');`), '2');

  process.stdout.write([
    'Church administration foundation verification passed:',
    '- only fully eligible actors can publish a church page',
    '- creation is actor-derived, idempotent, and immediately creates the first equal administrator place',
    '- normalized-address and PostGIS proximity checks return the existing safe page instead of duplicating it',
    '- suspicious same-address geography fails closed for protected review',
    '- administrator membership is limited to three places and grants no visitor transport access',
    '- administrative tables remain behind forced RLS with no direct application-role grants',
  ].join('\n') + '\n');
} finally {
  if (createdUserIds.length > 0) {
    try {
      const accountList = createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
      runSql(container, `
        delete from app.church_admin_event where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_admin_membership where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_slug_history where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.church_operation where actor_account_id in (${accountList});
        delete from app.church where created_by in (${accountList});
        delete from app.account where id in (${accountList});
        delete from app.legal_document_version where version = ${sqlLiteral(`church-test-${suffix}`)};
      `);
    } catch {
      // The disposable local database is rebuilt before every CI integration run.
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }
}
