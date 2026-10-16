import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createOwnerQuery, loadOperatorConfiguration, operatorIdentityQuery, parseOwnerArguments, runOwnerCommand } from './church-owner-command.mjs';

const churchId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const token = 'a'.repeat(64);
const options = { churchId, action: 'archive_church', reference: 'SYNTHETIC-CASE', execute: false };
const prepared = () => ({ operation_id: operationId, operation_type: 'archive_church', token,
  expires_at: '2026-10-16T23:00:00Z', secret: 'never print', preview: {
    church_id: churchId, slug: 'synthetic-church', official_name: 'Synthetic Church', status: 'published',
    administrator_count: 1, pending_archival_requests: 0, pending_invitations: 0,
    passenger_requests: 0, driver_offers: 0, pending_responses: 0, agreements: 0, private_extra: 'never print',
  } });
const setup = () => ({ query: vi.fn().mockReturnValueOnce({ allowed: true }).mockReturnValueOnce(prepared())
  .mockReturnValueOnce({ operation_id: operationId, attempt_id: attemptId })
  .mockReturnValueOnce({ operation_id: operationId, church_id: churchId, status: 'archived', secret: token }),
  confirm: vi.fn().mockResolvedValue(`EXECUTE ${operationId}`), output: vi.fn(), interactive: true, environment: 'staging' });

