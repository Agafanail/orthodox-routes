import type { PlaceInput, PublicArea, PublicPlace, SavedPlace, SelectedPlace } from './types';

const SOURCE_KINDS = ['user_pin', 'user_confirmed_geocode', 'place_selection'] as const;
const PROVIDER_PLACE_ID = /^[A-Za-z0-9_:.-]{1,255}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum && !CONTROL.test(trimmed) ? trimmed : null;
}

function coordinate(value: unknown, limit: number) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** `undefined` when absent, the trimmed value when valid, and `null` when present but invalid. */
function optional(value: unknown, maximum: number) {
  if (value === undefined) return undefined;
  return text(value, maximum);
}

/**
 * Parses one confirmed place from untrusted client input. The caller never supplies a public
 * area: the database derives it, so no field for it exists here.
 */
export function parseSelectedPlace(value: unknown): SelectedPlace | null {
  const item = record(value);
  if (!item) return null;
  const lat = coordinate(item.lat, 85);
  const lng = coordinate(item.lng, 180);
  const address = text(item.address, 300);
  const sourceKind = SOURCE_KINDS.find((kind) => kind === item.sourceKind);
  if (lat === null || lng === null || !address || !sourceKind) return null;

  // An optional field that is present but malformed is rejected rather than silently dropped:
  // quietly discarding bad input would hide a client defect and weaken the stored record.
  const locality = optional(item.locality, 120);
  const countryCode = optional(item.countryCode, 2);
  const providerPlaceId = optional(item.providerPlaceId, 255);
  const label = optional(item.label, 60);
  if (locality === null || countryCode === null || providerPlaceId === null || label === null) return null;
  if (countryCode !== undefined && !COUNTRY_CODE.test(countryCode)) return null;
  if (providerPlaceId !== undefined && !PROVIDER_PLACE_ID.test(providerPlaceId)) return null;

  const save = item.save === true;
  if (label !== undefined && !save) return null;

  return {
    address,
    lat,
    lng,
    sourceKind,
    ...(locality === undefined ? {} : { locality }),
    ...(countryCode === undefined ? {} : { countryCode }),
    ...(providerPlaceId === undefined ? {} : { providerPlaceId }),
    ...(save ? { save } : {}),
    ...(label === undefined ? {} : { label }),
  };
}

/** Parses either a reference to an already saved place or a newly confirmed place. */
export function parsePlaceInput(value: unknown): PlaceInput | null {
  const item = record(value);
  if (!item) return null;
  if (typeof item.savedPlaceId === 'string') {
    return UUID.test(item.savedPlaceId) ? { savedPlaceId: item.savedPlaceId } : null;
  }
  return parseSelectedPlace(item);
}

/** Parses the JSON a place field carries through a form submission. */
export function parsePlaceInputList(value: unknown, maximum: number): PlaceInput[] | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > maximum) return null;
  const places = parsed.map(parsePlaceInput);
  return places.every((place): place is PlaceInput => place !== null) ? places : null;
}

/** Converts a validated place into the snake_case shape the database RPCs expect. */
export function placeToRpcInput(place: PlaceInput): Record<string, unknown> {
  if ('savedPlaceId' in place) return { saved_place_id: place.savedPlaceId };
  return {
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    source_kind: place.sourceKind,
    ...(place.locality === undefined ? {} : { locality: place.locality }),
    ...(place.countryCode === undefined ? {} : { country_code: place.countryCode }),
    ...(place.providerPlaceId === undefined ? {} : { provider_place_id: place.providerPlaceId }),
    ...(place.save ? { save: true } : {}),
    ...(place.label === undefined ? {} : { label: place.label }),
  };
}

export function parsePublicArea(value: unknown): PublicArea | undefined {
  const item = record(value);
  const lat = coordinate(item?.lat, 90);
  const lng = coordinate(item?.lng, 180);
  const radiusM = typeof item?.radius_m === 'number' ? item.radius_m : null;
  return lat === null || lng === null || radiusM === null ? undefined : { lat, lng, radiusM };
}

export function parsePublicPlace(value: unknown): PublicPlace | null {
  const item = record(value);
  const placeId = text(item?.place_id, 64);
  const publicAreaLabel = text(item?.public_area_label, 120);
  if (!placeId || !publicAreaLabel) return null;
  const publicArea = parsePublicArea(item?.public_area);
  return { placeId, publicAreaLabel, ...(publicArea ? { publicArea } : {}) };
}

export function parseSavedPlaces(value: unknown): SavedPlace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const placeId = text(item?.place_id, 64);
    const exactAddress = text(item?.exact_address, 300);
    const lat = coordinate(item?.lat, 90);
    const lng = coordinate(item?.lng, 180);
    if (!placeId || !exactAddress || lat === null || lng === null) return [];
    const label = text(item?.label, 60);
    const locality = text(item?.locality, 120);
    const countryCode = text(item?.country_code, 2);
    return [{
      exactAddress,
      lat,
      lng,
      placeId,
      ...(label ? { label } : {}),
      ...(locality ? { locality } : {}),
      ...(countryCode ? { countryCode } : {}),
    }];
  });
}

/** The short human name a saved place shows in a list. */
export function savedPlaceName(place: SavedPlace) {
  return place.label ?? place.exactAddress;
}
