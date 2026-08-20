'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { parseContextualDraftId } from '@/lib/contextual-registration/flow';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function returnToDraft(draftId: string, status: string): never {
  redirect(`/registration/${draftId}?status=${encodeURIComponent(status)}`);
}

async function ownedDraftClient(rawDraftId: FormDataEntryValue | null) {
  const draftId = parseContextualDraftId(rawDraftId);
  const supabase = await createServerSupabaseClient();
  if (!draftId || !supabase) return null;
  const current = await supabase.schema('api').rpc('current_contextual_draft', {
    p_draft_id: draftId,
  });
  return current.error || !current.data || typeof current.data !== 'object'
    ? null
    : { draft: current.data as Record<string, unknown>, draftId, supabase };
}

function object(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum
    ? value.trim()
    : null;
}

function uuid(value: unknown) {
  const parsed = text(value, 36);
  return parsed && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)
    ? parsed
    : null;
}

function integer(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function boolean(value: unknown) { return typeof value === 'boolean' ? value : null; }

function contextualPassengerArgs(payload: Record<string, unknown>, clientKey: string) {
  const churchId = uuid(payload.churchId);
  const desiredArrivalAt = text(payload.desiredArrivalAt, 40);
  const timezone = text(payload.timezone, 64);
  const totalPassengers = integer(payload.passengerCount, 1, 55);
  const childrenCount = integer(payload.childrenCount, 0, 55);
  const childSeatRequired = boolean(payload.childSeatRequired);
  const returnRequired = boolean(payload.returnRequired);
  const publicNote = typeof payload.publicNote === 'string' && payload.publicNote.length <= 300 ? payload.publicNote : null;
  const places = Array.isArray(payload.places) ? payload.places.flatMap((raw) => {
    const place = object(raw);
    const exactLabel = text(place?.exactLabel, 300);
    const publicAreaLabel = text(place?.publicAreaLabel, 120);
    return exactLabel && publicAreaLabel ? [{ exact_label: exactLabel, public_area_label: publicAreaLabel }] : [];
  }) : [];
  return churchId && desiredArrivalAt && Number.isFinite(Date.parse(desiredArrivalAt)) && timezone
    && totalPassengers !== null && childrenCount !== null && childrenCount <= totalPassengers
    && childSeatRequired !== null && returnRequired !== null && publicNote !== null && places.length >= 1 && places.length <= 3
    ? {
      p_church_id: churchId, p_service_occurrence_id: null, p_desired_arrival_at: desiredArrivalAt,
      p_timezone: timezone, p_total_passengers: totalPassengers, p_children_count: childrenCount,
      p_child_seat_required: childSeatRequired, p_return_required: returnRequired,
      p_public_note: publicNote, p_places: places, p_client_key: clientKey,
    }
    : null;
}

function contextualDriverArgs(payload: Record<string, unknown>, clientKey: string) {
  const churchId = uuid(payload.churchId);
  const timezone = text(payload.timezone, 64);
  const seats = integer(payload.seatsAvailable, 1, 55);
  const detour = integer(payload.maxDetourKm, 0, 20);
  const children = boolean(payload.childrenAllowed);
  const childSeat = boolean(payload.driverChildSeatAvailable);
  const returnAvailable = boolean(payload.returnAvailable);
  const publicNote = typeof payload.publicNote === 'string' && payload.publicNote.length <= 300 ? payload.publicNote : null;
  const exactOrigin = text(payload.exactOriginLabel, 300);
  const publicOrigin = text(payload.publicOriginArea, 120);
  const base = churchId && timezone && seats !== null && detour !== null && [0, 2, 5, 10, 15, 20].includes(detour)
    && children !== null && childSeat !== null && returnAvailable !== null && publicNote !== null
    && exactOrigin && publicOrigin && (children || !childSeat)
    ? {
      p_church_id: churchId, p_timezone: timezone, p_total_seats: seats, p_max_detour_km: detour,
      p_children_allowed: children, p_driver_child_seat_available: childSeat,
      p_return_available: returnAvailable, p_public_note: publicNote,
      p_exact_origin_label: exactOrigin, p_public_origin_area: publicOrigin, p_client_key: clientKey,
    }
    : null;
  if (!base) return null;
  if (payload.offerMode === 'trip') {
    const departure = text(payload.departureAt, 40);
    const arrival = text(payload.arrivalAt, 40);
    return departure && arrival && Date.parse(arrival) > Date.parse(departure)
      ? { rpc: 'publish_driver_occurrence', resultKey: 'occurrence_id', resultType: 'driver_occurrence', args: {
        ...base, p_service_occurrence_id: null, p_departure_at: departure, p_arrival_at: arrival,
      } }
      : null;
  }
  if (payload.offerMode === 'route') {
    const weekdays = Array.isArray(payload.weekdays)
      ? payload.weekdays.filter((day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6)
      : [];
    const departureTime = text(payload.localDepartureTime, 5);
    const arrivalTime = text(payload.localArrivalTime, 5);
    const startsOn = text(payload.startsOn, 10);
    const endsOn = text(payload.endsOn, 10);
    return weekdays.length > 0 && departureTime && arrivalTime && startsOn && endsOn
      ? { rpc: 'publish_driver_series', resultKey: 'series_id', resultType: 'driver_series', args: {
        ...base, p_weekdays: [...new Set(weekdays)], p_local_departure_time: departureTime,
        p_local_arrival_time: arrivalTime, p_starts_on: startsOn, p_ends_on: endsOn,
      } }
      : null;
  }
  return null;
}

export async function createContextualAccountAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');

  const displayName = formData.get('display_name');
  const phone = formData.get('phone');
  const language = formData.get('language');
  if (
    typeof displayName !== 'string'
    || typeof phone !== 'string'
    || typeof language !== 'string'
  ) returnToDraft(owned.draftId, 'account-input');

  const result = await owned.supabase.schema('api').rpc('materialize_contextual_account', {
    p_draft_id: owned.draftId,
    p_display_name: displayName,
    p_phone_e164: phone,
    p_preferred_language: language,
  });
  if (result.error) returnToDraft(owned.draftId, 'account-input');
  returnToDraft(owned.draftId, 'account-created');
}

export async function declareContextualAdultAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  if (formData.get('adult') !== 'yes') returnToDraft(owned.draftId, 'adult-required');

  const result = await owned.supabase.schema('api').rpc('declare_adult');
  returnToDraft(owned.draftId, result.error ? 'account-unavailable' : 'adult-declared');
}

export async function requestContextualPhoneVerificationAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');

  const account = await owned.supabase.schema('api').rpc('current_account');
  const phone = account.data && typeof account.data === 'object'
    ? (account.data as Record<string, unknown>).phone
    : null;
  if (typeof phone !== 'string') returnToDraft(owned.draftId, 'phone-unavailable');

  const result = await owned.supabase.schema('api').rpc('request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: phone,
  });
  const status = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>).status
    : null;
  if (status === 'queued' || status === 'already_verified') {
    returnToDraft(owned.draftId, status === 'queued' ? 'phone-requested' : 'phone-verified');
  }
  returnToDraft(owned.draftId, status === 'rate_limited' ? 'phone-rate-limited' : 'phone-unavailable');
}

export async function verifyContextualPhoneAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  const code = formData.get('code');
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    returnToDraft(owned.draftId, 'phone-code-invalid');
  }

  const current = await owned.supabase.schema('api').rpc('current_phone_verification');
  const attemptId = current.data && typeof current.data === 'object'
    ? (current.data as Record<string, unknown>).attempt_id
    : null;
  if (typeof attemptId !== 'string') returnToDraft(owned.draftId, 'phone-unavailable');

  const result = await owned.supabase.schema('api').rpc('verify_phone_code', {
    p_attempt_id: attemptId,
    p_code: code,
  });
  const status = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>).status
    : null;
  const safeStatus = status === 'verified'
    ? 'phone-verified'
    : status === 'invalid_code'
      ? 'phone-code-invalid'
      : status === 'delivery_pending'
        ? 'phone-delivery-pending'
        : 'phone-unavailable';
  returnToDraft(owned.draftId, safeStatus);
}

