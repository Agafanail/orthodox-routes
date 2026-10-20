import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTurnstileVerifier, type TurnstileOutcome } from '@/lib/anti-abuse/turnstile';
import { createComplaintPreparationBroker, createComplaintPreparationIntent } from './preparation';

const uuid = '10000000-0000-4000-8000-000000000001';
const payload = { targetType: 'church', targetId: uuid, category: 'other', description: ' Synthetic report ',
  replyEmail: ' Reporter@EXAMPLE.test ', language: 'en', challengeToken: 'synthetic-challenge' };
const trusted = { reporterAccountId: null, trustedNetworkAddress: '192.0.2.21' };
const secret = 'synthetic-independent-rate-secret-at-least-32-chars';
const prepared = { draft_id: uuid, status: 'pending_email', expires_at: '2026-10-19T12:00:00Z' };

function fixture(options: { budget?: unknown; challenge?: TurnstileOutcome; data?: unknown; error?: unknown } = {}) {
  const calls: string[] = [], signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    expect(args).toBeTypeOf('object');
    calls.push(name);
    return { abortSignal: (signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve(name === 'consume_complaint_rate_limit'
        ? { data: options.budget ?? 'allowed', error: null }
        : { data: options.data === undefined ? prepared : options.data, error: options.error ?? null });
    } };
  });
  const client = { schema: vi.fn(() => ({ rpc })) };
  const verifyChallenge = vi.fn(async () => { calls.push('challenge'); return options.challenge ?? 'verified'; });
  const broker = createComplaintPreparationBroker({ client, rateSecret: secret, verifyChallenge });
  return { broker, client, rpc, verifyChallenge, calls, signals };
}

