import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeoapifyProvider } from './geoapify';
import { GeoProviderUnavailableError, RouteNotAvailableError } from './provider';

const KEY = 'test-key-never-real';

function stubFetch(handler: (url: URL) => { ok?: boolean; status?: number; body?: unknown } | Promise<never>) {
  const calls: URL[] = [];
  vi.stubGlobal('fetch', async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const result = await handler(url);
    return {
      json: async () => result.body,
      ok: result.ok ?? (result.status === undefined || result.status < 400),
      status: result.status ?? 200,
    } as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const feature = {
  geometry: { coordinates: [7.6869, 45.0703], type: 'Point' },
  properties: {
    city: 'Torino',
    country_code: 'it',
    formatted: 'Via Roma 1, 10121 Torino, Italy',
    lat: 45.0703,
    lon: 7.6869,
    place_id: '51a1b2c3d4',
  },
  type: 'Feature',
};

describe('searchPlaces', () => {
  // A whole typed address belongs to the geocoding endpoint. Autocomplete is for partial input
  // and, given a complete address, returns a differently named street in the same city.
  it('asks the geocoding endpoint and keeps only the fields the domain stores', async () => {
    const calls = stubFetch(() => ({ body: { features: [feature], type: 'FeatureCollection' } }));
    const provider = createGeoapifyProvider(KEY);

    const results = await provider.searchPlaces('Via Roma', { near: { lat: 45.07, lng: 7.68 } });

    expect(calls[0].origin + calls[0].pathname).toBe('https://api.geoapify.com/v1/geocode/search');
    expect(calls[0].searchParams.get('text')).toBe('Via Roma');
    expect(calls[0].searchParams.get('bias')).toBe('proximity:7.68,45.07');
    expect(results).toEqual([{
      address: 'Via Roma 1, 10121 Torino, Italy',
      countryCode: 'IT',
      id: '51a1b2c3d4',
      lat: 45.0703,
      lng: 7.6869,
      locality: 'Torino',
      providerPlaceId: '51a1b2c3d4',
    }]);
  });

  it('does not call the provider for an empty query', async () => {
    const calls = stubFetch(() => ({ body: {} }));
    expect(await createGeoapifyProvider(KEY).searchPlaces('   ')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('drops a candidate that cannot be stored as a place', async () => {
    stubFetch(() => ({
      body: {
        features: [
          { properties: { formatted: 'No coordinate' } },
          { properties: { formatted: 'Impossible', lat: 95, lon: 7 } },
          feature,
        ],
      },
    }));
    expect(await createGeoapifyProvider(KEY).searchPlaces('x')).toHaveLength(1);
  });

  it('reports an ordinary outage instead of a provider status or message', async () => {
    stubFetch(() => ({ body: {}, ok: false }));
    await expect(createGeoapifyProvider(KEY).searchPlaces('x'))
      .rejects.toThrow(GeoProviderUnavailableError);

    stubFetch(() => Promise.reject(new Error('ECONNRESET at api.geoapify.com')));
    await expect(createGeoapifyProvider(KEY).searchPlaces('x'))
      .rejects.toThrow('The map provider is unavailable.');
  });
});

describe('measureRoute', () => {
  const routeBody = {
    features: [{
      geometry: { coordinates: [[[7.6, 45.0], [7.68, 45.07]]], type: 'MultiLineString' },
      properties: { distance: 12500.4, distance_units: 'meters', time: 1240.7 },
    }],
  };

  it('sends the waypoints in order and keeps only distance and duration', async () => {
    const calls = stubFetch(() => ({ body: routeBody }));
    const provider = createGeoapifyProvider(KEY);

    const measurement = await provider.measureRoute({
      destination: { lat: 45.0703, lng: 7.6869 },
      origin: { lat: 45.02, lng: 7.65 },
      via: { lat: 45.05, lng: 7.67 },
    });

    expect(calls[0].searchParams.get('waypoints')).toBe('45.02,7.65|45.05,7.67|45.0703,7.6869');
    expect(calls[0].searchParams.get('mode')).toBe('drive');
    // The response carried geometry; nothing but the two numbers leaves the adapter.
    expect(measurement).toEqual({ distanceM: 12500, durationS: 1241 });
    expect(Object.keys(measurement)).toEqual(['distanceM', 'durationS']);
  });

  it('omits the via point for a baseline route', async () => {
    const calls = stubFetch(() => ({ body: routeBody }));
    await createGeoapifyProvider(KEY).measureRoute({
      destination: { lat: 45.0703, lng: 7.6869 },
      origin: { lat: 45.02, lng: 7.65 },
    });
    expect(calls[0].searchParams.get('waypoints')).toBe('45.02,7.65|45.0703,7.6869');
  });

  // A missing number must not become a zero-length route that would claim a perfect match.
  it('treats an unusable answer as an outage', async () => {
    stubFetch(() => ({ body: { features: [{ properties: { distance: 100 } }] } }));
    await expect(createGeoapifyProvider(KEY).measureRoute({
      destination: { lat: 45.07, lng: 7.68 },
      origin: { lat: 45.02, lng: 7.65 },
    })).rejects.toThrow(GeoProviderUnavailableError);

    stubFetch(() => ({ body: { features: [] } }));
    await expect(createGeoapifyProvider(KEY).measureRoute({
      destination: { lat: 45.07, lng: 7.68 },
      origin: { lat: 45.02, lng: 7.65 },
    })).rejects.toThrow(GeoProviderUnavailableError);
  });
});

describe('a request the provider refuses', () => {
  // A point with no road near it is answered with 400. That says nothing about the provider's
  // health, and reporting it as an outage stopped matching for a whole church.
  it('is reported apart from an outage, so one bad point does not stop the rest', async () => {
    stubFetch(() => ({ body: { message: 'No suitable edges near location' }, status: 400 }));
    await expect(createGeoapifyProvider(KEY).measureRoute({
      destination: { lat: 38.9098, lng: 16.5877 },
      origin: { lat: 38.84, lng: 16.59 },
      via: { lat: 38.9, lng: 16.45 },
    })).rejects.toThrow(RouteNotAvailableError);
  });

  // A rejected credential or a rate limit is a real outage and must keep stopping the run.
  it('still calls a refused credential and a rate limit an outage', async () => {
    for (const status of [401, 403, 429, 500]) {
      stubFetch(() => ({ body: {}, status }));
      await expect(createGeoapifyProvider(KEY).measureRoute({
        destination: { lat: 38.9098, lng: 16.5877 },
        origin: { lat: 38.84, lng: 16.59 },
      })).rejects.toThrow(GeoProviderUnavailableError);
    }
  });
});

describe('key handling', () => {
  it('sends the key only as a request parameter and never in a thrown message', async () => {
    stubFetch(() => Promise.reject(new Error(`failed with ${KEY}`)));
    const error = await createGeoapifyProvider(KEY).searchPlaces('x').catch((caught) => caught);
    expect(String(error)).not.toContain(KEY);
    expect(error).toBeInstanceOf(GeoProviderUnavailableError);
  });
});
