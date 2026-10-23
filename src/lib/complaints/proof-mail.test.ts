import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(() => null) }));
vi.mock('@/lib/supabase/server-privileged', () => ({ createPrivilegedSupabaseClient: mocks.client }));
import { complaintProofCopy, COMPLAINT_PROOF_COPY_VERSION, parseComplaintProofJob,
  processComplaintProofMail, renderComplaintProofMail } from './proof-mail';
import { createResendNotificationAdapter } from '@/lib/notifications/resend';

const draftId = '10000000-0000-4000-8000-000000000001';
const jobId = '10000000-0000-4000-8000-000000000002';
const providerId = '10000000-0000-4000-8000-000000000003';
const origin = 'https://orthodox.example';
const languages = ['en', 'ru', 'it', 'ro', 'uk', 'de'] as const;
function raw(overrides: Record<string, unknown> = {}) {
  return { draft_id: draftId, job_id: jobId, attempt_count: 1, destination_email: 'synthetic@example.test',
    evaluated_at: new Date().toISOString(),
    language: 'en', email_token: 'a'.repeat(64), expires_at: new Date(Date.now() + 800_000).toISOString(),
    lease_until: new Date(Date.now() + 44_000).toISOString(), ...overrides };
}
function setup(options: { job?: unknown; completion?: unknown; claimError?: unknown } = {}) {
  let delivered = false;
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string) => {
    return { abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      if (name === 'complaint_proof_mail_claim') {
        if (delivered) return Promise.resolve({ data: null, error: null });
        delivered = true;
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
afterEach(() => vi.useRealTimers());

describe('complaint email-proof mail boundary', () => {
  it('constructs the selected protected client with an actual per-request deadline', async () => {
    mocks.client.mockClear(); const f = setup();
    expect(await processComplaintProofMail(1, { adapter: f.dependencies.adapter, appOrigin: origin }))
      .toEqual({ configured: false, claimed: 0, sent: 0, failed: 0 });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ requestTimeoutMs: 5000 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('keeps versioned prepared text complete without runtime private interpolation', () => {
    expect(COMPLAINT_PROOF_COPY_VERSION).toBe(1);
    expect(Object.keys(complaintProofCopy).sort()).toEqual([...languages].sort());
    for (const copy of Object.values(complaintProofCopy)) for (const value of Object.values(copy)) {
      expect(value.trim()).toBe(value);
      expect(value.length).toBeGreaterThan(0);
      expect(value.length).toBeLessThan(250);
      expect(value).not.toMatch(/[<>{}@\d\u0000-\u001f\u007f]/);
    }
  });
  it.each(languages)('renders %s proof mail with a fragment-only capability and no private input', (language) => {
    const value = raw({ language, description: 'PRIVATE-COMPLAINT', phone: '+1234567890', exact_place: 'PRIVATE-PLACE' });
    const job = parseComplaintProofJob(value)!;
    expect(job).not.toBeNull();
    const message = renderComplaintProofMail(job, origin);
    expect(message.email.subject).toBe(complaintProofCopy[language].subject);
    expect(message.push).toBe('');
    const link = new URL(message.email.text.match(/https:\/\/\S+/)![0]);
    expect(link.origin).toBe(origin);
    expect(link.pathname).toBe(`/${language}/report/${draftId}`);
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#email-proof=${value.email_token}`);
    for (const privateValue of [value.destination_email, 'PRIVATE-COMPLAINT', '+1234567890', 'PRIVATE-PLACE']) {
      expect(JSON.stringify(message)).not.toContain(privateValue);
    }
    expect(message.email.html).toContain(complaintProofCopy[language].action);
  });
  it.each([
    null, [], 'not-object', { draft_id: 'invalid' }, { job_id: 'invalid' }, { email_token: 'bad' },
    { destination_email: 'bad' }, { destination_email: 'x\r\n@example.test' }, { language: '__proto__' },
    { language: 'fr' }, { attempt_count: 0 }, { attempt_count: 6 }, { attempt_count: 1.5 },
    { evaluated_at: 'not-date' }, { evaluated_at: null }, { expires_at: 'not-date' }, { lease_until: 'not-date' }, { lease_until: '2000-01-01T00:00:00Z' },
    { expires_at: new Date(Date.now() + 2_000_000).toISOString() },
    { lease_until: new Date(Date.now() + 60_000).toISOString() },
  ])('refuses malformed or expired worker data %j', (overrides) => {
    expect(parseComplaintProofJob(overrides && !Array.isArray(overrides) && typeof overrides === 'object'
      ? raw(overrides) : overrides)).toBeNull();
  });
  it.each([-7_200_000, 3_600_000])('accepts valid database durations with server clock offset %s', (offset) => {
    const now = Date.now();
    const value = raw({ evaluated_at: new Date(now + offset).toISOString(),
      expires_at: new Date(now + offset + 800_000).toISOString(),
      lease_until: new Date(now + offset + 45_000).toISOString() });
    const parsed = parseComplaintProofJob(value, now, 2_000);
    expect(parsed?.leaseUntil).toBe(now + 43_000);
    expect(parsed?.expiresAt).toBe(now + 798_000);
  });
  it('does not extend deadlines with latency or invalid elapsed time', () => {
    const now = Date.now();
    const value = raw({ evaluated_at: new Date(now).toISOString(), lease_until: new Date(now + 4_000).toISOString() });
    expect(parseComplaintProofJob(value, now, 5_000)).toBeNull();
    expect(parseComplaintProofJob(value, now, -1)).toBeNull();
    expect(parseComplaintProofJob(value, now, NaN)).toBeNull();
  });
  it.each(['http://orthodox.example', 'https://user:pass@orthodox.example', 'https://orthodox.example/path',
    'https://orthodox.example?redirect=evil', 'https://orthodox.example#secret', 'invalid'])('refuses unsafe origin %s before claiming', async (appOrigin) => {
    const { dependencies, rpc, send } = setup();
    expect(await processComplaintProofMail(1, { ...dependencies, appOrigin })).toEqual({ claimed: 0, configured: false, failed: 0, sent: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(() => renderComplaintProofMail(parseComplaintProofJob(raw())!, appOrigin)).toThrow();
  });
  it('does not claim without an email adapter or privileged client', async () => {
    const { dependencies, rpc } = setup();
    expect((await processComplaintProofMail(1, { ...dependencies, adapter: null })).configured).toBe(false);
    expect((await processComplaintProofMail(1, { ...dependencies, client: null })).configured).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses one lease at a time and records only fixed outcomes without provider payload', async () => {
    const { dependencies, rpc, send } = setup();
    expect(await processComplaintProofMail(5, dependencies)).toEqual({ claimed: 1, configured: true, failed: 0, sent: 1 });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['complaint_proof_mail_claim', 'complaint_proof_mail_complete', 'complaint_proof_mail_claim']);
    const calls = rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls[1][1]).toEqual({ p_job_id: jobId, p_lease_token: calls[0][1].p_lease_token, p_outcome: 'sent' });
    expect(calls[2][1].p_lease_token).not.toBe(calls[0][1].p_lease_token);
    expect(JSON.stringify(calls)).not.toContain(providerId);
    const delivery = send.mock.calls[0][0];
    expect(delivery.jobId).toBe(jobId);
    expect(delivery.safeParameters).toEqual({});
    expect(delivery.channel).toBe('email');
  });
  it('does not send malformed or almost-expired claims', async () => {
    for (const job of [raw({ email_token: 'invalid' }), raw({ lease_until: new Date(Date.now() + 10_000).toISOString() })]) {
      const { dependencies, send } = setup({ job });
      expect((await processComplaintProofMail(1, dependencies)).failed).toBe(1);
      expect(send).not.toHaveBeenCalled();
    }
  });
  it('does not count rejected completion as accepted delivery', async () => {
    const { dependencies } = setup({ completion: false });
    expect(await processComplaintProofMail(1, dependencies)).toEqual({ claimed: 1, configured: true, failed: 1, sent: 0 });
  });
  it('contains provider exceptions and arbitrary outcomes without exposing private errors', async () => {
    for (const result of [null, { outcome: 'unexpected', error: 'PRIVATE-ERROR' }]) {
      const { dependencies, send, rpc } = setup();
      send.mockResolvedValue(result);
      expect((await processComplaintProofMail(1, dependencies)).failed).toBe(1);
      expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE-ERROR');
    }
    const { dependencies, send } = setup();
    send.mockRejectedValue(new Error('PRIVATE-ERROR'));
    expect(JSON.stringify(await processComplaintProofMail(1, dependencies))).not.toContain('PRIVATE-ERROR');
  });
  it('bounds a stalled provider and clears the timer', async () => {
    vi.useFakeTimers();
    const { dependencies, send } = setup();
    send.mockImplementation(() => new Promise(() => {}));
    const processing = processComplaintProofMail(1, dependencies);
    await vi.advanceTimersByTimeAsync(12_001);
    expect(await processing).toEqual({ claimed: 1, configured: true, failed: 1, sent: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled claim and does not dispatch after timeout', async () => {
    vi.useFakeTimers();
    const { dependencies, rpc, send } = setup();
    let claimSignal: AbortSignal | undefined;
    rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { claimSignal = signal; return new Promise(() => {}); } }));
    const processing = processComplaintProofMail(1, dependencies);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await processing).toEqual({ claimed: 0, configured: true, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(claimSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('contains claim errors before delivery', async () => {
    const { dependencies, send } = setup({ claimError: { message: 'PRIVATE-DATABASE-ERROR' } });
    expect(await processComplaintProofMail(1, dependencies)).toEqual({ claimed: 0, configured: true, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it('reserves a complete provider/completion window without extending the original lease', async () => {
    const f = setup({ job: raw({ lease_until: new Date(Date.now() + 19_000).toISOString() }) });
    expect(await processComplaintProofMail(1, f.dependencies)).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(f.send).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { outcome: 'sent' },
    { outcome: 'sent', providerAdapter: 'fake-email', providerCode: 'http_200', providerReference: 'private non-UUID', safeFailureClass: null },
    { outcome: 'sent', providerAdapter: 'other-provider', providerCode: 'http_200', providerReference: providerId, safeFailureClass: null },
    { outcome: 'sent', providerAdapter: 'fake-email', providerCode: 'http_500', providerReference: providerId, safeFailureClass: null },
    { outcome: 'permanent_failure', providerAdapter: 'fake-email', providerCode: 'http_400', providerReference: null, safeFailureClass: 'private-provider-error' },
  ])('never records an unvalidated provider acknowledgement as sent or permanent %#', async (result) => {
    const { dependencies, send, rpc } = setup(); send.mockResolvedValue(result);
    expect(await processComplaintProofMail(1, dependencies)).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(rpc.mock.calls[1]).toEqual(['complaint_proof_mail_complete', expect.objectContaining({ p_outcome: 'temporary_failure' })]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('private');
  });
  it('preserves validated permanent provider refusal and successful selected Resend acknowledgement', async () => {
    const failed = setup();
    failed.send.mockResolvedValue({ outcome: 'permanent_failure', providerAdapter: 'fake-email', providerCode: 'http_400',
      providerReference: null, safeFailureClass: 'provider_rejected' });
    expect((await processComplaintProofMail(1, failed.dependencies)).sent).toBe(0);
    expect(failed.rpc.mock.calls[1]).toEqual(['complaint_proof_mail_complete', expect.objectContaining({ p_outcome: 'permanent_failure' })]);
    const success = setup();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: providerId }));
    const adapter = createResendNotificationAdapter({ apiKey: 're_synthetic', appOrigin: origin, from: 'Orthodox Routes <proof@example.test>' }, fetcher);
    expect(await processComplaintProofMail(1, { ...success.dependencies, adapter })).toEqual({ configured: true, claimed: 1, sent: 1, failed: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(success.rpc.mock.calls)).not.toContain(providerId);
  });
  it.each(['evaluated_at', 'expires_at', 'lease_until'])('rejects normalized impossible %s before dispatch', (field) => {
    expect(parseComplaintProofJob(raw({ [field]: '2026-02-31T12:00:00Z' }))).toBeNull();
  });
  it.each([null, {}, 'true', 1])('starts no later claim after malformed completion %#', async (completion) => {
    const f = setup({ completion });
    expect(await processComplaintProofMail(5, f.dependencies)).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('preserves the existing next-claim behavior after an acknowledged refusal', async () => {
    const f = setup({ completion: false });
    expect(await processComplaintProofMail(5, f.dependencies)).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledTimes(3);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  });
  it('aborts acknowledged RPC signals and stops after an uncertain completion', async () => {
    const successful = setup(); await processComplaintProofMail(1, successful.dependencies);
    expect(successful.signals).toHaveLength(2);
    expect(successful.signals.every((signal) => signal.aborted)).toBe(true);
    vi.useFakeTimers(); const f = setup(); let completionSignal: AbortSignal | undefined;
    f.rpc.mockImplementationOnce(() => ({ abortSignal: (signal: AbortSignal) => {
      f.signals.push(signal); return Promise.resolve({ data: raw(), error: null });
    } })).mockImplementationOnce(() => ({ abortSignal: (signal: AbortSignal) => {
      completionSignal = signal; return new Promise(() => {});
    } }));
    const pending = processComplaintProofMail(5, f.dependencies);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ configured: true, claimed: 1, sent: 0, failed: 1 });
    expect(completionSignal?.aborted).toBe(true);
    expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
