import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComplaintRateLimiter, deriveComplaintRateKeys } from './rate-limit';

const secret = 'synthetic-complaint-rate-secret-with-at-least-32-characters';
const input = { trustedNetworkAddress: '192.0.2.17', replyEmail: 'Person@example.test' };
type RpcResult = { data: unknown; error: unknown };
function stub(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn<(signal: AbortSignal) => Promise<RpcResult>>(async () => ({ data, error }));
  const rpc = vi.fn<(name: string, args: Record<string, unknown>) => { abortSignal: typeof abortSignal }>(() => ({ abortSignal }));
  const client = { schema: vi.fn(() => ({ rpc })) };
  return { client, rpc, abortSignal };
}

describe('complaint attempt rate keys', () => {
  it('uses deterministic scoped HMACs, not raw network/email data', () => {
    const keys = deriveComplaintRateKeys(input, secret)!;
    expect(keys).toEqual(deriveComplaintRateKeys(input, secret));
    expect(keys.networkKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.mailboxKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.networkKey).not.toBe(keys.mailboxKey);
    for (const value of [input.trustedNetworkAddress, input.replyEmail, secret]) expect(JSON.stringify(keys)).not.toContain(value);
    expect(deriveComplaintRateKeys(input, `${secret}-rotated`)).not.toEqual(keys);
  });

  it('normalizes mailbox case and surrounding spaces without merging different mailboxes', () => {
    const keys = deriveComplaintRateKeys(input, secret)!;
    expect(deriveComplaintRateKeys({ ...input, replyEmail: ' person@EXAMPLE.test ' }, secret)).toEqual(keys);
    expect(deriveComplaintRateKeys({ ...input, replyEmail: 'another@example.test' }, secret)!.mailboxKey).not.toBe(keys.mailboxKey);
  });

  it('normalizes IPv6 spelling and IPv4-mapped forms without accepting forwarded lists', () => {
    const v6 = deriveComplaintRateKeys({ ...input, trustedNetworkAddress: '2001:db8::17' }, secret);
    expect(deriveComplaintRateKeys({ ...input, trustedNetworkAddress: '2001:0DB8:0000:0000:0000:0000:0000:0017' }, secret)).toEqual(v6);
    for (const address of ['::ffff:192.0.2.17', '::ffff:c000:211']) {
      expect(deriveComplaintRateKeys({ ...input, trustedNetworkAddress: address }, secret)).toEqual(deriveComplaintRateKeys(input, secret));
    }
  });

  it.each([null, undefined, true, [], 'request', {},
    { ...input, trustedNetworkAddress: 'unavailable' },
    { ...input, trustedNetworkAddress: '192.0.2.17, 198.51.100.5' },
    { ...input, trustedNetworkAddress: ' 192.0.2.17 ' },
    { ...input, trustedNetworkAddress: 'http://192.0.2.17' },
    { ...input, trustedNetworkAddress: 'fe80::1%eth0' },
    { ...input, trustedNetworkAddress: 'x'.repeat(65) },
    { ...input, replyEmail: 'invalid' }, { ...input, replyEmail: null },
    { ...input, replyEmail: 'person\u0000@example.test' },
    { ...input, replyEmail: '\nperson@example.test' },
    { ...input, replyEmail: 'a'.repeat(513) },
  ])('refuses invalid or untrusted input %#', (value) => {
    expect(deriveComplaintRateKeys(value, secret)).toBeNull();
  });

  it.each([undefined, null, '', 'short', 'a'.repeat(257), 'a'.repeat(32) + '\n'])('requires a bounded explicit server secret %#', (value) => {
    expect(deriveComplaintRateKeys(input, value)).toBeNull();
  });
});

describe('inactive complaint rate boundary', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['allowed', 'rate_limited', 'unavailable'] as const)('contains the fixed outcome %s', async (status) => {
    const fake = stub(status);
    const result = await createComplaintRateLimiter({ client: fake.client, secret })(input);
    expect(result).toBe(status);
    expect(fake.client.schema).toHaveBeenCalledWith('api');
    const args = fake.rpc.mock.calls[0][1];
    expect(fake.rpc).toHaveBeenCalledWith('consume_complaint_rate_limit', {
      p_network_key: deriveComplaintRateKeys(input, secret)!.networkKey,
      p_mailbox_key: deriveComplaintRateKeys(input, secret)!.mailboxKey,
    });
    expect(Object.keys(args).sort()).toEqual(['p_mailbox_key', 'p_network_key']);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.abortSignal.mock.calls[0][0].aborted).toBe(true);
  });

  it('does no I/O with missing configuration or invalid input', async () => {
    const fake = stub('allowed');
    await expect(createComplaintRateLimiter({ client: null, secret })(input)).resolves.toBe('unavailable');
    await expect(createComplaintRateLimiter({ client: fake.client, secret: null })(input)).resolves.toBe('unavailable');
    await expect(createComplaintRateLimiter({ client: fake.client, secret })(null)).resolves.toBe('unavailable');
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it.each([null, true, {}, ['allowed'], 'sent', { status: 'allowed' }])('rejects unexpected RPC payload %#', async (data) => {
    await expect(createComplaintRateLimiter({ client: stub(data).client, secret })(input)).resolves.toBe('unavailable');
  });

  it('contains transport errors without exposing them or retrying', async () => {
    const fake = stub('allowed', { message: 'Synthetic private provider error' });
    await expect(createComplaintRateLimiter({ client: fake.client, secret })(input)).resolves.toBe('unavailable');
    fake.abortSignal.mockRejectedValueOnce(new Error('Synthetic connection detail'));
    await expect(createComplaintRateLimiter({ client: fake.client, secret })(input)).resolves.toBe('unavailable');
    expect(fake.rpc).toHaveBeenCalledTimes(2);
  });

  it('bounds an adapter that ignores abort and never acknowledges an uncertain attempt', async () => {
    vi.useFakeTimers();
    const fake = stub('allowed');
    fake.abortSignal.mockImplementationOnce(() => new Promise(() => {}));
    const pending = createComplaintRateLimiter({ client: fake.client, secret })(input);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe('unavailable');
    expect(fake.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