export async function cancelContextualDraftAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  const result = await owned.supabase.schema('api').rpc('cancel_contextual_draft', {
    p_draft_id: owned.draftId,
  });
  redirect(result.error || !result.data ? `/registration/${owned.draftId}?status=cancel-failed` : '/?status=draft-cancelled');
}

export async function acceptContextualTermsAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  if (formData.get('terms') !== 'yes') returnToDraft(owned.draftId, 'terms-failed');
  const result = await owned.supabase.schema('api').rpc('accept_current_terms');
  returnToDraft(owned.draftId, result.error ? 'terms-failed' : 'terms-accepted');
}

export async function publishContextualDraftAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  const payload = object(owned.draft.payload);
  const eligibility = object(owned.draft.eligibility);
  if (!payload || owned.draft.payload_version !== 1 || eligibility?.eligible !== true) {
    returnToDraft(owned.draftId, 'eligibility-required');
  }

  let rpc: string;
  let args: Record<string, unknown>;
  let resultKey: string;
  let resultType: string;
  if (owned.draft.action_type === 'passenger_request') {
    const parsed = contextualPassengerArgs(payload, owned.draftId);
    if (!parsed) returnToDraft(owned.draftId, 'publication-invalid');
    rpc = 'publish_passenger_request';
    args = parsed;
    resultKey = 'request_id';
    resultType = 'passenger_request';
  } else if (owned.draft.action_type === 'driver_offer') {
    const parsed = contextualDriverArgs(payload, owned.draftId);
    if (!parsed) returnToDraft(owned.draftId, 'publication-invalid');
    ({ rpc, args, resultKey, resultType } = parsed);
  } else if (owned.draft.action_type === 'ride_response' && payload.responseDirection === 'passenger_to_driver') {
    const parsed = contextualPassengerArgs(payload, owned.draftId);
    const occurrenceId = uuid(payload.occurrenceId);
    if (!parsed || !occurrenceId) returnToDraft(owned.draftId, 'publication-invalid');
    rpc = 'publish_contextual_passenger_response';
    args = { ...parsed, p_occurrence_id: occurrenceId };
    resultKey = 'response_id';
    resultType = 'ride_response';
  } else if (owned.draft.action_type === 'ride_response' && payload.responseDirection === 'driver_to_passenger') {
    const parsed = contextualDriverArgs(payload, owned.draftId);
    const requestId = uuid(payload.requestId);
    const placeId = uuid(payload.placeId);
    const count = integer(payload.offeredPassengerCount, 1, 55);
    if (!parsed || parsed.rpc !== 'publish_driver_occurrence' || !requestId || !placeId || count === null) {
      returnToDraft(owned.draftId, 'publication-invalid');
    }
    rpc = 'publish_contextual_driver_response';
    args = {
      ...parsed.args, p_request_id: requestId, p_place_id: placeId,
      p_offered_passenger_count: count,
    };
    resultKey = 'response_id';
    resultType = 'ride_response';
  } else {
    returnToDraft(owned.draftId, 'publication-unavailable');
  }

  const publication = await owned.supabase.schema('api').rpc(rpc, args);
  const publicationData = object(publication.data);
  const resultId = uuid(publicationData?.[resultKey]);
  if (publication.error || !resultId) returnToDraft(owned.draftId, 'publication-failed');
  const completed = await owned.supabase.schema('api').rpc('complete_contextual_transport_draft', {
    p_draft_id: owned.draftId,
    p_result_id: resultId,
    p_result_type: resultType,
  });
  if (completed.error) returnToDraft(owned.draftId, 'publication-saved');
  const churchSlug = text(payload.churchSlug, 100);
  redirect(churchSlug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(churchSlug)
    ? `/churches/${churchSlug}?status=publication-complete`
    : '/churches?status=publication-complete');
}
