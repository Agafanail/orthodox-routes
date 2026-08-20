import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getContextualRegistrationConfig: vi.fn(),
  getPublicSupabaseConfig: vi.fn(),
  getServerSupabaseConfig: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/config', () => ({
  getContextualRegistrationConfig: mocks.getContextualRegistrationConfig,
  getPublicSupabaseConfig: mocks.getPublicSupabaseConfig,
  getServerSupabaseConfig: mocks.getServerSupabaseConfig,
}));

import { GET } from './route';

describe('Core application readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicSupabaseConfig.mockReturnValue({ key: 'public-test-key', url: 'https://staging.example.test' });
    mocks.getServerSupabaseConfig.mockReturnValue({ key: 'server-test-key', url: 'https://staging.example.test' });
    mocks.getContextualRegistrationConfig.mockReturnValue({
      appOrigin: 'https://app-staging.example.test',
      secret: 's'.repeat(32),
    });
    mocks.createClient.mockReturnValue({
      schema: vi.fn(() => ({ rpc: mocks.rpc })),
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it('fails closed when required staging configuration is incomplete', async () => {
    mocks.getServerSupabaseConfig.mockReturnValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ scope: 'core-application', status: 'unavailable' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('contains backend errors without returning their details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private backend detail' } });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ scope: 'core-application', status: 'unavailable' });
  });

  it('reports ready only after the committed Core API responds', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ scope: 'core-application', status: 'ready' });
    expect(mocks.rpc).toHaveBeenCalledWith('transport_church_by_slug', {
      p_slug: '__core_readiness__',
    });
  });
});
