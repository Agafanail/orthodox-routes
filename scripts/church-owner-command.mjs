import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[A-Z0-9][A-Z0-9._-]{3,63}$/;
const GROUP = 'orthodox_routes_church_operator';
const ACTIONS = ['archive_church', 'restore_church', 'hide_church', 'remove_church_admin'];
const failure = () => new Error('Protected church operation failed. Review the support case before retrying.');

export function parseOwnerArguments(args) {
  if (args.length === 2 && args[0] === '--status' && UUID.test(args[1])) return { statusId: args[1] };
  const values = new Map();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--execute' && !execute) { execute = true; continue; }
    if (!['--church', '--action', '--case', '--membership'].includes(key) || values.has(key)
      || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid owner command arguments.');
    values.set(key, args[++index]);
  }
  const churchId = values.get('--church'); const action = values.get('--action'); const reference = values.get('--case');
  const membershipId = values.get('--membership');
  if (!UUID.test(churchId ?? '') || !ACTIONS.includes(action)
    || !REFERENCE.test(reference ?? '') || (action === 'remove_church_admin'
      ? !UUID.test(membershipId ?? '') : membershipId !== undefined)) throw new Error('Invalid owner command arguments.');
  return { churchId, action, reference, execute, ...(membershipId ? { membershipId } : {}) };
}

/** Only explicitly supplied operational service/password files; no application URL/key fallback. */
export function loadOperatorConfiguration(env, inspect = lstatSync, platform = process.platform) {
  const service = env.OWNER_CHURCH_PG_SERVICE;
  const environment = env.OWNER_CHURCH_ENVIRONMENT;
  if (typeof service !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(service)
    || !['staging', 'production'].includes(environment)) {
    throw new Error('Separate owner connection configuration is required.');
  }
  const paths = [env.OWNER_CHURCH_PG_SERVICE_FILE, env.OWNER_CHURCH_PG_PASSFILE];
  try {
    for (const path of paths) {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error();
      const info = inspect(path);
      if (!info.isFile() || info.isSymbolicLink() || (platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error();
    }
  } catch { throw new Error('Protected operational connection files are required.'); }
  const inherited = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'APPDATA',
    'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG', 'LC_ALL']);
  const childEnv = Object.fromEntries(Object.entries(env).filter(([name, value]) =>
    inherited.has(name.toUpperCase()) && typeof value === 'string'));
  return { service, environment, childEnv: { ...childEnv, PGSERVICEFILE: paths[0], PGPASSFILE: paths[1] } };
}

export function createOwnerQuery(config, launch = spawnSync) {
  const args = ['--no-psqlrc', '--no-password', '--quiet', '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate', '--file=-',
    `--dbname=service=${config.service} sslmode=verify-full connect_timeout=5 options='-c statement_timeout=15000 -c lock_timeout=5000 -c log_parameter_max_length_on_error=0' application_name=orthodox-routes-owner`];
  return (statement, parameters = []) => {
    try {
      if (parameters.length > 4 || parameters.some((value) => typeof value !== 'string'
        || !/^[A-Za-z0-9_.:-]{1,64}$/.test(value))) throw new Error();
      // psql 17 extended-query binding keeps values out of SQL text and process arguments.
      const input = parameters.length === 0 ? statement
        : `select (${operatorIdentityPredicate}) as owner_allowed \\gset\n\\if :owner_allowed\n`
          + `${statement}\n\\bind ${parameters.map((value) => `'${value}'`).join(' ')} \\g\n`
          + '\\else\n\\quit\n\\endif\n';
      const result = launch('psql', args, { input, env: config.childEnv,
        shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, maxBuffer: 65_536 });
      if (result.status !== 0 || result.error) throw new Error();
      return JSON.parse(result.stdout.trim());
    } catch { throw failure(); } // Never forward psql stderr, SQL, credentials, capability, or provider text.
  };
}

const operatorIdentityPredicate = `session_user = current_user and session_user not in ('postgres', 'supabase_admin', 'authenticator',
    'service_role', 'anon', 'authenticated', 'supabase_auth_admin', 'supabase_storage_admin', '${GROUP}')
  and session_user::text ~ '^[a-z0-9_]{1,63}$'
  and exists (select 1 from pg_roles where rolname = session_user and rolcanlogin
    and not (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
  and pg_has_role(session_user, '${GROUP}', 'USAGE')
  and current_setting('log_parameter_max_length') = '0'
  and current_setting('log_parameter_max_length_on_error') = '0'
  and coalesce(current_setting('pgaudit.log_parameter', true), 'off') in ('off', 'false', '0')
  and not exists (select 1 from pg_auth_members where member = (select oid from pg_roles where rolname = session_user)
    and roleid <> (select oid from pg_roles where rolname = '${GROUP}'))
  and not exists (select 1 from pg_namespace where nspname in ('app', 'private', 'api', 'ops')
    and (has_schema_privilege(session_user, oid, 'CREATE')
      or (nspname <> 'ops' and has_schema_privilege(session_user, oid, 'USAGE'))))
  and not exists (select 1 from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'private', 'api', 'ops') and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(session_user, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`;
export const operatorIdentityQuery = `select jsonb_build_object('allowed', ${operatorIdentityPredicate});`;

