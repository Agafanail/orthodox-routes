import type { Coordinate } from './types';

/**
 * Static map imagery and the pixel arithmetic that turns a tap into a coordinate.
 *
 * The application draws real map imagery without adding a client-side mapping library. A person
 * searches for an address, sees the place on the map, and can tap to correct the marker or place
 * it by hand where address data is poor. That is exactly the approved flow; a fully interactive
 * vector map can later replace the image inside the same component without touching the domain,
 * because everything below is plain geometry.
 */

export type StaticMapView = {
  center: Coordinate;
  zoom: number;
  width: number;
  height: number;
};

export type StaticMapMarker = Coordinate & {
  /** A church pin and a chosen place read differently, as the design system requires. */
  kind: 'church' | 'place' | 'user';
};

export type StaticMapArea = Coordinate & {
  radiusM: number;
};

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const MAX_LATITUDE = 85.05112878;

const MARKER_COLOURS: Record<StaticMapMarker['kind'], string> = {
  church: '#92400e',
  place: '#b45309',
  user: '#1d4ed8',
};

export function clampZoom(zoom: number) {
  return Math.min(Math.max(Math.round(zoom), MIN_ZOOM), MAX_ZOOM);
}

function clampLatitude(lat: number) {
  return Math.min(Math.max(lat, -MAX_LATITUDE), MAX_LATITUDE);
}

/** Web Mercator projection into absolute pixels at the given zoom. */
export function project({ lat, lng }: Coordinate, zoom: number) {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const latitude = clampLatitude(lat) * (Math.PI / 180);
  return {
    x: ((lng + 180) / 360) * worldSize,
    y: ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * worldSize,
  };
}

/** The inverse projection, used to read the coordinate a person tapped. */
export function unproject({ x, y }: { x: number; y: number }, zoom: number): Coordinate {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const normalizedY = 1 - (2 * y) / worldSize;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * normalizedY)) * 180) / Math.PI,
    lng: (x / worldSize) * 360 - 180,
  };
}

/**
 * Turns a tap at image pixel `(x, y)` into a coordinate, given the view the image was rendered
 * with. Taps outside the image are refused rather than silently clamped to an edge.
 */
export function pixelToCoordinate(view: StaticMapView, x: number, y: number): Coordinate | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > view.width || y > view.height) return null;
  const centerPixel = project(view.center, view.zoom);
  return unproject({
    x: centerPixel.x - view.width / 2 + x,
    y: centerPixel.y - view.height / 2 + y,
  }, view.zoom);
}

/** Where a coordinate falls inside the image, or null when it is outside the visible area. */
export function coordinateToPixel(view: StaticMapView, point: Coordinate) {
  const centerPixel = project(view.center, view.zoom);
  const pointPixel = project(point, view.zoom);
  const x = pointPixel.x - centerPixel.x + view.width / 2;
  const y = pointPixel.y - centerPixel.y + view.height / 2;
  return x < 0 || y < 0 || x > view.width || y > view.height ? null : { x, y };
}

/**
 * A zoom at which a circle of the given radius is comfortably visible, so an approximate area is
 * never shown at a scale that implies more precision than it has.
 */
export function zoomForRadius(radiusM: number, widthPx: number) {
  const metresPerPixelAtEquator = 156543.03392;
  const desiredMetresPerPixel = (radiusM * 3) / widthPx;
  return clampZoom(Math.log2(metresPerPixelAtEquator / desiredMetresPerPixel));
}

export type StaticMapRequest = StaticMapView & {
  apiKey: string;
  markers?: StaticMapMarker[];
  areas?: StaticMapArea[];
  style?: string;
};

/**
 * Builds a Geoapify static map URL.
 *
 * Only the browser key reaches this URL, and it carries no personal data beyond the coordinates
 * the person is already looking at on their own screen.
 */
export function staticMapUrl(request: StaticMapRequest): string {
  const url = new URL('https://maps.geoapify.com/v1/staticmap');
  url.searchParams.set('style', request.style ?? 'osm-bright-smooth');
  url.searchParams.set('width', String(Math.round(request.width)));
  url.searchParams.set('height', String(Math.round(request.height)));
  url.searchParams.set('center', `lonlat:${request.center.lng},${request.center.lat}`);
  url.searchParams.set('zoom', String(clampZoom(request.zoom)));

  for (const marker of request.markers ?? []) {
    url.searchParams.append(
      'marker',
      `lonlat:${marker.lng},${marker.lat};type:material;color:${MARKER_COLOURS[marker.kind]};size:medium`,
    );
  }
  // An approximate area is drawn as a circle with no centre mark, so the public centre is never
  // read as the exact place.
  for (const area of request.areas ?? []) {
    url.searchParams.append(
      'circle',
      `lonlat:${area.lng},${area.lat};radiusmeters:${Math.round(area.radiusM)};linecolor:%23b45309;linewidth:2;fillcolor:%23b45309;fillopacity:0.15`,
    );
  }

  url.searchParams.set('apiKey', request.apiKey);
  return url.toString();
}
