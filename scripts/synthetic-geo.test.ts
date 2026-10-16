import { describe, expect, it } from 'vitest';
import { containsExactCoordinate, haversineMetres } from './synthetic-geo.mjs';

describe('synthetic public-coordinate leak guard', () => {
  it('does not mistake one shared axis for a leaked point', () => {
    const exact = { lat: 45.0611, lng: 7.6721 };
    const east = { lat: exact.lat, lng: exact.lng + 0.006 };
    const north = { lat: exact.lat + 0.004, lng: exact.lng };
    expect(haversineMetres(exact.lat, exact.lng, east.lat, east.lng)).toBeGreaterThan(100);
    expect(containsExactCoordinate([east, north, exact.lat, exact.lng], exact.lat, exact.lng)).toBe(false);
  });

  it('detects complete points through nested objects and GeoJSON coordinate arrays', () => {
    expect(containsExactCoordinate({ nested: [{ lat: 45.0611, lng: 7.6721 }] }, 45.0611, 7.6721)).toBe(true);
    expect(containsExactCoordinate({ coordinates: [7.6721, 45.0611] }, 45.0611, 7.6721)).toBe(true);
    expect(containsExactCoordinate({ lat: 45.0611 + 1e-10, lng: 7.6721 }, 45.0611, 7.6721)).toBe(true);
  });

  it('ignores absent or nonnumeric values without substring matching', () => {
    expect(containsExactCoordinate({ lat: '45.0611', lng: '7.6721', other: null }, 45.0611, 7.6721)).toBe(false);
    expect(containsExactCoordinate({ lat: 45.06112, lng: 7.67212 }, 45.0611, 7.6721)).toBe(false);
  });
});
