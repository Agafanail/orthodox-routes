import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnstileVerifier, getTurnstileConfig, type TurnstileAction, type TurnstileConfig } from './turnstile';

const now = Date.parse('2026-10-17T10:00:00Z');
const config: TurnstileConfig = { secretKey: 'synthetic-server-secret-only', expectedHostname: 'routes.example.org' };
const token = 'synthetic-opaque-challenge-token';
const success = () => ({
  success: true, hostname: config.expectedHostname, action: 'complaint_submit',
  challenge_ts: new Date(now - 1_000).toISOString(), 'error-codes': [],
});
const provider = (value: unknown = success(), status = 200) => vi.fn<typeof fetch>(async () =>
  new Response(JSON.stringify(value), { status }));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Turnstile server configuration', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', config.secretKey);
    vi.stubEnv('ORTHODOX_ROUTES_APP_URL', 'https://routes.example.org');
  });

  it('requires an explicit server secret and HTTPS application hostname', () => {
    expect(getTurnstileConfig()).toEqual(config);
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(getTurnstileConfig()).toBeNull();
  });

  it.each([
    '', 'http://routes.example.org', 'http://localhost:3000', 'https://localhost',
    'https://127.0.0.1', 'https://[::1]', 'https://routes.example.org.',
    'https://user:password@routes.example.org', 'https://routes.example.org/path',
    'https://routes.example.org?secret=x', 'https://routes.example.org#fragment',
  ])('disables verification for an unsafe application origin: %s', (origin) => {
    vi.stubEnv('ORTHODOX_ROUTES_APP_URL', origin);
    expect(getTurnstileConfig()).toBeNull();
  });

  it.each([
    'short', `${config.secretKey}\n`, ` ${config.secretKey}`, 'x'.repeat(257),
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA',
  ])('rejects malformed and official dummy secrets without a bypass', (secret) => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', secret);
    expect(getTurnstileConfig()).toBeNull();
  });
});

