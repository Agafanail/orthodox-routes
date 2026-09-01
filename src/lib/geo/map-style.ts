import type { Coordinate } from './types';

/**
 * Geoapify map styling and the geometry the interactive map draws.
 *
 * Geoapify serves OpenMapTiles vector styles, so the map is rendered by MapLibre GL rather than
 * by a vendor SDK. Attribution for OpenStreetMap, OpenMapTiles, and Geoapify travels inside the
 * style document and is displayed by the map itself; the surfaces additionally render a plain
 * text credit so it survives even if a style ever omits it.
 */

const STYLE_BASE = 'https://maps.geoapify.com/v1/styles';
const DEFAULT_STYLE = 'osm-bright-smooth';

export const GEOAPIFY_MAP_ATTRIBUTION = 'Данные: © OpenStreetMap · © OpenMapTiles · Powered by Geoapify';

export function geoapifyStyleUrl(browserKey: string, style: string = DEFAULT_STYLE) {
  return `${STYLE_BASE}/${style}/style.json?apiKey=${encodeURIComponent(browserKey)}`;
}

/** How a marker reads on the map. Type is carried by shape and label, never by colour alone. */
export type MapMarkerKind = 'church' | 'place' | 'user';

export type MapMarker = Coordinate & {
  id: string;
  kind: MapMarkerKind;
  label: string;
};

/**
 * A public approximate area. It is drawn as a circle with no centre mark, because a centre mark
 * would read as the exact place the circle exists to hide.
 */
export type MapArea = Coordinate & {
  id: string;
  radiusM: number;
  label: string;
  /**
   * A passenger meeting area and a driver departure area differ by colour *and* by outline.
   * Colour is what makes the difference legible at a glance; the dashed and solid outlines keep
   * it legible for anyone who does not distinguish these two hues.
   */
  kind: 'meeting' | 'departure';
};

/**
 * One source of truth for the two area colours, shared by the map layers and the legend beside
 * them. Blue and amber are chosen because they stay distinguishable under the common forms of
 * colour blindness, where a red and green pair would not.
 */
export const AREA_COLOURS: Record<MapArea['kind'], string> = {
  departure: '#b45309',
  meeting: '#1d4ed8',
};

/** What each kind of area is, in the words used on the board itself. */
export const AREA_TITLES: Record<MapArea['kind'], string> = {
  departure: 'Поездка водителя',
  meeting: 'Запрос пассажира',
};

const EARTH_RADIUS_M = 6371008.8;

/**
 * Approximates a geodesic circle as a polygon. Sixty-four points is smooth at every zoom the
 * application uses and keeps the payload small.
 */
export function circlePolygon(center: Coordinate, radiusM: number, steps = 64): number[][] {
  const points: number[][] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const angular = radiusM / EARTH_RADIUS_M;

  for (let index = 0; index <= steps; index += 1) {
    const bearing = (index / steps) * 2 * Math.PI;
    const lat = Math.asin(
      Math.sin(latRad) * Math.cos(angular)
      + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng = (center.lng * Math.PI) / 180 + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
      Math.cos(angular) - Math.sin(latRad) * Math.sin(lat),
    );
    points.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
  }
  return points;
}

export function areasToGeoJson(areas: MapArea[]) {
  return {
    features: areas.map((area) => ({
      geometry: { coordinates: [circlePolygon(area, area.radiusM)], type: 'Polygon' as const },
      properties: { id: area.id, kind: area.kind, label: area.label },
      type: 'Feature' as const,
    })),
    type: 'FeatureCollection' as const,
  };
}

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** The bounding box that contains every supplied point, or null when there is nothing to fit. */
export function boundsOf(points: Coordinate[]): MapBounds | null {
  if (points.length === 0) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    east: Math.max(...lngs),
    north: Math.max(...lats),
    south: Math.min(...lats),
    west: Math.min(...lngs),
  };
}

/** True when a bounding box is a single point, which must be centred rather than fitted. */
export function isPointBounds(bounds: MapBounds) {
  return Math.abs(bounds.east - bounds.west) < 1e-9 && Math.abs(bounds.north - bounds.south) < 1e-9;
}

/**
 * The four extremes of a circle, so fitting the view includes the whole approximate area rather
 * than just its centre. Without this a one-kilometre circle would be clipped at the edges.
 */
export function areaExtremes(area: MapArea): Coordinate[] {
  const latDelta = (area.radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lngDelta = latDelta / Math.max(Math.cos((area.lat * Math.PI) / 180), 1e-6);
  return [
    { lat: area.lat + latDelta, lng: area.lng },
    { lat: area.lat - latDelta, lng: area.lng },
    { lat: area.lat, lng: area.lng + lngDelta },
    { lat: area.lat, lng: area.lng - lngDelta },
  ];
}
