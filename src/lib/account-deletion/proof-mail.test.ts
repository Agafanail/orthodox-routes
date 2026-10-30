import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(() => null) }));
vi.mock('@/lib/supabase/server-privileged', () => ({ createPrivilegedSupabaseClient: mocks.client }));
import { deletionProofCopy, DELETION_PROOF_COPY_VERSION, parseDeletionProofJob,
  processDeletionProofMail, renderDeletionProofMail } from './proof-mail';
import { createResendNotificationAdapter } from '@/lib/notifications/resend';

const requestId = '10000000-0000-4000-8000-000000000001';
const jobId = '10000000-0000-4000-8000-000000000002';
const providerId = '10000000-0000-4000-8000-000000000003';
const origin = 'https://orthodox.example';
const languages = ['en', 'ru', 'it', 'ro', 'uk', 'de'] as const;
function raw(overrides: Record<string, unknown> = {}) {
  return { request_id: requestId, job_id: jobId, attempt_count: 1, destination_email: 'synthetic@example.test',
    evaluated_at: new Date().toISOString(), language: 'en', email_token: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 800_000).toISOString(), lease_until: new Date(Date.now() + 44_000).toISOString(), ...overrides };
}
function setup(options: { job?: unknown; completion?: unknown; claimError?: unknown } = {}) {
  let claimed = false;
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, _args: Record<string, unknown>) => {
    void _args;
    return { abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      if (name === 'account_deletion_confirmation_mail_claim') {
        if (claimed) return Promise.resolve({ data: null, error: null });
        claimed = true;
        return Promise.resolve({ data: options.job === undefined ? raw() : options.job, error: options.claimError ?? null });
      }
      return Promise.resolve({ data: options.completion === undefined ? true : options.completion, error: null });
    } };
  });
  const send = vi.fn().mockResolvedValue({ outcome: 'sent', providerAdapter: 'fake-email', providerCode: 'http_200',
    providerReference: providerId, safeFailureClass: null });
  const dependencies = { appOrigin: origin, client: { schema: () => ({ rpc }) },
    adapter: { adapterId: 'fake-email', channel: 'email' as const, send } };
  return { dependencies, rpc, send, signals };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('account deletion email-proof sender', () => {
  it('provides versioned prepared copy for every supported language', () => {
    expect(DELETION_PROOF_COPY_VERSION).toBe(1);
    expect(Object.keys(deletionProofCopy).sort()).toEqual([...languages].sort());
    for (const copy of Object.values(deletionProofCopy)) for (const text of Object.values(copy)) {
      expect(text.trim()).toBe(text); expect(text.length).toBeGreaterThan(0); expect(text.length).toBeLessThan(250);
      expect(text).not.toMatch(/[<>{}@\d\u0000-\u001f\u007f]/);
    }
  });
  it.each(languages)('renders %s with request/proof in the fragment and no private interpolation', (language) => {
    const value = raw({ language, display_name: 'PRIVATE-NAME', phone: '+1234567890', location: 'PRIVATE-PLACE' });
    const job = parseDeletionProofJob(value)!; expect(job).not.toBeNull();
    const message = renderDeletionProofMail(job, origin);
    const link = new URL(message.email.text.match(/https:\/\/\S+/)![0]);
    expect(link.origin).toBe(origin); expect(link.pathname).toBe(`/${language}/profile`); expect(link.search).toBe('');
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect([...fragment.keys()]).toEqual(['deletion-request', 'email-proof']);
    expect(fragment.get('deletion-request')).toBe(requestId); expect(fragment.get('email-proof')).toBe(value.email_token);
    expect(message.push).toBe(''); expect(message.email.subject).toBe(deletionProofCopy[language].subject);
    expect(message.email.html).toContain('&amp;email-proof=');
    for (const privateValue of [value.destination_email, 'PRIVATE-NAME', '+1234567890', 'PRIVATE-PLACE']) {
      expect(JSON.stringify(message)).not.toContain(privateValue);
    }
  });
  it('keeps the actual Resend body purpose-bound and records only the fixed outcome', async () => {
    const f = setup();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: providerId }));
    const adapter = createResendNotificationAdapter({ apiKey: 're_synthetic', appOrigin: origin,
      from: 'Orthodox Routes <proof@example.test>' }, fetcher);
    expect(await processDeletionProofMail(1, { ...f.dependencies, adapter }))
      .toEqual({ configured: true, claimed: 1, sent: 1, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [destination, init] = fetcher.mock.calls[0];
    expect(destination).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init?.body as string);
    expect(body.to).toEqual(['synthetic@example.test']); expect(body.subject).toBe(deletionProofCopy.en.subject);
    expect(body.text).toContain(`#deletion-request=${requestId}&email-proof=`);
    expect(init?.headers).toEqual(expect.objectContaining({ 'idempotency-key': `notification-${jobId}` }));
    expect(f.rpc.mock.calls).toEqual([
      ['account_deletion_confirmation_mail_claim', { p_lease_token: expect.any(String) }],
      ['account_deletion_confirmation_mail_complete', { p_job_id: jobId,
        p_lease_token: f.rpc.mock.calls[0][1].p_lease_token, p_outcome: 'sent' }],
    ]);
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(providerId);
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('synthetic@example.test');
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('cannot mistake a complaint draft claim for a deletion request', async () => {
    const complaint: Record<string, unknown> = { ...raw(), draft_id: requestId };
    delete complaint.request_id;
    const f = setup({ job: complaint });
    expect(await processDeletionProofMail(1, f.dependencies)).toEqual({ configured: true, claimed: 0, sent: 0, failed: 1 });
    expect(f.send).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { request_id: 'invalid' }, { job_id: 'invalid' }, { email_token: 'not-proof' }, { language: '__proto__' },
    { destination_email: 'x\r\n@example.test' }, { attempt_count: 6 }, { evaluated_at: '2026-02-31T12:00:00Z' },
    { expires_at: 'invalid' }, { lease_until: '2026-02-31T12:00:00Z' },
  ])('contains malformed service data before dispatch %#', async (override) => {
    const f = setup({ job: raw(override) });
    expect((await processDeletionProofMail(1, f.dependencies)).failed).toBe(1); expect(f.send).not.toHaveBeenCalled();
  });
  it.each([-7_200_000, 3_600_000])('honors relative database timing despite host clock skew %s', (offset) => {
    const now = Date.now();
    const value = raw({ evaluated_at: new Date(now + offset).toISOString(),
      expires_at: new Date(now + offset + 800_000).toISOString(), lease_until: new Date(now + offset + 45_000).toISOString() });
    expect(parseDeletionProofJob(value, now, 2000)?.leaseUntil).toBe(now + 43_000);
    expect(parseDeletionProofJob(value, now, 46_000)).toBeNull();
  });
  it.each(['http://orthodox.example', 'https://user:pass@orthodox.example', 'https://orthodox.example/path',
    'https://orthodox.example?redirect=evil', 'https://orthodox.example#secret', 'invalid'])('refuses unsafe origin %s before work', async (appOrigin) => {
    const f = setup();
    expect((await processDeletionProofMail(1, { ...f.dependencies, appOrigin })).configured).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
    expect(() => renderDeletionProofMail(parseDeletionProofJob(raw())!, appOrigin)).toThrow();
  });
  it('requires an email adapter and configured privileged client', async () => {
    const f = setup();
    expect((await processDeletionProofMail(1, { ...f.dependencies, adapter: null })).configured).toBe(false);
    expect((await processDeletionProofMail(1, { ...f.dependencies, client: null })).configured).toBe(false);
    expect((await processDeletionProofMail(1, { ...f.dependencies,
      adapter: { ...f.dependencies.adapter, channel: 'web_push' } })).configured).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
  it('creates the default client with a bounded request deadline', async () => {
    mocks.client.mockClear(); const f = setup();
    expect((await processDeletionProofMail(1, { adapter: f.dependencies.adapter, appOrigin: origin })).configured).toBe(false);
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ requestTimeoutMs: 5000 });
  });
  it('reserves time for provider and completion before any send', async () => {
    const f = setup({ job: raw({ lease_until: new Date(Date.now() + 19_000).toISOString() }) });
    expect((await processDeletionProofMail(1, f.dependencies)).failed).toBe(1); expect(f.send).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([false, null, 'true', 1, {}])('never reports uncertain or refused completion as sent %#', async (completion) => {
    const f = setup({ completion });
    expect(await processDeletionProofMail(1, f.dependencies)).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(['claim', 'provider', 'completion'] as const)('bounds stalled %s without private error leakage', async (stage) => {
    vi.useFakeTimers(); const f = setup();
    if (stage === 'claim') f.rpc.mockImplementationOnce(() => ({ abortSignal: (signal: AbortSignal) => {
      f.signals.push(signal); return new Promise(() => {});
    } }));
    if (stage === 'provider') f.send.mockImplementation(() => new Promise(() => {}));
    if (stage === 'completion') f.rpc.mockImplementationOnce(() => ({ abortSignal: (signal: AbortSignal) => {
      f.signals.push(signal); return Promise.resolve({ data: raw(), error: null });
    } })).mockImplementationOnce(() => ({ abortSignal: (signal: AbortSignal) => {
      f.signals.push(signal); return new Promise(() => {});
    } }));
    const processing = processDeletionProofMail(1, f.dependencies);
    await vi.advanceTimersByTimeAsync(stage === 'provider' ? 12_001 : 5_001);
    expect(await processing).toEqual({ configured: true, claimed: stage === 'claim' ? 0 : 1, sent: 0, failed: 1 });
    expect(f.signals.every((signal) => signal.aborted)).toBe(true); expect(vi.getTimerCount()).toBe(0);
    if (stage === 'claim') expect(f.send).not.toHaveBeenCalled();
  });
  it('does not turn a private provider exception into public or database data', async () => {
    const f = setup(); f.send.mockRejectedValue(new Error('PRIVATE-CAPABILITY-CONTACT-ERROR'));
    expect(JSON.stringify(await processDeletionProofMail(1, f.dependencies))).not.toContain('PRIVATE');
    expect(f.rpc.mock.calls[1][1]).toEqual({ p_job_id: jobId, p_lease_token: expect.any(String), p_outcome: 'temporary_failure' });
  });
  it('never treats an unvalidated provider success as accepted delivery', async () => {
    const f = setup(); f.send.mockResolvedValue({ outcome: 'sent', providerReference: 'PRIVATE-REFERENCE' });
    expect((await processDeletionProofMail(1, f.dependencies)).sent).toBe(0);
    expect(f.rpc.mock.calls[1][1].p_outcome).toBe('temporary_failure');
    expect(JSON.stringify(f.rpc.mock.calls)).not.toContain('PRIVATE');
  });
});
