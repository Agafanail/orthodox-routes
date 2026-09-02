'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { beginContextualRegistrationAction } from '@/app/contextual-registration/actions';
import { zonedLocalDateTimeToIso } from '@/lib/core-transport/time';
import { parsePlaceInputList, placeToRpcInput } from '@/lib/geo/place';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function field(form: FormData, name: string, max = 300) {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : null;
}

function optionalField(form: FormData, name: string, max = 300) {
  const value = form.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? '' : trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null;
}

function uuid(form: FormData, name: string) {
  const value = field(form, name, 36);
  return value && UUID.test(value) ? value : null;
}

function integer(form: FormData, name: string, minimum: number, maximum: number) {
  const value = field(form, name, 3);
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function checked(form: FormData, name: string) {
  return form.get(name) === 'yes';
}

function corePath(form: FormData) {
  const slug = field(form, 'church_slug', 100);
  return slug && SLUG.test(slug) ? `/churches/${slug}` : '/churches';
}

function finish(form: FormData, status: string): never {
  const path = corePath(form);
  revalidatePath(path);
  redirect(`${path}?status=${encodeURIComponent(status)}`);
}

async function call(
  form: FormData,
  name: string,
  args: Record<string, unknown>,
  success: string,
  expectedStatus?: string,
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) finish(form, 'backend-unavailable');
  const result = await supabase.schema('api').rpc(name, args);
  const status = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? (result.data as Record<string, unknown>).status
    : null;
  finish(form, result.error || (expectedStatus && status !== expectedStatus) ? 'action-failed' : success);
}

function passengerInput(form: FormData) {
  const churchId = uuid(form, 'church_id');
  const timezone = field(form, 'timezone', 64);
  const desiredArrivalAt = timezone
    ? zonedLocalDateTimeToIso(form.get('desired_arrival_local'), timezone)
    : null;
  const passengerCount = integer(form, 'passenger_count', 1, 55);
  const childrenCount = integer(form, 'children_count', 0, 55);
  const publicNote = optionalField(form, 'public_note', 300);
  // Up to three alternative meeting places, each already confirmed by the person on the map.
  const places = parsePlaceInputList(form.get('places'), 3);
  if (!churchId || !timezone || !desiredArrivalAt || passengerCount === null
    || childrenCount === null || childrenCount > passengerCount || publicNote === null
    || !places) return null;
  const childSeatRequired = checked(form, 'child_seat_required');
  if (childrenCount === 0 && childSeatRequired) return null;
  return {
    churchId, timezone, desiredArrivalAt, passengerCount, childrenCount,
    childSeatRequired, returnRequired: checked(form, 'return_required'), publicNote,
    places,
  };
}

function driverBaseInput(form: FormData) {
  const churchId = uuid(form, 'church_id');
  const timezone = field(form, 'timezone', 64);
  const seatsAvailable = integer(form, 'seats_available', 1, 55);
  const maxDetourKm = integer(form, 'max_detour_km', 0, 20);
  const publicNote = optionalField(form, 'public_note', 300);
  const origins = parsePlaceInputList(form.get('origin'), 1);
  const childrenAllowed = checked(form, 'children_allowed');
  const driverChildSeatAvailable = checked(form, 'driver_child_seat_available');
  if (!churchId || !timezone || seatsAvailable === null || maxDetourKm === null
    || ![0, 2, 5, 10, 15, 20].includes(maxDetourKm) || publicNote === null
    || !origins || (!childrenAllowed && driverChildSeatAvailable)) return null;
  return {
    churchId, timezone, seatsAvailable, maxDetourKm, childrenAllowed,
    driverChildSeatAvailable, returnAvailable: checked(form, 'return_available'),
    publicNote, origin: origins[0],
  };
}

function occurrenceInput(form: FormData) {
  const base = driverBaseInput(form);
  if (!base) return null;
  const departureAt = zonedLocalDateTimeToIso(form.get('departure_local'), base.timezone);
  const arrivalAt = zonedLocalDateTimeToIso(form.get('arrival_local'), base.timezone);
  return departureAt && arrivalAt && Date.parse(arrivalAt) > Date.parse(departureAt)
    ? { ...base, departureAt, arrivalAt }
    : null;
}

