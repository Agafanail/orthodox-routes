import { describe, expect, it, vi } from 'vitest';
import { parseOwnerArguments, runOwnerCommand } from './church-owner-command.mjs';

const church = '11111111-1111-4111-8111-111111111111';
const caseId = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const operation = '44444444-4444-4444-8444-444444444444';
const attempt = '55555555-5555-4555-8555-555555555555';
const action = 'reconcile_church_administration_case';
const options = { churchId: church, administrationCaseId: caseId, action, reference: 'SYNTHETIC-CASE', execute: false };
const args = ['--church', church, '--action', action, '--case', 'SYNTHETIC-CASE'];
function fixture(resolution = 'replacement') {
  const prepared = { operation_id: operation, operation_type: action, token: 'a'.repeat(64), expires_at: '2026-10-30T18:00:00Z',
    preview: { church_id: church, administration_case_id: caseId, membership_id: member, resolution,
      slug: 'synthetic-church', official_name: 'Synthetic Church', status: resolution === 'archive' ? 'archived' : 'published',
      administrator_count: resolution === 'archive' ? 0 : 1, pending_archival_requests: 0, pending_invitations: 0,
      passenger_requests: 0, driver_offers: 0, pending_responses: 0, agreements: 0, private_extra: 'never print' } };
  const result = { operation_id: operation, church_id: church, administration_case_id: caseId, membership_id: member,
    resolution, status: 'reconciled', private_extra: 'never print' };
  const dependencies = { query: vi.fn().mockReturnValueOnce({ allowed: true }).mockReturnValueOnce(prepared)
    .mockReturnValueOnce({ operation_id: operation, attempt_id: attempt }).mockReturnValueOnce(result),
  confirm: vi.fn().mockResolvedValue(`EXECUTE ${operation}`), output: vi.fn(), interactive: true, environment: 'staging' };
  return { prepared, result, dependencies };
}

describe('reviewed case reconciliation command', () => {
  it('accepts only a selected case without new membership/identity inputs', () => {
    expect(parseOwnerArguments([...args, '--administration-case', caseId])).toEqual(options);
    for (const suffix of [[], ['--administration-case', 'private@example.test'],
      ['--administration-case', caseId, '--membership', member], ['--administration-case', caseId, '--support-deletion'],
      ['--administration-case', caseId, '--replacement', member]]) {
      expect(() => parseOwnerArguments([...args, ...suffix])).toThrow();
    }
    expect(() => parseOwnerArguments(['--church', church, '--action', 'archive_church', '--case', 'CASE',
      '--administration-case', caseId])).toThrow();
  });
  it('keeps reconciliation preview-only by default and projects only safe references', async () => {
    const { dependencies } = fixture();
    expect((await runOwnerCommand(options, dependencies)).status).toBe('preview_only');
    expect(dependencies.query.mock.calls[1]).toEqual([
      'select ops.prepare_church_case_reconciliation($1::uuid, $2::uuid, $3::text)', [church, caseId, 'SYNTHETIC-CASE']]);
    expect(dependencies.query).toHaveBeenCalledTimes(2); expect(dependencies.confirm).not.toHaveBeenCalled();
    const output = dependencies.output.mock.calls.flat().join('\n');
    expect(output).toContain(member); expect(output).not.toContain('a'.repeat(64)); expect(output).not.toContain('never print');
  });
  it.each(['replacement', 'archive'])('confirms only the selected observed %s resolution', async (resolution) => {
    const { dependencies } = fixture(resolution);
    expect((await runOwnerCommand({ ...options, execute: true }, dependencies)).status).toBe('reconciled');
    expect(dependencies.query.mock.calls[2][0]).toContain('begin_church_lifecycle_attempt');
    expect(dependencies.query.mock.calls[3][0]).toContain('execute_church_lifecycle');
    expect(JSON.parse(dependencies.output.mock.calls.at(-1)![0])).toEqual({ operation_id: operation, church_id: church,
      status: 'reconciled', administration_case_id: caseId, membership_id: member, resolution });
  });
  it.each(['case', 'membership', 'resolution', 'coverage', 'visibility'])('refuses invalid %s preview before confirmation', async (kind) => {
    const { prepared, dependencies } = fixture(kind === 'visibility' ? 'archive' : 'replacement');
    if (kind === 'case') prepared.preview.administration_case_id = church;
    if (kind === 'membership') prepared.preview.membership_id = 'private@example.test';
    if (kind === 'resolution') prepared.preview.resolution = 'remove_account';
    if (kind === 'coverage') prepared.preview.administrator_count = 0;
    if (kind === 'visibility') prepared.preview.status = 'published';
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.confirm).not.toHaveBeenCalled(); expect(dependencies.output).not.toHaveBeenCalled();
  });
  it.each(['administration_case_id', 'membership_id', 'resolution'])('refuses a substituted %s result', async (field) => {
    const { result, dependencies } = fixture();
    result[field as 'administration_case_id' | 'membership_id' | 'resolution'] = field === 'resolution' ? 'archive' : church;
    await expect(runOwnerCommand({ ...options, execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain('"status":"reconciled"');
  });
});
