import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  coordinateToPixel,
  pixelToCoordinate,
  project,
  staticMapUrl,
  unproject,
  zoomForRadius,
} from './static-map';

const view = {
  center: { lat: 45.0703, lng: 7.6869 },
  height: 320,
  width: 600,
  zoom: 14,
};

describe('projection', () => {
  it('round-trips a coordinate through the projection', () => {
    const point = { lat: 45.0703, lng: 7.6869 };
    const back = unproject(project(point, 14), 14);
    expect(back.lat).toBeCloseTo(point.lat, 9);
    expect(back.lng).toBeCloseTo(point.lng, 9);
  });

  it('keeps a pole inside the projectable range', () => {
    expect(Number.isFinite(project({ lat: 90, lng: 0 }, 10).y)).toBe(true);
    expect(Number.isFinite(project({ lat: -90, lng: 0 }, 10).y)).toBe(true);
  });

  it('clamps zoom into the usable range', () => {
    expect(clampZoom(0)).toBe(3);
    expect(clampZoom(99)).toBe(18);
    expect(clampZoom(13.4)).toBe(13);
  });
});

describe('pixelToCoordinate', () => {
  it('reads the centre of the image as the view centre', () => {
    const point = pixelToCoordinate(view, view.width / 2, view.height / 2);
    expect(point?.lat).toBeCloseTo(view.center.lat, 9);
    expect(point?.lng).toBeCloseTo(view.center.lng, 9);
  });

  it('moves east and north as expected', () => {
    const east = pixelToCoordinate(view, view.width / 2 + 100, view.height / 2)!;
    const north = pixelToCoordinate(view, view.width / 2, view.height / 2 - 100)!;
    expect(east.lng).toBeGreaterThan(view.center.lng);
    expect(east.lat).toBeCloseTo(view.center.lat, 9);
    expect(north.lat).toBeGreaterThan(view.center.lat);
  });

  it('refuses a tap outside the image rather than clamping it to an edge', () => {
    expect(pixelToCoordinate(view, -1, 10)).toBeNull();
    expect(pixelToCoordinate(view, 10, view.height + 1)).toBeNull();
    expect(pixelToCoordinate(view, Number.NaN, 10)).toBeNull();
  });

  it('round-trips against the forward pixel mapping', () => {
    const point = pixelToCoordinate(view, 123, 200)!;
    const pixel = coordinateToPixel(view, point)!;
    expect(pixel.x).toBeCloseTo(123, 6);
    expect(pixel.y).toBeCloseTo(200, 6);
  });

  it('reports a coordinate outside the visible area', () => {
    expect(coordinateToPixel(view, { lat: 38.11, lng: 13.36 })).toBeNull();
  });
});

describe('zoomForRadius', () => {
  it('chooses a zoom where a one-kilometre area fits comfortably', () => {
    const zoom = zoomForRadius(1000, 600);
    expect(zoom).toBeGreaterThanOrEqual(12);
    expect(zoom).toBeLessThanOrEqual(15);
  });
});

describe('staticMapUrl', () => {
  it('builds a request with the marker and the area but no centre mark on the area', () => {
    const url = new URL(staticMapUrl({
      ...view,
      apiKey: 'test-key',
      areas: [{ lat: 45.065, lng: 7.68, radiusM: 1000 }],
      markers: [{ kind: 'church', lat: 45.0703, lng: 7.6869 }],
    }));

    expect(url.origin + url.pathname).toBe('https://maps.geoapify.com/v1/staticmap');
    expect(url.searchParams.get('center')).toBe('lonlat:7.6869,45.0703');
    expect(url.searchParams.get('zoom')).toBe('14');
    expect(url.searchParams.get('marker')).toContain('lonlat:7.6869,45.0703');
    expect(url.searchParams.get('circle')).toContain('radiusmeters:1000');
    // The circle carries no marker of its own, so a public centre is never drawn as a point.
    expect(url.searchParams.getAll('marker')).toHaveLength(1);
  });

  it('renders several areas for one request with several meeting places', () => {
    const url = new URL(staticMapUrl({
      ...view,
      apiKey: 'test-key',
      areas: [
        { lat: 45.065, lng: 7.68, radiusM: 1000 },
        { lat: 45.041, lng: 7.66, radiusM: 1000 },
      ],
    }));
    expect(url.searchParams.getAll('circle')).toHaveLength(2);
  });
});
