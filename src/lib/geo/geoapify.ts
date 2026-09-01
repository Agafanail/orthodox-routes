import {
  GeoProviderUnavailableError,
  RouteNotAvailableError,
  type GeoProvider,
  type GeoProviderProbe,
  type PlaceSearchOptions,
  type RouteRequest,
} from './provider';
import type { PlaceCandidate, RouteMeasurement } from './types';

/**
 * The Geoapify adapter.
 *
 * Geoapify serves OpenStreetMap, OpenAddresses, and GeoNames data, whose open licences permit
 * storing a coordinate for as long as the person keeps their place and using it for matching
 * between different people. That is the reason this provider can support the approved model
 * where Google Maps Platform cannot; the review is recorded in the backend architecture
 * document.
 *
 * The adapter keeps only what the domain needs. From a search it keeps a coordinate, a display
 * address, a locality, and a country. From a route it keeps a distance and a duration, and it
 * never reads or returns the route geometry, because the driver made no promise to follow it.
 * The API key is never logged, never returned, and never placed in an error message.
 */

const SEARCH_ENDPOINT = 'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOCODE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
const ROUTING_ENDPOINT = 'https://api.geoapify.com/v1/routing';
const REQUEST_TIMEOUT_MS = 8000;

export const GEOAPIFY_ATTRIBUTION = 'Данные: © OpenStreetMap, OpenAddresses, GeoNames · Geoapify';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : null;
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * True when a status means "the provider is fine, but it cannot answer this question".
 *
 * A refusal of the request itself is permanent for these coordinates: the commonest case is a
 * point with no road near it, which Geoapify answers with 400. Retrying changes nothing, and it
 * says nothing about the provider's health, so it must not be reported as an outage. The
 * statuses that do mean trouble are excluded: a rejected credential, a forbidden call, and a
 * rate limit are all conditions that affect every other request too.
 */
function refusesThisRequest(status: number) {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

/**
 * Runs one request with a bounded timeout. A failure becomes the ordinary unavailable error, so
 * a provider outage can never surface a vendor message or a status code to a parishioner — with
 * one exception: a request the provider refuses outright is reported separately, so one
 * unanswerable question does not masquerade as the provider being down.
 */
async function requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (refusesThisRequest(response.status)) throw new RouteNotAvailableError();
    if (!response.ok) throw new GeoProviderUnavailableError();
    return await response.json();
  } catch (error) {
    if (error instanceof RouteNotAvailableError) throw error;
    throw new GeoProviderUnavailableError();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseCandidate(value: unknown, index: number): PlaceCandidate | null {
  const feature = record(value);
  const properties = record(feature?.properties);
  if (!properties) return null;

  const lat = finite(properties.lat);
  const lon = finite(properties.lon);
  const address = text(properties.formatted, 300);
  if (lat === null || lon === null || !address) return null;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;

  const locality = text(properties.city, 120) ?? text(properties.county, 120);
  const countryCode = text(properties.country_code, 2);
  const providerPlaceId = text(properties.place_id, 255);

  return {
    address,
    id: providerPlaceId ?? `${lat},${lon},${index}`,
    lat,
    lng: lon,
    ...(locality ? { locality } : {}),
    // Geoapify returns a lowercase ISO code; the application stores it uppercase.
    ...(countryCode && /^[A-Za-z]{2}$/.test(countryCode) ? { countryCode: countryCode.toUpperCase() } : {}),
    ...(providerPlaceId && /^[A-Za-z0-9_:.-]{1,255}$/.test(providerPlaceId) ? { providerPlaceId } : {}),
  };
}

export function createGeoapifyProvider(apiKey: string): GeoProvider {
  /**
   * The picker searches a whole address the person has finished typing, which is what the
   * geocoding endpoint is for. Autocomplete is tuned for partial input and, on a complete
   * address, will happily return a differently named street in the same city.
   */
  function searchUrl(text: string, options: PlaceSearchOptions = {}) {
    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set('text', text.slice(0, 200));
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('limit', String(Math.min(Math.max(options.limit ?? 8, 1), 20)));
    url.searchParams.set('lang', options.language ?? 'ru');
    // Bias towards the church the person is looking at, so a village street name near that
    // church beats an identical name in another country.
    if (options.near) url.searchParams.set('bias', `proximity:${options.near.lng},${options.near.lat}`);
    url.searchParams.set('apiKey', apiKey);
    return url;
  }

  return {
    name: 'geoapify',

    async probe(): Promise<GeoProviderProbe> {
      // Each capability is checked separately. A credential refused everywhere points at the
      // key or its restrictions; one endpoint refused alone points at that endpoint.
      const checks: Record<string, URL> = {
        autocomplete: (() => {
          const url = new URL(SEARCH_ENDPOINT);
          url.searchParams.set('text', 'Via Roma 1, Torino');
          url.searchParams.set('format', 'geojson');
          url.searchParams.set('limit', '1');
          url.searchParams.set('apiKey', apiKey);
          return url;
        })(),
        geocode: searchUrl('Via Roma 1, Torino'),
        routing: (() => {
          const url = new URL(ROUTING_ENDPOINT);
          url.searchParams.set('waypoints', '45.0703,7.6869|45.0200,7.6500');
          url.searchParams.set('mode', 'drive');
          url.searchParams.set('apiKey', apiKey);
          return url;
        })(),
      };

      const endpoints: Record<string, number | null> = {};
      let usableResults: number | null = null;

      for (const [name, url] of Object.entries(checks)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          endpoints[name] = response.status;
          if (name === 'geocode' && response.ok) {
            const payload = record(await response.json());
            const features = Array.isArray(payload?.features) ? payload.features : [];
            usableResults = features
              .map(parseCandidate)
              .filter((candidate): candidate is PlaceCandidate => candidate !== null).length;
          }
        } catch {
          endpoints[name] = null;
        } finally {
          clearTimeout(timeout);
        }
      }

      return {
        endpoints,
        ok: endpoints.geocode === 200 && (usableResults ?? 0) > 0,
        results: usableResults,
        status: endpoints.geocode,
      };
    },

    async searchPlaces(query: string, options: PlaceSearchOptions = {}): Promise<PlaceCandidate[]> {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];

      const payload = record(await requestJson(searchUrl(trimmed, options), options.signal));
      const features = Array.isArray(payload?.features) ? payload.features : [];
      return features
        .map(parseCandidate)
        .filter((candidate): candidate is PlaceCandidate => candidate !== null);
    },

    async measureRoute(request: RouteRequest): Promise<RouteMeasurement> {
      const points = [request.origin, ...(request.via ? [request.via] : []), request.destination];
      const url = new URL(ROUTING_ENDPOINT);
      url.searchParams.set('waypoints', points.map((point) => `${point.lat},${point.lng}`).join('|'));
      url.searchParams.set('mode', 'drive');
      url.searchParams.set('units', 'metric');
      url.searchParams.set('apiKey', apiKey);

      const payload = record(await requestJson(url, request.signal));
      const feature = record(Array.isArray(payload?.features) ? payload.features[0] : null);
      const properties = record(feature?.properties);
      const distanceM = finite(properties?.distance);
      const durationS = finite(properties?.time);

      // Anything but two usable numbers is treated as an outage rather than as a zero-length
      // route, so matching claims nothing instead of claiming something false.
      if (distanceM === null || durationS === null || distanceM < 0 || durationS < 0) {
        throw new GeoProviderUnavailableError();
      }
      // The response also carries route geometry. It is deliberately not read: no provider
      // route line is stored, published, or presented as a commitment.
      return { distanceM: Math.round(distanceM), durationS: Math.round(durationS) };
    },
  };
}