function safePrepared(value, options) {
  if (!value || typeof value.operation_id !== 'string' || !UUID.test(value.operation_id)
    || value.operation_type !== options.action || typeof value.token !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.token) || typeof value.expires_at !== 'string'
    || value.expires_at.length > 40 || !Number.isFinite(Date.parse(value.expires_at))) throw failure();
  const preview = value.preview;
  if (!preview || preview.church_id !== options.churchId || typeof preview.slug !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preview.slug) || preview.slug.length > 200
    || typeof preview.official_name !== 'string' || preview.official_name.length > 200
    || /[\x00-\x1f\x7f]/.test(preview.official_name)
    || !['published', 'hidden', 'archive_requested', 'archived'].includes(preview.status)) throw failure();
  const counts = ['administrator_count', 'pending_archival_requests', 'pending_invitations',
    'passenger_requests', 'driver_offers', 'pending_responses', 'agreements'];
  if (counts.some((key) => !Number.isSafeInteger(preview[key]) || preview[key] < 0)) throw failure();
  if (options.action === 'remove_church_admin' && (!UUID.test(options.membershipId ?? '')
    || preview.membership_id !== options.membershipId || preview.administrator_count <= 1)) throw failure();
  return { operation_id: value.operation_id, operation_type: value.operation_type, expires_at: value.expires_at,
    preview: { church_id: preview.church_id, slug: preview.slug, official_name: preview.official_name,
      status: preview.status, ...Object.fromEntries(counts.map((key) => [key, preview[key]])),
      ...(options.action === 'remove_church_admin' ? { membership_id: options.membershipId } : {}) } };
}

export async function runOwnerCommand(options, { query, confirm, output, interactive, environment }) {
  if (options.execute && !interactive) throw new Error('Execution requires an interactive protected operator terminal.');
  try {
    if (query(operatorIdentityQuery)?.allowed !== true) throw failure();
    if (options.statusId) {
      if (!UUID.test(options.statusId)) throw failure();
      const state = query('select ops.church_lifecycle_result($1::uuid)', [options.statusId]);
      if (state?.operation_id !== options.statusId || !['prepared', 'expired', 'succeeded'].includes(state.state)
        || typeof state.church_id !== 'string' || !UUID.test(state.church_id)
        || !ACTIONS.includes(state.operation_type)) throw failure();
      let latestAttempt = null;
      if (state.latest_attempt !== null) {
        if (!state.latest_attempt || typeof state.latest_attempt.attempt_id !== 'string'
          || !UUID.test(state.latest_attempt.attempt_id)
          || !['unfinished', 'success', 'refused', 'error'].includes(state.latest_attempt.state)) throw failure();
        latestAttempt = { attempt_id: state.latest_attempt.attempt_id, state: state.latest_attempt.state };
      }
      output(JSON.stringify({ environment, operation_id: state.operation_id, operation_type: state.operation_type,
        church_id: state.church_id, state: state.state, latest_attempt: latestAttempt }));
      return { status: state.state, operationId: state.operation_id };
    }
    const reason = options.action === 'archive_church' ? 'reviewed_archival'
      : options.action === 'hide_church' ? 'reviewed_hiding' : 'reviewed_restoration';
    const prepared = options.action === 'remove_church_admin'
      ? query('select ops.prepare_church_admin_removal($1::uuid, $2::uuid, $3::text)',
        [options.churchId, options.membershipId, options.reference])
      : query('select ops.prepare_church_lifecycle($1::uuid, $2::text, $3::text, $4::text)',
        [options.churchId, options.action, options.reference, reason]);
    const safe = safePrepared(prepared, options);
    output(JSON.stringify({ environment, ...safe }));
    if (!options.execute) return { status: 'preview_only', operationId: safe.operation_id };
    if (await confirm(`Type EXECUTE ${safe.operation_id} to confirm this exact preview: `) !== `EXECUTE ${safe.operation_id}`) {
      output('Cancelled. No church transition was executed.');
      return { status: 'cancelled', operationId: safe.operation_id };
    }
    const attempt = query('select ops.begin_church_lifecycle_attempt($1::uuid, $2::text)',
      [safe.operation_id, prepared.token]);
    if (attempt?.operation_id !== safe.operation_id || typeof attempt.attempt_id !== 'string'
      || !UUID.test(attempt.attempt_id)) throw failure();
    output(JSON.stringify({ operation_id: safe.operation_id, attempt_id: attempt.attempt_id }));
    // A separate committed connection records the start before any transition request is sent.
    const result = query('select ops.execute_church_lifecycle($1::uuid, $2::text, $3::uuid)',
      [safe.operation_id, prepared.token, attempt.attempt_id]);
    const expectedStatus = options.action === 'archive_church' ? 'archived'
      : options.action === 'hide_church' ? 'hidden' : options.action === 'remove_church_admin' ? 'removed' : 'published';
    if (result?.operation_id !== safe.operation_id || result.church_id !== options.churchId
      || result.status !== expectedStatus || (options.action === 'remove_church_admin'
        && result.membership_id !== options.membershipId)) throw failure();
    // Project rather than printing the database response, even though this RPC is trusted.
    output(JSON.stringify({ operation_id: safe.operation_id, church_id: options.churchId, status: expectedStatus,
      ...(options.action === 'remove_church_admin' ? { membership_id: options.membershipId } : {}) }));
    return { status: expectedStatus, operationId: safe.operation_id };
  } catch { throw failure(); }
}

async function main() {
  let terminal;
  try {
    const options = parseOwnerArguments(process.argv.slice(2));
    if (options.execute && (!process.stdin.isTTY || !process.stdout.isTTY)) {
      throw new Error('Execution requires an interactive protected operator terminal.');
    }
    const config = loadOperatorConfiguration(process.env);
    await runOwnerCommand(options, {
      query: createOwnerQuery(config), environment: config.environment,
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY), output: (line) => process.stdout.write(`${line}\n`),
      confirm: async (question) => {
        terminal = createInterface({ input: process.stdin, output: process.stdout });
        return terminal.question(question);
      },
    });
  } catch { process.stderr.write('Protected owner command failed; inspect the case and connection configuration.\n'); process.exitCode = 1; }
  finally { terminal?.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
