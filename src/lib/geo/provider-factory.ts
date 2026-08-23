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
 * The key the browser may use for map imagery.
 *
 * It is separate from the server key on purpose: the browser key is restricted to rendering and
 * carries no search or routing rights that could be spent from a page. It is withheld unless a
 * vendor that actually serves imagery is configured, so the local fake never produces a request
 * to a vendor that would fail and never pretends to be a real map.
 */
export function getBrowserMapKey(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const provider = environment.ORTHODOX_ROUTES_MAP_PROVIDER?.trim();
  if (!provider || !IMAGERY_PROVIDERS.has(provider)) return null;
  return environment.NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_BROWSER_KEY?.trim() || null;
}
