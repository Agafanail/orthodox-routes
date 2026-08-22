import { parsePublicPlace } from '@/lib/geo/place';
import type {
  CoreAgreement,
  CoreChurch,
  CoreDriverOccurrence,
  CoreDisclosure,
  CoreEligibility,
  CoreExactPlace,
  CoreOwnedOccurrence,
  CoreOwnedRequest,
  CoreOwnedSeries,
  CorePassengerRequest,
  CorePlaceOption,
  CoreResponse,
} from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown) { return typeof value === 'string' && value.length > 0 ? value : null; }
function number(value: unknown) { return typeof value === 'number' && Number.isInteger(value) ? value : null; }
function boolean(value: unknown) { return typeof value === 'boolean' ? value : null; }

function place(value: unknown): CorePlaceOption | null {
  return parsePublicPlace(value);
}

/** An exact place is present only inside a participant-authorized disclosure response. */
function exactPlace(value: unknown): CoreExactPlace | undefined {
  const item = record(value);
  const placeId = string(item?.place_id);
  const exactAddress = string(item?.exact_address);
  if (!placeId || !exactAddress) return undefined;
  const point = record(item?.exact_point);
  const lat = typeof point?.lat === 'number' ? point.lat : undefined;
  const lng = typeof point?.lng === 'number' ? point.lng : undefined;
  return {
    exactAddress,
    placeId,
    ...(string(item?.locality) ? { locality: string(item?.locality) as string } : {}),
    ...(string(item?.country_code) ? { countryCode: string(item?.country_code) as string } : {}),
    ...(lat === undefined ? {} : { lat }),
    ...(lng === undefined ? {} : { lng }),
  };
}

export function parseCoreChurch(value: unknown): CoreChurch | null {
  const item = record(value);
  const churchId = string(item?.church_id);
  const slug = string(item?.slug);
  const officialName = string(item?.official_name);
  const address = string(item?.address);
  const locality = string(item?.locality);
  const countryCode = string(item?.country_code);
  const timezone = string(item?.timezone);
  const lat = typeof item?.lat === 'number' ? item.lat : undefined;
  const lng = typeof item?.lng === 'number' ? item.lng : undefined;
  return churchId && slug && officialName && address && locality && countryCode && timezone
    ? {
      address,
      churchId,
      countryCode,
      locality,
      officialName,
      slug,
      timezone,
      ...(lat === undefined ? {} : { lat }),
      ...(lng === undefined ? {} : { lng }),
    }
    : null;
}

export function parseCorePassengerRequests(value: unknown): CorePassengerRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const requestId = string(item?.request_id);
    const churchId = string(item?.church_id);
    const authorName = string(item?.author_name);
    const desiredArrivalAt = string(item?.desired_arrival_at);
    const timezone = string(item?.timezone);
    const passengerCount = number(item?.passenger_count);
    const childrenCount = number(item?.children_count);
    const childSeatRequired = boolean(item?.child_seat_required);
    const returnRequired = boolean(item?.return_required);
    const placeOptions = Array.isArray(item?.place_options)
      ? item.place_options.map(place).filter((entry): entry is CorePlaceOption => entry !== null)
      : [];
    if (!requestId || !churchId || !authorName || !desiredArrivalAt || !timezone
      || passengerCount === null || childrenCount === null || childSeatRequired === null
      || returnRequired === null || placeOptions.length === 0) return [];
    return [{
      requestId, churchId, authorName, desiredArrivalAt, timezone, passengerCount,
      childrenCount, childSeatRequired, returnRequired, placeOptions,
      publicNote: string(item?.public_note) ?? undefined,
    }];
  });
}

export function parseCoreDriverOccurrences(value: unknown): CoreDriverOccurrence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const occurrenceId = string(item?.occurrence_id);
    const churchId = string(item?.church_id);
    const authorName = string(item?.author_name);
    const departureAt = string(item?.departure_at);
    const arrivalAt = string(item?.arrival_at);
    const timezone = string(item?.timezone);
    const availableSeats = number(item?.available_seats);
    const maxDetourKm = number(item?.max_detour_km);
    const childrenAllowed = boolean(item?.children_allowed);
    const driverChildSeatAvailable = boolean(item?.driver_child_seat_available);
    const returnAvailable = boolean(item?.return_available);
    const publicOriginArea = string(item?.public_origin_area);
    if (!occurrenceId || !churchId || !authorName || !departureAt || !arrivalAt || !timezone
      || availableSeats === null || maxDetourKm === null || childrenAllowed === null
      || driverChildSeatAvailable === null || returnAvailable === null || !publicOriginArea) return [];
    return [{
      occurrenceId, seriesId: string(item?.series_id) ?? undefined, churchId, authorName,
      departureAt, arrivalAt, timezone, availableSeats, maxDetourKm, childrenAllowed,
      driverChildSeatAvailable, returnAvailable, publicOriginArea,
      originArea: place(item?.origin_area) ?? undefined,
      publicNote: string(item?.public_note) ?? undefined,
    }];
  });
}

