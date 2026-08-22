import { createFakeGeoProvider } from './fake-provider';
import { getGeoProviderConfig, type GeoProvider } from './provider';

/**
 * Builds the configured map provider.
 *
 * The vendor is deliberately resolved by name here so that adding one is a single adapter file
 * rather than a change to the domain. Until a vendor is selected, the only implementation is the
 * deterministic local fake, which is refused outside development so it can never stand in for a
 * real provider in a deployed environment.
 */
export function resolveGeoProvider(
  environment: Record<string, string | undefined> = process.env,
): GeoProvider | null {
  const config = getGeoProviderConfig(environment);
  if (!config) return null;

  if (config.provider === 'local-fake') {
    return environment.NODE_ENV === 'production' ? null : createFakeGeoProvider();
  }

  // No vendor adapter is implemented yet: selecting one is an owner decision with account,
  // billing, and data-storage consequences recorded in the backend architecture document.
  return null;
}
