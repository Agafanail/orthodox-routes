import { describe, expect, it, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { openContextualResume, sealContextualResume } from '@/lib/contextual-registration/secure-token';
import { createComplaintPreparationRetryStore } from './retry-state';
import { createComplaintPreparationBroker } from './preparation';

const secret = 'ab'.repeat(32), now = Date.parse('2026-10-20T12:00:00Z');
const actor = '019c7134-a39b-7d8e-a4ad-8b11d56d0011';
const other = '019c7134-a39b-7d8e-a4ad-8b11d56d0022';

describe('inactive complaint preparation retry state', () => {
  it.each([null, actor])('preserves only server-generated intent for the same trusted reporter %s', (reporter) => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(reporter, now)!;
    expect(issued.intent.clientKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(issued.intent.resumeToken).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.intent.emailToken).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.intent.resumeToken).not.toBe(issued.intent.emailToken);
    for (const value of Object.values(issued.intent)) expect(issued.ticket).not.toContain(value);
    expect(issued.ticket.length).toBeLessThan(1024);
    expect(store.open(issued.ticket, reporter, now)).toEqual({ intent: issued.intent, expiresAt: now + 900_000 });
    expect(Object.isFrozen(store.open(issued.ticket, reporter, now)!.intent)).toBe(true);
    expect(store.issue(reporter, now)!.intent).not.toEqual(issued.intent);
    expect(Object.keys(store.open(issued.ticket, reporter, now)!)).toEqual(['intent', 'expiresAt']);
  });
  it('authenticates reporter and purpose, not a browser-provided account or another flow capability', () => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    for (const reporter of [null, other, undefined, 'private@example.test']) expect(store.open(issued.ticket, reporter, now)).toBeNull();
    expect(store.open(issued.ticket, actor.toUpperCase(), now)).not.toBeNull();
    expect(store.open(store.issue(null, now)!.ticket, actor, now)).toBeNull();
    expect(createComplaintPreparationRetryStore('cd'.repeat(32)).open(issued.ticket, actor, now)).toBeNull();
    const contextual = sealContextualResume({ capability: 'e'.repeat(64), expiresAt: new Date(now + 60_000).toISOString() }, secret);
    expect(store.open(contextual, actor, now)).toBeNull();
    expect(openContextualResume(issued.ticket, secret, new Date(now))).toBeNull();
  });
  it('cannot extend the original lifetime and tightens to the actual database deadline', () => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    const deadline = now + 60_000;
    const restricted = store.restrict(issued.ticket, actor, new Date(deadline).toISOString(), now)!;
    expect(restricted).not.toBe(issued.ticket);
    expect(store.open(restricted, actor, deadline - 1)).toEqual({ intent: issued.intent, expiresAt: deadline });
    expect(store.open(restricted, actor, deadline)).toBeNull();
    const later = store.restrict(restricted, actor, new Date(now + 1_000_000).toISOString(), now)!;
    expect(store.open(later, actor, now)!.expiresAt).toBe(deadline);
    const unchanged = store.restrict(issued.ticket, actor, new Date(now + 1_000_000).toISOString(), now)!;
    expect(store.open(unchanged, actor, now)!.expiresAt).toBe(now + 900_000);
    expect(store.open(issued.ticket, actor, now - 1)).toBeNull();
    expect(store.open(issued.ticket, actor, now + 900_000)).toBeNull();
  });
  it('contains tampered IV, ciphertext, tag, version and noncanonical encoding', () => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    for (const index of [0, 1, 2, 3]) {
      const parts = issued.ticket.split('.'); parts[index] = `${parts[index][0] === 'a' ? 'b' : 'a'}${parts[index].slice(1)}`;
      expect(store.open(parts.join('.'), actor, now)).toBeNull();
    }
    expect(store.open(`${issued.ticket}=`, actor, now)).toBeNull();
    const alias = issued.ticket.split('.'), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    alias[3] = alias[3].slice(0, -1) + alphabet[alphabet.indexOf(alias[3].at(-1)!) + 1];
    expect(Buffer.from(alias[3], 'base64url')).toEqual(Buffer.from(issued.ticket.split('.')[3], 'base64url'));
    expect(store.open(alias.join('.'), actor, now)).toBeNull();
    expect(store.restrict(issued.ticket, other, new Date(now + 10_000).toISOString(), now)).toBeNull();
  });
  it('preserves explicit retry identity through the existing broker without caching budget/challenge or receipt authority', async () => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    const expiresAt = new Date(now + 60_000).toISOString();
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
      expect(args).not.toHaveProperty('challengeToken');
      return { abortSignal: () => Promise.resolve({ error: null, data: name === 'consume_complaint_rate_limit' ? 'allowed'
        : { draft_id: other, status: 'pending_email', expires_at: expiresAt } }) };
    });
    const verifyChallenge = vi.fn(async () => 'verified' as const);
    const broker = createComplaintPreparationBroker({ client: { schema: () => ({ rpc }) }, verifyChallenge,
      rateSecret: 'synthetic-dedicated-rate-secret-at-least-32-chars' });
    const payload = { targetType: 'church', targetId: other, category: 'other', description: 'Synthetic report',
      replyEmail: 'reporter@example.test', language: 'en', challengeToken: 'first-challenge' };
    const trusted = { reporterAccountId: actor, trustedNetworkAddress: '192.0.2.21' };
    const first = await broker(payload, trusted, issued.intent);
    expect(first).toEqual({ status: 'pending_email', draftId: other, expiresAt });
    const restricted = store.restrict(issued.ticket, actor, expiresAt, now)!;
    const retry = store.open(restricted, actor, now + 1)!;
    expect(await broker({ ...payload, challengeToken: 'fresh-challenge' }, trusted, retry.intent)).toEqual(first);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['consume_complaint_rate_limit', 'prepare_complaint_email_draft',
      'consume_complaint_rate_limit', 'prepare_complaint_email_draft']);
    expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[3][1]);
    expect(verifyChallenge).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(first)).not.toContain(issued.intent.emailToken);
    expect(first).not.toHaveProperty('received');
  });
  it.each([null, undefined, false, {}, [], '', 'v1', 'v1.', 'v1.a.b', 'v1.a.b.c', 'v1.a.b.c.', 'a'.repeat(1025)]
    .map((value) => ({ value })))('safely refuses malformed ticket %#', ({ value }) => {
    const store = createComplaintPreparationRetryStore(secret);
    expect(store.open(value, actor, now)).toBeNull();
    expect(store.restrict(value, actor, new Date(now + 60_000).toISOString(), now)).toBeNull();
  });
  it.each([null, undefined, '', 'short', 'A'.repeat(64), 'ab'.repeat(33), {}, 123])('fails closed without an explicit valid dedicated secret %#', (value) => {
    const store = createComplaintPreparationRetryStore(value);
    expect(store.issue(actor, now)).toBeNull(); expect(store.open('v1.a.b.c', actor, now)).toBeNull();
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER])('refuses invalid issuance clocks %s', (time) => {
    expect(createComplaintPreparationRetryStore(secret).issue(actor, time)).toBeNull();
  });
  it('refuses malformed authenticated plaintext from a faulty trusted writer', () => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    const state = { ...issued.intent, issuedAt: now, expiresAt: now + 60_000 };
    const context = 'orthodox-routes:complaint-preparation-retry:v1';
    const encode = (value: unknown) => {
      const key = createHash('sha256').update(`${context}:ticket:${secret}`, 'utf8').digest();
      const iv = Buffer.alloc(12, 5), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`${context}:${actor}`, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
    };
    expect(store.open(encode(state), actor, now)).not.toBeNull();
    for (const value of [null, [], {}, { ...state, privateText: 'must not pass' }, { ...state, clientKey: undefined },
      { ...state, clientKey: 'invalid' }, { ...state, resumeToken: 'invalid' },
      { ...state, emailToken: state.resumeToken }, { ...state, issuedAt: now + 1 }, { ...state, issuedAt: 0.5 },
      { ...state, expiresAt: now + 900_001 }, { ...state, expiresAt: now }, { ...state, expiresAt: -1 }]) {
      expect(store.open(encode(value), actor, now)).toBeNull();
    }
    for (const time of [NaN, Infinity, -1, 1.5]) expect(store.open(issued.ticket, actor, time)).toBeNull();
  });
  it.each([null, '', 'invalid', '2026-10-20', '2026-02-31T12:00:00Z', '2027-02-29T12:00:00Z',
    '2026-11-31T12:00:00+02:00', '2026-10-20T24:00:00Z', '2026-10-20T12:60:00Z',
    new Date(now - 1).toISOString(), new Date(now).toISOString()])
  ('does not retain state after an invalid/elapsed database deadline %s', (expiry) => {
    const store = createComplaintPreparationRetryStore(secret), issued = store.issue(actor, now)!;
    expect(store.restrict(issued.ticket, actor, expiry, now)).toBeNull();
  });
  it.each(['2028-02-29T12:01:00Z', '2028-02-29T14:01:00.123456+02:00'])
  ('accepts real leap-day and fractional zoned database timestamps %s', (expiry) => {
    const at = Date.parse('2028-02-29T12:00:00Z'), store = createComplaintPreparationRetryStore(secret);
    const issued = store.issue(actor, at)!;
    const restricted = store.restrict(issued.ticket, actor, expiry, at)!;
    expect(store.open(restricted, actor, at)!.expiresAt).toBe(Date.parse(expiry));
  });
  it('refuses February 31 even when normalization would retain the original future ticket', () => {
    const at = Date.parse('2026-02-28T12:00:00Z'), store = createComplaintPreparationRetryStore(secret);
    const issued = store.issue(actor, at)!;
    expect(store.restrict(issued.ticket, actor, '2026-02-31T12:00:00Z', at)).toBeNull();
  });
});