export function parseCoreOwnedItems(value: unknown) {
  const root = record(value);
  const ownedRequests: CoreOwnedRequest[] = Array.isArray(root?.passenger_requests)
    ? root.passenger_requests.flatMap((raw) => {
      const item = record(raw);
      const requestId = string(item?.request_id);
      const status = string(item?.status);
      const totalPassengers = number(item?.total_passengers);
      const remainingPassengers = number(item?.remaining_passengers);
      return requestId && status && totalPassengers !== null && remainingPassengers !== null
        ? [{ requestId, status, totalPassengers, remainingPassengers }]
        : [];
    }) : [];
  const ownedOccurrences: CoreOwnedOccurrence[] = Array.isArray(root?.driver_occurrences)
    ? root.driver_occurrences.flatMap((raw) => {
      const item = record(raw);
      const occurrenceId = string(item?.occurrence_id);
      const status = string(item?.status);
      const totalSeats = number(item?.total_seats);
      const confirmedSeats = number(item?.confirmed_seats);
      const availableSeats = number(item?.available_seats);
      return occurrenceId && status && totalSeats !== null && confirmedSeats !== null && availableSeats !== null
        ? [{ occurrenceId, seriesId: string(item?.series_id) ?? undefined, status, totalSeats, confirmedSeats, availableSeats }]
        : [];
    }) : [];
  const ownedSeries: CoreOwnedSeries[] = Array.isArray(root?.driver_series)
    ? root.driver_series.flatMap((raw) => {
      const item = record(raw);
      const seriesId = string(item?.series_id);
      const status = string(item?.status);
      return seriesId && status ? [{ seriesId, status }] : [];
    }) : [];
  return { ownedRequests, ownedOccurrences, ownedSeries };
}

export function parseCoreResponses(value: unknown): CoreResponse[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const responseId = string(item?.response_id);
    const direction = item?.direction;
    const status = string(item?.status);
    const currentRole = item?.current_role;
    const requestId = string(item?.request_id);
    const occurrenceId = string(item?.occurrence_id);
    const passengerName = string(item?.passenger_name);
    const driverName = string(item?.driver_name);
    const offeredPassengerCount = number(item?.offered_passenger_count);
    const expiresAt = string(item?.expires_at);
    if (!responseId || !status || !requestId || !occurrenceId || !passengerName || !driverName
      || offeredPassengerCount === null || !expiresAt
      || (direction !== 'passenger_to_driver' && direction !== 'driver_to_passenger')
      || (currentRole !== 'passenger' && currentRole !== 'driver')) return [];
    return [{
      responseId, direction, status, currentRole, requestId, occurrenceId,
      passengerName, driverName, offeredPassengerCount, expiresAt,
      selectedPlace: place(item?.selected_place) ?? undefined,
    }];
  });
}

export function parseCoreAgreements(value: unknown): CoreAgreement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const item = record(raw);
    const agreementId = string(item?.agreement_id);
    const status = string(item?.status);
    const currentRole = item?.current_role;
    const requestId = string(item?.request_id);
    const occurrenceId = string(item?.occurrence_id);
    const passengerName = string(item?.passenger_name);
    const driverName = string(item?.driver_name);
    const confirmedPassengerCount = number(item?.confirmed_passenger_count);
    const scheduledArrivalAt = string(item?.scheduled_arrival_at);
    const timezone = string(item?.timezone);
    const contactAvailable = boolean(item?.contact_available);
    if (!agreementId || !status || !requestId || !occurrenceId || !passengerName || !driverName
      || confirmedPassengerCount === null || !scheduledArrivalAt || !timezone || contactAvailable === null
      || (currentRole !== 'passenger' && currentRole !== 'driver')) return [];
    return [{
      agreementId, status, currentRole, requestId, occurrenceId, passengerName,
      driverName, confirmedPassengerCount, scheduledArrivalAt, timezone, contactAvailable,
    }];
  });
}

export function parseCoreEligibility(value: unknown): CoreEligibility | undefined {
  const item = record(value);
  const eligible = boolean(item?.eligible);
  const accepted = boolean(item?.current_terms_accepted);
  const reasons = Array.isArray(item?.reasons)
    ? item.reasons.filter((entry): entry is string => typeof entry === 'string')
    : null;
  if (eligible === null || accepted === null || reasons === null) return undefined;
  return {
    eligible,
    reasons,
    currentTermsAccepted: accepted,
    currentTermsVersion: string(item?.current_terms_version) ?? undefined,
  };
}

export function parseCoreDisclosure(
  agreementId: string,
  contactsValue: unknown,
  placeValue: unknown,
): CoreDisclosure | undefined {
  const contacts = record(contactsValue);
  const placeValueRecord = record(placeValue);
  const contactAgreementId = string(contacts?.agreement_id);
  const placeAgreementId = string(placeValueRecord?.agreement_id);
  const counterpartyName = string(contacts?.counterparty_name);
  const email = string(contacts?.email);
  const phone = string(contacts?.phone);
  const exactMeetingLabel = string(placeValueRecord?.exact_meeting_label);
  const visibleUntil = string(contacts?.visible_until);
  return contactAgreementId === agreementId && placeAgreementId === agreementId
    && counterpartyName && email && phone && exactMeetingLabel && visibleUntil
    ? {
      agreementId,
      counterpartyName,
      email,
      exactMeetingLabel,
      phone,
      visibleUntil,
      ...(exactPlace(placeValueRecord?.meeting_place)
        ? { meetingPlace: exactPlace(placeValueRecord?.meeting_place) }
        : {}),
      ...(exactPlace(placeValueRecord?.departure_place)
        ? { departurePlace: exactPlace(placeValueRecord?.departure_place) }
        : {}),
    }
    : undefined;
}

export function asRecord(value: unknown) { return record(value); }
