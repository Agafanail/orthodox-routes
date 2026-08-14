import { describe, expect, it, vi } from 'vitest';
import {
  confirmEmailSignIn,
  parseEmail,
  requestEmailSignInLink,
  resolveVerifiedAuthIdentity,
  signOutCurrentSession,
  type AuthFlowClient,
} from './flow';

const VALID_TOKEN_HASH = 'a'.repeat(64);

function createAuthClient() {
  return {
    getClaims: vi.fn().mockResolvedValue({ data: { claims: null }, error: null }),
    getSession: vi.fn(),
    signInWithOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }),
  };
}

describe('passwordless email request', () => {
  it.each(['', 'person', 'person@', '@example.org', 'person @example.org']) (
    'rejects malformed email %j without contacting Auth',
    async (email) => {
      const client = createAuthClient();

      await expect(
        requestEmailSignInLink(client as unknown as AuthFlowClient, email),
      ).resolves.toEqual({ status: 'invalid-email' });
      expect(client.signInWithOtp).not.toHaveBeenCalled();
    },
  );

  it('trims a valid email and requests only the approved email flow', async () => {
    const client = createAuthClient();

    await expect(
      requestEmailSignInLink(client as unknown as AuthFlowClient, ' parishioner@example.org '),
    ).resolves.toEqual({ email: 'parishioner@example.org', status: 'sent' });
    expect(client.signInWithOtp).toHaveBeenCalledWith({
      email: 'parishioner@example.org',
      options: { shouldCreateUser: true },
    });
  });

  it('translates provider failure to a safe result', async () => {
    const client = createAuthClient();
    client.signInWithOtp.mockResolvedValue({
      data: { session: null },
      error: new Error('raw provider detail'),
    });

    await expect(
      requestEmailSignInLink(client as unknown as AuthFlowClient, 'person@example.org'),
    ).resolves.toEqual({ status: 'send-failed' });
  });

  it('classifies only the structured email resend throttle as rate limited', async () => {
    const client = createAuthClient();
    client.signInWithOtp.mockResolvedValue({
      data: { session: null },
      error: {
        code: 'over_email_send_rate_limit',
        message: 'For security purposes, you can only request this after 59 seconds.',
        status: 429,
      },
    });

    await expect(
      requestEmailSignInLink(client as unknown as AuthFlowClient, 'person@example.org'),
    ).resolves.toEqual({ status: 'rate-limited' });
  });

  it.each([
    { code: 'different_error', status: 429 },
    { code: 'over_email_send_rate_limit', status: 503 },
  ])('keeps other structured provider errors generic: %j', async (error) => {
    const client = createAuthClient();
    client.signInWithOtp.mockResolvedValue({
      data: { session: null },
      error: { ...error, message: 'raw provider detail' },
    });

    await expect(
      requestEmailSignInLink(client as unknown as AuthFlowClient, 'person@example.org'),
    ).resolves.toEqual({ status: 'send-failed' });
  });

  it('fails safely when local Auth is not configured', async () => {
    await expect(requestEmailSignInLink(null, 'person@example.org')).resolves.toEqual({
      status: 'unavailable',
    });
  });
});

describe('explicit confirmation', () => {
  it.each([
    { tokenHash: null, type: 'email' },
    { tokenHash: 'short', type: 'email' },
    { tokenHash: VALID_TOKEN_HASH, type: 'signup' },
  ])('rejects malformed confirmation input without verification', async (input) => {
    const client = createAuthClient();

    await expect(
      confirmEmailSignIn(client as unknown as AuthFlowClient, {
        destination: '/auth',
        tokenHash: input.tokenHash,
        type: input.type,
      }),
    ).resolves.toEqual({ status: 'invalid-link' });
    expect(client.verifyOtp).not.toHaveBeenCalled();
  });

  it('verifies the token only when the explicit action invokes the operation', async () => {
    const client = createAuthClient();

    await expect(
      confirmEmailSignIn(client as unknown as AuthFlowClient, {
        destination: '/churches/pokrov-catanzaro',
        tokenHash: VALID_TOKEN_HASH,
        type: 'email',
      }),
    ).resolves.toEqual({ destination: '/', status: 'verified' });
    expect(client.verifyOtp).toHaveBeenCalledOnce();
    expect(client.verifyOtp).toHaveBeenCalledWith({
      token_hash: VALID_TOKEN_HASH,
      type: 'email',
    });
  });

  it('translates invalid, expired, or reused token failures to one safe result', async () => {
    const client = createAuthClient();
    client.verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error('expired') });

    await expect(
      confirmEmailSignIn(client as unknown as AuthFlowClient, {
        destination: '/auth',
        tokenHash: VALID_TOKEN_HASH,
        type: 'email',
      }),
    ).resolves.toEqual({ status: 'invalid-link' });
  });
});

describe('redirect safety', () => {
  it.each([
    'https://example.net/phishing',
    '//example.net/phishing',
    '/%2F%2Fexample.net/phishing',
    '/\\example.net',
    'javascript:alert(1)',
    '/unknown-internal-route',
    '/auth/confirm?token_hash=secret',
    '/',
    '/auth',
    '/churches',
    '/churches/pokrov-catanzaro',
    '/drivers/driver-1',
  ])('always uses the approved root destination instead of %j', async (destination) => {
    const client = createAuthClient();

    await expect(
      confirmEmailSignIn(client as unknown as AuthFlowClient, {
        destination,
        tokenHash: VALID_TOKEN_HASH,
        type: 'email',
      }),
    ).resolves.toEqual({ destination: '/', status: 'verified' });
  });
});

describe('verified server identity and sign-out', () => {
  it('resolves identity through getClaims and never consults getSession', async () => {
    const client = createAuthClient();
    client.getClaims.mockResolvedValue({
      data: { claims: { email: 'person@example.org', sub: 'internal-user-id' } },
      error: null,
    });

    await expect(
      resolveVerifiedAuthIdentity(client as unknown as AuthFlowClient),
    ).resolves.toEqual({ email: 'person@example.org' });
    expect(client.getClaims).toHaveBeenCalledOnce();
    expect(client.getSession).not.toHaveBeenCalled();
  });

  it('treats absent or unverifiable sessions as anonymous', async () => {
    const client = createAuthClient();
    client.getClaims.mockResolvedValue({ data: { claims: null }, error: new Error('missing') });

    await expect(
      resolveVerifiedAuthIdentity(client as unknown as AuthFlowClient),
    ).resolves.toBeNull();
    await expect(resolveVerifiedAuthIdentity(null)).resolves.toBeNull();
  });

  it('signs out only the current session', async () => {
    const client = createAuthClient();

    await expect(
      signOutCurrentSession(client as unknown as AuthFlowClient),
    ).resolves.toBe(true);
    expect(client.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('email parsing', () => {
  it('does not expose values longer than the email boundary to Auth', () => {
    expect(parseEmail(`${'a'.repeat(250)}@example.org`)).toBeNull();
  });
});
