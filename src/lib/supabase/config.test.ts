import { afterEach, describe, expect, it } from 'vitest';
import { getPublicSupabaseConfig, isSafePublicSupabaseKey } from './config';

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function legacyJwt(role: string) {
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `header.${payload}.signature`;
}

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

describe('public Supabase configuration', () => {
  it('accepts publishable and legacy anonymous public keys', () => {
    expect(isSafePublicSupabaseKey('sb_publishable_local')).toBe(true);
    expect(isSafePublicSupabaseKey(legacyJwt('anon'))).toBe(true);
  });

  it('rejects secret and service-role credentials', () => {
    expect(isSafePublicSupabaseKey('sb_secret_never_public')).toBe(false);
    expect(isSafePublicSupabaseKey(legacyJwt('service_role'))).toBe(false);
  });

  it('keeps ordinary builds operational when Auth variables are absent', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(getPublicSupabaseConfig()).toBeNull();
  });

  it('returns only a valid public URL and key pair', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_local';

    expect(getPublicSupabaseConfig()).toEqual({
      key: 'sb_publishable_local',
      url: 'http://127.0.0.1:54321',
    });
  });
});