function seriesInput(form: FormData) {
  const base = driverBaseInput(form);
  const localDepartureTime = field(form, 'local_departure_time', 5);
  const localArrivalTime = field(form, 'local_arrival_time', 5);
  const startsOn = field(form, 'starts_on', 10);
  const endsOn = field(form, 'ends_on', 10);
  const weekdays = form.getAll('weekdays').flatMap((value) => {
    const parsed = typeof value === 'string' && /^[0-6]$/.test(value) ? Number(value) : null;
    return parsed === null ? [] : [parsed];
  });
  return base && localDepartureTime && localArrivalTime && startsOn && endsOn
    && /^\d{2}:\d{2}$/.test(localDepartureTime) && /^\d{2}:\d{2}$/.test(localArrivalTime)
    && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(endsOn)
    && weekdays.length > 0
    ? { ...base, localDepartureTime, localArrivalTime, startsOn, endsOn, weekdays: [...new Set(weekdays)] }
    : null;
}

function passengerArgs(input: NonNullable<ReturnType<typeof passengerInput>>, clientKey: string) {
  return {
    p_church_id: input.churchId, p_service_occurrence_id: null,
    p_desired_arrival_at: input.desiredArrivalAt, p_timezone: input.timezone,
    p_total_passengers: input.passengerCount, p_children_count: input.childrenCount,
    p_child_seat_required: input.childSeatRequired, p_return_required: input.returnRequired,
    p_public_note: input.publicNote, p_places: input.places.map(placeToRpcInput),
    p_client_key: clientKey,
  };
}

function occurrenceArgs(input: NonNullable<ReturnType<typeof occurrenceInput>>, clientKey: string) {
  return {
    p_church_id: input.churchId, p_service_occurrence_id: null,
    p_departure_at: input.departureAt, p_arrival_at: input.arrivalAt, p_timezone: input.timezone,
    p_total_seats: input.seatsAvailable, p_max_detour_km: input.maxDetourKm,
    p_children_allowed: input.childrenAllowed, p_driver_child_seat_available: input.driverChildSeatAvailable,
    p_return_available: input.returnAvailable, p_public_note: input.publicNote,
    p_origin: placeToRpcInput(input.origin), p_client_key: clientKey,
  };
}

function seriesArgs(input: NonNullable<ReturnType<typeof seriesInput>>, clientKey: string) {
  return {
    p_church_id: input.churchId, p_weekdays: input.weekdays,
    p_local_departure_time: input.localDepartureTime, p_local_arrival_time: input.localArrivalTime,
    p_timezone: input.timezone, p_starts_on: input.startsOn, p_ends_on: input.endsOn,
    p_total_seats: input.seatsAvailable, p_max_detour_km: input.maxDetourKm,
    p_children_allowed: input.childrenAllowed, p_driver_child_seat_available: input.driverChildSeatAvailable,
    p_return_available: input.returnAvailable, p_public_note: input.publicNote,
    p_origin: placeToRpcInput(input.origin), p_client_key: clientKey,
  };
}

export async function publishPassengerRequestAction(form: FormData) {
  const input = passengerInput(form);
  const clientKey = uuid(form, 'client_key');
  if (!input || !clientKey) finish(form, 'invalid-input');
  await call(form, 'publish_passenger_request', passengerArgs(input, clientKey), 'request-published');
}

export async function publishDriverOccurrenceAction(form: FormData) {
  const input = occurrenceInput(form);
  const clientKey = uuid(form, 'client_key');
  if (!input || !clientKey) finish(form, 'invalid-input');
  await call(form, 'publish_driver_occurrence', occurrenceArgs(input, clientKey), 'offer-published');
}

export async function publishDriverSeriesAction(form: FormData) {
  const input = seriesInput(form);
  const clientKey = uuid(form, 'client_key');
  if (!input || !clientKey) finish(form, 'invalid-input');
  await call(form, 'publish_driver_series', seriesArgs(input, clientKey), 'series-published');
}

