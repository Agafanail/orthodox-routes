import assert from 'node:assert/strict';
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

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (status.status !== 0) fail('The local Supabase account test stack is not running.');

  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }

  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');

  if (!url || !publicKey || !serviceRoleKey) {
    fail('Required local-only integration-test configuration is unavailable.');
  }

  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for database-boundary verification.');

  const container = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');

  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function runSql(container, statement, { expectFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-f',
      '-',
    ],
    { encoding: 'utf8', input: statement },
  );

  if (expectFailure) {
    assert.notEqual(result.status, 0, 'The database operation unexpectedly succeeded.');
    return '';
  }

  if (result.status !== 0) fail('A synthetic database verification operation failed.');
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic verified user could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Protected account RPC failed: ${name}.`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

function assertReason(result, reason) {
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes(reason), `Missing eligibility reason: ${reason}.`);
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const password = `Local-only-${suffix}-Aa1!`;
const identities = [
  { email: `account-a-${suffix}@example.test`, confirmed: true },
  { email: `account-b-${suffix}@example.test`, confirmed: true },
  { email: `account-unverified-${suffix}@example.test`, confirmed: false },
];
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const createdUserIds = [];

try {
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email,
      email_confirm: identity.confirmed,
      password,
    });
    if (created.error || !created.data.user) fail('A synthetic Auth identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(created.data.user.id);
  }

  const accountCountBeforeRpc = runSql(
    container,
    `select count(*) from app.account where id in ('${identities[0].id}', '${identities[1].id}', '${identities[2].id}');`,
  );
  assert.equal(accountCountBeforeRpc, '0', 'Auth identity creation materialized an application account.');

  const anonymousEligibility = await fetch(`${url}/rest/v1/rpc/current_eligibility`, {
    method: 'POST',
    headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.ok(
    [401, 403, 404].includes(anonymousEligibility.status),
    'Anonymous eligibility access was not rejected.',
  );

  runSql(
    container,
    `begin;
     set local role authenticated;
     select set_config('request.jwt.claims', '{"sub":"${identities[2].id}","role":"authenticated"}', true);
     select api.create_account('Unverified User', 'en', null);
     rollback;`,
    { expectFailure: true },
  );

  const clientA = userClient(url, publicKey);
  const clientB = userClient(url, publicKey);
  await signIn(clientA, identities[0].email, password);
  await signIn(clientB, identities[1].email, password);

  const missingAccount = await rpc(clientA, 'current_eligibility');
  assert.equal(missingAccount.email_verified, true);
  assertReason(missingAccount, 'account_missing');

  const accountA = await rpc(clientA, 'create_account', {
    p_display_name: "  Дмитрий O'Нил-Smith  ",
    p_phone_e164: '+390000000001',
    p_preferred_language: 'ru',
  });
  assert.equal(accountA.display_name, "Дмитрий O'Нил-Smith");
  assert.equal(accountA.preferred_language, 'ru');
  assert.equal(accountA.status, 'active');
  assert.equal(accountA.phone_verified_at, null);
  assert.equal(accountA.eligibility.eligible, false);
  assertReason(accountA.eligibility, 'phone_not_verified');
  assertReason(accountA.eligibility, 'adult_declaration_missing');
  assertReason(accountA.eligibility, 'current_terms_unavailable');

  await expectRpcFailure(clientA, 'create_account', {
    p_display_name: 'Duplicate',
    p_phone_e164: null,
    p_preferred_language: 'en',
  });
  assert.equal(
    runSql(container, `select count(*) from app.account where id = '${identities[0].id}';`),
    '1',
  );

  await expectRpcFailure(clientA, 'create_account', {
    p_account_id: identities[1].id,
    p_display_name: 'Wrong target',
    p_phone_e164: null,
    p_preferred_language: 'en',
  });
  assert.equal(
    runSql(container, `select count(*) from app.account where id = '${identities[1].id}';`),
    '0',
  );

  await expectRpcFailure(clientB, 'create_account', {
    p_display_name: 'Я'.repeat(81),
    p_phone_e164: '+390000000002',
    p_preferred_language: 'uk',
  });
  await expectRpcFailure(clientB, 'create_account', {
    p_display_name: 'Valid Name',
    p_phone_e164: '+390000000002',
    p_preferred_language: 'fr',
  });
  await expectRpcFailure(clientB, 'create_account', {
    p_display_name: 'Unsafe\nName',
    p_phone_e164: '+390000000002',
    p_preferred_language: 'de',
  });

  const accountB = await rpc(clientB, 'create_account', {
    p_display_name: 'Марія-Анна',
    p_phone_e164: '+390000000002',
    p_preferred_language: 'uk',
  });
  assert.equal(accountB.display_name, 'Марія-Анна');
  assert.equal(accountB.email, identities[1].email);
  assert.notEqual(accountB.email, accountA.email);

  const privateSchemaRead = await fetch(`${url}/rest/v1/account_contact?select=*`, {
    headers: {
      Accept: 'application/json',
      'Accept-Profile': 'private',
      Authorization: `Bearer ${(await clientA.auth.getSession()).data.session.access_token}`,
      apikey: publicKey,
    },
  });
  assert.ok(
    [400, 401, 403, 404, 406].includes(privateSchemaRead.status),
    'The private schema was unexpectedly readable through the Data API.',
  );

  const directPrivateUpdate = runSql(
    container,
    `begin;
     set local role authenticated;
     select set_config('request.jwt.claims', '{"sub":"${identities[0].id}","role":"authenticated"}', true);
     update private.account_contact set phone_verified_at = now() where account_id = '${identities[0].id}';
     rollback;`,
    { expectFailure: true },
  );
  assert.equal(directPrivateUpdate, '');
  await expectRpcFailure(clientA, 'mark_phone_verified');

  const tableGrantCount = runSql(
    container,
    `select count(*)
     from information_schema.role_table_grants
     where grantee in ('anon', 'authenticated')
       and table_schema in ('app', 'private')
       and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`,
  );
  assert.equal(tableGrantCount, '0', 'Application tables have broad client grants.');
  assert.equal(
    runSql(
      container,
      `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('app', 'private')
         and c.relname in ('account', 'account_contact', 'legal_document_version', 'legal_acceptance')
         and c.relrowsecurity and c.relforcerowsecurity;`,
    ),
    '4',
    'RLS and FORCE RLS are not enabled on every foundation table.',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'api'
         and p.proname in ('current_eligibility', 'current_account', 'create_account', 'update_current_account_profile', 'declare_adult', 'accept_current_terms')
         and p.prosecdef
         and p.proconfig @> array['search_path=""'];`,
    ),
    '6',
    'Protected API functions are not fully hardened.',
  );

  const declared = await rpc(clientA, 'declare_adult');
  assert.ok(declared.adult_declared_at);
  assert.equal(declared.status, 'active');
  assertReason(declared.eligibility, 'phone_not_verified');
  assertReason(declared.eligibility, 'current_terms_unavailable');

  runSql(
    container,
    `insert into app.legal_document_version
       (document_type, version, language_codes, effective_at, status, content_hash)
     values
       ('terms', 'synthetic-terms-v1', array['en','ru','it','ro','uk','de'], now() - interval '2 minutes', 'published', repeat('1', 64)),
       ('privacy_policy', 'synthetic-privacy-v1', array['en','ru','it','ro','uk','de'], now() - interval '2 minutes', 'published', repeat('2', 64));`,
  );

  let eligibilityA = await rpc(clientA, 'current_eligibility');
  assertReason(eligibilityA, 'phone_not_verified');
  assertReason(eligibilityA, 'current_terms_not_accepted');
  const firstTermsAcceptance = await rpc(clientA, 'accept_current_terms');
  const repeatedTermsAcceptance = await rpc(clientA, 'accept_current_terms');
  assert.equal(repeatedTermsAcceptance.accepted_at, firstTermsAcceptance.accepted_at);
  assert.equal(
    runSql(
      container,
      `select count(*) from app.legal_acceptance where account_id = '${identities[0].id}';`,
    ),
    '1',
    'Retrying Terms acceptance created a duplicate record.',
  );
  eligibilityA = await rpc(clientA, 'current_eligibility');
  assert.equal(eligibilityA.current_terms_version, 'synthetic-terms-v1');
  assert.equal(eligibilityA.current_terms_accepted, true);
  assertReason(eligibilityA, 'phone_not_verified');

  runSql(
    container,
    `update private.account_contact
     set phone_verified_at = now()
     where account_id = '${identities[0].id}';`,
  );
  runSql(
    container,
    `begin;
     update private.account_contact
     set phone_e164 = '+390000000001', phone_verified_at = now()
     where account_id = '${identities[1].id}';
     rollback;`,
    { expectFailure: true },
  );
  eligibilityA = await rpc(clientA, 'current_eligibility');
  assert.equal(eligibilityA.eligible, true);
  assert.deepEqual(eligibilityA.reasons, []);

  runSql(
    container,
    `insert into app.legal_document_version
       (document_type, version, language_codes, effective_at, status, content_hash)
     values
       ('terms', 'synthetic-terms-v2', array['en','ru','it','ro','uk','de'], now() - interval '1 minute', 'published', repeat('3', 64));`,
  );
  eligibilityA = await rpc(clientA, 'current_eligibility');
  assert.equal(eligibilityA.current_terms_version, 'synthetic-terms-v2');
  assert.equal(eligibilityA.current_terms_accepted, false);
  assertReason(eligibilityA, 'current_terms_not_accepted');
  assert.equal((await rpc(clientA, 'current_account')).status, 'active');

  await rpc(clientA, 'accept_current_terms');
  eligibilityA = await rpc(clientA, 'current_eligibility');
  assert.equal(eligibilityA.eligible, true);

  for (const status of ['restricted', 'deleting']) {
    runSql(
      container,
      `update app.account set status = '${status}', updated_at = now() where id = '${identities[0].id}';`,
    );
    const stateResult = await rpc(clientA, 'current_eligibility');
    assertReason(stateResult, 'account_state_not_permitted');
  }
  runSql(
    container,
    `update app.account set status = 'deleted', deleted_at = now(), updated_at = now()
     where id = '${identities[0].id}';`,
  );
  assertReason(await rpc(clientA, 'current_eligibility'), 'account_state_not_permitted');
  runSql(
    container,
    `update app.account set status = 'active', deleted_at = null, updated_at = now()
     where id = '${identities[0].id}';`,
  );

  runSql(
    container,
    `update auth.users set email_confirmed_at = null where id = '${identities[0].id}';`,
  );
  const unverifiedEmailResult = await rpc(clientA, 'current_eligibility');
  assertReason(unverifiedEmailResult, 'email_not_verified');
  assert.equal((await rpc(clientA, 'current_account')).email, identities[0].email);
  runSql(
    container,
    `update auth.users set email_confirmed_at = now() where id = '${identities[0].id}';`,
  );
  assert.equal((await rpc(clientA, 'current_eligibility')).eligible, true);

  const currentA = await rpc(clientA, 'current_account');
  const currentB = await rpc(clientB, 'current_account');
  assert.equal(currentA.display_name, "Дмитрий O'Нил-Smith");
  assert.equal(currentB.display_name, 'Марія-Анна');
  assert.notEqual(currentA.public_id, currentB.public_id);

  await expectRpcFailure(clientB, 'current_account', { p_account_id: identities[0].id });
  await expectRpcFailure(clientB, 'update_current_account_profile', {
    p_account_id: identities[0].id,
    p_display_name: 'Cross-account mutation',
    p_preferred_language: 'en',
  });
  assert.equal((await rpc(clientA, 'current_account')).display_name, "Дмитрий O'Нил-Smith");

  process.stdout.write(
    [
      'Account and eligibility foundation verification passed:',
      '- Auth identities do not auto-materialize application accounts',
      '- account RPCs derive ownership from verified authentication context',
      '- display name, language, contact, and phone-verification boundaries hold',
      '- adult declaration and current Terms acceptance are durable prerequisites',
      '- active account state remains separate from participation eligibility',
      '- restricted, deleting, deleted, and unverified-email states are ineligible',
      '- app/private tables remain behind RLS, grants, and hardened API functions',
    ].join('\n') + '\n',
  );
} finally {
  if (createdUserIds.length > 0) {
    try {
      runSql(
        container,
        `delete from app.account where id in (${createdUserIds.map((id) => `'${id}'`).join(', ')});
         delete from app.legal_document_version
         where version in ('synthetic-terms-v1', 'synthetic-terms-v2', 'synthetic-privacy-v1');`,
      );
    } catch {
      // The disposable local database is rebuilt from migrations before CI verification.
    }
  }

  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
