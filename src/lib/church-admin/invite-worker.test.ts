import { describe, expect, it, vi } from 'vitest';
import { parseInviteJob, processChurchInviteMail, renderInviteMail } from './invite-worker';

const job = {
  attempt_count: 1,
  church_name: '<Synthetic Church>',
  church_slug: 'synthetic-church',
  destination_email: 'invitee@example.test',
  invite_id: '10000000-0000-4000-8000-000000000001',
  job_id: '10000000-0000-4000-8000-000000000002',
  language: 'en',
  token: 'a'.repeat(64),
};

describe('church invitation email boundary', () => {
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
    const outcome = await processChurchInviteMail(10, {
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
