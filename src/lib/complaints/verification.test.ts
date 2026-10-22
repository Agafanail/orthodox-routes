import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComplaintEmailVerificationBroker, deriveComplaintVerificationRateKeys } from './verification';
import { createComplaintEmailVerificationController } from './verification-controller';
import { complaintDatabaseTimestamp, parseComplaintDraftReceipt } from './draft-receipt';
import { deriveComplaintRateKeys } from './rate-limit';

const id = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const secret = 'synthetic-independent-verify-secret-at-least-32-chars';
const network = '192.0.2.17', token = 'a'.repeat(64);
const receipt = { draft_id: id, status: 'email_verified', expires_at: '2026-10-22T12:15:00Z' };
function fixture(budget: unknown = 'allowed', data: unknown = receipt) {
  const signals: AbortSignal[] = [];
  const transport = vi.fn(async (name: string) => ({ data: name === 'consume_complaint_verification_rate_limit' ? budget : data, error: null as unknown }));
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    expect(args).toBeTypeOf('object');
    return { abortSignal: (signal: AbortSignal) => { signals.push(signal); return transport(name); } };
  });
  const client = { schema: vi.fn(() => ({ rpc })) };
  const verify = createComplaintEmailVerificationBroker({ client, rateSecret: secret });
  return { verify, rpc, client, transport, signals };
}
const request = (body: unknown = { emailToken: token }, options: RequestInit = {}, query = '') => new Request(
  `https://routes.example.test/en/report/${id}/verify${query}`, {
    method: 'POST', headers: { origin: 'https://routes.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(body), ...options,
  },
);
function controller(verify = fixture().verify, expectedDraftId: unknown = id, trustedNetworkAddress: unknown = network) {
  return createComplaintEmailVerificationController({ applicationOrigin: 'https://routes.example.test', expectedDraftId, trustedNetworkAddress, verify });
}
afterEach(() => vi.useRealTimers());

describe('independent complaint verification identity', () => {
  it('canonicalizes network and route identity, with domains separate from preparation', () => {
    const keys = deriveComplaintVerificationRateKeys(network, id, secret)!;
    expect(keys.networkKey).toMatch(/^[0-9a-f]{64}$/); expect(keys.draftKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.networkKey).not.toBe(keys.draftKey);
    expect(keys).toEqual(deriveComplaintVerificationRateKeys('::ffff:c000:211', id.toUpperCase(), secret));
    expect(deriveComplaintVerificationRateKeys('2001:DB8::17', id, secret)).toEqual(
      deriveComplaintVerificationRateKeys('2001:0db8:0:0:0:0:0:17', id, secret),
    );
    expect(keys.networkKey).not.toBe(deriveComplaintRateKeys({ trustedNetworkAddress: network, replyEmail: 'synthetic@example.test' }, secret)!.networkKey);
    expect(deriveComplaintVerificationRateKeys(network, otherId, secret)!.draftKey).not.toBe(keys.draftKey);
    expect(deriveComplaintVerificationRateKeys(network, id, secret + '-rotated')).not.toEqual(keys);
    for (const value of [network, id, secret, token]) expect(JSON.stringify(keys)).not.toContain(value);
  });
  it.each([
    [null, id, secret], ['192.0.2.17, 198.51.100.1', id, secret], ['fe80::1%eth0', id, secret],
    [network, null, secret], [network, 'invalid', secret], [network, id, null],
    [network, id, 'short'], [network, id, 'x'.repeat(257)], [network, id, secret + '\n'],
  ])('requires trusted canonical input and an explicit bounded secret %#', (address, draft, key) => {
    expect(deriveComplaintVerificationRateKeys(address, draft, key)).toBeNull();
  });
});

describe('shared strict draft receipt', () => {
  it.each(['2026-02-31T12:00:00Z', '2026-10-22T24:00:00Z', '2026-10-22T12:00:00', 'invalid'])('refuses normalized or unzoned time %s', (time) => {
    expect(complaintDatabaseTimestamp(time)).toBeNaN();
    expect(parseComplaintDraftReceipt({ ...receipt, expires_at: time })).toBeNull();
  });
  it.each(['2028-02-29T12:00:00.123456Z', '2026-10-22T12:00:00.123456+02:00'])('keeps real zoned calendar %s', (time) => {
    expect(complaintDatabaseTimestamp(time)).toBe(Date.parse(time));
  });
});

describe('complaint email verification broker', () => {
  it('consumes fresh verification budgets before the exact expected-draft proof RPC', async () => {
    const f = fixture();
    await expect(f.verify({ emailToken: token }, id, network)).resolves.toEqual({ status: 'email_verified', draftId: id, expiresAt: receipt.expires_at });
    const keys = deriveComplaintVerificationRateKeys(network, id, secret)!;
    expect(f.rpc.mock.calls).toEqual([
      ['consume_complaint_verification_rate_limit', { p_network_key: keys.networkKey, p_draft_key: keys.draftKey }],
      ['verify_complaint_email_draft_v2', { p_draft_id: id, p_email_token: token }],
    ]);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
    await f.verify({ emailToken: token }, id, network);
    expect(f.rpc).toHaveBeenCalledTimes(4); // Explicit repeats spend a fresh attempt, not a cached grant.
  });
  it.each([null, [], {}, { emailToken: null }, { emailToken: 'A'.repeat(64) }, { emailToken: token, draftId: otherId },
    { emailToken: token, reporterAccountId: id }, { emailToken: token, replyEmail: 'person@example.test' }])('refuses extra actor/target/mailbox or malformed input %#', async (value) => {
    const f = fixture();
    await expect(f.verify(value, id, network)).resolves.toEqual({ status: 'unavailable' });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('does no privileged work with absent client, key, route reference or trusted address', async () => {
    const f = fixture();
    await expect(createComplaintEmailVerificationBroker({ client: null, rateSecret: secret })({ emailToken: token }, id, network)).resolves.toEqual({ status: 'unavailable' });
    await expect(createComplaintEmailVerificationBroker({ client: f.client, rateSecret: null })({ emailToken: token }, id, network)).resolves.toEqual({ status: 'unavailable' });
    await f.verify({ emailToken: token }, 'invalid', network);
    await f.verify({ emailToken: token }, id, 'untrusted');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(['rate_limited', 'unavailable', null, true, {}, 'sent'])('does not verify after non-allowed budget %#', async (budget) => {
    const f = fixture(budget);
    await expect(f.verify({ emailToken: token }, id, network)).resolves.toEqual({ status: budget === 'rate_limited' ? 'rate_limited' : 'unavailable' });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown proofs without leaking another draft and preserves expired results', async () => {
    await expect(fixture('allowed', null).verify({ emailToken: token }, id, network)).resolves.toEqual({ status: 'rejected' });
    await expect(fixture('allowed', { ...receipt, status: 'expired' }).verify({ emailToken: token }, id, network))
      .resolves.toEqual({ status: 'expired', draftId: id, expiresAt: receipt.expires_at });
  });
  it.each([{ ...receipt, draft_id: otherId }, { ...receipt, status: 'pending_email' },
    { ...receipt, email: 'private@example.test' }, { ...receipt, expires_at: '2026-02-31T12:00:00Z' },
    { ...receipt, draft_id: 'invalid' }, { ...receipt, status: 'received' }])('contains wrong-target or unsafe receipts %#', async (data) => {
    await expect(fixture('allowed', data).verify({ emailToken: token }, id, network)).resolves.toEqual({ status: 'unavailable' });
  });
  it('contains failures without retrying or starting verification after an uncertain budget', async () => {
    const f = fixture();
    f.transport.mockRejectedValueOnce(new Error('private connection details'));
    await expect(f.verify({ emailToken: token }, id, network)).resolves.toEqual({ status: 'unavailable' });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    f.transport.mockResolvedValueOnce({ data: 'allowed', error: null }).mockResolvedValueOnce({ data: receipt, error: { message: 'private SQL error' } });
    await expect(f.verify({ emailToken: token }, id, network)).resolves.toEqual({ status: 'unavailable' });
    expect(f.rpc).toHaveBeenCalledTimes(3);
  });
  it.each(['budget', 'proof'])('bounds abort-ignoring %s I/O and leaves uncertain outcome for an explicit retry', async (step) => {
    vi.useFakeTimers();
    const f = fixture();
    if (step === 'proof') f.transport.mockResolvedValueOnce({ data: 'allowed', error: null });
    f.transport.mockImplementationOnce(() => new Promise(() => {}));
    const pending = f.verify({ emailToken: token }, id, network);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toEqual({ status: 'unavailable' });
    expect(f.rpc).toHaveBeenCalledTimes(step === 'budget' ? 1 : 2);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('snapshots the proof before waiting for a budget', async () => {
    const f = fixture(), input = { emailToken: token };
    const pending = f.verify(input, id, network);
    input.emailToken = 'b'.repeat(64);
    await pending;
    expect(f.rpc.mock.calls[1][1]).toEqual({ p_draft_id: id, p_email_token: token });
  });
});

describe('unregistered explicit complaint verification HTTP composition', () => {
  it('returns only safe receipt metadata after a real broker call', async () => {
    const f = fixture(), response = await controller(f.verify)(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'email_verified', draftId: id, expiresAt: receipt.expires_at });
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(['GET', 'HEAD', 'OPTIONS'])('never consumes a proof on %s or a scanner visit', async (method) => {
    const f = fixture();
    expect((await controller(f.verify)(new Request(`https://routes.example.test/en/report/${id}/verify`, { method }))).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([
    [request({}, {}, '?token=synthetic-private-proof')],
    [request({ emailToken: token }, { headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' } })],
    [request({ emailToken: token }, { headers: { origin: 'https://routes.example.test', 'content-type': 'text/plain' } })],
  ])('rejects query proof, cross-origin and unsafe intake %#', async (req) => {
    const f = fixture();
    expect((await controller(f.verify)(req)).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([['rate_limited', 429], ['rejected', 400], ['unavailable', 503]] as const)('maps fixed outcome %s', async (status, code) => {
    const verify = vi.fn(async () => ({ status }));
    const response = await controller(verify)(request());
    expect(response.status).toBe(code); expect(await response.json()).toEqual({ status });
  });
  it('contains malformed or cross-draft injected results instead of trusting TypeScript types', async () => {
    for (const result of [{ status: 'private exception' }, { status: 'email_verified', draftId: otherId, expiresAt: receipt.expires_at },
      { status: 'email_verified', draftId: id, expiresAt: '2026-02-31T12:00:00Z' }]) {
      const response = await controller((async () => result) as never)(request());
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: 'unavailable' });
    }
  });
  it('contains a stalled injected seam and ignores results after request abort', async () => {
    vi.useFakeTimers();
    const pending = controller((() => new Promise(() => {})) as never)(request());
    await vi.advanceTimersByTimeAsync(11_000);
    expect((await pending).status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
    const abort = new AbortController();
    const verify = vi.fn(async () => { abort.abort(); return { status: 'rejected' as const }; });
    expect((await controller(verify)(request({ emailToken: token }, { signal: abort.signal }))).status).toBe(503);
  });
});
