import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { COMPLAINT_PREPARATION_COOKIE_PREFIX as prefix, COMPLAINT_PREPARATION_HEADER as header, createComplaintPreparationController } from './controller';
import { createComplaintPreparationRetryStore } from './retry-state';
import { createComplaintPreparationBroker, type ComplaintPreparationResult } from './preparation';
import type { ComplaintReporter } from './reporter';

const origin = 'https://routes.example.test', secret = 'a'.repeat(64);
const id = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000002';
const cookie = `${prefix}-${id}`;
const slotSecret = createHmac('sha256', secret).update(`orthodox-routes:complaint-retry-slot:v1:${id}`).digest('hex');
const payload = { targetType: 'church', targetId: id, category: 'other', description: 'Synthetic report',
  replyEmail: 'reporter@example.test', language: 'en', challengeToken: 'fresh-synthetic-challenge' };
const initialTime = Date.parse('2026-10-22T12:00:00Z');
const request = (body: unknown = payload, signal?: AbortSignal) => new Request(`${origin}/api/unregistered`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', [header]: id },
  body: JSON.stringify(body), signal,
});
function fixture(overrides: Partial<Parameters<typeof createComplaintPreparationController>[0]> = {}) {
  let time = initialTime;
  const jar = new Map<string, string>();
  const set = vi.fn((name: string, value: string, options: { maxAge: number }) => {
    if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
  });
  const prepare = vi.fn<NonNullable<Parameters<typeof createComplaintPreparationController>[0]['prepare']>>(async (): Promise<ComplaintPreparationResult> => ({ status: 'pending_email', draftId: id,
    expiresAt: new Date(initialTime + 300_000).toISOString() }));
  const resolveReporter = vi.fn(async (): Promise<ComplaintReporter> => ({ status: 'resolved', reporterAccountId: null }));
  const dependencies = { applicationOrigin: origin, retrySecret: secret,
    cookieStore: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), set },
    resolveReporter, trustedNetworkAddress: '192.0.2.21', prepare, now: () => time, ...overrides };
  const handle = createComplaintPreparationController(dependencies);
  const bootstrap = async () => { expect((await handle(request())).status).toBe(428); };
  return { jar, set, prepare, resolveReporter, dependencies, handle, bootstrap, advance: (ms: number) => { time += ms; } };
}

