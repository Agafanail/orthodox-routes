import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  if (status.status !== 0) fail('The local Supabase phone test stack is not running.');

  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }

  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) {
    fail('Required local-only phone integration-test configuration is unavailable.');
  }
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for phone-boundary verification.');
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
  if (result.status !== 0) fail('A synthetic phone verification database operation failed.');
  return result.stdout.trim();
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic verified phone-test user could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Protected phone RPC failed: ${name}.`);
  return result.data;
}

function claimDelivery(container) {
  const leaseToken = randomUUID();
  const raw = runSql(
    container,
    `select row_to_json(claimed)
     from ops.claim_phone_verification_deliveries('${leaseToken}', 1) as claimed;`,
  );
  assert.ok(raw, 'The restricted worker could not claim a queued synthetic delivery.');
  return { delivery: JSON.parse(raw), leaseToken };
}

function completeDelivery(container, attemptId, leaseToken, delivered = true, expected = 't') {
  assert.equal(
    runSql(
      container,
      `select ops.complete_phone_verification_delivery(
         '${attemptId}', '${leaseToken}', ${delivered}, 'local-test', 'synthetic-provider-reference'
       );`,
    ),
    expected,
  );
}

async function claimDeliveryThroughWorkerApi(client, attemptId) {
  const leaseToken = randomUUID();
  const result = await client.schema('api').rpc('phone_worker_claim_delivery', {
    p_attempt_id: attemptId,
    p_lease_token: leaseToken,
  });
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    fail('The service-role phone worker could not claim one queued synthetic delivery.');
  }
  return { delivery: result.data[0], leaseToken };
}

async function completeDeliveryThroughWorkerApi(client, attemptId, leaseToken) {
  const result = await client.schema('api').rpc('phone_worker_complete_delivery', {
    p_attempt_id: attemptId,
    p_lease_token: leaseToken,
    p_delivered: true,
    p_provider_adapter: 'local-test',
    p_provider_reference: 'synthetic-provider-reference',
  });
  if (result.error || result.data !== true) {
    fail('The service-role phone worker could not complete one synthetic delivery.');
  }
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const password = `Local-phone-${suffix}-Aa1!`;
const identities = [
  { email: `phone-a-${suffix}@example.test`, phone: '+390000000101' },
  { email: `phone-b-${suffix}@example.test`, phone: '+390000000101' },
  { email: `phone-c-${suffix}@example.test`, phone: '+390000000103' },
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
    if (created.error || !created.data.user) fail('A synthetic phone-test identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
  }

  const clients = identities.map(() => userClient(url, publicKey));
  for (let index = 0; index < clients.length; index += 1) {
    await signIn(clients[index], identities[index].email, password);
    await rpc(clients[index], 'create_account', {
      p_display_name: `Phone Test ${index + 1}`,
      p_phone_e164: identities[index].phone,
      p_preferred_language: 'en',
    });
  }

  const anonymousRequest = await fetch(`${url}/rest/v1/rpc/request_phone_verification`, {
    method: 'POST',
    headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: JSON.stringify({ p_client_key: randomUUID(), p_phone_e164: '+390000000199' }),
  });
  assert.ok([401, 403, 404].includes(anonymousRequest.status));

  const requestKeyA = randomUUID();
  const requestedA = await rpc(clients[0], 'request_phone_verification', {
    p_client_key: requestKeyA,
    p_phone_e164: identities[0].phone,
  });
  assert.equal(requestedA.status, 'queued');
  assert.equal(requestedA.last_digits, '0101');
  assert.equal(requestedA.verification_code, undefined);
  assert.deepEqual(
    await rpc(clients[0], 'request_phone_verification', {
      p_client_key: requestKeyA,
      p_phone_e164: identities[0].phone,
    }),
    requestedA,
  );
  assert.equal((await rpc(clients[0], 'verify_phone_code', {
    p_attempt_id: requestedA.attempt_id,
    p_code: '000000',
  })).status, 'delivery_pending');
  assert.equal((await rpc(clients[1], 'verify_phone_code', {
    p_attempt_id: requestedA.attempt_id,
    p_code: '000000',
  })).status, 'invalid_attempt');

  const forbiddenWorkerClaim = await clients[0].schema('api').rpc('phone_worker_claim_delivery', {
    p_attempt_id: requestedA.attempt_id,
    p_lease_token: randomUUID(),
  });
  assert.ok(forbiddenWorkerClaim.error);

  const unrelatedWorkerClaim = await admin.schema('api').rpc('phone_worker_claim_delivery', {
    p_attempt_id: randomUUID(),
    p_lease_token: randomUUID(),
  });
  assert.equal(unrelatedWorkerClaim.error, null);
  assert.deepEqual(unrelatedWorkerClaim.data, []);

  const claimedA = await claimDeliveryThroughWorkerApi(admin, requestedA.attempt_id);
  assert.equal(claimedA.delivery.attempt_id, requestedA.attempt_id);
  assert.equal(claimedA.delivery.phone_e164, identities[0].phone);
  assert.match(claimedA.delivery.verification_code, /^[0-9]{6}$/);
  await completeDeliveryThroughWorkerApi(admin, requestedA.attempt_id, claimedA.leaseToken);

  const safeStatusA = await rpc(clients[0], 'current_phone_verification');
  assert.equal(safeStatusA.status, 'sent');
  assert.equal(safeStatusA.provider_reference, undefined);
  const wrongCode = claimedA.delivery.verification_code === '000000' ? '000001' : '000000';
  const wrongResult = await rpc(clients[0], 'verify_phone_code', {
    p_attempt_id: requestedA.attempt_id,
    p_code: wrongCode,
  });
  assert.equal(wrongResult.status, 'invalid_code');
  assert.equal(wrongResult.attempts_remaining, 4);

  const verifiedA = await rpc(clients[0], 'verify_phone_code', {
    p_attempt_id: requestedA.attempt_id,
    p_code: claimedA.delivery.verification_code,
  });
  assert.equal(verifiedA.status, 'verified');
  assert.ok(verifiedA.account.phone_verified_at);
  assert.equal(verifiedA.account.eligibility.phone_verified, true);
  assert.equal(
    runSql(
      container,
      `select count(*) from ops.phone_verification_attempt
       where id = '${requestedA.attempt_id}' and state = 'verified'
         and code_salt is null and code_digest is null;`,
    ),
    '1',
  );

  assert.equal(
    runSql(container, `select count(*) from ops.phone_verification_delivery where attempt_id = '${requestedA.attempt_id}';`),
    '0',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from information_schema.routine_privileges
       where grantee in ('anon', 'authenticated')
         and specific_schema = 'api'
         and routine_name in ('phone_worker_claim_delivery', 'phone_worker_complete_delivery')
         and privilege_type = 'EXECUTE';`,
    ),
    '0',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from information_schema.routine_privileges
       where grantee = 'service_role'
         and specific_schema = 'api'
         and routine_name in ('phone_worker_claim_delivery', 'phone_worker_complete_delivery')
         and privilege_type = 'EXECUTE';`,
    ),
    '2',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'api'
         and p.proname in ('phone_worker_claim_delivery', 'phone_worker_complete_delivery')
         and p.prosecdef and p.proconfig @> array['search_path=""'];`,
    ),
    '2',
  );
  assert.equal((await rpc(clients[0], 'request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: identities[0].phone,
  })).status, 'already_verified');

  const requestedB = await rpc(clients[1], 'request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: identities[1].phone,
  });
  const claimedB = claimDelivery(container);
  completeDelivery(container, requestedB.attempt_id, claimedB.leaseToken);
  assert.equal((await rpc(clients[1], 'verify_phone_code', {
    p_attempt_id: requestedB.attempt_id,
    p_code: claimedB.delivery.verification_code,
  })).status, 'phone_in_use');
  assert.equal((await rpc(clients[1], 'current_account')).phone_verified_at, null);

  const requestedC = await rpc(clients[2], 'request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: identities[2].phone,
  });
  assert.equal((await rpc(clients[2], 'request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: identities[2].phone,
  })).status, 'rate_limited');
  const claimedC = claimDelivery(container);
  completeDelivery(container, requestedC.attempt_id, claimedC.leaseToken);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await rpc(clients[2], 'verify_phone_code', {
      p_attempt_id: requestedC.attempt_id,
      p_code: claimedC.delivery.verification_code === '999999' ? '999998' : '999999',
    });
    assert.equal(result.status, attempt === 5 ? 'attempts_exhausted' : 'invalid_code');
  }
  assert.equal(
    runSql(
      container,
      `select count(*) from ops.phone_verification_attempt
       where id = '${requestedC.attempt_id}' and state = 'failed'
         and code_salt is null and code_digest is null;`,
    ),
    '1',
  );

  runSql(
    container,
    `update ops.phone_verification_attempt
     set requested_at = requested_at - interval '2 minutes'
     where account_id in ('${identities[1].id}', '${identities[2].id}');`,
  );
  const racePhone = '+390000000150';
  const raceRequests = await Promise.all([
    rpc(clients[1], 'request_phone_verification', {
      p_client_key: randomUUID(),
      p_phone_e164: racePhone,
    }),
    rpc(clients[2], 'request_phone_verification', {
      p_client_key: randomUUID(),
      p_phone_e164: racePhone,
    }),
  ]);
  const raceCodes = new Map();
  for (let index = 0; index < 2; index += 1) {
    const claimed = claimDelivery(container);
    raceCodes.set(claimed.delivery.attempt_id, claimed.delivery.verification_code);
    completeDelivery(container, claimed.delivery.attempt_id, claimed.leaseToken);
  }
  const raceResults = await Promise.all(
    raceRequests.map((request, index) =>
      rpc(clients[index + 1], 'verify_phone_code', {
        p_attempt_id: request.attempt_id,
        p_code: raceCodes.get(request.attempt_id),
      }),
    ),
  );
  assert.deepEqual(
    raceResults.map((result) => result.status).sort(),
    ['phone_in_use', 'verified'],
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from private.account_contact
       where account_id in ('${identities[1].id}', '${identities[2].id}')
         and phone_e164 = '${racePhone}' and phone_verified_at is not null;`,
    ),
    '1',
  );

  const unverifiedRaceIndex = raceResults.findIndex((result) => result.status === 'phone_in_use') + 1;
  runSql(
    container,
    `update ops.phone_verification_attempt
     set requested_at = requested_at - interval '2 minutes'
     where account_id = '${identities[unverifiedRaceIndex].id}';`,
  );
  const expiringRequest = await rpc(clients[unverifiedRaceIndex], 'request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: '+390000000199',
  });
  const abandonedLease = claimDelivery(container);
  assert.equal(abandonedLease.delivery.attempt_id, expiringRequest.attempt_id);
  runSql(
    container,
    `update ops.phone_verification_delivery
     set leased_at = leased_at - interval '61 seconds'
     where attempt_id = '${expiringRequest.attempt_id}';`,
  );
  const recoveredLease = claimDelivery(container);
  assert.equal(recoveredLease.delivery.attempt_id, expiringRequest.attempt_id);
  assert.equal(recoveredLease.delivery.verification_code, abandonedLease.delivery.verification_code);
  runSql(
    container,
    `update ops.phone_verification_attempt
     set requested_at = requested_at - interval '11 minutes',
         expires_at = expires_at - interval '11 minutes'
     where id = '${expiringRequest.attempt_id}';
     update ops.phone_verification_attempt
     set requested_at = requested_at - interval '20 minutes'
     where account_id = '${identities[unverifiedRaceIndex].id}'
       and id <> '${expiringRequest.attempt_id}';`,
  );
  completeDelivery(container, expiringRequest.attempt_id, recoveredLease.leaseToken, true, 'f');
  assert.equal((await rpc(clients[unverifiedRaceIndex], 'current_phone_verification')).status, 'expired');
  assert.equal(
    runSql(
      container,
      `select count(*) from ops.phone_verification_attempt as attempt
       left join ops.phone_verification_delivery as delivery on delivery.attempt_id = attempt.id
       where attempt.id = '${expiringRequest.attempt_id}'
         and attempt.state = 'expired' and attempt.code_salt is null and attempt.code_digest is null
         and delivery.attempt_id is null;`,
    ),
    '1',
  );

  assert.equal(
    runSql(
      container,
      `select count(*) from information_schema.role_table_grants
       where grantee in ('anon', 'authenticated', 'service_role')
         and table_schema = 'ops'
         and table_name in ('security_policy', 'phone_verification_attempt', 'phone_verification_delivery')
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`,
    ),
    '0',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'api'
         and p.proname in ('request_phone_verification', 'current_phone_verification', 'verify_phone_code')
         and p.prosecdef and p.proconfig @> array['search_path=""'];`,
    ),
    '3',
  );
  assert.equal(
    runSql(
      container,
      `select count(*) from information_schema.routine_privileges
       where grantee in ('anon', 'authenticated', 'service_role')
         and specific_schema = 'ops'
         and routine_name in ('claim_phone_verification_deliveries', 'complete_phone_verification_delivery')
         and privilege_type = 'EXECUTE';`,
    ),
    '0',
  );

  process.stdout.write(
    [
      'Phone verification foundation verification passed:',
      '- the authenticated API never returns OTP or provider diagnostics',
      '- only a restricted worker contract can lease transient delivery material',
      '- only the service-role Next.js worker bridge can lease the requested attempt through the Data API',
      '- cross-account attempts and anonymous requests cannot verify a phone',
      '- resend delay, expiry state, and five-attempt exhaustion are database-owned',
      '- successful verification clears recoverable code material and updates eligibility',
      '- duplicate verified-phone binding is rejected without reserving unverified input',
      '- concurrent claims of one unbound phone produce exactly one verified binding',
      '- expired queued codes are removed from both attempt and delivery storage',
      '- abandoned worker leases are recoverable while post-expiry completion is rejected',
      '- RLS, grants, and hardened function boundaries remain least-privilege',
    ].join('\n') + '\n',
  );
} finally {
  if (createdUserIds.length > 0) {
    try {
      runSql(container, `delete from app.account where id in (${createdUserIds.map((id) => `'${id}'`).join(', ')});`);
    } catch {
      // The disposable local database is rebuilt from migrations before CI verification.
    }
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}
