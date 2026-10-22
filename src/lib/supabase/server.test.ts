import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ config: vi.fn(), cookies: vi.fn(), factory: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: f.cookies }));
vi.mock('./config', () => ({ getPublicSupabaseConfig: f.config }));
vi.mock('@supabase/ssr', async () => ({ ...await vi.importActual('@supabase/ssr'), createServerClient: f.factory }));
import { createServerSupabaseClient } from './server';

describe('server client before SSR background initialization', () => {
  beforeEach(() => {
    vi.resetAllMocks(); f.config.mockReturnValue({ url: 'https://synthetic.supabase.co', key: 'public-key' });
    f.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() }); f.factory.mockReturnValue({ synthetic: true });
  });
  it('preserves ordinary server client construction', async () => {
    expect(await createServerSupabaseClient()).toEqual({ synthetic: true }); expect(f.factory).toHaveBeenCalledTimes(1);
  });
  it.each(['sb-synthetic-auth-token', 'sb-synthetic-auth-token-code-verifier'])('refuses bad %s encoding before SDK creation', async (name) => {
    f.cookies.mockResolvedValue({ getAll: () => [{ name, value: 'base64-not-a-session' }] });
    expect(await createServerSupabaseClient()).toBeNull(); expect(f.factory).not.toHaveBeenCalled();
  });
  it('retains compatibility with readable legacy state', async () => {
    f.cookies.mockResolvedValue({ getAll: () => [{ name: 'sb-synthetic-auth-token', value: '{}' }] });
    expect(await createServerSupabaseClient()).toEqual({ synthetic: true });
  });
  it('does not turn readable forged session contents into verified authority', async () => {
    f.cookies.mockResolvedValue({ getAll: () => [{ name: 'sb-synthetic-auth-token', value: '{"sub":"forged"}' }] });
    await createServerSupabaseClient(); expect(f.factory).toHaveBeenCalledTimes(1); // Auth still owns verification.
  });
  it('recovers only on explicit Auth action, deleting exact project state while preserving all other cookies', async () => {
    const values = new Map([['sb-synthetic-auth-token.0', 'base64-not-a-session'],
      ['sb-synthetic-auth-token-code-verifier', 'legacy-verifier'], ['sb-other-auth-token', 'other-session'],
      ['orthodox-routes-contextual-draft', 'preserved-draft'], ['__Host-orthodox-routes-complaint-preparation', 'preserved-retry']]);
    const deleted: string[] = [];
    f.cookies.mockResolvedValue({ getAll: () => [...values].map(([name, value]) => ({ name, value })),
      delete: (name: string) => { deleted.push(name); values.delete(name); } });
    expect(await createServerSupabaseClient()).toBeNull(); expect(deleted).toEqual([]);
    expect(await createServerSupabaseClient({ recoverMalformedCookies: true })).toEqual({ synthetic: true });
    expect(deleted).toEqual(['sb-synthetic-auth-token.0', 'sb-synthetic-auth-token-code-verifier']);
    expect([...values.keys()]).toEqual(['sb-other-auth-token', 'orthodox-routes-contextual-draft', '__Host-orthodox-routes-complaint-preparation']);
  });
  it('fails closed if explicit recovery cannot clear cookies', async () => {
    f.cookies.mockResolvedValue({ getAll: () => [{ name: 'sb-synthetic-auth-token', value: 'base64-not-a-session' }],
      delete: () => { throw new Error('private-cookie-store-error'); } });
    expect(await createServerSupabaseClient({ recoverMalformedCookies: true })).toBeNull(); expect(f.factory).not.toHaveBeenCalled();
  });
  it('does not clear healthy state even on an explicit recovery-capable Auth action', async () => {
    const remove = vi.fn(); f.cookies.mockResolvedValue({ getAll: () => [], delete: remove });
    await createServerSupabaseClient({ recoverMalformedCookies: true }); expect(remove).not.toHaveBeenCalled();
  });
});