describe('unregistered complaint HTTP preparation composition', () => {
  afterEach(() => vi.useRealTimers());
  it('establishes secure retained state before ANY uncertain preparation, without returning capabilities', async () => {
    const f = fixture(), response = await f.handle(request());
    expect(response.status).toBe(428); expect(await response.json()).toEqual({ status: 'state_required' });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = f.set.mock.calls[0];
    expect(name).toBe(cookie); expect(value.length).toBeLessThanOrEqual(1024);
    expect(options).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 900,
      expires: new Date(initialTime + 900_000) });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('cannot write a draft when the first state-establishing response was lost', async () => {
    const f = fixture(); await f.bootstrap(); f.jar.clear(); await f.bootstrap();
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.set).toHaveBeenCalledTimes(2);
  });
  it.each([null, 'forged-slot', `${id}.extra`])('refuses a missing/malformed non-authority form selector %#', async (slot) => {
    const f = fixture(), input = request();
    if (slot === null) input.headers.delete(header); else input.headers.set(header, slot);
    expect((await f.handle(input)).status).toBe(400); expect(f.resolveReporter).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled();
  });
  it('keeps concurrent forms independent without a one-complaint-per-browser rule', async () => {
    const f = fixture(), second = () => { const input = request({ ...payload, description: 'Another synthetic form' }); input.headers.set(header, other); return input; };
    await Promise.all([f.bootstrap(), (async () => { expect((await f.handle(second())).status).toBe(428); })()]);
    expect(f.jar.size).toBe(2); expect(f.prepare).not.toHaveBeenCalled();
    await f.handle(request()); await f.handle(second());
    const firstIntent = f.prepare.mock.calls[0][2], secondIntent = f.prepare.mock.calls[1][2];
    expect(firstIntent.clientKey).not.toBe(secondIntent.clientKey); expect(firstIntent.clientKey).not.toBe(id);
    expect(secondIntent.clientKey).not.toBe(other); expect(firstIntent.resumeToken).not.toBe(secondIntent.resumeToken);
  });
  it('refuses an encrypted ticket transplanted between form slots and clears only that slot', async () => {
    const f = fixture(); await f.bootstrap(); const retained = f.jar.get(cookie)!;
    f.jar.set(`${prefix}-${other}`, retained);
    const second = request(); second.headers.set(header, other);
    expect((await f.handle(second)).status).toBe(409); expect(f.jar.get(cookie)).toBe(retained);
    expect(f.jar.has(`${prefix}-${other}`)).toBe(false); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('prepares only after cookie acknowledgement and shortens, never renews, retry state', async () => {
    const f = fixture(); await f.bootstrap(); const original = f.jar.get(cookie)!;
    f.advance(20_000); const response = await f.handle(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'pending_email', draftId: id,
      expiresAt: '2026-10-22T12:05:00.000Z' });
    expect(f.prepare).toHaveBeenCalledWith(payload, { reporterAccountId: null, trustedNetworkAddress: '192.0.2.21' }, expect.any(Object));
    const retry = createComplaintPreparationRetryStore(slotSecret), retained = f.jar.get(cookie)!;
    expect(retry.open(retained, null, initialTime + 20_000)?.intent).toEqual(retry.open(original, null, initialTime)?.intent);
    expect(retry.open(retained, null, initialTime + 20_000)?.expiresAt).toBe(initialTime + 300_000);
    expect(f.set.mock.calls[1][2].maxAge).toBe(280);
    const serialized = JSON.stringify(await (await f.handle(request())).json());
    for (const value of Object.values(retry.open(original, null, initialTime)!.intent)) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain(payload.description); expect(serialized).not.toContain(payload.replyEmail);
  });
  it.each(['unavailable', 'rate_limited', 'rejected'] as const)('preserves an uncertain prior identity after a later %s, without renewal', async (status) => {
    const f = fixture(); await f.bootstrap(); const retained = f.jar.get(cookie);
    f.prepare.mockResolvedValue({ status }); f.advance(100_000);
    expect((await f.handle(request())).status).toBe(status === 'rate_limited' ? 429 : status === 'rejected' ? 400 : 503);
    expect(f.jar.get(cookie)).toBe(retained); expect(f.set).toHaveBeenCalledTimes(1);
  });
  it('clears only confirmed expired state, not another retained retry', async () => {
    const f = fixture(); await f.bootstrap(); f.jar.set('other-cookie', 'preserved');
    f.prepare.mockResolvedValue({ status: 'expired', draftId: id, expiresAt: '2026-10-22T12:00:00Z' });
    const response = await f.handle(request()); expect(response.status).toBe(410); expect(await response.json()).toEqual({ status: 'expired' });
    expect(f.jar.has(cookie)).toBe(false); expect(f.jar.get('other-cookie')).toBe('preserved');
    expect(f.set.mock.calls[1][2]).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0, expires: new Date(0) });
  });
  it.each(['malformed', 'wrong-actor', 'expired', 'duplicate'] as const)('refuses and clears %s state before any preparation', async (kind) => {
    const f = fixture(); await f.bootstrap();
    if (kind === 'malformed') f.jar.set(cookie, 'private-bad-cookie');
    if (kind === 'wrong-actor') f.resolveReporter.mockResolvedValue({ status: 'resolved', reporterAccountId: other });
    if (kind === 'expired') f.advance(900_000);
    if (kind === 'duplicate') f.dependencies.cookieStore!.getAll = () => [{ name: cookie, value: 'one' }, { name: cookie, value: 'two' }];
    const response = await f.handle(request()); expect(response.status).toBe(409); expect(await response.json()).toEqual({ status: 'state_invalid' });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.jar.has(cookie)).toBe(false);
  });
  it('uses only server reporter/network context, not forwarded or body authority', async () => {
    const f = fixture(); f.resolveReporter.mockResolvedValue({ status: 'resolved', reporterAccountId: id }); await f.bootstrap();
    const input = request(); input.headers.set('x-forwarded-for', '203.0.113.99'); input.headers.set('x-account-id', other);
    await f.handle(input);
    expect(f.prepare.mock.calls[0][1]).toEqual({ reporterAccountId: id, trustedNetworkAddress: '192.0.2.21' });
  });
  it.each([null, '', 'short-secret'])('refuses missing configuration without clearing an existing retry %#', async (retrySecret) => {
    const f = fixture({ retrySecret }); f.jar.set(cookie, 'preserve-on-config-error');
    expect((await f.handle(request())).status).toBe(503); expect(f.set).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });
  it.each([null, 'unknown', '192.0.2.21, 203.0.113.2'])('refuses unverified network input %#', async (trustedNetworkAddress) => {
    const f = fixture({ trustedNetworkAddress }); expect((await f.handle(request())).status).toBe(503);
    expect(f.resolveReporter).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('contains unknown reporter state without interpreting it as a guest or changing cookies', async () => {
    const f = fixture(); f.jar.set(cookie, 'retain'); f.resolveReporter.mockResolvedValue({ status: 'unavailable' });
    expect((await f.handle(request())).status).toBe(503); expect(f.set).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });
  it.each([NaN, -1, Infinity, 1.5])('preserves cookies when the server clock is invalid %#', async (time) => {
    const f = fixture({ now: () => time }); f.jar.set(cookie, 'retain');
    expect((await f.handle(request())).status).toBe(503); expect(f.set).not.toHaveBeenCalled();
  });
  it('refuses foreign origin before reporter/cookie/preparation work', async () => {
    const f = fixture(), input = request(); input.headers.set('origin', 'https://foreign.example.test');
    expect((await f.handle(input)).status).toBe(400); expect(f.resolveReporter).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled();
  });
  it.each(['bootstrap', 'receipt', 'clear'] as const)('contains private %s cookie-write errors without leaking or retrying', async (stage) => {
    const f = fixture();
    if (stage !== 'bootstrap') await f.bootstrap();
    if (stage === 'clear') f.prepare.mockResolvedValue({ status: 'expired', draftId: id, expiresAt: '2026-10-22T12:00:00Z' });
    f.set.mockImplementation(() => { throw new Error('private-cookie-diagnostics'); });
    const response = await f.handle(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: 'unavailable' });
    expect(f.prepare).toHaveBeenCalledTimes(stage === 'bootstrap' ? 0 : 1);
  });
  it.each(['not-a-date', '2026-02-31T12:00:00Z', '2026-10-22T11:59:59Z'])('keeps the retry identity if a successful-shaped receipt has unsafe expiry %#', async (expiresAt) => {
    const f = fixture(); await f.bootstrap(); const retained = f.jar.get(cookie);
    f.prepare.mockResolvedValue({ status: 'pending_email', draftId: id, expiresAt });
    expect((await f.handle(request())).status).toBe(503); expect(f.jar.get(cookie)).toBe(retained); expect(f.set).toHaveBeenCalledTimes(1);
  });
  it('keeps the same retained identity after an abort or thrown uncertain write', async () => {
    const f = fixture(); await f.bootstrap(); const retained = f.jar.get(cookie), abort = new AbortController();
    f.prepare.mockImplementation(async () => { abort.abort(); throw new Error('private-uncertain-write'); });
    expect((await f.handle(request(payload, abort.signal))).status).toBe(503);
    expect(f.jar.get(cookie)).toBe(retained); expect(f.set).toHaveBeenCalledTimes(1);
  });
  it.each(['reporter', 'prepare'] as const)('bounds an abort-ignoring %s seam without clearing uncertain state', async (stage) => {
    vi.useFakeTimers(); const f = fixture(); await f.bootstrap(); const retained = f.jar.get(cookie);
    if (stage === 'reporter') f.resolveReporter.mockImplementation(() => new Promise(() => {}));
    else f.prepare.mockImplementation(() => new Promise(() => {}));
    const pending = f.handle(request()); await vi.advanceTimersByTimeAsync(stage === 'reporter' ? 12_000 : 16_000);
    expect((await pending).status).toBe(503); expect(f.jar.get(cookie)).toBe(retained); expect(vi.getTimerCount()).toBe(0);
  });
  it('composes explicit retries through the real broker with the same intent but fresh budget and challenge', async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => { calls.push({ name, args });
      return { abortSignal: async () => ({ error: null, data: name === 'consume_complaint_rate_limit' ? 'allowed'
        : { status: 'pending_email', draft_id: id, expires_at: '2026-10-22T12:05:00Z' } }) }; });
    const verifyChallenge = vi.fn<(token: unknown) => Promise<'verified'>>(async () => 'verified');
    const f = fixture({ prepare: createComplaintPreparationBroker({ client: { schema: () => ({ rpc }) }, rateSecret: 'synthetic-long-independent-rate-secret', verifyChallenge }) });
    await f.bootstrap(); expect(calls).toEqual([]); expect(verifyChallenge).not.toHaveBeenCalled();
    expect((await f.handle(request())).status).toBe(200);
    expect((await f.handle(request({ ...payload, challengeToken: 'second-fresh-challenge' }))).status).toBe(200);
    expect(calls.map(({ name }) => name)).toEqual(['consume_complaint_rate_limit', 'prepare_complaint_email_draft',
      'consume_complaint_rate_limit', 'prepare_complaint_email_draft']);
    expect(calls[1].args).toEqual(calls[3].args); expect(verifyChallenge).toHaveBeenCalledTimes(2);
    expect(verifyChallenge.mock.calls[1][0]).toBe('second-fresh-challenge');
    const before = calls.length;
    expect((await f.handle(request({ ...payload, reporterAccountId: other }))).status).toBe(503);
    expect(calls.length).toBe(before); // Forged payload authority fails before budget/challenge/write.
    expect(verifyChallenge).toHaveBeenCalledTimes(2);
  });
});
