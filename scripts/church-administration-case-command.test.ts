import { describe, expect, it, vi } from 'vitest';
import { parseOwnerArguments, runOwnerCommand } from './church-owner-command.mjs';

const church = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const incoming = '33333333-3333-4333-8333-333333333333';
const operation = '44444444-4444-4444-8444-444444444444';
const supportCase = '55555555-5555-4555-8555-555555555555';
const attempt = '66666666-6666-4666-8666-666666666666';
const base = ['--church', church, '--case', 'SYNTHETIC-CASE', '--support-deletion'];
const options = { churchId: church, reference: 'SYNTHETIC-CASE', supportDeletion: true, execute: false, membershipId: member };
function fixture(action = 'archive_church') {
  const prepared = { operation_id: operation, operation_type: action, token: 'a'.repeat(64),
    expires_at: '2026-10-29T16:00:00Z', preview: { church_id: church, slug: 'synthetic-church',
      official_name: 'Synthetic Church', status: 'published', administrator_count: 1, pending_archival_requests: 0,
      pending_invitations: 0, passenger_requests: 0, driver_offers: 0, pending_responses: 0, agreements: 0,
      membership_id: member, administration_case_id: supportCase, replacement_account_id: incoming,
      private_extra: 'never print' } };
  const result = { operation_id: operation, church_id: church, status: action === 'archive_church' ? 'archived' : 'replaced',
    membership_id: member, replacement_account_id: incoming, replacement_membership_id: attempt, private_extra: 'never print' };
  const dependencies = { query: vi.fn().mockReturnValueOnce({ allowed: true }).mockReturnValueOnce(prepared)
    .mockReturnValueOnce({ operation_id: operation, attempt_id: attempt }).mockReturnValueOnce(result),
  confirm: vi.fn().mockResolvedValue(`EXECUTE ${operation}`), output: vi.fn(), interactive: true, environment: 'staging' };
  return { prepared, dependencies };
}

describe('reviewed final-administrator support command', () => {
  it('requires an exact outgoing membership for either supported decision', () => {
    expect(parseOwnerArguments([...base, '--action', 'archive_church', '--membership', member]))
      .toEqual({ ...options, action: 'archive_church' });
    expect(parseOwnerArguments([...base, '--action', 'replace_church_admin', '--membership', member, '--replacement', incoming]))
      .toEqual({ ...options, action: 'replace_church_admin', replacementAccountId: incoming });
    for (const args of [[...base, '--action', 'archive_church'],
      [...base, '--action', 'hide_church', '--membership', member],
      [...base, '--action', 'remove_church_admin', '--membership', member],
      [...base, '--action', 'archive_church', '--membership', member, '--support-deletion']]) {
      expect(() => parseOwnerArguments(args)).toThrow();
    }
  });
  it.each(['archive_church', 'replace_church_admin'])('prepares %s through only its case-bound contract', async (action) => {
    const { dependencies } = fixture(action);
    await runOwnerCommand({ ...options, action, ...(action === 'replace_church_admin' ? { replacementAccountId: incoming } : {}) }, dependencies);
    expect(dependencies.query.mock.calls[1]).toEqual(action === 'archive_church'
      ? ['select ops.prepare_church_administration_archival($1::uuid, $2::uuid, $3::text)', [church, member, 'SYNTHETIC-CASE']]
      : ['select ops.prepare_church_administration_replacement($1::uuid, $2::uuid, $3::uuid, $4::text)', [church, member, incoming, 'SYNTHETIC-CASE']]);
    expect(dependencies.confirm).not.toHaveBeenCalled(); expect(dependencies.query).toHaveBeenCalledTimes(2);
    const output = dependencies.output.mock.calls.flat().join('\n');
    expect(output).toContain(supportCase); expect(output).toContain(member);
    expect(output).not.toContain('a'.repeat(64)); expect(output).not.toContain('never print');
  });
  it.each(['missing case', 'bad case', 'wrong membership', 'not final'])('refuses a %s preview before confirmation', async (kind) => {
    const { prepared, dependencies } = fixture();
    if (kind === 'missing case') delete (prepared.preview as Partial<typeof prepared.preview>).administration_case_id;
    if (kind === 'bad case') prepared.preview.administration_case_id = 'private@example.test';
    if (kind === 'wrong membership') prepared.preview.membership_id = incoming;
    if (kind === 'not final') prepared.preview.administrator_count = 2;
    await expect(runOwnerCommand({ ...options, action: 'archive_church', execute: true }, dependencies)).rejects.toThrow();
    expect(dependencies.confirm).not.toHaveBeenCalled(); expect(dependencies.output).not.toHaveBeenCalled();
  });
  it.each(['archive_church', 'replace_church_admin'])('uses the committed attempt and projects native %s success safely', async (action) => {
    const { dependencies } = fixture(action);
    const result = await runOwnerCommand({ ...options, action, execute: true,
      ...(action === 'replace_church_admin' ? { replacementAccountId: incoming } : {}) }, dependencies);
    expect(result.status).toBe(action === 'archive_church' ? 'archived' : 'replaced');
    expect(dependencies.query.mock.calls[2][0]).toContain('begin_church_lifecycle_attempt');
    expect(dependencies.query.mock.calls[3][0]).toContain('execute_church_lifecycle');
    const output = JSON.parse(dependencies.output.mock.calls.at(-1)![0]);
    expect(output.administration_case_id).toBe(supportCase); expect(output.membership_id).toBe(member);
    expect(output.private_extra).toBeUndefined();
  });
});
