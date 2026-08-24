import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBrowserMapKey: vi.fn(),
  getContextualRegistrationConfig: vi.fn(),
  getPublicSupabaseConfig: vi.fn(),
  getServerSupabaseConfig: vi.fn(),
  resolveGeoProvider: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/config', () => ({
  getContextualRegistrationConfig: mocks.getContextualRegistrationConfig,
  getPublicSupabaseConfig: mocks.getPublicSupabaseConfig,
  getServerSupabaseConfig: mocks.getServerSupabaseConfig,
}));
vi.mock('@/lib/geo/provider-factory', () => ({
  getBrowserMapKey: mocks.getBrowserMapKey,
  resolveGeoProvider: mocks.resolveGeoProvider,
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
    mocks.resolveGeoProvider.mockReturnValue(null);
    mocks.getBrowserMapKey.mockReturnValue(null);
  });

  // A missing credential and a rejected one look identical from a page, so readiness reports
  // which half is configured. It reports booleans only: no key, no length, no provider reply.
  it('reports each map capability separately without revealing a credential', async () => {
    mocks.resolveGeoProvider.mockReturnValue({ name: 'geoapify' });
    mocks.getBrowserMapKey.mockReturnValue('render-key');

    const body = await (await GET(new Request('https://app.example.test/api/readiness'))).json();

    expect(body.maps).toEqual({ rendering: true, search: true });
    expect(JSON.stringify(body)).not.toContain('render-key');
  });

  it('shows search unconfigured while rendering still works', async () => {
    mocks.getBrowserMapKey.mockReturnValue('render-key');

    const body = await (await GET(new Request('https://app.example.test/api/readiness'))).json();

    expect(body.maps).toEqual({ rendering: true, search: false });
  });

  // The probe costs a billed provider request, so an ordinary poll must never trigger it.
  it('does not call the provider unless the probe is requested', async () => {
    const probe = vi.fn();
    mocks.resolveGeoProvider.mockReturnValue({ name: 'geoapify', probe });

    const body = await (await GET(new Request('https://app.example.test/api/readiness'))).json();

    expect(probe).not.toHaveBeenCalled();
    expect(body.maps.probe).toBeUndefined();
  });

  it('reports the provider outcome and status when the probe is requested', async () => {
    const probe = vi.fn().mockResolvedValue({ endpoints: { autocomplete: 401 }, ok: false, results: null, status: 401 });
    mocks.resolveGeoProvider.mockReturnValue({ name: 'geoapify', probe });

    const body = await (await GET(new Request('https://app.example.test/api/readiness?probe=maps'))).json();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(body.maps.probe).toEqual({ endpoints: { autocomplete: 401 }, ok: false, results: null, status: 401 });
  });

  it('reports an unconfigured provider rather than calling nothing silently', async () => {
    const body = await (await GET(new Request('https://app.example.test/api/readiness?probe=maps'))).json();

    expect(body.maps.probe).toEqual({ ok: false, results: null, status: null });
  });

  it('fails closed when required staging configuration is incomplete', async () => {
    mocks.getServerSupabaseConfig.mockReturnValue(null);

    const response = await GET(new Request('https://app.example.test/api/readiness'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ maps: { rendering: false, search: false }, scope: 'core-application', status: 'unavailable' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('contains backend errors without returning their details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private backend detail' } });

    const response = await GET(new Request('https://app.example.test/api/readiness'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ maps: { rendering: false, search: false }, scope: 'core-application', status: 'unavailable' });
  });

  it('reports ready only after the committed Core API responds', async () => {
    const response = await GET(new Request('https://app.example.test/api/readiness'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ maps: { rendering: false, search: false }, scope: 'core-application', status: 'ready' });
    expect(mocks.rpc).toHaveBeenCalledWith('transport_church_by_slug', {
      p_slug: '__core_readiness__',
    });
  });
});
