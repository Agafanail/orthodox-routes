import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable local database only. No provider adapter or real recipient is used.
export async function verifyNotificationPreferenceHandoff({ admin, actor, accountId, container, rpc, sql, literal }) {
  const sourceId = randomUUID(), name = `notify-pref-${randomUUID()}`;
  const trigger = `verify_pref_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const lock = `hashtextextended(${literal(name)}, 0)`;
  const launch = (statement, hold = false) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume();
    const done = new Promise((resolve, reject) => {
      child.on('error', reject); child.on('close', (code) => resolve(code));
    });
    if (hold) child.stdin.write(statement); else child.stdin.end(statement);
    return { child, done };
  };
  const wait = async (condition) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (sql(`select (${condition})::text;`) === 'true') return;
      await delay(50);
    }
    throw new Error('Synthetic notification preference barrier was not observed.');
  };
  const change = (email) => rpc(actor, 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: email, p_web_push_enabled: false,
  });
  const fixture = `select notification.id from app.notification as notification
    where notification.recipient_account_id = ${literal(accountId)}::uuid
      and notification.object_public_id = ${literal(sourceId)}::uuid`;
  const before = await rpc(actor, 'current_notification_preferences');
  let gate, creator;
  try {
    await change(true);
    sql(`create function private.${trigger}() returns trigger language plpgsql set search_path = '' as $barrier$
      begin perform pg_advisory_xact_lock(${lock}); return new; end; $barrier$;
      revoke all on function private.${trigger}() from public, anon, authenticated, service_role;
      create trigger ${trigger} before insert on app.notification for each row
        when (new.recipient_account_id = ${literal(accountId)}::uuid and new.object_public_id = ${literal(sourceId)}::uuid)
        execute function private.${trigger}();`);
    gate = launch(`set application_name = ${literal(name)}; begin; select pg_advisory_xact_lock(${lock});\n`, true);
    await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(name)} and state = 'idle in transaction')`);
    creator = launch(`set application_name = ${literal(`${name}-create`)}; set statement_timeout = '15s';
      select app.create_notification(${literal(accountId)}::uuid, 'ride.response.received', 'ride_response',
        ${literal(sourceId)}::uuid, '/trips', 'notifications.response_received', '{}'::jsonb, 99);`);
    await wait(`exists (select 1 from pg_stat_activity where application_name = ${literal(`${name}-create`)} and wait_event = 'advisory')`);
    // The actual authenticated preference RPC commits before any notification/job exists.
    assert.equal((await change(false)).ride_email_enabled, false);
    gate.child.stdin.end('commit;\n');
    assert.equal(await gate.done, 0); assert.equal(await creator.done, 0);
    assert.equal(sql(`select count(*) from app.notification_delivery as delivery
      where delivery.notification_id in (${fixture}) and delivery.channel = 'email' and delivery.state = 'queued';`), '1',
    'The test must causally reproduce late enqueue, not manufacture a delivery row.');
    const claimed = await rpc(admin, 'notification_worker_claim_job_v3', { p_lease_token: randomUUID(), p_channels: ['email'] });
    // Compare only a boolean, so a failed regression never logs a private destination/key payload.
    assert.equal(Boolean(claimed), false, 'A late ordinary notification crossed the selected worker handoff after committed opt-out.');
  } finally {
    if (gate && !gate.child.stdin.writableEnded) gate.child.stdin.end('rollback;\n');
    await Promise.all([gate?.done, creator?.done].filter(Boolean));
    sql(`drop trigger if exists ${trigger} on app.notification; drop function if exists private.${trigger}();
      delete from app.outbox_job where payload_reference in (select delivery.id from app.notification_delivery as delivery
        where delivery.notification_id in (${fixture}));
      delete from app.notification where id in (${fixture});`);
    await rpc(actor, 'update_notification_preference', { p_client_key: randomUUID(),
      p_ride_email_enabled: before.ride_email_enabled, p_web_push_enabled: before.web_push_enabled });
  }
}