describe('protected owner command', () => {
  it('accepts only fixed canonical arguments or a narrow status lookup', () => {
    expect(parseOwnerArguments(['--church', churchId, '--action', 'archive_church', '--case', 'SYNTHETIC-CASE']))
      .toEqual(options);
    expect(parseOwnerArguments(['--status', operationId])).toEqual({ statusId: operationId });
    for (const args of [[], ['--sql', 'delete from app.church'], ['--status', '../unsafe'],
      ['--church', churchId, '--action', 'archive_church', '--case', 'private@example.test'],
      ['--church', churchId, '--action', 'archive_church', '--case', 'CASE', '--case', 'OTHER'],
      ['--church', churchId, '--action', 'archive_church', '--case', 'CASE', '--execute', '--execute']]) {
      expect(() => parseOwnerArguments(args)).toThrow('Invalid owner command arguments.');
    }
  });

  it('has no application URL/password fallback and requires protected connection files', () => {
    const inspect = vi.fn().mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600 });
    expect(() => loadOperatorConfiguration({ DATABASE_URL: 'synthetic-secret' }, inspect)).toThrow();
    expect(inspect).not.toHaveBeenCalled();
    const env = { OWNER_CHURCH_PG_SERVICE: 'synthetic_owner', OWNER_CHURCH_ENVIRONMENT: 'staging',
      OWNER_CHURCH_PG_SERVICE_FILE: resolve('synthetic-service.conf'), OWNER_CHURCH_PG_PASSFILE: resolve('synthetic-passfile'),
      PATH: 'synthetic-path', PGPASSWORD: 'never inherit', SUPABASE_SECRET_KEY: 'never inherit' };
    const config = loadOperatorConfiguration(env, inspect, 'linux');
    expect(config.childEnv).toEqual({ PATH: 'synthetic-path', PGSERVICEFILE: env.OWNER_CHURCH_PG_SERVICE_FILE,
      PGPASSFILE: env.OWNER_CHURCH_PG_PASSFILE });
    inspect.mockReturnValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o644 });
    expect(() => loadOperatorConfiguration(env, inspect, 'linux')).toThrow();
    inspect.mockReturnValue({ isFile: () => true, isSymbolicLink: () => true, mode: 0o600 });
    expect(() => loadOperatorConfiguration(env, inspect, 'win32')).toThrow();
  });

  it('bounds psql without shell expansion, startup files, password argv, or stderr forwarding', () => {
    const launch = vi.fn().mockReturnValue({ status: 0, stdout: '{"allowed":true}', stderr: '' });
    const query = createOwnerQuery({ service: 'synthetic_owner', childEnv: { PGPASSFILE: 'synthetic-path' } }, launch);
    expect(query('select 1;')).toEqual({ allowed: true });
    const [command, args, settings] = launch.mock.calls[0];
    expect(command).toBe('psql');
    expect(args).toContain('--no-psqlrc');
    expect(args).toContain('--no-password');
    expect(args.at(-1)).toContain('sslmode=verify-full');
    expect(args.at(-1)).toContain('statement_timeout=15000');
    expect(settings).toMatchObject({ shell: false, timeout: 20_000, maxBuffer: 65_536 });
    query('select $1::text', [token]);
    expect(launch.mock.calls[1][2].input).toContain(`\\bind '${token}' \\g`);
    expect(launch.mock.calls[1][1].join(' ')).not.toContain(token);
    expect(launch.mock.calls[1][2].input).toContain('select $1::text');
    expect(launch.mock.calls[1][2].input.indexOf('\\if :owner_allowed'))
      .toBeLessThan(launch.mock.calls[1][2].input.indexOf(`\\bind '${token}'`));
    expect(launch.mock.calls[1][2].input).toContain('\\quit\n');
    launch.mockReturnValue({ status: 1, stdout: '', stderr: `synthetic-private-password ${token}` });
    expect(() => query('select 1;')).toThrow('Protected church operation failed.');
  });

  it('rejects a broad/unrelated identity before preparing any operation', async () => {
    expect(operatorIdentityQuery).toContain("current_setting('log_parameter_max_length') = '0'");
    expect(operatorIdentityQuery).toContain("current_setting('log_parameter_max_length_on_error') = '0'");
    expect(operatorIdentityQuery).toContain("current_setting('pgaudit.log_parameter', true)");
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValue({ allowed: false });
    await expect(runOwnerCommand(options, dependencies)).rejects.toThrow();
    expect(dependencies.query).toHaveBeenCalledTimes(1);
    expect(dependencies.output).not.toHaveBeenCalled();
  });

  it('rejects malformed bind parameters before starting a subprocess', () => {
    const launch = vi.fn();
    const query = createOwnerQuery({ service: 'synthetic_owner', childEnv: {} }, launch);
    for (const value of ["unsafe'quote", 'unsafe\\command', 'unsafe\ncommand', '`unsafe`', '', 'a'.repeat(65)]) {
      expect(() => query('select $1::text', [value])).toThrow('Protected church operation failed.');
    }
    expect(() => query('select $1::text', ['a', 'b', 'c', 'd', 'e'])).toThrow();
    expect(launch).not.toHaveBeenCalled();
  });

  it('fails closed when the same-connection preflight exits without a query result', () => {
    const launch = vi.fn().mockReturnValue({ status: 0, stdout: '', stderr: '' });
    const query = createOwnerQuery({ service: 'synthetic_owner', childEnv: {} }, launch);
    expect(() => query('select $1::text', [token])).toThrow('Protected church operation failed.');
    expect(launch.mock.calls[0][2].input).toContain('\\if :owner_allowed');
  });

  it('projects a preview without exposing the capability or unrecognized fields', async () => {
    const dependencies = setup();
    expect(await runOwnerCommand(options, dependencies)).toEqual({ status: 'preview_only', operationId });
    const output = dependencies.output.mock.calls.flat().join('\n');
    expect(output).toContain(churchId);
    expect(output).not.toContain(token);
    expect(output).not.toContain('never print');
    expect(dependencies.query).toHaveBeenCalledTimes(2);
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });

  it('requires an interactive terminal before any execute-mode connection', async () => {
    const dependencies = { ...setup(), interactive: false };
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow('interactive');
    expect(dependencies.query).not.toHaveBeenCalled();
  });

  it('cancels without executing unless the exact operation identifier is confirmed', async () => {
    const dependencies = setup(); dependencies.confirm.mockResolvedValue('yes');
    expect((await runOwnerCommand({ ...options, execute: true }, dependencies)).status).toBe('cancelled');
    expect(dependencies.query).toHaveBeenCalledTimes(2);
  });

  it('executes only the confirmed capability and prints a projected result', async () => {
    const dependencies = setup();
    expect((await runOwnerCommand({ ...options, execute: true }, dependencies)).status).toBe('archived');
    expect(dependencies.query.mock.calls[2][0]).toContain('begin_church_lifecycle_attempt');
    expect(dependencies.query.mock.calls[2][1]).toEqual([operationId, token]);
    expect(dependencies.query.mock.calls[3][0]).not.toContain(token);
    expect(dependencies.query.mock.calls[3][1]).toEqual([operationId, token, attemptId]);
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
    expect(dependencies.confirm.mock.calls[0][0]).toContain(`EXECUTE ${operationId}`);
  });

  it('refuses a malformed preview before output or confirmation', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ ...prepared(), token: ['a'.repeat(64)] });
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.output).not.toHaveBeenCalled();
    expect(dependencies.confirm).not.toHaveBeenCalled();
  });

  it('redacts unexpected transport details even after explicit confirmation', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce(prepared()).mockImplementationOnce(() => { throw new Error(`private: ${token}`); });
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies))
      .rejects.toThrow('Protected church operation failed. Review the support case before retrying.');
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
  });

  it('reads only own operation outcome without preparing or executing again', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ operation_id: operationId, church_id: churchId, operation_type: 'archive_church',
        state: 'succeeded', latest_attempt: { attempt_id: attemptId, state: 'success', token }, token, other_private: 'never print' });
    expect((await runOwnerCommand({ statusId: operationId }, dependencies)).status).toBe('succeeded');
    expect(dependencies.query.mock.calls[1][0]).toContain('ops.church_lifecycle_result');
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain('never print');
  });

  it('never submits a transition if the durable attempt start fails or is malformed', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce(prepared()).mockReturnValueOnce({ operation_id: operationId, attempt_id: token });
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.query).toHaveBeenCalledTimes(3);
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
  });

  it('preserves an interrupted attempt identifier without retrying an ambiguous transition', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce(prepared()).mockReturnValueOnce({ operation_id: operationId, attempt_id: attemptId })
      .mockImplementationOnce(() => { throw new Error(`private: ${token}`); });
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.query).toHaveBeenCalledTimes(4);
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain(attemptId);
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
  });

  it('projects unfinished attempts without calling them failures or retrying them', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ operation_id: operationId, church_id: churchId, operation_type: 'archive_church',
        state: 'prepared', latest_attempt: { attempt_id: attemptId, state: 'unfinished', secret: token } });
    expect((await runOwnerCommand({ statusId: operationId }, dependencies)).status).toBe('prepared');
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('unfinished');
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
    expect(dependencies.query).toHaveBeenCalledTimes(2);
  });

  it('does not retry a committed refusal or forward an execution error payload', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce(prepared()).mockReturnValueOnce({ operation_id: operationId, attempt_id: attemptId })
      .mockReturnValueOnce({ operation_id: operationId, execution_result: 'refused', private_error: token });
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.query).toHaveBeenCalledTimes(4);
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain(token);
  });

  it('rejects unrecognized attempt states before printing a status response', async () => {
    const dependencies = setup(); dependencies.query.mockReset().mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ operation_id: operationId, church_id: churchId, operation_type: 'archive_church',
        state: 'prepared', latest_attempt: { attempt_id: attemptId, state: token } });
    await expect(runOwnerCommand({ statusId: operationId }, dependencies)).rejects.toThrow();
    expect(dependencies.output).not.toHaveBeenCalled();
  });
});
