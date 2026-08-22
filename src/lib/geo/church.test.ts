import { describe, expect, it } from 'vitest';
import { approximateDistance, coarseLocation, parseCatalogChurches, parseCoarseLocation } from './church';

const raw = {
  address: 'Via Roma 1',
  church_id: '00000000-0000-4000-8000-000000000001',
  country_code: 'IT',
  lat: 45.0703,
  lng: 7.6869,
  locality: 'Torino',
  official_name: 'Test Church',
  slug: 'test-church',
  timezone: 'Europe/Rome',
};

describe('parseCatalogChurches', () => {
  it('reads a published church with its public exact location', () => {
    const [church] = parseCatalogChurches([raw]);
    expect(church.slug).toBe('test-church');
    expect(church.lat).toBe(45.0703);
    expect(church.distanceM).toBeUndefined();
  });

  it('reads the distance only when the caller supplied a location', () => {
    const [church] = parseCatalogChurches([{ ...raw, distance_m: 4200 }]);
    expect(church.distanceM).toBe(4200);
  });

  it('drops a church that cannot be plotted', () => {
    expect(parseCatalogChurches([{ ...raw, lat: null }])).toEqual([]);
    expect(parseCatalogChurches([{ ...raw, slug: '' }])).toEqual([]);
    expect(parseCatalogChurches(null)).toEqual([]);
  });
});

describe('coarseLocation', () => {
  // Sorting a catalog needs no more precision than about a kilometre, and a coarse value keeps
  // a person's exact position out of request URLs and ordinary server logs.
  it('rounds a device position to roughly a kilometre', () => {
    expect(coarseLocation(45.070312, 7.686945)).toEqual({ lat: 45.07, lng: 7.69 });
  });

  it('refuses an impossible position', () => {
    expect(coarseLocation(95, 7)).toBeNull();
    expect(coarseLocation(45, 200)).toBeNull();
    expect(coarseLocation(Number.NaN, 7)).toBeNull();
  });

  it('parses a coarse position from request parameters', () => {
    expect(parseCoarseLocation('45.07', '7.69')).toEqual({ lat: 45.07, lng: 7.69 });
    expect(parseCoarseLocation('near', '7.69')).toBeNull();
    expect(parseCoarseLocation(undefined, undefined)).toBeNull();
  });
});

describe('approximateDistance', () => {
  it('shows a short rounded value and never a precise one', () => {
    expect(approximateDistance(23400)).toBe('≈23 км от вас');
    expect(approximateDistance(400)).toBe('≈1 км от вас');
  });

  it('shows nothing when no location is available', () => {
    expect(approximateDistance(undefined)).toBeNull();
  });
});
