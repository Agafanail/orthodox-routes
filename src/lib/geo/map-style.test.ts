import { describe, expect, it } from 'vitest';
import {
  areaExtremes,
  areasToGeoJson,
  boundsOf,
  circlePolygon,
  geoapifyStyleUrl,
  isPointBounds,
  type MapArea,
} from './map-style';

const meeting: MapArea = {
  id: 'a',
  kind: 'meeting',
  label: 'Torino',
  lat: 45.0703,
  lng: 7.6869,
  radiusM: 1000,
};

const EARTH_RADIUS_M = 6371008.8;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

describe('geoapifyStyleUrl', () => {
  it('builds a vector style URL carrying the render key', () => {
    const url = new URL(geoapifyStyleUrl('render-key'));
    expect(url.origin + url.pathname).toBe('https://maps.geoapify.com/v1/styles/osm-bright-smooth/style.json');
    expect(url.searchParams.get('apiKey')).toBe('render-key');
  });

  it('escapes a key rather than pasting it raw into the URL', () => {
    expect(geoapifyStyleUrl('a b&c')).toContain('apiKey=a%20b%26c');
  });
});

describe('circlePolygon', () => {
  it('closes the ring and keeps every vertex at the requested radius', () => {
    const ring = circlePolygon(meeting, 1000, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);

    for (const [lng, lat] of ring) {
      expect(metresBetween(meeting, { lat, lng })).toBeCloseTo(1000, -1);
    }
  });
});

describe('areasToGeoJson', () => {
  it('emits one polygon per area and carries its kind for styling', () => {
    const collection = areasToGeoJson([meeting, { ...meeting, id: 'b', kind: 'departure' }]);
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].properties.kind).toBe('meeting');
    expect(collection.features[1].properties.kind).toBe('departure');
    expect(collection.features[0].geometry.type).toBe('Polygon');
  });

  // The circle is the whole public representation; a centre point would defeat it.
  it('never emits a point for the centre of an area', () => {
    const serialized = JSON.stringify(areasToGeoJson([meeting]));
    expect(serialized).not.toContain('"Point"');
  });
});

describe('bounds', () => {
  it('contains every supplied point', () => {
    const box = boundsOf([{ lat: 45, lng: 7 }, { lat: 38, lng: 13 }])!;
    expect(box).toEqual({ east: 13, north: 45, south: 38, west: 7 });
  });

  it('reports a single point so it can be centred instead of fitted', () => {
    expect(isPointBounds(boundsOf([{ lat: 45, lng: 7 }])!)).toBe(true);
    expect(isPointBounds(boundsOf([{ lat: 45, lng: 7 }, { lat: 46, lng: 8 }])!)).toBe(false);
  });

  it('returns nothing when there is nothing to fit', () => {
    expect(boundsOf([])).toBeNull();
  });

  // Fitting to centres alone would clip a one-kilometre circle at the edge of the view.
  it('expands an area to its extremes so the whole circle fits', () => {
    const extremes = areaExtremes(meeting);
    expect(extremes).toHaveLength(4);
    for (const point of extremes) {
      expect(metresBetween(meeting, point)).toBeCloseTo(1000, -1);
    }

    const box = boundsOf(extremes)!;
    expect(box.north).toBeGreaterThan(meeting.lat);
    expect(box.south).toBeLessThan(meeting.lat);
    expect(box.east).toBeGreaterThan(meeting.lng);
    expect(box.west).toBeLessThan(meeting.lng);
  });
});
