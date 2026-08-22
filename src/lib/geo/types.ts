/** A coordinate the application owns after the user confirmed it. */
export type Coordinate = {
  lat: number;
  lng: number;
};

/**
 * How the coordinate was obtained. It is recorded because the storage rights of a provider
 * result and of a marker the person placed themselves are not the same question.
 */
export type PlaceSourceKind = 'user_pin' | 'user_confirmed_geocode' | 'place_selection';

/** One place the user confirmed, in the shape the protected publication RPCs accept. */
export type SelectedPlace = Coordinate & {
  address: string;
  locality?: string;
  countryCode?: string;
  sourceKind: PlaceSourceKind;
  providerPlaceId?: string;
  /** Keep this place for reuse. A saved place lives until its owner deletes it. */
  save?: boolean;
  label?: string;
};

/** A reference to a place the user already saved, used instead of selecting a new one. */
export type SavedPlaceReference = {
  savedPlaceId: string;
};

export type PlaceInput = SelectedPlace | SavedPlaceReference;

export type SavedPlace = Coordinate & {
  placeId: string;
  label?: string;
  exactAddress: string;
  locality?: string;
  countryCode?: string;
};

/**
 * The privacy-safe public representation of a place. The centre is deliberately not the exact
 * point: it is offset by the database so the exact location cannot be read off the circle.
 */
export type PublicArea = Coordinate & {
  radiusM: number;
};

export type PublicPlace = {
  placeId: string;
  publicAreaLabel: string;
  publicArea?: PublicArea;
};

/** One address/place candidate returned by the place-search adapter. */
export type PlaceCandidate = Coordinate & {
  id: string;
  address: string;
  locality?: string;
  countryCode?: string;
  providerPlaceId?: string;
};

/**
 * A route measurement. Only the two numbers are used: no geometry is returned to the domain and
 * none is stored, because the driver never promised to follow a provider-computed road.
 */
export type RouteMeasurement = {
  distanceM: number;
  durationS: number;
};
