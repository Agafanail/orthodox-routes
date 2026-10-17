import { afterEach, describe, expect, it, vi } from 'vitest';
import { complaintProofCopy, COMPLAINT_PROOF_COPY_VERSION, parseComplaintProofJob,
  processComplaintProofMail, renderComplaintProofMail } from './proof-mail';

const draftId = '10000000-0000-4000-8000-000000000001';
const jobId = '10000000-0000-4000-8000-000000000002';
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
  const rpc = vi.fn((name: string) => {
    if (name === 'complaint_proof_mail_claim') {
      if (delivered) return Promise.resolve({ data: null, error: null });
      delivered = true;
      return Promise.resolve({ data: options.job === undefined ? raw() : options.job, error: options.claimError ?? null });
    }
    return Promise.resolve({ data: options.completion === undefined ? true : options.completion, error: null });
  });
  const send = vi.fn().mockResolvedValue({ outcome: 'sent', providerReference: 'must-not-be-stored' });
  const dependencies = { appOrigin: origin, client: { schema: () => ({ rpc }) },
    adapter: { adapterId: 'fake-email', channel: 'email' as const, send } };
  return { dependencies, rpc, send };
}
afterEach(() => vi.useRealTimers());

describe('complaint email-proof mail boundary', () => {
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
    expect(JSON.stringify(calls)).not.toContain('must-not-be-stored');
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
    rpc.mockImplementation(() => new Promise(() => {}));
    const processing = processComplaintProofMail(1, dependencies);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await processing).toEqual({ claimed: 0, configured: true, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('contains claim errors before delivery', async () => {
    const { dependencies, send } = setup({ claimError: { message: 'PRIVATE-DATABASE-ERROR' } });
    expect(await processComplaintProofMail(1, dependencies)).toEqual({ claimed: 0, configured: true, failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
