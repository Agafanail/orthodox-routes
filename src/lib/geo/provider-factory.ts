import { createFakeGeoProvider } from './fake-provider';
import { createGeoapifyProvider } from './geoapify';
import { getGeoProviderConfig, type GeoProvider } from './provider';

/**
 * Builds the configured map provider.
 *
 * The vendor is resolved by name here so that adding one is a single adapter file rather than a
 * change to the domain. An unknown name yields no provider at all, which the application treats
 * as an ordinary outage rather than as an error to show a parishioner.
 *
 * The deterministic local fake is refused outside development, so it can never stand in for a
 * real provider in a deployed environment.
 */
export function resolveGeoProvider(
  environment: Record<string, string | undefined> = process.env,
): GeoProvider | null {
  const config = getGeoProviderConfig(environment);
  if (!config) return null;

  if (config.provider === 'geoapify') return createGeoapifyProvider(config.serverKey);
  if (config.provider === 'local-fake') {
    return environment.NODE_ENV === 'production' ? null : createFakeGeoProvider();
  }
  return null;
}

/** Vendors that serve the map imagery the browser renders. */
const IMAGERY_PROVIDERS = new Set(['geoapify']);

/**
 * The credential the browser uses to render map tiles.
 *
 * This is a second, different key from the server one. The server key stays on the server and is
 * restricted by IP; this one is necessarily visible in the page and is therefore restricted at
 * the provider to this application's domains and to map rendering only, so copying it out of a
 * page buys nothing. It is withheld entirely unless a vendor that serves imagery is configured,
 * so the local fake never produces a request that would fail and never pretends to be a map.
 */
export function getBrowserMapKey(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const provider = environment.ORTHODOX_ROUTES_MAP_PROVIDER?.trim();
  if (!provider || !IMAGERY_PROVIDERS.has(provider)) return null;
  return environment.NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY?.trim() || null;
}
