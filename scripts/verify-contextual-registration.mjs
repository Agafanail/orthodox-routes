import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
  if (status.status !== 0) fail('The local Supabase contextual-registration test stack is not running.');

  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }

  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) {
    fail('Required local-only contextual-registration configuration is unavailable.');
  }
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for contextual-registration verification.');
  const container = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function runSql(container, statement) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (result.status !== 0) fail('A contextual-registration database assertion failed.');
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic contextual-registration user could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Contextual-registration RPC failed: ${name}: ${result.error.message}`);
  return result.data;
}

async function expectRpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

function capability() {
  return randomBytes(32).toString('hex');
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const password = `Local-draft-${suffix}-Aa1!`;
const identities = [
  { email: `draft-a-${suffix}@example.test` },
  { email: `draft-b-${suffix}@example.test` },
  { email: `draft-no-account-${suffix}@example.test` },
];
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const createdUserIds = [];

try {
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email,
      email_confirm: true,
      password,
    });
    if (created.error || !created.data.user) fail('A synthetic contextual-registration identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
  }

  const clients = identities.map(() => userClient(url, publicKey));
  for (let index = 0; index < clients.length; index += 1) {
    await signIn(clients[index], identities[index].email, password);
    if (index === 2) continue;
    await rpc(clients[index], 'create_account', {
      p_display_name: `Draft Test ${index + 1}`,
      p_phone_e164: `+39000000020${index + 1}`,
      p_preferred_language: 'en',
    });
  }

  const noAccountToken = capability();
  const noAccountDraft = await rpc(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: { churchId: 'church-no-account', passengerCount: 1 },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_display_name: 'Unmaterialized Passenger',
    p_phone_e164: '+390000000298',
    p_preferred_language: 'en',
    p_resume_token: noAccountToken,
    p_rate_key: capability(),
  });
  await rpc(admin, 'attach_contextual_draft_email', {
    p_email: identities[2].email,
    p_resume_token: noAccountToken,
    p_rate_key: capability(),
  });
  const noAccountClaim = await rpc(clients[2], 'claim_contextual_draft', {
    p_resume_token: noAccountToken,
  });
  assert.equal(noAccountClaim.status, 'claimed');
  assert.equal(noAccountClaim.eligibility.account_exists, false);
  assert.equal(noAccountClaim.registration_profile.phone, '+390000000298');
  await expectRpcFailure(clients[1], 'materialize_contextual_account', {
    p_display_name: 'Wrong Actor',
    p_draft_id: noAccountDraft.draft_id,
    p_phone_e164: '+390000000297',
    p_preferred_language: 'en',
  });
  const materializedAccount = await rpc(clients[2], 'materialize_contextual_account', {
    p_display_name: 'Unmaterialized Passenger',
    p_draft_id: noAccountDraft.draft_id,
    p_phone_e164: '+390000000298',
    p_preferred_language: 'en',
  });
  assert.equal(materializedAccount.display_name, 'Unmaterialized Passenger');
  assert.equal(materializedAccount.phone, '+390000000298');
  const materializedDraft = await rpc(clients[2], 'current_contextual_draft', {
    p_draft_id: noAccountDraft.draft_id,
  });
  assert.equal(materializedDraft.eligibility.account_exists, true);
  assert.equal(materializedDraft.registration_profile, null);
  assert.equal(
    runSql(container, `select count(*) from private.contextual_draft where public_id = '${noAccountDraft.draft_id}' and auth_user_id = '${identities[2].id}' and account_id = '${identities[2].id}';`),
    '1',
  );
  await rpc(clients[2], 'cancel_contextual_draft', { p_draft_id: noAccountDraft.draft_id });

  const anonymousCreate = await fetch(`${url}/rest/v1/rpc/create_contextual_registration`, {
    method: 'POST',
    headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_action_type: 'passenger_request',
      p_payload: { churchId: 'church-1' },
      p_payload_version: 1,
      p_client_key: randomUUID(),
      p_resume_token: capability(),
      p_rate_key: capability(),
    }),
  });
  assert.ok([401, 403, 404].includes(anonymousCreate.status));
  await expectRpcFailure(clients[0], 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: { churchId: 'church-1' },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: capability(),
    p_rate_key: capability(),
  });

  const draftToken = capability();
  const clientKey = randomUUID();
  const payload = {
    churchId: 'church-1',
    serviceId: 'service-1',
    seatsRequired: 2,
    notes: 'Near the west entrance',
  };
  const created = await rpc(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: payload,
    p_payload_version: 1,
    p_client_key: clientKey,
    p_display_name: '  Draft Passenger  ',
    p_phone_e164: '+390000000299',
    p_preferred_language: 'en',
    p_resume_token: draftToken,
    p_rate_key: capability(),
  });
  assert.equal(created.status, 'open');
  assert.match(created.draft_id, /^[0-9a-f-]{36}$/);
  assert.ok(created.expires_at);
  assert.equal(created.payload, undefined);
  assert.equal(created.resume_token, undefined);

  assert.deepEqual(
    await rpc(admin, 'create_contextual_registration', {
      p_action_type: 'passenger_request',
      p_payload: payload,
      p_payload_version: 1,
      p_client_key: clientKey,
      p_display_name: 'Draft Passenger',
      p_phone_e164: '+390000000299',
      p_preferred_language: 'en',
      p_resume_token: draftToken,
      p_rate_key: capability(),
    }),
    created,
  );
  await expectRpcFailure(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: { ...payload, seatsRequired: 3 },
    p_payload_version: 1,
    p_client_key: clientKey,
    p_display_name: 'Different Passenger',
    p_phone_e164: '+390000000299',
    p_preferred_language: 'en',
    p_resume_token: draftToken,
    p_rate_key: capability(),
  });

  const throttledRateKey = capability();
  runSql(container, 'update ops.security_policy set contextual_draft_create_limit = 2 where singleton;');
  for (let request = 0; request < 2; request += 1) {
    assert.equal((await rpc(admin, 'create_contextual_registration', {
      p_action_type: 'passenger_request',
      p_payload: { churchId: 'church-rate-test', request },
      p_payload_version: 1,
      p_client_key: randomUUID(),
      p_resume_token: capability(),
      p_rate_key: throttledRateKey,
    })).status, 'open');
  }
  assert.equal((await rpc(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: { churchId: 'church-rate-test', request: 3 },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: capability(),
    p_rate_key: throttledRateKey,
  })).status, 'rate_limited');
  runSql(container, 'update ops.security_policy set contextual_draft_create_limit = 20 where singleton;');

  const concurrentKey = randomUUID();
  const concurrentToken = capability();
  const concurrentResults = await Promise.all([
    rpc(admin, 'create_contextual_registration', {
      p_action_type: 'driver_offer',
      p_payload: { churchId: 'church-1', seatsAvailable: 3 },
      p_payload_version: 1,
      p_client_key: concurrentKey,
      p_display_name: 'Concurrent Driver',
      p_phone_e164: '+390000000296',
      p_preferred_language: 'en',
      p_resume_token: concurrentToken,
      p_rate_key: capability(),
    }),
    rpc(admin, 'create_contextual_registration', {
      p_action_type: 'driver_offer',
      p_payload: { churchId: 'church-1', seatsAvailable: 3 },
      p_payload_version: 1,
      p_client_key: concurrentKey,
      p_display_name: 'Concurrent Driver',
      p_phone_e164: '+390000000296',
      p_preferred_language: 'en',
      p_resume_token: concurrentToken,
      p_rate_key: capability(),
    }),
  ]);
  assert.deepEqual(concurrentResults[0], concurrentResults[1]);

  for (const forbiddenPayload of [
    { email: identities[0].email },
    { nested: { phoneNumber: '+390000000299' } },
    { entries: [{ resumeToken: capability() }] },
  ]) {
    await expectRpcFailure(admin, 'create_contextual_registration', {
      p_action_type: 'passenger_request',
      p_payload: forbiddenPayload,
      p_payload_version: 1,
      p_client_key: randomUUID(),
      p_resume_token: capability(),
      p_rate_key: capability(),
    });
  }
  await expectRpcFailure(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: { notes: 'x'.repeat(17000) },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: capability(),
    p_rate_key: capability(),
  });
  await expectRpcFailure(admin, 'create_contextual_registration', {
    p_action_type: 'passenger_request',
    p_payload: payload,
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: 'weak-token',
    p_rate_key: capability(),
  });

  const attached = await rpc(admin, 'attach_contextual_draft_email', {
    p_email: identities[0].email.toUpperCase(),
    p_resume_token: draftToken,
    p_rate_key: capability(),
  });
  assert.equal(attached.status, 'attached');
  assert.equal(attached.draft_id, created.draft_id);
  assert.equal((await rpc(admin, 'attach_contextual_draft_email', {
    p_email: identities[1].email,
    p_resume_token: draftToken,
    p_rate_key: capability(),
  })).status, 'email_mismatch');

  assert.equal(await rpc(clients[1], 'claim_contextual_draft', { p_resume_token: draftToken }), null);
  assert.equal(await rpc(clients[1], 'current_contextual_draft', { p_draft_id: created.draft_id }), null);
  const claimed = await rpc(clients[0], 'claim_contextual_draft', { p_resume_token: draftToken });
  assert.equal(claimed.draft_id, created.draft_id);
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.action_type, 'passenger_request');
  assert.deepEqual(claimed.payload, payload);
  assert.equal(claimed.registration_profile, null);
  assert.equal(claimed.eligibility.account_exists, true);
  assert.equal(claimed.eligibility.eligible, false);
  assert.deepEqual(await rpc(clients[0], 'claim_contextual_draft', { p_resume_token: draftToken }), claimed);
  await expectRpcFailure(clients[0], 'clear_contextual_registration_profile', {
    p_draft_id: created.draft_id,
  });
  assert.equal((await rpc(clients[0], 'current_contextual_draft', {
    p_draft_id: created.draft_id,
  })).registration_profile, null);
  assert.equal(
    runSql(container, `select count(*) from private.contextual_draft where public_id = '${created.draft_id}' and state = 'claimed' and result_id is null;`),
    '1',
    'Claiming a draft must not publish or complete it.',
  );

  assert.equal(await rpc(clients[1], 'cancel_contextual_draft', { p_draft_id: created.draft_id }), null);
  const cancelled = await rpc(clients[0], 'cancel_contextual_draft', { p_draft_id: created.draft_id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(
    runSql(container, `select count(*) from private.contextual_draft where public_id = '${created.draft_id}' and state = 'cancelled' and payload is null and resume_token_digest is null and intended_email_salt is null and intended_email_digest is null;`),
    '1',
  );

  const expiringToken = capability();
  const expiring = await rpc(admin, 'create_contextual_registration', {
    p_action_type: 'ride_response',
    p_payload: { offerId: randomUUID(), seatsRequested: 1 },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: expiringToken,
    p_rate_key: capability(),
  });
  runSql(container, `update private.contextual_draft set created_at = clock_timestamp() - interval '2 seconds', expires_at = clock_timestamp() - interval '1 second' where public_id = '${expiring.draft_id}';`);
  assert.equal((await rpc(admin, 'attach_contextual_draft_email', {
    p_email: identities[0].email,
    p_resume_token: expiringToken,
    p_rate_key: capability(),
  })).status, 'expired');
  assert.equal(
    runSql(container, `select count(*) from private.contextual_draft where public_id = '${expiring.draft_id}' and state = 'expired' and payload is null and resume_token_digest is null;`),
    '1',
  );

  const completableToken = capability();
  const completable = await rpc(admin, 'create_contextual_registration', {
    p_action_type: 'church_create',
    p_payload: { name: 'Synthetic Parish', city: 'Rome' },
    p_payload_version: 1,
    p_client_key: randomUUID(),
    p_resume_token: completableToken,
    p_rate_key: capability(),
  });
  await rpc(admin, 'attach_contextual_draft_email', {
    p_email: identities[0].email,
    p_resume_token: completableToken,
    p_rate_key: capability(),
  });
  await rpc(clients[0], 'claim_contextual_draft', { p_resume_token: completableToken });
  const resultId = randomUUID();
  assert.equal(
    runSql(container, `select app.complete_contextual_draft('${identities[0].id}', id, 'church', '${resultId}') from private.contextual_draft where public_id = '${completable.draft_id}';`),
    't',
  );
  assert.equal(
    runSql(container, `select count(*) from private.contextual_draft where public_id = '${completable.draft_id}' and state = 'completed' and payload is null and resume_token_digest is null and result_type = 'church' and result_id = '${resultId}';`),
    '1',
  );

  const databaseBoundary = JSON.parse(runSql(
    container,
    `select json_build_object(
       'forced_rls', (select relforcerowsecurity from pg_class where oid = 'private.contextual_draft'::regclass),
       'table_grants', (select count(*) from information_schema.role_table_grants where table_schema = 'private' and table_name = 'contextual_draft' and grantee in ('anon', 'authenticated', 'service_role')),
       'profile_table_grants', (select count(*) from information_schema.role_table_grants where table_schema = 'private' and table_name = 'contextual_registration_profile' and grantee in ('anon', 'authenticated', 'service_role')),
       'rate_table_grants', (select count(*) from information_schema.role_table_grants where table_schema = 'ops' and table_name = 'contextual_draft_rate_limit' and grantee in ('anon', 'authenticated', 'service_role')),
       'anonymous_writes', (select count(*) from information_schema.routine_privileges where specific_schema = 'api' and routine_name in ('create_contextual_draft', 'create_contextual_registration', 'attach_contextual_draft_email') and grantee in ('anon', 'authenticated')),
       'service_writes', (select count(*) from information_schema.routine_privileges where specific_schema = 'api' and routine_name in ('create_contextual_registration', 'attach_contextual_draft_email') and grantee = 'service_role'),
       'legacy_create_grants', (select count(*) from information_schema.routine_privileges where specific_schema = 'api' and routine_name = 'create_contextual_draft' and grantee = 'service_role'),
       'completion_grants', (select count(*) from information_schema.routine_privileges where specific_schema = 'app' and routine_name = 'complete_contextual_draft' and grantee in ('anon', 'authenticated', 'service_role')),
       'materialize_grants', (select count(*) from information_schema.routine_privileges where specific_schema = 'api' and routine_name = 'materialize_contextual_account' and grantee = 'authenticated'),
       'obsolete_helper_grants', (select count(*) from information_schema.routine_privileges where specific_schema = 'api' and routine_name in ('clear_contextual_registration_profile', 'link_contextual_draft_account') and grantee in ('anon', 'authenticated', 'service_role')),
       'unsafe_definers', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname like '%contextual%' and p.prosecdef and not p.proconfig @> array['search_path=""'])
     );`,
  ));
  assert.equal(databaseBoundary.forced_rls, true);
  assert.equal(databaseBoundary.table_grants, 0);
  assert.equal(databaseBoundary.profile_table_grants, 0);
  assert.equal(databaseBoundary.rate_table_grants, 0);
  assert.equal(databaseBoundary.anonymous_writes, 0);
  assert.equal(databaseBoundary.service_writes, 2);
  assert.equal(databaseBoundary.legacy_create_grants, 0);
  assert.equal(databaseBoundary.completion_grants, 0);
  assert.equal(databaseBoundary.materialize_grants, 1);
  assert.equal(databaseBoundary.obsolete_helper_grants, 0);
  assert.equal(databaseBoundary.unsafe_definers, 0);

  console.log('Contextual registration draft verification passed.');
} finally {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}