describe('inactive complaint preparation broker', () => {
  afterEach(() => vi.useRealTimers());

  it('generates distinct opaque server-owned retry capabilities without user data', () => {
    const first = createComplaintPreparationIntent(), second = createComplaintPreparationIntent();
    expect(first.clientKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.resumeToken).toMatch(/^[0-9a-f]{64}$/); expect(first.emailToken).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([first.resumeToken, first.emailToken, second.resumeToken, second.emailToken]).size).toBe(4);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('requires budget then a server-selected challenge before minimal pending-email preparation', async () => {
    const f = fixture(), intent = createComplaintPreparationIntent();
    expect(await f.broker(payload, trusted, intent)).toEqual({ status: 'pending_email', draftId: uuid, expiresAt: prepared.expires_at });
    expect(f.calls).toEqual(['consume_complaint_rate_limit', 'challenge', 'prepare_complaint_email_draft']);
    expect(f.verifyChallenge).toHaveBeenCalledWith(payload.challengeToken, 'complaint_submit', expect.any(AbortSignal));
    const [name, args] = f.rpc.mock.calls[1];
    expect(name).toBe('prepare_complaint_email_draft');
    expect(args).toEqual({ p_target_type: 'church', p_target_id: uuid, p_reporter_account_id: null,
      p_category: 'other', p_description: 'Synthetic report', p_reply_email: 'reporter@example.test', p_language: 'en',
      p_client_key: intent.clientKey, p_resume_token: intent.resumeToken, p_email_token: intent.emailToken });
    const rateArgs = JSON.stringify(f.rpc.mock.calls[0]);
    for (const value of [trusted.trustedNetworkAddress, 'reporter@example.test', intent.emailToken, intent.resumeToken, uuid]) {
      expect(rateArgs).not.toContain(value);
    }
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  });

  it.each(['rate_limited', 'unavailable', 'unknown', { status: 'allowed' }])('never challenges or writes after budget refusal %#', async (budget) => {
    const f = fixture({ budget });
    expect(await f.broker(payload, trusted, createComplaintPreparationIntent()))
      .toEqual({ status: budget === 'rate_limited' ? 'rate_limited' : 'unavailable' });
    expect(f.calls).toEqual(['consume_complaint_rate_limit']);
  });
  it.each(['rejected', 'unavailable'] as const)('never writes after challenge %s', async (challenge) => {
    const f = fixture({ challenge });
    expect(await f.broker(payload, trusted, createComplaintPreparationIntent())).toEqual({ status: challenge });
    expect(f.calls).toEqual(['consume_complaint_rate_limit', 'challenge']);
  });

  it.each([null, [], {}, { ...payload, reporterAccountId: uuid }, { ...payload, resumeToken: 'a'.repeat(64) },
    { ...payload, action: 'support_submit' }, { ...payload, verified: true }, { ...payload, targetType: 'account' },
    { ...payload, targetId: 'private' }, { ...payload, category: 'x'.repeat(65) }, { ...payload, description: ' ' },
    { ...payload, description: 'x'.repeat(4001) }, { ...payload, description: 'private\ttext' },
    { ...payload, replyEmail: 'invalid' }, { ...payload, replyEmail: 'person\n@example.test' },
    { ...payload, language: '__proto__' }, { ...payload, challengeToken: '' }, { ...payload, challengeToken: 'x'.repeat(2049) },
    Object.create(payload)])('refuses invalid/authority-bearing payload before any external work %#', async (value) => {
    const f = fixture(); expect(await f.broker(value, trusted, createComplaintPreparationIntent())).toEqual({ status: 'unavailable' });
    expect(f.calls).toEqual([]);
  });

  it('fails closed on missing dependencies, untrusted context and invalid intents', async () => {
    const f = fixture(), intent = createComplaintPreparationIntent();
    for (const deps of [{ client: null, rateSecret: secret, verifyChallenge: f.verifyChallenge },
      { client: f.client, rateSecret: null, verifyChallenge: f.verifyChallenge },
      { client: f.client, rateSecret: secret, verifyChallenge: null }]) {
      expect(await createComplaintPreparationBroker(deps)(payload, trusted, intent)).toEqual({ status: 'unavailable' });
    }
    expect(await f.broker(payload, { ...trusted, reporterAccountId: 'spoofed' }, intent)).toEqual({ status: 'unavailable' });
    expect(await f.broker(payload, { ...trusted, trustedNetworkAddress: '192.0.2.21, 198.51.100.2' }, intent)).toEqual({ status: 'unavailable' });
    expect(await f.broker(payload, trusted, { ...intent, emailToken: intent.resumeToken })).toEqual({ status: 'unavailable' });
    expect(f.calls).toEqual([]);
  });

  it('snapshots identity, payload and retry intent before dependencies can mutate them', async () => {
    const f = fixture(), input = { ...payload }, context = { ...trusted, reporterAccountId: uuid }, intent = { ...createComplaintPreparationIntent() };
    const original = { ...intent };
    f.verifyChallenge.mockImplementationOnce(async () => {
      input.targetId = '20000000-0000-4000-8000-000000000002'; context.reporterAccountId = input.targetId;
      intent.resumeToken = 'b'.repeat(64); return 'verified';
    });
    await f.broker(input, context, intent);
    expect(f.rpc.mock.calls[1][1]).toMatchObject({ p_target_id: uuid, p_reporter_account_id: uuid, p_resume_token: original.resumeToken });
  });

  it.each(['email_verified', 'expired'])('returns only safe draft %s, never complaint success', async (status) => {
    const f = fixture({ data: { ...prepared, status } });
    expect(await f.broker(payload, trusted, createComplaintPreparationIntent()))
      .toEqual({ status, draftId: uuid, expiresAt: prepared.expires_at });
  });
  it.each([null, [], { ...prepared, status: 'received' }, { ...prepared, email: 'private@example.test' },
    { ...prepared, draft_id: 'invalid' }, { ...prepared, expires_at: 'yesterday' }])('contains malformed privileged receipts %#', async (data) => {
    const f = fixture({ data });
    expect(await f.broker(payload, trusted, createComplaintPreparationIntent())).toEqual({ status: 'unavailable' });
  });

  it('preserves intent/input across explicit retries but rechecks budget and challenge every time', async () => {
    const f = fixture(), intent = createComplaintPreparationIntent();
    await f.broker(payload, trusted, intent); await f.broker(payload, trusted, intent);
    expect(f.rpc.mock.calls[1]).toEqual(f.rpc.mock.calls[3]);
    expect(f.verifyChallenge).toHaveBeenCalledTimes(2);
  });
  it.each(['en', 'ru', 'uk', 'it', 'ro', 'de'])('preserves %s and PostgreSQL character bounds without adding ride eligibility', async (language) => {
    const f = fixture();
    expect(await f.broker({ ...payload, language, description: '😀'.repeat(4000) }, trusted, createComplaintPreparationIntent()))
      .toMatchObject({ status: 'pending_email' });
    expect(f.rpc.mock.calls[1][1]).toMatchObject({ p_language: language, p_description: '😀'.repeat(4000) });
  });
  it.each([true, false])('composes the actual Turnstile adapter with a synthetic action-bound acknowledgement (%s)', async (valid) => {
    const f = fixture();
    const provider = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true,
      hostname: 'routes.example.test', action: valid ? 'complaint_submit' : 'support_submit',
      challenge_ts: new Date().toISOString() }), { status: 200 }));
    const verifier = createTurnstileVerifier({ secretKey: 'synthetic-turnstile-server-secret', expectedHostname: 'routes.example.test' }, provider);
    const result = await createComplaintPreparationBroker({ client: f.client, rateSecret: secret, verifyChallenge: verifier })
      (payload, trusted, createComplaintPreparationIntent());
    expect(result.status).toBe(valid ? 'pending_email' : 'rejected');
    expect(f.rpc).toHaveBeenCalledTimes(valid ? 2 : 1);
    const body = String(provider.mock.calls[0][1]?.body);
    for (const excluded of [payload.description.trim(), trusted.trustedNetworkAddress, 'reporter@example.test', uuid]) {
      expect(body).not.toContain(excluded);
    }
  });
  it('contains private errors without logging or retrying writes', async () => {
    const f = fixture({ error: { message: 'private@example.test' } });
    expect(await f.broker(payload, trusted, createComplaintPreparationIntent())).toEqual({ status: 'unavailable' });
    const g = fixture(); g.verifyChallenge.mockRejectedValueOnce(new Error('private@example.test'));
    expect(await g.broker(payload, trusted, createComplaintPreparationIntent())).toEqual({ status: 'unavailable' });
    expect(g.calls).toEqual(['consume_complaint_rate_limit']);
  });

  it('bounds an abort-ignoring challenge and never prepares after its late success', async () => {
    vi.useFakeTimers(); const f = fixture(); let settle!: (value: TurnstileOutcome) => void;
    f.verifyChallenge.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    const pending = f.broker(payload, trusted, createComplaintPreparationIntent());
    await vi.advanceTimersByTimeAsync(5001); expect(await pending).toEqual({ status: 'unavailable' });
    settle('verified'); await vi.advanceTimersByTimeAsync(0);
    expect(f.rpc).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds an uncertain draft write, aborts it and never automatically retries', async () => {
    vi.useFakeTimers(); const f = fixture(); let writeSignal: AbortSignal | undefined;
    f.rpc.mockImplementation((name: string) => ({ abortSignal: (signal: AbortSignal) => {
      if (name === 'consume_complaint_rate_limit') return Promise.resolve({ data: 'allowed', error: null });
      writeSignal = signal; return new Promise(() => {});
    } }));
    const pending = f.broker(payload, trusted, createComplaintPreparationIntent());
    await vi.advanceTimersByTimeAsync(5001); expect(await pending).toEqual({ status: 'unavailable' });
    expect(writeSignal?.aborted).toBe(true); expect(f.rpc).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
