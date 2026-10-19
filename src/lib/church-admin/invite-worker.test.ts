import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInviteJob, processChurchInviteMail, renderInviteMail } from './invite-worker';

const moment = Date.now();
const job = {
  attempt_count: 1,
  church_name: '<Synthetic Church>',
  church_slug: 'synthetic-church',
  destination_email: 'invitee@example.test',
  invite_id: '10000000-0000-4000-8000-000000000001',
  job_id: '10000000-0000-4000-8000-000000000002',
  language: 'en',
  token: 'a'.repeat(64),
  evaluated_at: new Date(moment).toISOString(),
  lease_until: new Date(moment + 120_000).toISOString(),
  expires_at: new Date(moment + 600_000).toISOString(),
};

describe('church invitation email boundary', () => {
  afterEach(() => vi.useRealTimers());
  it.each(['http://routes.example.test', 'https://person:secret@routes.example.test',
    'https://routes.example.test/path', 'https://routes.example.test/?next=private', 'https://routes.example.test/#private', 'invalid'])
  ('refuses unsafe application origin %s before claiming or sending', async (appOrigin) => {
    const rpc = vi.fn(), send = vi.fn();
    expect(await processChurchInviteMail(1, { appOrigin, client: { schema: () => ({ rpc }) },
      adapter: { adapterId: 'synthetic', channel: 'email', send } })).toEqual({ claimed: 0, configured: false, failed: 0, sent: 0 });
    expect(rpc).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    expect(() => renderInviteMail(parseInviteJob(job)!, appOrigin)).toThrow('secure application origin');
  });
  it.each([{ destination_email: 'private\n@example.test' }, { destination_email: 'invalid' },
    { church_slug: '../private' }, { church_name: 'private\u0000name' }, { token: '0'.repeat(64) },
    { evaluated_at: null }, { lease_until: new Date(moment + 120_001).toISOString() },
    { expires_at: new Date(moment - 1).toISOString() }])('refuses unsafe or unbounded claim data %#', (changed) => {
    expect(parseInviteJob({ ...job, ...changed }, moment)).toBeNull();
  });
  it('uses relative database time in both skew directions and subtracts claim latency', () => {
    for (const skew of [-86_400_000, 86_400_000]) {
      const parsed = parseInviteJob(job, moment + skew, 5000)!;
      expect(parsed.leaseUntil).toBe(moment + skew + 115_000);
      expect(parsed.expiresAt).toBe(moment + skew + 595_000);
    }
    expect(parseInviteJob(job, moment, 120_000)).toBeNull();
    expect(parseInviteJob(job, moment, -1)).toBeNull();
  });
  it('preserves valid long church slugs accepted by the authoritative write path', () => {
    const slug = 'synthetic-church-'.repeat(30) + 'page';
    const parsed = parseInviteJob({ ...job, church_slug: slug }, moment);
    expect(parsed).not.toBeNull();
    const message = renderInviteMail(parsed!, 'https://routes.example.test');
    expect(message.email.text).toContain(`/churches/${slug}/admin/invite#invite=${job.invite_id}`);
  });
  it('claims one job only after the preceding send/completion and uses fresh lease keys', async () => {
    const order: string[] = [], leases: unknown[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      order.push(name);
      if (name === 'church_invite_worker_claim') {
        expect(args.p_limit).toBe(1); leases.push(args.p_lease_token);
        return { data: [{ ...job, job_id: leases.length === 1 ? job.job_id : job.invite_id }], error: null };
      }
      return { data: true, error: null };
    });
    const send = vi.fn(async () => { order.push('send'); return { outcome: 'sent' as const, providerReference: job.job_id,
      providerAdapter: 'synthetic', providerCode: null, safeFailureClass: null }; });
    expect(await processChurchInviteMail(2, { appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) },
      adapter: { adapterId: 'synthetic', channel: 'email', send } })).toEqual({ claimed: 2, configured: true, failed: 0, sent: 2 });
    expect(order).toEqual(['church_invite_worker_claim', 'send', 'church_invite_worker_complete',
      'church_invite_worker_claim', 'send', 'church_invite_worker_complete']);
    expect(leases[0]).not.toBe(leases[1]);
  });
  it.each([{ data: [] }, { data: [job, job] }, { data: [{ ...job, evaluated_at: null }] }])('fails closed or ends on an unexpected/empty claim %#', async ({ data }) => {
    const rpc = vi.fn(async () => ({ data, error: null })), send = vi.fn();
    const result = await processChurchInviteMail(1, { appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) },
      adapter: { adapterId: 'synthetic', channel: 'email', send } });
    expect(result.sent).toBe(0); expect(send).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it('does not send a known almost-expired invitation', async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...job, evaluated_at: new Date().toISOString(),
      lease_until: new Date(Date.now() + 15_000).toISOString() }], error: null })), send = vi.fn();
    expect(await processChurchInviteMail(1, { appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) },
      adapter: { adapterId: 'synthetic', channel: 'email', send } })).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it.each(['claim', 'send', 'complete'])('bounds an abort-ignoring %s without retry or reflected errors', async (stall) => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => {
      if ((stall === 'claim' && name.endsWith('_claim')) || (stall === 'complete' && name.endsWith('_complete'))) return new Promise<never>(() => {});
      return Promise.resolve({ data: name.endsWith('_claim') ? [job] : true, error: null });
    });
    const send = vi.fn(() => stall === 'send' ? new Promise<never>(() => {}) : Promise.resolve({ outcome: 'sent' as const,
      providerReference: job.job_id, providerAdapter: 'synthetic', providerCode: null, safeFailureClass: null }));
    const pending = processChurchInviteMail(1, { appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) },
      adapter: { adapterId: 'synthetic', channel: 'email', send } });
    await vi.advanceTimersByTimeAsync(stall === 'send' ? 12_001 : 5001);
    expect(await pending).toMatchObject({ sent: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(stall === 'claim' ? 1 : 2); expect(vi.getTimerCount()).toBe(0);
  });
  it('contains private adapter failures and never stores an arbitrary provider reference', async () => {
    for (const result of [new Error('private@example.test'), { outcome: 'sent', providerReference: 'private@example.test' },
      { outcome: 'unexpected', providerReference: job.token }]) {
      const rpc = vi.fn(async (name: string) => ({ data: name.endsWith('_claim') ? [job] : true, error: null }));
      const send = vi.fn().mockImplementation(async () => { if (result instanceof Error) throw result; return result; });
      const summary = await processChurchInviteMail(1, { appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) },
        adapter: { adapterId: 'synthetic', channel: 'email', send } });
      expect(summary).toMatchObject({ failed: 1, sent: 0 });
      expect(rpc.mock.calls[1]).toEqual(['church_invite_worker_complete', expect.objectContaining({
        p_outcome: 'temporary_failure', p_provider_reference: null,
      })]);
    }
  });
  it('rejects malformed worker data and keeps the invitation token in a URL fragment', () => {
    expect(parseInviteJob({ ...job, token: 'not-a-token' })).toBeNull();
    const parsed = parseInviteJob(job);
    expect(parsed).not.toBeNull();
    const message = renderInviteMail(parsed!, 'https://orthodox.example');
    expect(message.email.html).toContain('&lt;Synthetic Church&gt;');
    expect(message.email.html).not.toContain('<Synthetic Church>');
    expect(message.email.text).toContain('/admin/invite#invite=');
    expect(message.email.text).toContain(`&token=${'a'.repeat(64)}`);
  });

  it('completes a claimed invite through the existing email adapter contract', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      schema: () => ({
        rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args });
          return Promise.resolve({ data: name === 'church_invite_worker_claim' ? [job] : true, error: null });
        },
      }),
    };
    const send = vi.fn().mockResolvedValue({
      outcome: 'sent', providerReference: job.job_id,
    });
    const outcome = await processChurchInviteMail(1, {
      adapter: { adapterId: 'test-email', channel: 'email', send },
      appOrigin: 'https://orthodox.example', client,
      leaseToken: '10000000-0000-4000-8000-000000000003',
    });
    expect(outcome).toEqual({ claimed: 1, configured: true, failed: 0, sent: 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.name)).toEqual([
      'church_invite_worker_claim', 'church_invite_worker_complete',
    ]);
    expect(calls[1].args.p_outcome).toBe('sent');
  });
});
