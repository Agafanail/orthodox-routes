import { describe, expect, it } from 'vitest';
import { getBrowserMapKey, resolveGeoProvider } from './provider-factory';

const geoapify = {
  NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_BROWSER_KEY: 'browser-key',
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
  it('returns the render-only key for a vendor that serves imagery', () => {
    expect(getBrowserMapKey(geoapify)).toBe('browser-key');
  });

  // The local fake serves no tiles, so offering a key would only produce a broken image.
  it('withholds the key when no imagery vendor is configured', () => {
    expect(getBrowserMapKey({ ...geoapify, ORTHODOX_ROUTES_MAP_PROVIDER: 'local-fake' })).toBeNull();
    expect(getBrowserMapKey({ NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_BROWSER_KEY: 'browser-key' })).toBeNull();
    expect(getBrowserMapKey({})).toBeNull();
  });

  it('never returns the server key to the browser', () => {
    const key = getBrowserMapKey(geoapify);
    expect(key).not.toBe(geoapify.ORTHODOX_ROUTES_MAP_SERVER_KEY);
  });
});