describe('Turnstile provider boundary', () => {
  it('posts only required verification material to the fixed endpoint and returns a safe verdict', async () => {
    const send = provider({ ...success(), cdata: 'synthetic-private-cdata', metadata: { ephemeral_id: 'synthetic-device-id' } });
    await expect(createTurnstileVerifier(config, send)(token, 'complaint_submit')).resolves.toBe('verified');
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init).toMatchObject({
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
    });
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(['idempotency_key', 'response', 'secret']);
    expect(body.secret).toBe(config.secretKey);
    expect(body.response).toBe(token);
    expect(body.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(init?.signal?.aborted).toBe(true); // Closed after the completed request; never retained for reuse.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('binds the trusted support action independently of complaint submission', async () => {
    const send = provider({ ...success(), action: 'support_submit' });
    await expect(createTurnstileVerifier(config, send)(token, 'support_submit')).resolves.toBe('verified');
  });

  it.each([null, { ...config, secretKey: 'short' }, { ...config, expectedHostname: '*.example.org' }])(
    'makes no provider call without safe configuration', async (candidate) => {
      const send = provider();
      await expect(createTurnstileVerifier(candidate, send)(token, 'complaint_submit')).resolves.toBe('unavailable');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, 1, {}, '', 'x'.repeat(2049), ' token', 'token\n', 'token\u0000']) (
    'rejects malformed challenge material before any network call', async (candidate) => {
      const send = provider();
      await expect(createTurnstileVerifier(config, send)(candidate, 'complaint_submit')).resolves.toBe('rejected');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects unapproved actions and pre-aborted requests before any network call', async () => {
    const send = provider();
    const verify = createTurnstileVerifier(config, send);
    await expect(verify(token, 'arbitrary_action' as TurnstileAction)).resolves.toBe('rejected');
    await expect(verify(token, 'complaint_submit', AbortSignal.abort())).resolves.toBe('unavailable');
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { hostname: 'attacker.example.org' }, { hostname: 'routes.example.org.attacker.test' },
    { hostname: undefined }, { hostname: 'ROUTES.EXAMPLE.ORG' },
    { action: 'support_submit' }, { action: undefined },
    { challenge_ts: undefined }, { challenge_ts: 'not-a-date' },
    { challenge_ts: new Date(now - 300_001).toISOString() },
    { challenge_ts: new Date(now + 60_001).toISOString() },
  ])('refuses a successful token for the wrong context or expired timestamp', async (override) => {
    await expect(createTurnstileVerifier(config, provider({ ...success(), ...override }))(token, 'complaint_submit'))
      .resolves.toBe('rejected');
  });

  it.each([-300_000, 60_000])('accepts only the documented lifetime and bounded clock skew (%s ms)', async (offset) => {
    await expect(createTurnstileVerifier(config, provider({ ...success(), challenge_ts: new Date(now + offset).toISOString() }))
      (token, 'complaint_submit')).resolves.toBe('verified');
  });

  it.each(['invalid-input-response', 'timeout-or-duplicate'])('rejects provider-refused challenges: %s', async (code) => {
    await expect(createTurnstileVerifier(config, provider({ success: false, 'error-codes': [code] }))(token, 'complaint_submit'))
      .resolves.toBe('rejected');
  });

  it.each([
    null, [], {}, { success: 'true' }, { ...success(), 'error-codes': ['internal-error'] },
    { success: false, 'error-codes': [] }, { success: false, 'error-codes': 'invalid-input-response' },
    { success: false, 'error-codes': ['invalid-input-secret'] },
    { success: false, 'error-codes': ['internal-error'] }, { success: false, 'error-codes': ['unknown-provider-value'] },
  ])('contains malformed/provider-operational results without exposing them', async (value) => {
    await expect(createTurnstileVerifier(config, provider(value))(token, 'complaint_submit')).resolves.toBe('unavailable');
  });

  it.each([302, 400, 401, 429, 500])('does not accept non-success HTTP status %s', async (status) => {
    const send = provider(success(), status);
    await expect(createTurnstileVerifier(config, send)(token, 'complaint_submit')).resolves.toBe('unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not cache verdicts or retry an already spent challenge', async () => {
    const send = provider();
    send.mockResolvedValueOnce(new Response(JSON.stringify(success())))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    const verify = createTurnstileVerifier(config, send);
    await expect(verify(token, 'complaint_submit')).resolves.toBe('verified');
    await expect(verify(token, 'complaint_submit')).resolves.toBe('rejected');
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0][1]?.body)).idempotency_key)
      .not.toBe(JSON.parse(String(send.mock.calls[1][1]?.body)).idempotency_key);
  });

  it('contains network exceptions and never logs tokens, secrets, or provider body', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const send = vi.fn<typeof fetch>(async () => { throw new Error(`${config.secretKey}:${token}:private-provider-value`); });
    await expect(createTurnstileVerifier(config, send)(token, 'complaint_submit')).resolves.toBe('unavailable');
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bounds the complete operation even if the provider fetch ignores cancellation', async () => {
    const send = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const result = createTurnstileVerifier(config, send)(token, 'complaint_submit');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe('unavailable');
    expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled response bodies and cancels the reader', async () => {
    const cancel = vi.fn();
    const send = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
    const result = createTurnstileVerifier(config, send)(token, 'complaint_submit');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe('unavailable');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels oversized bodies before parsing or exposing their contents', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16_385)); }, cancel });
    const send = vi.fn<typeof fetch>(async () => new Response(body));
    await expect(createTurnstileVerifier(config, send)(token, 'complaint_submit')).resolves.toBe('unavailable');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('refuses invalid JSON and caller cancellation while awaiting a body', async () => {
    const invalid = vi.fn<typeof fetch>(async () => new Response('synthetic-private-invalid-json'));
    await expect(createTurnstileVerifier(config, invalid)(token, 'complaint_submit')).resolves.toBe('unavailable');
    const cancel = vi.fn();
    const send = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel })));
    const caller = new AbortController();
    const result = createTurnstileVerifier(config, send)(token, 'complaint_submit', caller.signal);
    await vi.advanceTimersByTimeAsync(1);
    caller.abort();
    await expect(result).resolves.toBe('unavailable');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