async function startContextual(form: FormData, actionType: 'passenger_request' | 'driver_offer' | 'ride_response', payload: Record<string, unknown>) {
  const contextual = new FormData();
  contextual.set('action_type', actionType);
  contextual.set('client_key', uuid(form, 'client_key') ?? randomUUID());
  contextual.set('payload', JSON.stringify(payload));
  contextual.set('display_name', field(form, 'display_name', 80) ?? '');
  contextual.set('phone', field(form, 'phone', 20) ?? '');
  contextual.set('preferred_language', field(form, 'preferred_language', 2) ?? 'ru');
  contextual.set('email', field(form, 'email', 254) ?? '');
  const result = await beginContextualRegistrationAction(contextual);
  if (result.status === 'email-sent') redirect('/auth?context=1&status=contextual-email-sent');
  finish(form, result.status === 'rate-limited' ? 'rate-limited' : result.status === 'invalid' ? 'invalid-input' : 'backend-unavailable');
}

export async function startPassengerContextualAction(form: FormData) {
  const input = passengerInput(form);
  if (!input) finish(form, 'invalid-input');
  await startContextual(form, 'passenger_request', {
    ...input,
    churchName: field(form, 'church_name', 200),
    churchSlug: field(form, 'church_slug', 100),
  });
}

export async function startDriverOccurrenceContextualAction(form: FormData) {
  const input = occurrenceInput(form);
  if (!input) finish(form, 'invalid-input');
  await startContextual(form, 'driver_offer', {
    ...input, offerMode: 'trip', churchName: field(form, 'church_name', 200),
    churchSlug: field(form, 'church_slug', 100),
  });
}

export async function startDriverSeriesContextualAction(form: FormData) {
  const input = seriesInput(form);
  if (!input) finish(form, 'invalid-input');
  await startContextual(form, 'driver_offer', {
    ...input, offerMode: 'route', churchName: field(form, 'church_name', 200),
    churchSlug: field(form, 'church_slug', 100),
  });
}

export async function publishPassengerResponseWithRequestAction(form: FormData) {
  const input = passengerInput(form);
  const occurrenceId = uuid(form, 'occurrence_id');
  const clientKey = uuid(form, 'client_key');
  if (!input || !occurrenceId || !clientKey) finish(form, 'invalid-input');
  await call(form, 'publish_contextual_passenger_response', {
    ...passengerArgs(input, clientKey), p_occurrence_id: occurrenceId,
  }, 'response-sent');
}

export async function publishDriverResponseWithOccurrenceAction(form: FormData) {
  const input = occurrenceInput(form);
  const requestId = uuid(form, 'request_id');
  const placeId = uuid(form, 'place_id');
  const count = integer(form, 'passenger_count', 1, 55);
  const clientKey = uuid(form, 'client_key');
  if (!input || !requestId || !placeId || count === null || !clientKey) finish(form, 'invalid-input');
  await call(form, 'publish_contextual_driver_response', {
    ...occurrenceArgs(input, clientKey), p_request_id: requestId,
    p_place_id: placeId, p_offered_passenger_count: count,
  }, 'response-sent');
}

export async function startPassengerResponseContextualAction(form: FormData) {
  const input = passengerInput(form);
  const occurrenceId = uuid(form, 'occurrence_id');
  if (!input || !occurrenceId) finish(form, 'invalid-input');
  await startContextual(form, 'ride_response', {
    ...input,
    churchName: field(form, 'church_name', 200), churchSlug: field(form, 'church_slug', 100),
    occurrenceId, responseDirection: 'passenger_to_driver',
    targetName: field(form, 'target_name', 80), targetSummary: field(form, 'target_summary', 240),
  });
}

export async function startDriverResponseContextualAction(form: FormData) {
  const input = occurrenceInput(form);
  const requestId = uuid(form, 'request_id');
  const placeId = uuid(form, 'place_id');
  const count = integer(form, 'passenger_count', 1, 55);
  if (!input || !requestId || !placeId || count === null) finish(form, 'invalid-input');
  await startContextual(form, 'ride_response', {
    ...input, offerMode: 'trip', churchName: field(form, 'church_name', 200),
    churchSlug: field(form, 'church_slug', 100), requestId, placeId,
    offeredPassengerCount: count, responseDirection: 'driver_to_passenger',
    targetName: field(form, 'target_name', 80), targetSummary: field(form, 'target_summary', 240),
  });
}

