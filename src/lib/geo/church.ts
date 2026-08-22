import type { Coordinate } from './types';

/** A published church as the public catalog and its map show it. */
export type CatalogChurch = Coordinate & {
  churchId: string;
  slug: string;
  officialName: string;
  address: string;
  locality: string;
  countryCode: string;
  timezone: string;
  /** Present only when the caller supplied a location after an explicit user action. */
  distanceM?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseCatalogChurches(value: unknown): CatalogChurch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const churchId = text(item?.church_id);
    const slug = text(item?.slug);
    const officialName = text(item?.official_name);
    const address = text(item?.address);
    const locality = text(item?.locality);
    const countryCode = text(item?.country_code);
    const timezone = text(item?.timezone);
    const lat = typeof item?.lat === 'number' ? item.lat : null;
    const lng = typeof item?.lng === 'number' ? item.lng : null;
    if (!churchId || !slug || !officialName || !address || !locality || !countryCode
      || !timezone || lat === null || lng === null) return [];
    const distanceM = typeof item?.distance_m === 'number' ? item.distance_m : undefined;
    return [{
      address,
      churchId,
      countryCode,
      lat,
      lng,
      locality,
      officialName,
      slug,
      timezone,
      ...(distanceM === undefined ? {} : { distanceM }),
    }];
  });
}

/**
 * The device location is rounded to roughly a kilometre before it is used in a request.
 *
 * Ordering a catalog by distance needs no more precision than that, and a coarse value keeps a
 * person's own exact position out of request URLs and ordinary server logs.
 */
export function coarseLocation(lat: number, lng: number): Coordinate | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return {
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
  };
}

/** Parses a coarse location that arrived as request parameters. */
export function parseCoarseLocation(lat: unknown, lng: unknown): Coordinate | null {
  const latitude = typeof lat === 'string' ? Number(lat) : Number.NaN;
  const longitude = typeof lng === 'string' ? Number(lng) : Number.NaN;
  return coarseLocation(latitude, longitude);
}

/** A short rounded distance, shown only when a location is available. */
export function approximateDistance(distanceM: number | undefined) {
  if (distanceM === undefined || !Number.isFinite(distanceM)) return null;
  const kilometres = distanceM / 1000;
  if (kilometres < 1) return '≈1 км от вас';
  return `≈${Math.round(kilometres)} км от вас`;
}
