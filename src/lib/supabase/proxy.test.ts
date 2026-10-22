import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const f = vi.hoisted(() => ({ config: vi.fn(), factory: vi.fn(), claims: vi.fn() }));
vi.mock('./config', () => ({ getPublicSupabaseConfig: f.config }));
vi.mock('@supabase/ssr', async () => ({ ...await vi.importActual('@supabase/ssr'), createServerClient: f.factory }));
import { updateAuthSession } from './proxy';

describe('Auth proxy malformed cookie containment', () => {
  beforeEach(() => {
    vi.resetAllMocks(); f.config.mockReturnValue({ url: 'https://synthetic.supabase.co', key: 'public-key' });
    f.claims.mockResolvedValue({ data: null, error: null }); f.factory.mockReturnValue({ auth: { getClaims: f.claims } });
  });
  it('preserves the ordinary claim refresh and private response headers', async () => {
    const response = await updateAuthSession(new NextRequest('https://routes.example.test/'));
    expect(f.claims).toHaveBeenCalledTimes(1); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('does not initialize Auth, expose diagnostics, or clear malformed cookies into a guest', async () => {
    const request = new NextRequest('https://routes.example.test/', { headers: { cookie: 'sb-synthetic-auth-token=base64-not-a-session' } });
    const response = await updateAuthSession(request);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.claims).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull(); expect(request.cookies.get('sb-synthetic-auth-token')).toBeDefined();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