async function simpleUuidAction(
  form: FormData,
  rpc: string,
  idName: string,
  rpcIdName: string,
  success: string,
  expectedStatus?: string,
) {
  const id = uuid(form, idName);
  const clientKey = uuid(form, 'client_key');
  if (!id || !clientKey) finish(form, 'invalid-input');
  await call(form, rpc, { [rpcIdName]: id, p_client_key: clientKey }, success, expectedStatus);
}

export async function submitPassengerResponseAction(form: FormData) {
  const requestId = uuid(form, 'request_id');
  const occurrenceId = uuid(form, 'occurrence_id');
  const clientKey = uuid(form, 'client_key');
  if (!requestId || !occurrenceId || !clientKey) finish(form, 'invalid-input');
  await call(form, 'submit_passenger_response', { p_request_id: requestId, p_occurrence_id: occurrenceId, p_client_key: clientKey }, 'response-sent');
}

export async function submitDriverResponseAction(form: FormData) {
  const requestId = uuid(form, 'request_id');
  const occurrenceId = uuid(form, 'occurrence_id');
  const placeId = uuid(form, 'place_id');
  const count = integer(form, 'passenger_count', 1, 55);
  const clientKey = uuid(form, 'client_key');
  if (!requestId || !occurrenceId || !placeId || count === null || !clientKey) finish(form, 'invalid-input');
  await call(form, 'submit_driver_response', {
    p_request_id: requestId, p_occurrence_id: occurrenceId, p_place_id: placeId,
    p_offered_passenger_count: count, p_client_key: clientKey,
  }, 'response-sent');
}

export async function answerPassengerResponseAction(form: FormData) {
  const responseId = uuid(form, 'response_id');
  const placeId = uuid(form, 'place_id');
  const count = integer(form, 'passenger_count', 1, 55);
  const clientKey = uuid(form, 'client_key');
  if (!responseId || !placeId || count === null || !clientKey) finish(form, 'invalid-input');
  await call(form, 'answer_passenger_response', {
    p_response_id: responseId, p_place_id: placeId, p_offered_passenger_count: count,
    p_accept: true, p_client_key: clientKey,
  }, 'response-answered');
}

export async function rejectPassengerResponseAction(form: FormData) {
  const responseId = uuid(form, 'response_id');
  const clientKey = uuid(form, 'client_key');
  if (!responseId || !clientKey) finish(form, 'invalid-input');
  await call(form, 'answer_passenger_response', {
    p_response_id: responseId, p_place_id: null, p_offered_passenger_count: null,
    p_accept: false, p_client_key: clientKey,
  }, 'response-declined');
}

export async function confirmRideResponseAction(form: FormData) { await simpleUuidAction(form, 'confirm_ride_response', 'response_id', 'p_response_id', 'agreement-confirmed', 'confirmed'); }
export async function declineRideResponseAction(form: FormData) { await simpleUuidAction(form, 'decline_ride_response', 'response_id', 'p_response_id', 'response-declined'); }
export async function withdrawRideResponseAction(form: FormData) { await simpleUuidAction(form, 'withdraw_ride_response', 'response_id', 'p_response_id', 'response-withdrawn'); }
export async function cancelRideAgreementAction(form: FormData) { await simpleUuidAction(form, 'cancel_ride_agreement', 'agreement_id', 'p_agreement_id', 'agreement-cancelled'); }
export async function restorePassengerRequestAction(form: FormData) { await simpleUuidAction(form, 'restore_passenger_request', 'request_id', 'p_request_id', 'request-restored'); }
export async function cancelPassengerRequestAction(form: FormData) { await simpleUuidAction(form, 'cancel_passenger_request', 'request_id', 'p_request_id', 'request-cancelled'); }
export async function cancelDriverOccurrenceAction(form: FormData) { await simpleUuidAction(form, 'cancel_driver_occurrence', 'occurrence_id', 'p_occurrence_id', 'offer-cancelled'); }
export async function stopDriverSeriesAction(form: FormData) { await simpleUuidAction(form, 'stop_driver_series', 'series_id', 'p_series_id', 'series-stopped'); }

export async function revealAgreementAction(form: FormData) {
  const agreementId = uuid(form, 'agreement_id');
  const path = corePath(form);
  redirect(agreementId ? `${path}?reveal=${agreementId}` : `${path}?status=invalid-input`);
}
