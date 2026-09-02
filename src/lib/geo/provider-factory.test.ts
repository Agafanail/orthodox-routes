import { describe, expect, it } from 'vitest';
import { getBrowserMapKey, resolveGeoProvider } from './provider-factory';

// Two different credentials, exactly as the owner configures them.
const geoapify = {
  NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY: 'render-key',
  ORTHODOX_ROUTES_MAP_PROVIDER: 'geoapify',
  ORTHODOX_ROUTES_MAP_SERVER_KEY: 'server-key',
};

describe('resolveGeoProvider', () => {
  it('builds the selected vendor adapter', () => {
    expect(resolveGeoProvider(geoapify)?.name).toBe('geoapify');
  });

  it('yields nothing when the provider is unconfigured or unknown', () => {
    expect(resolveGeoProvider({})).toBeNull();
    expect(resolveGeoProvider({ ORTHODOX_ROUTES_MAP_PROVIDER: 'geoapify' })).toBeNull();
    expect(resolveGeoProvider({ ...geoapify, ORTHODOX_ROUTES_MAP_PROVIDER: 'some-vendor' })).toBeNull();
  });

  it('allows the deterministic fake only outside production', () => {
    const fake = { ...geoapify, ORTHODOX_ROUTES_MAP_PROVIDER: 'local-fake' };
    expect(resolveGeoProvider({ ...fake, NODE_ENV: 'development' })?.name).toBe('local-fake');
    expect(resolveGeoProvider({ ...fake, NODE_ENV: 'production' })).toBeNull();
  });
});

describe('getBrowserMapKey', () => {
  it('returns the render-only credential for a vendor that serves imagery', () => {
    expect(getBrowserMapKey(geoapify)).toBe('render-key');
  });

  // The local fake serves no tiles, so offering a key would only produce a broken request.
  it('withholds the credential when no imagery vendor is configured', () => {
    expect(getBrowserMapKey({ ...geoapify, ORTHODOX_ROUTES_MAP_PROVIDER: 'local-fake' })).toBeNull();
    expect(getBrowserMapKey({ NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY: 'render-key' })).toBeNull();
    expect(getBrowserMapKey({})).toBeNull();
  });

  // The two credentials are separate at the provider; the server one must never reach a page.
  it('never returns the server credential to the browser', () => {
    expect(getBrowserMapKey(geoapify)).not.toBe(geoapify.ORTHODOX_ROUTES_MAP_SERVER_KEY);
  });

  it('does not fall back to the server credential when the render one is absent', () => {
    const withoutRenderKey = { ...geoapify, NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY: undefined };
    expect(getBrowserMapKey(withoutRenderKey)).toBeNull();
  });
});
