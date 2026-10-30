import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Called only from the existing exact-container/CLI-local account verifier.
// No sender, public confirmation page, deletion executor or provider is invoked.
export async function verifyAccountDeletionConfirmation({ admin, url, publicKey, password, sql, container }) {
  const origin = new URL(url);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)
    || container !== 'supabase_db_orthodox-routes') throw new Error('Deletion confirmation verification requires the exact local stack.');
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const subjects = [];
  const invoke = (client, name, args = {}) => client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(12_000));
  const rpc = async (client, name, args = {}) => {
    const result = await invoke(client, name, args); assert.equal(Boolean(result.error), false, `Deletion confirmation RPC failed: ${name}.`);
    return result.data;
  };
  const makeUser = async () => {
    const email = `deletion-confirmation-${randomUUID()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(Boolean(created.error), false); assert.equal(typeof created.data.user?.id, 'string');
    const id = created.data.user.id; subjects.push(id);
    const client = createClient(url, publicKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(Boolean(signedIn.error), false); assert.equal(Boolean(signedIn.data.session), true);
    return { id, email, client, token: signedIn.data.session.access_token };
  };
  const reset = () => {
    if (subjects.length === 0) return;
    const selected = subjects.map((id) => `${literal(id)}::uuid`).join(',');
    sql(`delete from ops.audit_event where target_type = 'deletion_request' and target_id in (
      select id from ops.deletion_request where subject_auth_id in (${selected}));
      delete from ops.deletion_request where subject_auth_id in (${selected});`);
  };
  const asyncSql = (input) => new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f', '-'], { windowsHide: true, timeout: 20_000 });
    let output = ''; let error = ''; child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { error += data; });
    child.on('error', reject); child.on('close', (code) => resolve({ code, output, state: /ERROR:\s+([A-Z0-9]{5})/.exec(error)?.[1] ?? null })); child.stdin.end(input);
  });
  const waitFor = async (condition) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (sql(`select ${condition};`) === 't') return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Deletion confirmation concurrency barrier was not reached.');
  };
  try {
    const owner = await makeUser(); const other = await makeUser();
    const anonymous = createClient(url, publicKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
    const request = (key) => rpc(owner.client, 'request_account_deletion_confirmation', { p_client_key: key });
    const confirm = (id, proof, client = owner.client) => rpc(client, 'confirm_account_deletion_email', { p_request_id: id, p_email_token: proof });
    const claim = (lease = randomUUID()) => rpc(admin, 'account_deletion_confirmation_mail_claim', { p_lease_token: lease });
    const complete = (job, lease, outcome) => rpc(admin, 'account_deletion_confirmation_mail_complete',
      { p_job_id: job.job_id, p_lease_token: lease, p_outcome: outcome });
    const rowState = (id) => sql(`select state from ops.deletion_request where id = ${literal(id)}::uuid;`);
    const domain = () => sql(`select md5(jsonb_agg(jsonb_build_array(to_jsonb(identity), to_jsonb(account), to_jsonb(contact), to_jsonb(preference))
      order by identity.id)::text) from auth.users as identity left join app.account as account on account.id = identity.id
      left join private.account_contact as contact on contact.account_id = identity.id
      left join private.notification_preference as preference on preference.account_id = identity.id
      where identity.id in (${subjects.map((id) => `${literal(id)}::uuid`).join(',')});`);
    const original = domain();
    assert.equal(/^[0-9a-f]{32}$/.test(original), true);
    assert.equal(sql(`select count(*) from app.account where id = ${literal(owner.id)}::uuid;`), '0');
    const bindingAt = (zone) => sql(`set timezone = ${literal(zone)}; select app.lock_deletion_confirmation_email(${literal(owner.id)}::uuid);`).split(/\r?\n/).at(-1);
    const initialBinding = bindingAt('UTC'); assert.equal(/^[0-9a-f]{64}$/.test(initialBinding), true);
    assert.equal(initialBinding, bindingAt('Pacific/Kiritimati'));
    for (const client of [anonymous, admin]) {
      assert.equal(Boolean((await invoke(client, 'request_account_deletion_confirmation', { p_client_key: randomUUID() })).error), true);
      assert.equal(Boolean((await invoke(client, 'confirm_account_deletion_email', { p_request_id: randomUUID(), p_email_token: 'a'.repeat(64) })).error), true);
      assert.equal(Boolean((await invoke(client, 'current_account_deletion_confirmation')).error), true);
    }
    for (const client of [anonymous, owner.client]) {
      assert.equal(Boolean((await invoke(client, 'account_deletion_confirmation_mail_claim', { p_lease_token: randomUUID() })).error), true);
      assert.equal(Boolean((await invoke(client, 'expire_account_deletion_confirmations', { p_limit: 100 })).error), true);
    }
    // GET receives no real proof in its URL; a scanner cannot create consent.
    const scanned = await fetch(`${url}/rest/v1/rpc/request_account_deletion_confirmation?p_client_key=${randomUUID()}`, {
      method: 'GET', headers: { apikey: publicKey, authorization: `Bearer ${owner.token}`, 'accept-profile': 'api' },
    });
    assert.equal(scanned.ok, false); await scanned.body?.cancel();
    sql(`begin; set local role authenticated; select set_config('request.jwt.claims',
      ${literal(JSON.stringify({ sub: owner.id, role: 'authenticated', amr: [] }))}, true);
      select api.request_account_deletion_confirmation(${literal(randomUUID())}::uuid); rollback;`, { expectFailure: true });
    const reauthAge = Number(sql('select sensitive_reauth_max_age_seconds from ops.security_policy where singleton;'));
    const reauthenticatedAt = Number(sql('select floor(extract(epoch from clock_timestamp()))::bigint;')) - reauthAge + 3;
    const authGateName = `del-reauth-${randomUUID()}`;
    const authGate = asyncSql(`set application_name = ${literal(authGateName)}; begin;
      select id from auth.users where id = ${literal(owner.id)}::uuid for update; select pg_sleep(4); commit;`);
    let staleRequester;
    try {
      await waitFor(`exists (select 1 from pg_stat_activity where application_name = ${literal(authGateName)} and wait_event = 'PgSleep')`);
      // Only this negative clock fixture supplies SQL claims; the positive paths below use actual signed Auth HTTP sessions.
      staleRequester = asyncSql(`set application_name = ${literal(`${authGateName}-wait`)}; begin; set local role authenticated;
        select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: owner.id, role: 'authenticated',
          amr: [{ method: 'password', timestamp: reauthenticatedAt }] }))}, true);
        select api.request_account_deletion_confirmation(${literal(randomUUID())}::uuid); commit;`);
      await waitFor(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${authGateName}-wait`)} and wait_event_type = 'Lock')`);
      assert.equal(sql(`select to_timestamp(${reauthenticatedAt}) + make_interval(secs => ${reauthAge}) > clock_timestamp();`), 't');
      const result = await staleRequester; assert.equal(result.code !== 0, true); assert.equal(result.state, '42501');
      assert.equal(sql(`select count(*) from ops.deletion_request where subject_auth_id = ${literal(owner.id)}::uuid;`), '0');
    } finally { await Promise.all([authGate, staleRequester].filter(Boolean)); }
    const key = randomUUID(); const repeated = await Promise.all([request(key), request(key)]);
    assert.deepEqual(repeated[0], repeated[1]); const intent = repeated[0];
    assert.equal(intent.status, 'awaiting_email'); assert.equal(intent.schema_version, 1);
    assert.deepEqual(Object.keys(intent).sort(), ['email_confirmed_at', 'expires_at', 'request_id', 'schema_version', 'status']);
    assert.equal(Boolean((await invoke(owner.client, 'request_account_deletion_confirmation', { p_client_key: randomUUID() })).error), true);
    assert.deepEqual(await rpc(owner.client, 'current_account_deletion_confirmation'), intent);
    assert.equal(await rpc(other.client, 'current_account_deletion_confirmation'), null);
    assert.equal(sql(`select count(*) from ops.audit_event where target_type = 'deletion_request' and target_id = ${literal(intent.request_id)}::uuid;`), '1');
    const leases = [randomUUID(), randomUUID()]; const simultaneous = await Promise.all(leases.map(claim));
    assert.equal(simultaneous.filter(Boolean).length, 1); const firstIndex = simultaneous.findIndex(Boolean);
    const first = simultaneous[firstIndex]; const lease = leases[firstIndex];
    assert.equal(first.request_id === intent.request_id, true); assert.equal(first.destination_email === owner.email, true);
    assert.equal(first.language, 'en'); assert.equal(/^[0-9a-f]{64}$/.test(first.email_token), true);
    assert.deepEqual(Object.keys(first).sort(), ['attempt_count', 'destination_email', 'email_token', 'evaluated_at', 'expires_at', 'job_id', 'language', 'lease_until', 'request_id']);
    assert.equal(sql(`select email_proof_hash <> ${literal(first.email_token)} and mail_lease_hash <> ${literal(lease)}
      from ops.deletion_request where id = ${literal(intent.request_id)}::uuid;`), 't');
    assert.equal((await confirm(intent.request_id, first.email_token, other.client)).status, 'unavailable');
    assert.equal((await confirm(randomUUID(), first.email_token)).status, 'unavailable');
    assert.equal((await confirm(intent.request_id, 'f'.repeat(64))).status, 'unavailable');
    assert.equal(await complete(first, randomUUID(), 'sent'), false);
    assert.equal(await complete(first, lease, 'unknown'), false);
    assert.equal(await complete(first, lease, 'temporary_failure'), true);
    assert.equal(await complete(first, lease, 'sent'), false);
    sql(`update ops.deletion_request set mail_next_at = clock_timestamp() where id = ${literal(intent.request_id)}::uuid;`);
    const secondLease = randomUUID(); const second = await claim(secondLease);
    assert.equal(second.request_id === intent.request_id, true); assert.equal(second.attempt_count, 2);
    assert.equal(second.email_token === first.email_token, false);
    assert.equal((await confirm(intent.request_id, first.email_token)).status, 'unavailable');
    assert.equal(await complete(second, secondLease, 'sent'), true);
    try {
      sql(`create function app.synthetic_deletion_consent_failure() returns trigger language plpgsql as $$ begin
        if new.id = ${literal(intent.request_id)}::uuid and new.state = 'email_confirmed' then raise exception 'Synthetic private consent failure'; end if;
        return new; end; $$;
        create trigger synthetic_deletion_consent_failure after update on ops.deletion_request
          for each row execute function app.synthetic_deletion_consent_failure();`);
      assert.equal(Boolean((await invoke(owner.client, 'confirm_account_deletion_email',
        { p_request_id: intent.request_id, p_email_token: second.email_token })).error), true);
      assert.equal(rowState(intent.request_id), 'pending_email');
      assert.equal(sql(`select count(*) from ops.audit_event where target_id = ${literal(intent.request_id)}::uuid;`), '1');
    } finally {
      sql('drop trigger if exists synthetic_deletion_consent_failure on ops.deletion_request; drop function if exists app.synthetic_deletion_consent_failure();');
    }
    const confirmations = await Promise.all([confirm(intent.request_id, second.email_token), confirm(intent.request_id, second.email_token)]);
    assert.deepEqual(confirmations[0], confirmations[1]); assert.equal(confirmations[0].status, 'email_confirmed');
    assert.equal(await complete(second, secondLease, 'sent'), false);
    assert.equal(sql(`select count(*) from ops.audit_event where target_id = ${literal(intent.request_id)}::uuid;`), '2');
    const historicalReceipt = sql(`begin; update ops.deletion_request set created_at = created_at - interval '16 minutes',
      expires_at = expires_at - interval '16 minutes', email_confirmed_at = email_confirmed_at - interval '16 minutes'
      where id = ${literal(intent.request_id)}::uuid; select api.expire_account_deletion_confirmations(100);
      select app.deletion_confirmation_ack(${literal(intent.request_id)}::uuid); rollback;`);
    assert.equal(JSON.parse(historicalReceipt.split(/\r?\n/).filter((line) => line.startsWith('{')).at(-1)).status, 'email_confirmed');
    assert.equal(domain(), original); assert.equal(sql(`select count(*) from app.account where id = ${literal(owner.id)}::uuid;`), '0');
    const validSession = await owner.client.auth.getUser(); assert.equal(Boolean(validSession.error), false);
    assert.equal(validSession.data.user?.id === owner.id, true);
    const confirmedEmailTime = sql(`select email_confirmed_at::text from auth.users where id = ${literal(owner.id)}::uuid;`);
    try {
      sql(`update auth.users set email_confirmed_at = clock_timestamp() where id = ${literal(owner.id)}::uuid;`);
      assert.equal((await confirm(intent.request_id, second.email_token)).status, 'unavailable');
      assert.equal(rowState(intent.request_id), 'closed');
    } finally { sql(`update auth.users set email_confirmed_at = ${literal(confirmedEmailTime)}::timestamptz where id = ${literal(owner.id)}::uuid;`); }
    reset();

    await rpc(owner.client, 'create_account', { p_display_name: 'Synthetic Deletion Subject', p_preferred_language: 'uk', p_phone_e164: null });
    sql(`update app.account set status = 'restricted', updated_at = clock_timestamp() where id = ${literal(owner.id)}::uuid;
      update private.notification_preference set ride_email_enabled = false, web_push_enabled = false where account_id = ${literal(owner.id)}::uuid;`);
    assert.equal((await rpc(owner.client, 'current_eligibility')).eligible, false);
    const restricted = await request(randomUUID()); const restrictedJob = await claim();
    assert.equal(restrictedJob.request_id === restricted.request_id, true); assert.equal(restrictedJob.language, 'uk');
    sql(`update private.account_contact set email_changed_at = clock_timestamp() where account_id = ${literal(owner.id)}::uuid;`);
    assert.equal((await confirm(restricted.request_id, restrictedJob.email_token)).status, 'unavailable');
    sql(`update private.account_contact set email_changed_at = null where account_id = ${literal(owner.id)}::uuid;`);
    assert.equal((await confirm(restricted.request_id, restrictedJob.email_token)).status, 'unavailable');
    assert.equal(rowState(restricted.request_id), 'closed');

    const changed = await request(randomUUID()); const gateName = `del-email-${randomUUID()}`;
    const emailGate = asyncSql(`set application_name = ${literal(gateName)}; begin;
      update auth.users set email = ${literal(`changed-${randomUUID()}@example.test`)} where id = ${literal(owner.id)}::uuid;
      select pg_sleep(4); commit;`);
    let pendingClaim;
    try {
      await waitFor(`exists (select 1 from pg_stat_activity where application_name = ${literal(gateName)} and wait_event = 'PgSleep')`);
      pendingClaim = claim();
      await waitFor(`exists (select 1 from pg_stat_activity where usename = 'authenticator' and wait_event_type = 'Lock'
        and query like '%account_deletion_confirmation_mail_claim%')`);
      assert.equal(await pendingClaim, null); assert.equal(rowState(changed.request_id), 'closed');
    } finally {
      await Promise.all([emailGate, pendingClaim].filter(Boolean));
      sql(`update auth.users set email = ${literal(owner.email)} where id = ${literal(owner.id)}::uuid;`);
    }
    const expiringKey = randomUUID(); const expiring = await request(expiringKey); const expiringJob = await claim();
    assert.equal(expiringJob.request_id === expiring.request_id, true);
    sql(`with instant as materialized (select clock_timestamp() as value) update ops.deletion_request
      set created_at = instant.value - interval '15 minutes' + interval '3 seconds', expires_at = instant.value + interval '3 seconds',
      mail_lease_until = instant.value + interval '3 seconds' from instant where id = ${literal(expiring.request_id)}::uuid;`);
    const expiryGateName = `del-expiry-${randomUUID()}`;
    const expiryGate = asyncSql(`set application_name = ${literal(expiryGateName)}; begin;
      select id from ops.deletion_request where id = ${literal(expiring.request_id)}::uuid for update; select pg_sleep(4); commit;`);
    let pendingConfirmation;
    try {
      await waitFor(`exists (select 1 from pg_stat_activity where application_name = ${literal(expiryGateName)} and wait_event = 'PgSleep')`);
      pendingConfirmation = confirm(expiring.request_id, expiringJob.email_token);
      await waitFor(`exists (select 1 from pg_stat_activity where usename = 'authenticator' and wait_event_type = 'Lock'
        and query like '%confirm_account_deletion_email%')`);
      assert.equal(sql(`select expires_at > clock_timestamp() from ops.deletion_request where id = ${literal(expiring.request_id)}::uuid;`), 't');
      assert.equal((await pendingConfirmation).status, 'unavailable'); assert.equal(rowState(expiring.request_id), 'closed');
    } finally { await Promise.all([expiryGate, pendingConfirmation].filter(Boolean)); }
    assert.equal((await request(expiringKey)).status, 'unavailable');
    reset();
    const housekeeping = await request(randomUUID());
    sql(`with instant as materialized (select clock_timestamp() as value) update ops.deletion_request
      set created_at = instant.value - interval '16 minutes', expires_at = instant.value - interval '1 minute'
      from instant where id = ${literal(housekeeping.request_id)}::uuid;`);
    const logicallyExpired = await rpc(owner.client, 'current_account_deletion_confirmation');
    assert.equal(logicallyExpired.request_id === housekeeping.request_id, true); assert.equal(logicallyExpired.status, 'unavailable');
    assert.equal(rowState(housekeeping.request_id), 'pending_email');
    assert.equal((await rpc(admin, 'expire_account_deletion_confirmations', { p_limit: 1 })).expired_requests, 1);
    assert.equal(Boolean((await invoke(admin, 'expire_account_deletion_confirmations', { p_limit: 101 })).error), true);
    assert.equal(rowState(housekeeping.request_id), 'closed'); reset();

    const softDeleted = await request(randomUUID());
    try {
      // Source-state fixture only, not real Auth deletion/session revocation.
      sql(`update auth.users set deleted_at = clock_timestamp() where id = ${literal(owner.id)}::uuid;`);
      assert.equal(await claim(), null); assert.equal(rowState(softDeleted.request_id), 'closed');
    } finally { sql(`update auth.users set deleted_at = null where id = ${literal(owner.id)}::uuid;`); }
    const lateAckIntent = await request(randomUUID()); const lateAckLease = randomUUID(); const lateAckJob = await claim(lateAckLease);
    assert.equal(lateAckJob.request_id === lateAckIntent.request_id, true);
    sql(`update ops.deletion_request set mail_lease_until = clock_timestamp() + interval '3 seconds' where id = ${literal(lateAckIntent.request_id)}::uuid;`);
    const ackGateName = `del-ack-${randomUUID()}`;
    const ackGate = asyncSql(`set application_name = ${literal(ackGateName)}; begin;
      select id from ops.deletion_request where id = ${literal(lateAckIntent.request_id)}::uuid for update; select pg_sleep(4); commit;`);
    let pendingAck;
    try {
      await waitFor(`exists (select 1 from pg_stat_activity where application_name = ${literal(ackGateName)} and wait_event = 'PgSleep')`);
      pendingAck = complete(lateAckJob, lateAckLease, 'sent');
      await waitFor(`exists (select 1 from pg_stat_activity where usename = 'authenticator' and wait_event_type = 'Lock'
        and query like '%account_deletion_confirmation_mail_complete%')`);
      assert.equal(sql(`select mail_lease_until > clock_timestamp() from ops.deletion_request where id = ${literal(lateAckIntent.request_id)}::uuid;`), 't');
      assert.equal(await pendingAck, false);
      assert.equal(sql(`select mail_state = 'claimed' and mail_attempt_count = 1 from ops.deletion_request where id = ${literal(lateAckIntent.request_id)}::uuid;`), 't');
    } finally { await Promise.all([ackGate, pendingAck].filter(Boolean)); }
    reset();

    const bounded = await request(randomUUID()); let finalJob;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const leaseToken = randomUUID(); const job = await claim(leaseToken);
      assert.equal(job.request_id === bounded.request_id, true); assert.equal(job.attempt_count, attempt); finalJob = job;
      if (attempt < 5) {
        assert.equal(await complete(job, leaseToken, 'temporary_failure'), true);
        sql(`update ops.deletion_request set mail_next_at = clock_timestamp() where id = ${literal(bounded.request_id)}::uuid;`);
      }
    }
    sql(`update ops.deletion_request set mail_lease_until = clock_timestamp() - interval '1 second'
      where id = ${literal(bounded.request_id)}::uuid;`);
    assert.equal(await claim(), null);
    assert.equal(sql(`select mail_state = 'failed' and mail_attempt_count = 5 from ops.deletion_request where id = ${literal(bounded.request_id)}::uuid;`), 't');
    assert.equal((await confirm(bounded.request_id, finalJob.email_token)).status, 'email_confirmed');
    const exported = await rpc(owner.client, 'export_current_account_data');
    assert.equal(exported.deletion_confirmations.length, 1);
    assert.equal(exported.deletion_confirmations[0].request_id === bounded.request_id, true);
    assert.equal(exported.deletion_confirmations[0].status, 'email_confirmed');
    assert.deepEqual(Object.keys(exported.deletion_confirmations[0]).sort(),
      ['closed_at', 'confirmation_expires_at', 'email_confirmed_at', 'request_id', 'requested_at', 'status']);
    assert.equal(JSON.stringify(exported.deletion_confirmations).includes(finalJob.email_token), false);
    assert.equal(JSON.stringify(exported.deletion_confirmations).includes(owner.email), false);
    await rpc(other.client, 'create_account', { p_display_name: 'Synthetic Other Deletion Subject', p_preferred_language: 'en', p_phone_e164: null });
    assert.deepEqual((await rpc(other.client, 'export_current_account_data')).deletion_confirmations, []);
    const snapshot = () => sql(`select jsonb_agg(jsonb_build_object('oid', routine.oid, 'definition', md5(pg_get_functiondef(routine.oid)),
      'acl', routine.proacl::text) order by routine.oid) from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname in ('api','app') and (routine.proname like '%deletion%'
        or routine.proname in ('require_recent_reauthentication', 'require_recent_reauthentication_at', 'export_current_account_data'));`);
    const expected = snapshot();
    sql(readFileSync(new URL('../supabase/migrations/20261030100000_account_deletion_confirmation.sql', import.meta.url), 'utf8'));
    assert.equal(snapshot(), expected);
    for (const role of ['anon', 'authenticated', 'service_role', 'orthodox_routes_church_operator']) {
      assert.equal(sql(`select has_table_privilege(${literal(role)}, 'ops.deletion_request', 'SELECT,INSERT,UPDATE,DELETE');`), 'f');
      for (const signature of ['app.lock_deletion_confirmation_email(uuid)', 'app.deletion_confirmation_ack(uuid)',
        'app.close_deletion_confirmation(uuid,text)', 'app.audit_deletion_confirmation(uuid,text)', 'app.export_deletion_confirmations(uuid)',
        'app.require_recent_reauthentication()', 'app.require_recent_reauthentication_at(timestamptz)']) {
        assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`), 'f');
      }
      for (const signature of ['api.request_account_deletion_confirmation(uuid)', 'api.current_account_deletion_confirmation()',
        'api.confirm_account_deletion_email(uuid,text)']) {
        assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`), role === 'authenticated' ? 't' : 'f');
      }
      for (const signature of ['api.account_deletion_confirmation_mail_claim(uuid)',
        'api.account_deletion_confirmation_mail_complete(uuid,uuid,text)', 'api.expire_account_deletion_confirmations(integer)']) {
        assert.equal(sql(`select has_function_privilege(${literal(role)}, ${literal(signature)}, 'EXECUTE');`), role === 'service_role' ? 't' : 'f');
      }
    }
    assert.equal(sql(`select relrowsecurity and relforcerowsecurity from pg_class where oid = 'ops.deletion_request'::regclass;`), 't');
    assert.equal(sql(`select count(*) from pg_proc where oid in ('app.require_recent_reauthentication()'::regprocedure,
      'app.require_recent_reauthentication_at(timestamptz)'::regprocedure) and provolatile = 's' and not prosecdef
      and proconfig @> array['search_path=""'];`), '2');
    process.stdout.write('Purpose-bound deletion confirmation verified: real authenticated own/pre-account/restricted requests, no account creation/deletion, idempotency/concurrency, current mailbox/target/token/reauth boundaries, proof rotation, rollback, actual source/expiry waits, bounded mail recovery, maintenance and replay.\n');
  } finally {
    reset();
    for (const id of subjects) {
      sql(`delete from app.account where id = ${literal(id)}::uuid;`);
      const removed = await admin.auth.admin.deleteUser(id); assert.equal(Boolean(removed.error), false, 'Synthetic deletion confirmation identity cleanup failed.');
    }
  }
}
