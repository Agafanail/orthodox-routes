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
});
