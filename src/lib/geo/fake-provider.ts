import { GeoProviderUnavailableError, type GeoProvider, type RouteRequest } from './provider';
import type { Coordinate, PlaceCandidate, RouteMeasurement } from './types';

/**
 * A deterministic local stand-in for a map provider.
 *
 * It exists so the whole domain — publication, approximation, matching, projections, and their
 * tests — can be verified without a provider account, network access, or spend. It models roads
 * as straight lines with a fixed detour factor, which is enough to exercise the deterministic
 * rules but is never real routing. A result from this fake is never reported as provider
 * verification.
 */

const EARTH_RADIUS_M = 6371008.8;
/** Roads are longer than a straight line; one constant factor keeps the fake predictable. */
const ROAD_FACTOR = 1.3;
/** A calm average used only to derive an illustrative duration. */
const AVERAGE_SPEED_MS = 13.9;

export function greatCircleMetres(from: Coordinate, to: Coordinate) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type FakeGeoProviderOptions = {
  places?: PlaceCandidate[];
  /** Makes every call fail, so provider-failure degradation can be verified. */
  unavailable?: boolean;
  /** Records each measured leg so tests can assert that cheap filters ran first. */
  onMeasure?: (request: RouteRequest) => void;
};

export function createFakeGeoProvider(options: FakeGeoProviderOptions = {}): GeoProvider {
  const places = options.places ?? [];

  return {
    name: 'local-fake',

    async probe() {
      return options.unavailable
        ? { ok: false, results: null, status: null }
        : { ok: true, results: places.length, status: 200 };
    },

    async searchPlaces(query, searchOptions) {
      if (options.unavailable) throw new GeoProviderUnavailableError();
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return [];
      const matches = places.filter((place) => place.address.toLowerCase().includes(needle)
        || (place.locality ?? '').toLowerCase().includes(needle));
      return matches.slice(0, searchOptions?.limit ?? 10);
    },

    async measureRoute(request): Promise<RouteMeasurement> {
      if (options.unavailable) throw new GeoProviderUnavailableError();
      options.onMeasure?.(request);
      const legs = request.via
        ? [greatCircleMetres(request.origin, request.via), greatCircleMetres(request.via, request.destination)]
        : [greatCircleMetres(request.origin, request.destination)];
      const distanceM = legs.reduce((total, leg) => total + leg, 0) * ROAD_FACTOR;
      return {
        distanceM: Math.round(distanceM),
        durationS: Math.round(distanceM / AVERAGE_SPEED_MS),
      };
    },
  };
}
