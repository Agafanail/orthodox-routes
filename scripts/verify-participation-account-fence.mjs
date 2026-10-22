import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Uses only the parent's eligible synthetic identity before its first durable church.
// No real owner interface, account restriction workflow, or operational policy is activated.
export async function verifyParticipationAccountFence({ container, accountId, churchArgs, sql, literal }) {
  const sessions = [];
  const open = (statement) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { child, output: '', error: '', result: null };
    session.done = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { session.output += chunk; });
      child.stderr.on('data', (chunk) => { session.error += chunk; });
      child.on('error', reject);
      child.on('close', (code) => { session.result = { code }; resolve(session.result); });
    });
    sessions.push(session);
    child.stdin.write(`\\set VERBOSITY sqlstate\n${statement}\n`);
    return session;
  };
  const wait = async (condition) => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      if (condition()) return;
      await delay(40);
    }
    throw new Error('Synthetic participation fence barrier was not observed.');
  };
  const finish = (session, statement) => session.child.stdin.end(`${statement}\n`);
  const actor = `set local role authenticated;
    select set_config('request.jwt.claims', ${literal(JSON.stringify({ sub: accountId, role: 'authenticated' }))}, true);`;
  const create = () => {
    const args = churchArgs({ p_client_key: randomUUID(), p_slug: `fence-${randomUUID()}` });
    return `select api.create_church(${[
      'p_slug', 'p_official_name', 'p_source_language', 'p_address_display', 'p_locality',
      'p_country_code', 'p_timezone',
    ].map((key) => literal(args[key])).join(', ')}, ${args.p_lat}, ${args.p_lng}, ${literal(args.p_client_key)}::uuid);`;
  };
  const account = `${literal(accountId)}::uuid`;
  const counts = () => sql(`select jsonb_build_array(
    (select count(*) from app.church where created_by = ${account}),
    (select count(*) from app.church_admin_membership where account_id = ${account}));`);
  const waiting = (name) => sql(`select exists (select 1 from pg_locks as lock
    join pg_stat_activity as activity on activity.pid = lock.pid
    where activity.application_name = ${literal(name)} and not lock.granted);`) === 't';
  const before = counts();
  try {
    assert.match(sql(`begin; ${actor} ${create()} rollback;`), /"status": "created"/);
    assert.equal(counts(), before, 'A rolled-back valid baseline must leave no church or membership.');
    assert.equal(sql(`begin read only; ${actor} select api.current_eligibility()->>'eligible'; rollback;`)
      .split(/\r?\n/).at(-2), 'true');

    const owner = open(`begin; set application_name = 'synthetic-fence-owner-first';
      update app.account set status = 'restricted' where id = ${account}; select 'owner-ready';`);
    await wait(() => owner.output.includes('owner-ready'));
    const participant = open(`begin; set application_name = 'synthetic-fence-participant-second'; ${actor} ${create()} rollback;`);
    // This must wait on the non-key status UPDATE, not only an incidental FK KEY SHARE.
    await wait(() => waiting('synthetic-fence-participant-second'));
    finish(owner, 'commit;');
    finish(participant, '');
    assert.equal((await owner.done).code, 0);
    assert.notEqual((await participant.done).code, 0);
    assert.match(participant.error, /42501/);
    assert.equal(counts(), before);
    assert.equal(sql(`begin read only; ${actor} select api.current_eligibility()->>'eligible'; rollback;`)
      .split(/\r?\n/).at(-2), 'false');
    // Restricted account self-export remains a read, not positive participation.
    assert.match(sql(`begin read only; ${actor} select jsonb_typeof(api.export_current_account_data()); rollback;`), /object/);
    sql(`update app.account set status = 'active' where id = ${account};`);

    const participantFirst = open(`begin; set application_name = 'synthetic-fence-participant-first';
      ${actor} ${create()} select 'participant-ready';`);
    await wait(() => participantFirst.output.includes('participant-ready'));
    const ownerSecond = open(`begin; set application_name = 'synthetic-fence-owner-second';
      update app.account set status = 'restricted' where id = ${account}; commit;`);
    await wait(() => waiting('synthetic-fence-owner-second'));
    finish(participantFirst, 'rollback;');
    finish(ownerSecond, '');
    assert.equal((await participantFirst.done).code, 0);
    assert.equal((await ownerSecond.done).code, 0);
    assert.equal(sql(`select status from app.account where id = ${account};`), 'restricted');
    assert.equal(counts(), before);
    sql(`update app.account set status = 'active' where id = ${account};`);

    assert.equal(sql(`select count(*) from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'api' and routine.provolatile = 'v'
        and (routine.prosrc like '%app.require_eligible_actor()%' or routine.prosrc like '%app.require_transport_actor()%');`), '0');
    assert.equal(sql(`select provolatile from pg_proc where oid =
      'app.managed_translation_target(text,uuid,text)'::regprocedure;`), 's');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(sql(`select has_function_privilege('${role}', 'app.require_mutating_actor(boolean)', 'EXECUTE')::text;`), 'false');
    }
    const migration = readFileSync(new URL('../supabase/migrations/20261020150000_participation_account_fence.sql', import.meta.url), 'utf8');
    sql(`begin; create temporary table participation_snapshot on commit drop as
      select routine.oid, pg_get_functiondef(routine.oid) as definition, routine.proacl
      from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname in ('app', 'api') and routine.prokind = 'f';
      ${migration}
      do $verify$ begin
        if exists (select 1 from participation_snapshot as snapshot join pg_proc as routine on routine.oid = snapshot.oid
          where pg_get_functiondef(routine.oid) is distinct from snapshot.definition or routine.proacl is distinct from snapshot.proacl)
        then raise exception 'Participation fence replay changed current function definitions or ACL.'; end if;
      end; $verify$; rollback;`);
    process.stdout.write('Participation account fence: both real RPC/status-update lock orders, fresh refusal, read-only eligibility/export, rollback, grants and replay.\n');
  } finally {
    for (const session of sessions) {
      if (!session.child.stdin.destroyed && !session.child.stdin.writableEnded) finish(session, 'rollback;');
    }
    await Promise.allSettled(sessions.map((session) => session.done));
    sql(`update app.account set status = 'active' where id = ${account};`);
  }
}
