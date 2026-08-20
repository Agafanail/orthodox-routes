import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_AUTH_DESTINATION = '/';

export type AuthFlowClient = Pick<
  SupabaseClient['auth'],
  'getClaims' | 'signInWithOtp' | 'signOut' | 'verifyOtp'
>;

export type AuthIdentity = {
  email: string | null;
};

export type RequestLinkResult =
  | { email: string; status: 'sent' }
  | { status: 'invalid-email' | 'rate-limited' | 'send-failed' | 'unavailable' };

export type ConfirmLinkResult =
  | { destination: string; status: 'verified' }
  | { status: 'invalid-link' | 'unavailable' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{32,1024}$/;

function isEmailSendRateLimitError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.status === 429 && candidate.code === 'over_email_send_rate_limit';
}

export function parseEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function isValidEmailTokenHash(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_HASH_PATTERN.test(value);
}

export async function requestEmailSignInLink(
  client: AuthFlowClient | null,
  rawEmail: unknown,
  emailRedirectTo?: string,
): Promise<RequestLinkResult> {
  const email = parseEmail(rawEmail);
  if (!email) return { status: 'invalid-email' };
  if (!client) return { status: 'unavailable' };

  try {
    const { error } = await client.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });
    if (isEmailSendRateLimitError(error)) return { status: 'rate-limited' };
    return error ? { status: 'send-failed' } : { email, status: 'sent' };
  } catch {
    return { status: 'send-failed' };
  }
}

export async function confirmEmailSignIn(
  client: AuthFlowClient | null,
  input: { destination: unknown; tokenHash: unknown; type: unknown },
): Promise<ConfirmLinkResult> {
  if (input.type !== 'email' || !isValidEmailTokenHash(input.tokenHash)) {
    return { status: 'invalid-link' };
  }
  if (!client) return { status: 'unavailable' };

  try {
    const { error } = await client.verifyOtp({
      token_hash: input.tokenHash,
      type: 'email',
    });
    if (error) return { status: 'invalid-link' };

    return {
      destination: DEFAULT_AUTH_DESTINATION,
      status: 'verified',
    };
  } catch {
    return { status: 'invalid-link' };
  }
}

export async function resolveVerifiedAuthIdentity(client: AuthFlowClient | null) {
  if (!client) return null;

  try {
    const { data, error } = await client.getClaims();
    const claims = data?.claims;
    if (error || typeof claims?.sub !== 'string' || !claims.sub) return null;

    return {
      email: typeof claims.email === 'string' ? claims.email : null,
    } satisfies AuthIdentity;
  } catch {
    return null;
  }
}

export async function signOutCurrentSession(client: AuthFlowClient | null) {
  if (!client) return false;

  try {
    const { error } = await client.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}
