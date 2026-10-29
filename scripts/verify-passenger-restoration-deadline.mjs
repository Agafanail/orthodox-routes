import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Real authenticated HTTP RPC and a read-only row-lock barrier in the disposable CI database.
export async function verifyPassengerRestorationDeadline({ requestId, container, attempt, sql, literal }) {
  const name = `restore-deadline-${randomUUID()}`, clientKey = randomUUID();
  const target = `public_id = ${literal(requestId)}::uuid`;
  const originalArrival = sql(`select desired_arrival_at from app.passenger_request where ${target};`);
  const wait = async (condition) => {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
      if (sql(`select (${condition})::text;`) === 'true') return;
      await delay(50);
    }
    throw new Error('Synthetic passenger restoration deadline barrier was not observed.');
  };
  const gate = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  gate.stdout.resume(); gate.stderr.resume();
  const closed = new Promise((resolve, reject) => { gate.on('error', reject); gate.on('close', (code) => resolve(code)); });
  let pending;
  try {
    sql(`update app.passenger_request set desired_arrival_at = clock_timestamp() + interval '4 seconds' where ${target};`);
    // Do not update the row in this transaction: a changed tuple would trigger a different
    // PostgreSQL recheck and could conceal the stale pre-lock time predicate being tested.
    gate.stdin.write(`set application_name = ${literal(name)}; begin;
      select id from app.passenger_request where ${target} for update;\n`);
    await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and state = 'idle in transaction')`);
    pending = attempt({ p_request_id: requestId, p_client_key: clientKey });
    await wait(`exists (select 1 from pg_stat_activity where usename = 'authenticator'
      and state = 'active' and wait_event_type = 'Lock' and query ilike '%restore_passenger_request%')`);
    assert.equal(sql(`select (desired_arrival_at > clock_timestamp())::text from app.passenger_request where ${target};`), 'true',
      'The request must be waiting before its deadline, not already expired before the call.');
    await wait(`exists (select 1 from app.passenger_request where ${target} and desired_arrival_at <= clock_timestamp())`);
    gate.stdin.end('commit;\n');
    assert.equal(await closed, 0);
    const result = await pending;
    assert.equal(Boolean(result.error), true, 'Restoration published an elapsed request after waiting on its unchanged row.');
    assert.equal(result.error.code, 'P0002', 'Expected a fresh deadline refusal, not an unrelated timeout/error.');
    assert.equal(sql(`select status from app.passenger_request where ${target};`), 'restore');
    assert.equal(sql(`select count(*) from private.transport_operation where operation_type = 'restore_passenger_request'
      and client_key = ${literal(clientKey)}::uuid;`), '0');
    sql(`update app.passenger_request set desired_arrival_at = ${literal(originalArrival)}::timestamptz where ${target};`);
    const restored = await attempt({ p_request_id: requestId, p_client_key: clientKey });
    assert.equal(Boolean(restored.error), false); assert.equal(restored.data.status, 'active');
    const replay = await attempt({ p_request_id: requestId, p_client_key: clientKey });
    assert.equal(Boolean(replay.error), false); assert.deepEqual(replay.data, restored.data);
    const definition = () => sql(`select md5(pg_get_functiondef(routine.oid)) || ':' || routine.proacl::text
      from pg_proc as routine where routine.oid = 'api.restore_passenger_request(uuid,uuid)'::regprocedure;`);
    const expectedDefinition = definition();
    sql(readFileSync(new URL('../supabase/migrations/20261029130000_passenger_restoration_deadline.sql', import.meta.url), 'utf8'));
    assert.equal(definition(), expectedDefinition);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(sql(`select has_function_privilege(
      ${literal(role)}, 'api.restore_passenger_request(uuid,uuid)', 'EXECUTE')::text;`), role === 'authenticated' ? 'true' : 'false');
    process.stdout.write('Passenger restoration deadline: actual HTTP row wait crossing expiry refused, no recorded success, future retry and idempotent replay passed.\n');
  } finally {
    if (!gate.stdin.writableEnded) gate.stdin.end('rollback;\n');
    await Promise.all([closed, pending].filter(Boolean));
    sql(`update app.passenger_request set desired_arrival_at = ${literal(originalArrival)}::timestamptz where ${target};`);
  }
}
