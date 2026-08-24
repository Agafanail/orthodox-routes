import type { Coordinate, PlaceCandidate, RouteMeasurement } from './types';

/**
 * The application-owned boundary to a map provider.
 *
 * Only three capabilities are needed, and each is deliberately narrow so that selecting or
 * replacing a vendor is configuration rather than redesign:
 *
 * - `searchPlaces` turns text into candidate places the user can confirm;
 * - `measureRoute` returns road distance and duration and nothing else — no geometry is
 *   returned to the domain and none is stored, because the driver never promised to follow a
 *   provider-computed road;
 * - the browser map surface, which is a rendering concern rather than part of this contract.
 *
 * No vendor payload is ever persisted. The database stores only the coordinate the user
 * confirmed and the application-derived approximation of it.
 */
export type GeoProvider = {
  readonly name: string;
  searchPlaces(query: string, options?: PlaceSearchOptions): Promise<PlaceCandidate[]>;
  measureRoute(request: RouteRequest): Promise<RouteMeasurement>;
};

export type PlaceSearchOptions = {
  /** Optional bias so results near the church the user is looking at come first. */
  near?: Coordinate;
  language?: string;
  limit?: number;
  signal?: AbortSignal;
};

export type RouteRequest = {
  origin: Coordinate;
  destination: Coordinate;
  /** The candidate passenger meeting point, when measuring a detour rather than a baseline. */
  via?: Coordinate;
  signal?: AbortSignal;
};

/**
 * Raised when no provider is configured, or when a configured provider cannot answer right now.
 * Matching treats this as "not established", never as "does not match".
 */
export class GeoProviderUnavailableError extends Error {
  constructor(message = 'The map provider is unavailable.') {
    super(message);
    this.name = 'GeoProviderUnavailableError';
  }
}

export type GeoProviderConfig = {
  provider: string;
  /**
   * Used only on the server, for address search and route measurement. It is a different
   * credential from the render key, restricted by allowed IP address at the provider, and it
   * must never be exposed to a browser.
   */
  serverKey: string;
};

/**
 * Reads the server-side provider configuration. Keys live only in the hosting secret manager;
 * none is committed, printed, or logged. Absent configuration is a normal state that the
 * application degrades around rather than an error to surface to a parishioner.
 */
export function getGeoProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): GeoProviderConfig | null {
  const provider = environment.ORTHODOX_ROUTES_MAP_PROVIDER?.trim();
  const serverKey = environment.ORTHODOX_ROUTES_MAP_SERVER_KEY?.trim();
  if (!provider || !serverKey) return null;
  return { provider, serverKey };
}

/**
 * True when the browser may render an interactive map surface.
 *
 * The render credential is deliberately separate from the server credential. It is exposed to
 * the browser by necessity — map tiles are fetched by the page — so at the provider it is
 * restricted to this application's domains and to map rendering alone. It can therefore not be
 * used to spend address searches or route calculations even if someone copies it out of a page.
 */
export function hasBrowserMapConfiguration(
  environment: Record<string, string | undefined> = process.env,
) {
  return Boolean(environment.NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY?.trim());
}
