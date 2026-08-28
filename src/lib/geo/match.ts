import type { PublicArea } from './types';

/**
 * A quality match as the current user sees it.
 *
 * There is no score. The explanation is made of facts a person can check: how many seats are
 * free, which of their meeting places works, and how much further the driver would travel.
 */

export type QualityMatchPlace = {
  placeId: string;
  publicAreaLabel: string;
  position: number;
  addedDistanceM: number;
  addedDurationS: number;
  /** The smallest added road distance; the others stay visible as valid alternatives. */
  best: boolean;
  publicArea?: PublicArea;
};

export type QualityMatch = {
  requestId: string;
  occurrenceId: string;
  currentRole: 'passenger' | 'driver';
  passengerCount: number;
  availableSeats: number;
  departureAt: string;
  arrivalAt: string;
  timezone: string;
  addedDistanceM: number;
  addedDurationS: number;
  places: QualityMatchPlace[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function text(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function matchPlace(value: unknown): QualityMatchPlace | null {
  const item = record(value);
  const placeId = text(item?.place_id);
  const publicAreaLabel = text(item?.public_area_label);
  const position = integer(item?.position);
  const addedDistanceM = integer(item?.added_distance_m);
  const addedDurationS = integer(item?.added_duration_s);
  if (!placeId || !publicAreaLabel || position === null
    || addedDistanceM === null || addedDurationS === null) return null;
  return {
    addedDistanceM,
    addedDurationS,
    best: item?.best === true,
    placeId,
    position,
    publicAreaLabel,
  };
}

export function parseQualityMatches(value: unknown): QualityMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const requestId = text(item?.request_id);
    const occurrenceId = text(item?.occurrence_id);
    const currentRole = item?.current_role;
    const passengerCount = integer(item?.passenger_count);
    const availableSeats = integer(item?.available_seats);
    const departureAt = text(item?.departure_at);
    const arrivalAt = text(item?.arrival_at);
    const timezone = text(item?.timezone);
    const addedDistanceM = integer(item?.added_distance_m);
    const addedDurationS = integer(item?.added_duration_s);
    const places = Array.isArray(item?.places)
      ? item.places.map(matchPlace).filter((place): place is QualityMatchPlace => place !== null)
      : [];
    if (!requestId || !occurrenceId || passengerCount === null || availableSeats === null
      || !departureAt || !arrivalAt || !timezone || addedDistanceM === null
      || addedDurationS === null || places.length === 0
      || (currentRole !== 'passenger' && currentRole !== 'driver')) return [];
    return [{
      addedDistanceM,
      addedDurationS,
      arrivalAt,
      availableSeats,
      currentRole,
      departureAt,
      occurrenceId,
      passengerCount,
      places,
      requestId,
      timezone,
    }];
  });
}

/** Rounds added kilometres the way the approved copy shows them. */
export function addedKilometres(addedDistanceM: number) {
  if (addedDistanceM <= 100) return 0;
  return addedDistanceM < 1000 ? Math.round((addedDistanceM / 1000) * 10) / 10 : Math.round(addedDistanceM / 1000);
}

/**
 * Rounds added minutes for display. The number shown is an estimate, which is why the wording
 * around it always says "примерно"; the exact value does take part in the decision, because it
 * moves the arrival the passenger would actually experience into or out of the approved window.
 * That comparison happens in SQL, never here.
 */
export function addedMinutes(addedDurationS: number) {
  return Math.max(0, Math.round(addedDurationS / 60));
}

/**
 * The approved explanation line. A detour that rounds away entirely reads as "on the way"
 * rather than as a misleading "+0 км".
 */
export function detourSummary(match: Pick<QualityMatch, 'addedDistanceM' | 'addedDurationS'>) {
  const kilometres = addedKilometres(match.addedDistanceM);
  if (kilometres === 0) return 'По пути · без заезда';
  return `+${String(kilometres).replace('.', ',')} км · примерно +${addedMinutes(match.addedDurationS)} мин`;
}

/** True when this driver occurrence is a suggestion for the current user. */
export function matchesOccurrence(matches: QualityMatch[], occurrenceId: string) {
  return matches.some((match) => match.occurrenceId === occurrenceId && match.currentRole === 'passenger');
}

/** True when this passenger request is a suggestion for the current user. */
export function matchesRequest(matches: QualityMatch[], requestId: string) {
  return matches.some((match) => match.requestId === requestId && match.currentRole === 'driver');
}
