import { formatDate, formatDateTime } from './dateFormat';
import {
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
} from './passengerRequestValidation';
import { formatAgreementCount, formatOccupiedOfTotal, formatPassengerCount, formatSeatCount } from './russianCount';
import type {
  ChurchService,
  DriverOfferType,
  DriverResponse,
  LocalDriverProfile,
  MockNotification,
  PassengerRequest,
  PrivateContact,
  PublicDriverOfferType,
  RideMatch,
  Route,
  TargetedPassengerRequest,
  Trip,
} from './types';

export type RideWorkflowState = {
  passengerRequests: PassengerRequest[];
  driverResponses: DriverResponse[];
  targetedRequests: TargetedPassengerRequest[];
  rideMatches: RideMatch[];
};

export type OfferAvailability = {
  active: boolean;
  availableSeats: number;
  totalSeats: number;
  reason?: 'missing' | 'inactive' | 'invalidDate' | 'past' | 'wrongWeekday' | 'full';
};

export type CompatibleDriverOffer = {
  driverId: string;
  offerId: string;
  offerType: PublicDriverOfferType;
  rideDate: string;
  label: string;
  availableSeats: number;
  totalSeats: number;
};

export type CompatiblePassengerRequestSummary = {
  requestId: string;
  serviceEvent: string;
  serviceDate: string;
  remainingPassengerCount: number;
  pickupArea: string;
  safePublicComment?: string;
};

export type RouteOccurrenceOption = {
  date: string;
  label: string;
  availableSeats: number;
  totalSeats: number;
  disabled: boolean;
};

export type PrivateDriverOfferDraft = {
  publicName: string;
  phone: string;
  email: string;
  originLabel: string;
  departureTime: string;
  offeredPassengerCount: string;
  maxDetourKm: string;
  consent: boolean;
};

export type PrivateDriverOfferDraftErrors = Partial<
  Record<keyof PrivateDriverOfferDraft, string>
>;

export type CompletedActivitySummary = {
  id: string;
  kind:
    | 'passengerRequest'
    | 'fullTrip'
    | 'partialRouteOccurrence'
    | 'fullRouteOccurrence';
  section: 'passengerRequests' | 'oneTimeTrips' | 'regularRouteOccurrences';
  message: string;
  detail: string;
  occurredAt: string;
  badge?: string;
  offerTypeLabel?: 'Регулярная поездка' | 'Разовая поездка';
};

export type PublicPassengerRequestItem = {
  id: string;
  firstName: string;
  serviceEvent: string;
  pickupArea: string;
  safePublicComment?: string;
  rootRequestId: string;
  originalPassengerCount: number;
  remainingPassengerCount: number;
  partial: boolean;
  countLabel: string;
  statusLabel: string;
};

const responseStatuses: DriverResponse['status'][] = [
  'pendingPassengerConfirmation',
  'accepted',
  'declined',
  'cancelled',
  'expired',
];
const targetedStatuses: TargetedPassengerRequest['status'][] = [
  'waitingForDriver',
  'pendingPassengerConfirmation',
  'matched',
  'declined',
  'cancelled',
  'expired',
];
const requestStatuses: PassengerRequest['status'][] = [
  'open',
  'matched',
  'partiallyMatched',
  'cancelled',
  'expired',
];
const rideMatchStatuses: RideMatch['status'][] = ['confirmed', 'cancelled', 'completed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function isLocalTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function getLocalDeparture(date: string, time: string) {
  if (!isLocalDate(date) || !isLocalTime(time)) {
    return null;
  }

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function getLocalDayStart(date: string) {
  if (!isLocalDate(date)) {
    return null;
  }

  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isRideDateCurrent(date: string, now: Date) {
  const day = getLocalDayStart(date);
  return day !== null && day.getTime() >= getToday(now).getTime();
}

export function routeIncludesDate(route: Pick<Route, 'recurrence'>, date: string) {
  const day = getLocalDayStart(date);
  return day !== null && route.recurrence.daysOfWeek.includes(day.getDay());
}

function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePrivateContact(value: unknown): PrivateContact | null {
  if (!isRecord(value) || !isNonEmptyString(value.phone) || !isInternationalPhoneValid(value.phone)) {
    return null;
  }

  if (value.email !== undefined && (!isNonEmptyString(value.email) || !isOptionalEmailValid(value.email))) {
    return null;
  }

  return {
    phone: normalizePhone(value.phone),
    email: typeof value.email === 'string' ? value.email.trim() : undefined,
  };
}

function parseOptionalString(value: unknown, maxLength = 300) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

export function parsePassengerRequest(value: unknown): PassengerRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const pickupZone = isRecord(value.pickupZone) ? value.pickupZone : null;
  const legacyStatus = value.status === 'pendingContact' || value.status === 'waitingForDriver';
  const status = legacyStatus ? 'open' : value.status;

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.churchId) ||
    !isNonEmptyString(value.firstName) ||
    !isNonEmptyString(value.phonePrivate) ||
    !isInternationalPhoneValid(value.phonePrivate) ||
    (value.emailPrivate !== undefined &&
      (!isNonEmptyString(value.emailPrivate) || !isOptionalEmailValid(value.emailPrivate))) ||
    !isNonEmptyString(value.serviceEvent) ||
    (value.serviceEventId !== undefined && !isNonEmptyString(value.serviceEventId)) ||
    (value.serviceDate !== undefined && !isLocalDate(value.serviceDate)) ||
    !Number.isInteger(value.passengerCount) ||
    Number(value.passengerCount) < 1 ||
    !pickupZone ||
    !isNonEmptyString(pickupZone.label) ||
    value.consentToShareContact !== true ||
    !requestStatuses.includes(status as PassengerRequest['status']) ||
    !isIsoTimestamp(value.createdAt)
  ) {
    return null;
  }

  const normalizedStatus = status as PassengerRequest['status'];
  return {
    id: value.id,
    churchId: value.churchId,
    firstName: value.firstName.trim(),
    phonePrivate: normalizePhone(value.phonePrivate),
    emailPrivate: typeof value.emailPrivate === 'string' ? value.emailPrivate.trim() : undefined,
    serviceEvent: value.serviceEvent.trim(),
    serviceEventId: typeof value.serviceEventId === 'string' ? value.serviceEventId : undefined,
    serviceDate: typeof value.serviceDate === 'string' ? value.serviceDate : undefined,
    passengerCount: Number(value.passengerCount),
    pickupZone: { label: pickupZone.label.trim() },
    safePublicComment: parseOptionalString(value.safePublicComment),
    consentToShareContact: true,
    status: normalizedStatus,
    publicVisible: normalizedStatus === 'open' && (legacyStatus || value.publicVisible === true),
    createdAt: value.createdAt,
    updatedAt: isIsoTimestamp(value.updatedAt) ? value.updatedAt : undefined,
    sourcePassengerRequestId: isNonEmptyString(value.sourcePassengerRequestId)
      ? value.sourcePassengerRequestId
      : undefined,
  };
}

export function parseDriverResponse(value: unknown): DriverResponse | null {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.passengerRequestId) || !isIsoTimestamp(value.createdAt)) {
    return null;
  }

  if (value.status === 'pendingContact' || (value.status === 'cancelled' && !value.driverOfferId)) {
    return {
      id: value.id,
      driverId: 'legacy-unlinked-driver',
      passengerRequestId: value.passengerRequestId,
      driverOfferId: 'legacy-unlinked-offer',
      driverOfferType: 'oneTimeTrip',
      rideDate: '1970-01-01',
      offeredPassengerCount: 1,
      status: value.status === 'cancelled' ? 'cancelled' : 'expired',
      createdAt: value.createdAt,
      updatedAt: isIsoTimestamp(value.cancelledAt) ? value.cancelledAt : value.createdAt,
      cancelledAt: isIsoTimestamp(value.cancelledAt) ? value.cancelledAt : undefined,
    };
  }

  const privateOffer = isRecord(value.privateOffer) ? value.privateOffer : null;
  const privateOfferValid =
    value.driverOfferType !== 'privateDriverOffer' ||
    Boolean(
      privateOffer &&
      isNonEmptyString(privateOffer.originLabel) &&
      isLocalTime(privateOffer.departureTime) &&
      (privateOffer.maxDetourKm === undefined ||
        (Number.isInteger(privateOffer.maxDetourKm) && Number(privateOffer.maxDetourKm) >= 0)),
    );

  if (
    !isNonEmptyString(value.driverId) ||
    !isNonEmptyString(value.driverOfferId) ||
    (value.driverOfferType !== 'regularRoute' &&
      value.driverOfferType !== 'oneTimeTrip' &&
      value.driverOfferType !== 'privateDriverOffer') ||
    !privateOfferValid ||
    !isLocalDate(value.rideDate) ||
    !Number.isInteger(value.offeredPassengerCount) ||
    Number(value.offeredPassengerCount) < 1 ||
    !responseStatuses.includes(value.status as DriverResponse['status']) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    driverId: value.driverId,
    passengerRequestId: value.passengerRequestId,
    driverOfferId: value.driverOfferId,
    driverOfferType: value.driverOfferType,
    rideDate: value.rideDate,
    offeredPassengerCount: Number(value.offeredPassengerCount),
    status: value.status as DriverResponse['status'],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    cancelledAt: isIsoTimestamp(value.cancelledAt) ? value.cancelledAt : undefined,
    privateOffer:
      value.driverOfferType === 'privateDriverOffer' && privateOffer
        ? {
            originLabel: String(privateOffer.originLabel).trim(),
            departureTime: String(privateOffer.departureTime),
            maxDetourKm:
              privateOffer.maxDetourKm === undefined
                ? undefined
                : Number(privateOffer.maxDetourKm),
          }
        : undefined,
  };
}

export function parseTargetedPassengerRequest(value: unknown): TargetedPassengerRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const pickupZone = isRecord(value.pickupZone) ? value.pickupZone : null;
  const status = targetedStatuses.includes(value.status as TargetedPassengerRequest['status'])
    ? (value.status as TargetedPassengerRequest['status'])
    : value.status === undefined || value.status === 'waitingForDriver'
      ? 'waitingForDriver'
      : null;

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.churchId) ||
    !isNonEmptyString(value.driverId) ||
    !isNonEmptyString(value.driverName) ||
    !isNonEmptyString(value.targetOfferId) ||
    (value.targetOfferType !== 'regularRoute' && value.targetOfferType !== 'oneTimeTrip') ||
    !isNonEmptyString(value.offerContext) ||
    (value.rideDate !== undefined && !isLocalDate(value.rideDate)) ||
    !isNonEmptyString(value.firstName) ||
    !isNonEmptyString(value.phonePrivate) ||
    !isInternationalPhoneValid(value.phonePrivate) ||
    (value.emailPrivate !== undefined &&
      (!isNonEmptyString(value.emailPrivate) || !isOptionalEmailValid(value.emailPrivate))) ||
    !Number.isInteger(value.passengerCount) ||
    Number(value.passengerCount) < 1 ||
    !pickupZone ||
    !isNonEmptyString(pickupZone.label) ||
    value.consentToShareContact !== true ||
    !status ||
    !isIsoTimestamp(value.createdAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    churchId: value.churchId,
    driverId: value.driverId,
    driverName: value.driverName.trim(),
    targetOfferId: value.targetOfferId,
    targetOfferType: value.targetOfferType,
    offerContext: value.offerContext.trim(),
    rideDate: typeof value.rideDate === 'string' ? value.rideDate : undefined,
    serviceEvent: isNonEmptyString(value.serviceEvent) ? value.serviceEvent.trim() : value.offerContext.trim(),
    serviceEventId: isNonEmptyString(value.serviceEventId) ? value.serviceEventId : undefined,
    firstName: value.firstName.trim(),
    phonePrivate: normalizePhone(value.phonePrivate),
    emailPrivate: typeof value.emailPrivate === 'string' ? value.emailPrivate.trim() : undefined,
    passengerCount: Number(value.passengerCount),
    pickupZone: { label: pickupZone.label.trim() },
    privateComment: parseOptionalString(value.privateComment),
    consentToShareContact: true,
    offeredPassengerCount:
      Number.isInteger(value.offeredPassengerCount) && Number(value.offeredPassengerCount) > 0
        ? Number(value.offeredPassengerCount)
        : undefined,
    status,
    publicVisible: false,
    createdAt: value.createdAt,
    updatedAt: isIsoTimestamp(value.updatedAt) ? value.updatedAt : value.createdAt,
    sourcePassengerRequestId: isNonEmptyString(value.sourcePassengerRequestId)
      ? value.sourcePassengerRequestId
      : undefined,
  };
}

export function parseRideMatch(value: unknown): RideMatch | null {
  if (!isRecord(value)) {
    return null;
  }

  const passengerContact = parsePrivateContact(value.passengerContactPrivate);
  const driverContact = parsePrivateContact(value.driverContactPrivate);

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.churchId) ||
    !isNonEmptyString(value.passengerRequestId) ||
    (value.targetedPassengerRequestId !== undefined && !isNonEmptyString(value.targetedPassengerRequestId)) ||
    (value.driverResponseId !== undefined && !isNonEmptyString(value.driverResponseId)) ||
    !isNonEmptyString(value.driverId) ||
    !isNonEmptyString(value.driverOfferId) ||
    (value.driverOfferType !== 'regularRoute' &&
      value.driverOfferType !== 'oneTimeTrip' &&
      value.driverOfferType !== 'privateDriverOffer') ||
    !isLocalDate(value.rideDate) ||
    !Number.isInteger(value.originalPassengerCount) ||
    !Number.isInteger(value.confirmedPassengerCount) ||
    Number(value.originalPassengerCount) < 1 ||
    Number(value.confirmedPassengerCount) < 1 ||
    Number(value.confirmedPassengerCount) > Number(value.originalPassengerCount) ||
    !rideMatchStatuses.includes(value.status as RideMatch['status']) ||
    !isNonEmptyString(value.passengerName) ||
    !isNonEmptyString(value.driverName) ||
    !passengerContact ||
    !driverContact ||
    !isIsoTimestamp(value.confirmedAt) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    churchId: value.churchId,
    passengerRequestId: value.passengerRequestId,
    targetedPassengerRequestId: isNonEmptyString(value.targetedPassengerRequestId)
      ? value.targetedPassengerRequestId
      : undefined,
    driverResponseId: isNonEmptyString(value.driverResponseId) ? value.driverResponseId : undefined,
    driverId: value.driverId,
    driverOfferId: value.driverOfferId,
    driverOfferType: value.driverOfferType,
    rideDate: value.rideDate,
    originalPassengerCount: Number(value.originalPassengerCount),
    confirmedPassengerCount: Number(value.confirmedPassengerCount),
    status: value.status as RideMatch['status'],
    passengerName: value.passengerName.trim(),
    driverName: value.driverName.trim(),
    passengerContactPrivate: passengerContact,
    driverContactPrivate: driverContact,
    confirmedAt: value.confirmedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    cancelledAt: isIsoTimestamp(value.cancelledAt) ? value.cancelledAt : undefined,
    remainingNeedHandledAt: isIsoTimestamp(value.remainingNeedHandledAt)
      ? value.remainingNeedHandledAt
      : undefined,
    driverOfferDepartureTime: isLocalTime(value.driverOfferDepartureTime)
      ? value.driverOfferDepartureTime
      : undefined,
  };
}

const emailInText = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const phoneInText = /\+\d[\d\s()\-]{6,}\d/;

export function parseMockNotification(value: unknown): MockNotification | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.churchId) ||
    !isNonEmptyString(value.message) ||
    value.message.length > 300 ||
    emailInText.test(value.message) ||
    phoneInText.test(value.message) ||
    !isIsoTimestamp(value.createdAt) ||
    (value.audience !== undefined && value.audience !== 'passenger' && value.audience !== 'driver')
  ) {
    return null;
  }

  return {
    id: value.id,
    churchId: value.churchId,
    message: value.message.trim(),
    createdAt: value.createdAt,
    audience: value.audience as MockNotification['audience'],
  };
}

export function getConfirmedSeatCount(
  rideMatches: RideMatch[],
  driverOfferId: string,
  driverOfferType: DriverOfferType,
  churchId: string,
  rideDate: string,
) {
  return rideMatches
    .filter(
      (match) =>
        match.driverOfferId === driverOfferId &&
        match.driverOfferType === driverOfferType &&
        match.churchId === churchId &&
        match.rideDate === rideDate &&
        match.status === 'confirmed',
    )
    .reduce((total, match) => total + match.confirmedPassengerCount, 0);
}

export function getOfferAvailability({
  offerId,
  offerType,
  rideDate,
  routes,
  trips,
  rideMatches,
  now,
}: {
  offerId: string;
  offerType: DriverOfferType;
  rideDate: string;
  routes: Route[];
  trips: Trip[];
  rideMatches: RideMatch[];
  now: Date;
}): OfferAvailability {
  if (!isLocalDate(rideDate)) {
    return { active: false, availableSeats: 0, totalSeats: 0, reason: 'invalidDate' };
  }

  if (offerType === 'privateDriverOffer') {
    return { active: false, availableSeats: 0, totalSeats: 0, reason: 'missing' };
  }

  if (offerType === 'oneTimeTrip') {
    const trip = trips.find((item) => item.id === offerId);
    if (!trip) {
      return { active: false, availableSeats: 0, totalSeats: 0, reason: 'missing' };
    }
    if (trip.status !== 'open' || trip.date !== rideDate) {
      return { active: false, availableSeats: 0, totalSeats: trip.seatsTotal, reason: 'inactive' };
    }

    const departure = getLocalDeparture(trip.date, trip.departureTime);
    if (!departure || departure.getTime() < now.getTime()) {
      return { active: false, availableSeats: 0, totalSeats: trip.seatsTotal, reason: 'past' };
    }

    const occupiedSeats = getConfirmedSeatCount(rideMatches, offerId, offerType, trip.churchId, rideDate);
    const availableSeats = Math.max(0, trip.seatsAvailable - occupiedSeats);
    return {
      active: availableSeats > 0,
      availableSeats,
      totalSeats: trip.seatsTotal,
      reason: availableSeats > 0 ? undefined : 'full',
    };
  }

  const route = routes.find((item) => item.id === offerId);
  if (!route) {
    return { active: false, availableSeats: 0, totalSeats: 0, reason: 'missing' };
  }
  if (route.status !== 'active') {
    return { active: false, availableSeats: 0, totalSeats: route.seats, reason: 'inactive' };
  }
  if (!routeIncludesDate(route, rideDate)) {
    return { active: false, availableSeats: 0, totalSeats: route.seats, reason: 'wrongWeekday' };
  }

  const departure = getLocalDeparture(rideDate, route.recurrence.typicalDepartureTime);
  if (!departure || departure.getTime() < now.getTime()) {
    return { active: false, availableSeats: 0, totalSeats: route.seats, reason: 'past' };
  }

  const occupiedSeats = getConfirmedSeatCount(rideMatches, offerId, offerType, route.churchId, rideDate);
  const availableSeats = Math.max(0, route.seats - occupiedSeats);
  return {
    active: availableSeats > 0,
    availableSeats,
    totalSeats: route.seats,
    reason: availableSeats > 0 ? undefined : 'full',
  };
}

export function getFutureRouteOccurrences({
  route,
  routes,
  trips,
  rideMatches,
  now,
  limit = 5,
}: {
  route: Route;
  routes: Route[];
  trips: Trip[];
  rideMatches: RideMatch[];
  now: Date;
  limit?: number;
}): RouteOccurrenceOption[] {
  if (route.status !== 'active' || limit < 1) return [];

  const occurrences: RouteOccurrenceOption[] = [];
  for (let offset = 0; offset < 370 && occurrences.length < limit; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!route.recurrence.daysOfWeek.includes(candidate.getDay())) continue;

    const date = toLocalDateValue(candidate);
    const departure = getLocalDeparture(date, route.recurrence.typicalDepartureTime);
    if (!departure || departure.getTime() < now.getTime()) continue;

    const availability = getOfferAvailability({
      offerId: route.id,
      offerType: 'regularRoute',
      rideDate: date,
      routes,
      trips,
      rideMatches,
      now,
    });
    if (availability.reason && availability.reason !== 'full') continue;

    occurrences.push({
      date,
      label:
        availability.availableSeats > 0
          ? `${formatDate(date)} — свободно ${formatSeatCount(availability.availableSeats)}`
          : `${formatDate(date)} — мест больше нет`,
      availableSeats: availability.availableSeats,
      totalSeats: availability.totalSeats,
      disabled: availability.availableSeats === 0,
    });
  }

  return occurrences;
}

export function getOverCapacityRequestWarning(
  availableSeats: number | undefined,
  requestedPassengerCount: number,
) {
  if (
    availableSeats === undefined ||
    availableSeats < 1 ||
    !Number.isInteger(requestedPassengerCount) ||
    requestedPassengerCount <= availableSeats
  ) {
    return undefined;
  }

  return `Сейчас у водителя свободно ${formatSeatCount(availableSeats)}, а вам нужно ${requestedPassengerCount}. Можно отправить запрос: водитель сможет предложить часть мест или отклонить просьбу.`;
}

export function getEffectiveTrips(trips: Trip[], rideMatches: RideMatch[], now: Date) {
  return trips.map((trip) => {
    const availability = getOfferAvailability({
      offerId: trip.id,
      offerType: 'oneTimeTrip',
      rideDate: trip.date,
      routes: [],
      trips,
      rideMatches,
      now,
    });
    return {
      ...trip,
      seatsAvailable: availability.availableSeats,
      status: trip.status === 'open' && availability.reason === 'full' ? ('full' as const) : trip.status,
    };
  });
}

export function getCompatiblePassengerRequests({
  churchId,
  offerId,
  offerType,
  rideDate,
  serviceEventId,
  passengerRequests,
  targetedRequests,
}: {
  churchId: string;
  offerId: string;
  offerType: PublicDriverOfferType;
  rideDate: string;
  serviceEventId?: string;
  passengerRequests: PassengerRequest[];
  targetedRequests: TargetedPassengerRequest[];
}): CompatiblePassengerRequestSummary[] {
  if (!isLocalDate(rideDate)) return [];

  return passengerRequests.flatMap((request): CompatiblePassengerRequestSummary[] => {
    const sameServiceOrDate =
      request.serviceDate === rideDate ||
      Boolean(serviceEventId && request.serviceEventId === serviceEventId);
    const alreadySent = targetedRequests.some(
      (targetedRequest) =>
        targetedRequest.sourcePassengerRequestId === request.id &&
        targetedRequest.targetOfferId === offerId &&
        targetedRequest.targetOfferType === offerType &&
        targetedRequest.rideDate === rideDate,
    );

    if (
      request.churchId !== churchId ||
      request.status !== 'open' ||
      request.publicVisible !== true ||
      request.passengerCount < 1 ||
      !sameServiceOrDate ||
      alreadySent
    ) {
      return [];
    }

    return [{
      requestId: request.id,
      serviceEvent: request.serviceEvent,
      serviceDate: request.serviceDate ?? rideDate,
      remainingPassengerCount: request.passengerCount,
      pickupArea: request.pickupZone.label,
      safePublicComment: request.safePublicComment,
    }];
  });
}

export function createTargetedRequestFromPassengerRequest({
  source,
  id,
  driverId,
  driverName,
  offerId,
  offerType,
  offerContext,
  rideDate,
  serviceEventId,
  createdAt,
}: {
  source: PassengerRequest;
  id: string;
  driverId: string;
  driverName: string;
  offerId: string;
  offerType: PublicDriverOfferType;
  offerContext: string;
  rideDate: string;
  serviceEventId?: string;
  createdAt: string;
}): TargetedPassengerRequest | null {
  const compatibleService =
    source.serviceDate === rideDate ||
    Boolean(serviceEventId && source.serviceEventId === serviceEventId);
  if (
    source.status !== 'open' ||
    source.publicVisible !== true ||
    source.passengerCount < 1 ||
    !compatibleService ||
    !isLocalDate(rideDate) ||
    !isIsoTimestamp(createdAt)
  ) {
    return null;
  }

  return {
    id,
    churchId: source.churchId,
    driverId,
    driverName,
    targetOfferId: offerId,
    targetOfferType: offerType,
    offerContext,
    rideDate,
    serviceEvent: source.serviceEvent,
    serviceEventId: source.serviceEventId ?? serviceEventId,
    firstName: source.firstName,
    phonePrivate: source.phonePrivate,
    emailPrivate: source.emailPrivate,
    passengerCount: source.passengerCount,
    pickupZone: { label: source.pickupZone.label },
    privateComment: source.safePublicComment,
    consentToShareContact: true,
    status: 'waitingForDriver',
    publicVisible: false,
    createdAt,
    updatedAt: createdAt,
    sourcePassengerRequestId: source.id,
  };
}

export function getCompatibleOwnedOffers({
  request,
  routes,
  trips,
  rideMatches,
  localDriverProfile,
  now,
}: {
  request: PassengerRequest;
  routes: Route[];
  trips: Trip[];
  rideMatches: RideMatch[];
  localDriverProfile: LocalDriverProfile | null;
  now: Date;
}): CompatibleDriverOffer[] {
  if (!localDriverProfile || request.status !== 'open' || !request.serviceDate) {
    return [];
  }

  const ownedTrips = trips.filter(
    (trip) =>
      trip.driverId === localDriverProfile.driverId &&
      trip.churchId === request.churchId &&
      trip.date === request.serviceDate,
  );
  const ownedRoutes = routes.filter(
    (route) =>
      route.driverId === localDriverProfile.driverId &&
      route.churchId === request.churchId &&
      routeIncludesDate(route, request.serviceDate as string),
  );

  return [
    ...ownedTrips.map((trip): CompatibleDriverOffer | null => {
      const availability = getOfferAvailability({
        offerId: trip.id,
        offerType: 'oneTimeTrip',
        rideDate: trip.date,
        routes,
        trips,
        rideMatches,
        now,
      });
      return availability.active
        ? {
            driverId: trip.driverId,
            offerId: trip.id,
            offerType: 'oneTimeTrip',
            rideDate: trip.date,
            label: `${formatDateTime(trip.date, trip.departureTime)}, выезд из ${trip.originLabel}`,
            availableSeats: availability.availableSeats,
            totalSeats: availability.totalSeats,
          }
        : null;
    }),
    ...ownedRoutes.map((route): CompatibleDriverOffer | null => {
      const rideDate = request.serviceDate as string;
      const availability = getOfferAvailability({
        offerId: route.id,
        offerType: 'regularRoute',
        rideDate,
        routes,
        trips,
        rideMatches,
        now,
      });
      return availability.active
        ? {
            driverId: route.driverId,
            offerId: route.id,
            offerType: 'regularRoute',
            rideDate,
            label: `${formatDate(rideDate)} в ${route.recurrence.typicalDepartureTime}, выезд из ${route.originLabel}`,
            availableSeats: availability.availableSeats,
            totalSeats: availability.totalSeats,
          }
        : null;
    }),
  ].filter((offer): offer is CompatibleDriverOffer => offer !== null);
}

const privateDetourValues = ['', '0', '2', '5', '10', '15', '20'];

export function validatePrivateDriverOfferDraft({
  draft,
  request,
  requireProfile,
  now,
}: {
  draft: PrivateDriverOfferDraft;
  request: PassengerRequest;
  requireProfile: boolean;
  now: Date;
}) {
  const errors: PrivateDriverOfferDraftErrors = {};
  const offeredPassengerCount = Number(draft.offeredPassengerCount);
  const normalizedPhone = normalizePhone(draft.phone);

  if (requireProfile) {
    if (!draft.publicName.trim()) errors.publicName = 'Введите имя.';
    if (!isInternationalPhoneValid(draft.phone)) {
      errors.phone = 'Введите номер в международном формате, например +39 333 123 4567.';
    }
    if (!isOptionalEmailValid(draft.email)) {
      errors.email = 'Введите корректный email, например name@example.com.';
    }
  }
  if (!draft.originLabel.trim()) errors.originLabel = 'Укажите, откуда вы едете.';
  if (!isLocalTime(draft.departureTime)) {
    errors.departureTime = 'Укажите время выезда.';
  } else if (
    !request.serviceDate ||
    (getLocalDeparture(request.serviceDate, draft.departureTime)?.getTime() ?? 0) < now.getTime()
  ) {
    errors.departureTime = 'Время выезда уже прошло.';
  }
  if (
    !Number.isInteger(offeredPassengerCount) ||
    offeredPassengerCount < 1 ||
    offeredPassengerCount > request.passengerCount
  ) {
    errors.offeredPassengerCount = `Укажите от 1 до ${request.passengerCount} мест.`;
  }
  if (!privateDetourValues.includes(draft.maxDetourKm)) {
    errors.maxDetourKm = 'Выберите допустимое отклонение от маршрута.';
  }
  if (!draft.consent) {
    errors.consent = 'Нужно подтвердить согласие на передачу контакта пассажиру.';
  }

  return { errors, offeredPassengerCount, normalizedPhone };
}

export function createPrivateDriverResponse({
  request,
  draft,
  driverId,
  id,
  createdAt,
  requireProfile,
  now,
}: {
  request: PassengerRequest;
  draft: PrivateDriverOfferDraft;
  driverId: string;
  id: string;
  createdAt: string;
  requireProfile: boolean;
  now: Date;
}): DriverResponse | null {
  const validation = validatePrivateDriverOfferDraft({ draft, request, requireProfile, now });
  if (
    request.status !== 'open' ||
    !request.serviceDate ||
    Object.keys(validation.errors).length > 0 ||
    !isIsoTimestamp(createdAt)
  ) {
    return null;
  }

  return {
    id,
    driverId,
    passengerRequestId: request.id,
    driverOfferId: id,
    driverOfferType: 'privateDriverOffer',
    rideDate: request.serviceDate,
    offeredPassengerCount: validation.offeredPassengerCount,
    status: 'pendingPassengerConfirmation',
    createdAt,
    updatedAt: createdAt,
    privateOffer: {
      originLabel: draft.originLabel.trim(),
      departureTime: draft.departureTime,
      maxDetourKm: draft.maxDetourKm ? Number(draft.maxDetourKm) : undefined,
    },
  };
}

export function createPendingDriverResponse({
  request,
  offer,
  offeredPassengerCount,
  id,
  createdAt,
}: {
  request: PassengerRequest;
  offer: CompatibleDriverOffer;
  offeredPassengerCount: number;
  id: string;
  createdAt: string;
}): DriverResponse | null {
  const maxOffer = Math.min(request.passengerCount, offer.availableSeats);
  if (
    request.status !== 'open' ||
    !Number.isInteger(offeredPassengerCount) ||
    offeredPassengerCount < 1 ||
    offeredPassengerCount > maxOffer
  ) {
    return null;
  }

  return {
    id,
    driverId: offer.driverId,
    passengerRequestId: request.id,
    driverOfferId: offer.offerId,
    driverOfferType: offer.offerType,
    rideDate: offer.rideDate,
    offeredPassengerCount,
    status: 'pendingPassengerConfirmation',
    createdAt,
    updatedAt: createdAt,
  };
}

export function cancelDriverResponse(response: DriverResponse, cancelledAt: string): DriverResponse {
  return response.status === 'pendingPassengerConfirmation'
    ? { ...response, status: 'cancelled', cancelledAt, updatedAt: cancelledAt }
    : response;
}

export function declineDriverResponse(response: DriverResponse, declinedAt: string): DriverResponse {
  return response.status === 'pendingPassengerConfirmation'
    ? { ...response, status: 'declined', updatedAt: declinedAt }
    : response;
}

export function offerPartialTargetedRequest(
  request: TargetedPassengerRequest,
  offeredPassengerCount: number,
  updatedAt: string,
) {
  if (
    request.status !== 'waitingForDriver' ||
    !Number.isInteger(offeredPassengerCount) ||
    offeredPassengerCount < 1 ||
    offeredPassengerCount >= request.passengerCount
  ) {
    return null;
  }

  return {
    ...request,
    offeredPassengerCount,
    status: 'pendingPassengerConfirmation' as const,
    updatedAt,
  };
}

export function declineTargetedRequest(request: TargetedPassengerRequest, updatedAt: string) {
  return request.status === 'waitingForDriver' || request.status === 'pendingPassengerConfirmation'
    ? { ...request, status: 'declined' as const, updatedAt }
    : request;
}

type ConfirmRideMatchInput = {
  source: 'targetedRequest' | 'driverResponse';
  sourceId: string;
  confirmedPassengerCount: number;
  matchId: string;
  timestamp: string;
  driverName: string;
  driverContact: PrivateContact | null;
  state: RideWorkflowState;
  routes: Route[];
  trips: Trip[];
  now: Date;
};

export type ConfirmRideMatchResult =
  | { ok: true; state: RideWorkflowState; rideMatch: RideMatch }
  | {
      ok: false;
      reason:
        | 'notPending'
        | 'alreadyConfirmed'
        | 'invalidCount'
        | 'driverContactUnavailable'
        | 'insufficientSeats';
    };

export function confirmRideMatch(input: ConfirmRideMatchInput): ConfirmRideMatchResult {
  const { state } = input;
  let passengerRequestId = '';
  let targetedPassengerRequestId: string | undefined;
  let driverResponseId: string | undefined;
  let driverId = '';
  let driverOfferId = '';
  let driverOfferType: DriverOfferType = 'oneTimeTrip';
  let rideDate = '';
  let passengerName = '';
  let originalPassengerCount = 0;
  let passengerContact: PrivateContact | null = null;
  let driverOfferDepartureTime: string | undefined;

  if (input.source === 'targetedRequest') {
    const request = state.targetedRequests.find((item) => item.id === input.sourceId);
    if (!request || !request.rideDate || (request.status !== 'waitingForDriver' && request.status !== 'pendingPassengerConfirmation')) {
      return { ok: false, reason: 'notPending' };
    }
    const requiredCount =
      request.status === 'pendingPassengerConfirmation'
        ? request.offeredPassengerCount
        : request.passengerCount;
    if (input.confirmedPassengerCount !== requiredCount) {
      return { ok: false, reason: 'invalidCount' };
    }
    const sourceRequest = request.sourcePassengerRequestId
      ? state.passengerRequests.find((item) => item.id === request.sourcePassengerRequestId)
      : undefined;
    if (
      request.sourcePassengerRequestId &&
      (!sourceRequest || sourceRequest.status !== 'open' || sourceRequest.publicVisible !== true)
    ) {
      return { ok: false, reason: 'notPending' };
    }
    passengerRequestId = sourceRequest?.id ?? request.id;
    targetedPassengerRequestId = request.id;
    driverId = request.driverId;
    driverOfferId = request.targetOfferId;
    driverOfferType = request.targetOfferType;
    rideDate = request.rideDate;
    passengerName = sourceRequest?.firstName ?? request.firstName;
    originalPassengerCount = sourceRequest?.passengerCount ?? request.passengerCount;
    passengerContact = sourceRequest
      ? { phone: sourceRequest.phonePrivate, email: sourceRequest.emailPrivate }
      : { phone: request.phonePrivate, email: request.emailPrivate };
  } else {
    const response = state.driverResponses.find((item) => item.id === input.sourceId);
    const request = response
      ? state.passengerRequests.find((item) => item.id === response.passengerRequestId)
      : undefined;
    if (!response || response.status !== 'pendingPassengerConfirmation' || !request || request.status !== 'open') {
      return { ok: false, reason: 'notPending' };
    }
    if (input.confirmedPassengerCount !== response.offeredPassengerCount) {
      return { ok: false, reason: 'invalidCount' };
    }
    passengerRequestId = request.id;
    driverResponseId = response.id;
    driverId = response.driverId;
    driverOfferId = response.driverOfferId;
    driverOfferType = response.driverOfferType;
    rideDate = response.rideDate;
    passengerName = request.firstName;
    originalPassengerCount = request.passengerCount;
    passengerContact = { phone: request.phonePrivate, email: request.emailPrivate };
    driverOfferDepartureTime = response.privateOffer?.departureTime;
  }

  if (state.rideMatches.some((match) => match.passengerRequestId === passengerRequestId)) {
    return { ok: false, reason: 'alreadyConfirmed' };
  }
  if (
    !Number.isInteger(input.confirmedPassengerCount) ||
    input.confirmedPassengerCount < 1 ||
    input.confirmedPassengerCount > originalPassengerCount
  ) {
    return { ok: false, reason: 'invalidCount' };
  }
  if (!input.driverContact) {
    return { ok: false, reason: 'driverContactUnavailable' };
  }

  if (driverOfferType === 'privateDriverOffer') {
    const departure = driverOfferDepartureTime
      ? getLocalDeparture(rideDate, driverOfferDepartureTime)
      : null;
    if (!departure || departure.getTime() < input.now.getTime()) {
      return { ok: false, reason: 'insufficientSeats' };
    }
  } else {
    const availability = getOfferAvailability({
      offerId: driverOfferId,
      offerType: driverOfferType,
      rideDate,
      routes: input.routes,
      trips: input.trips,
      rideMatches: state.rideMatches,
      now: input.now,
    });
    if (!availability.active || availability.availableSeats < input.confirmedPassengerCount) {
      return { ok: false, reason: 'insufficientSeats' };
    }
  }

  const rideMatch: RideMatch = {
    id: input.matchId,
    churchId:
      input.source === 'targetedRequest'
        ? state.targetedRequests.find((request) => request.id === input.sourceId)?.churchId ?? ''
        : state.passengerRequests.find((request) => request.id === passengerRequestId)?.churchId ?? '',
    passengerRequestId,
    targetedPassengerRequestId,
    driverResponseId,
    driverId,
    driverOfferId,
    driverOfferType,
    rideDate,
    originalPassengerCount,
    confirmedPassengerCount: input.confirmedPassengerCount,
    status: 'confirmed',
    passengerName,
    driverName: input.driverName,
    passengerContactPrivate: passengerContact,
    driverContactPrivate: input.driverContact,
    confirmedAt: input.timestamp,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    driverOfferDepartureTime,
  };

  const nextState: RideWorkflowState = {
    passengerRequests: state.passengerRequests.map((request) =>
      request.id === passengerRequestId
        ? {
            ...request,
            status:
              input.confirmedPassengerCount < request.passengerCount
                ? 'partiallyMatched'
                : 'matched',
            publicVisible: false,
            updatedAt: input.timestamp,
          }
        : request,
    ),
    targetedRequests: state.targetedRequests.map((request) => {
      if (request.id === targetedPassengerRequestId) {
        return { ...request, status: 'matched' as const, updatedAt: input.timestamp };
      }
      if (
        passengerRequestId !== targetedPassengerRequestId &&
        request.sourcePassengerRequestId === passengerRequestId &&
        (request.status === 'waitingForDriver' || request.status === 'pendingPassengerConfirmation')
      ) {
        return { ...request, status: 'expired' as const, updatedAt: input.timestamp };
      }
      return request;
    }),
    driverResponses: state.driverResponses.map((response) => {
      if (response.id === driverResponseId) {
        return { ...response, status: 'accepted', updatedAt: input.timestamp };
      }
      if (
        response.passengerRequestId === passengerRequestId &&
        response.status === 'pendingPassengerConfirmation'
      ) {
        return { ...response, status: 'expired', updatedAt: input.timestamp };
      }
      return response;
    }),
    rideMatches: [rideMatch, ...state.rideMatches],
  };

  return { ok: true, state: nextState, rideMatch };
}

export function cancelRideMatch(state: RideWorkflowState, matchId: string, cancelledAt: string) {
  const rideMatch = state.rideMatches.find((match) => match.id === matchId);
  if (!rideMatch || rideMatch.status !== 'confirmed') {
    return state;
  }

  return {
    ...state,
    targetedRequests: state.targetedRequests.map((request) =>
      request.id === rideMatch.targetedPassengerRequestId
        ? { ...request, status: 'cancelled' as const, updatedAt: cancelledAt }
        : request,
    ),
    rideMatches: state.rideMatches.map((match) =>
      match.id === matchId
        ? { ...match, status: 'cancelled' as const, cancelledAt, updatedAt: cancelledAt }
        : match,
    ),
  };
}

export function cancelFutureMatchesForOffer(
  state: RideWorkflowState,
  offerId: string,
  offerType: DriverOfferType,
  routes: Route[],
  trips: Trip[],
  now: Date,
  cancelledAt: string,
) {
  return getFutureConfirmedMatchesForOffer(state.rideMatches, offerId, offerType, routes, trips, now)
    .reduce((current, match) => cancelRideMatch(current, match.id, cancelledAt), state);
}

function getRideMatchDeparture(match: RideMatch, routes: Route[], trips: Trip[]) {
  const departureTime = match.driverOfferType === 'oneTimeTrip'
    ? trips.find((trip) => trip.id === match.driverOfferId)?.departureTime
    : match.driverOfferType === 'regularRoute'
      ? routes.find((route) => route.id === match.driverOfferId)?.recurrence.typicalDepartureTime
      : match.driverOfferDepartureTime;
  return departureTime ? getLocalDeparture(match.rideDate, departureTime) : null;
}

export function getFutureConfirmedMatchesForOffer(
  rideMatches: RideMatch[],
  offerId: string,
  offerType: DriverOfferType,
  routes: Route[],
  trips: Trip[],
  now: Date,
) {
  return rideMatches.filter((match) => {
    const departure = getRideMatchDeparture(match, routes, trips);
    return match.driverOfferId === offerId &&
      match.driverOfferType === offerType &&
      match.status === 'confirmed' &&
      departure !== null &&
      departure.getTime() >= now.getTime();
  });
}

type RequestSource = PassengerRequest | TargetedPassengerRequest;

function isTargetedRequestSource(source: RequestSource): source is TargetedPassengerRequest {
  return 'targetOfferId' in source;
}

export function canDirectlyRepublish({
  source,
  match,
  routes,
  trips,
  services = [],
  now,
}: {
  source: RequestSource;
  match: RideMatch;
  routes: Route[];
  trips: Trip[];
  services?: ChurchService[];
  now: Date;
}) {
  const date = isTargetedRequestSource(source) ? source.rideDate : source.serviceDate;
  if (!date) {
    return false;
  }

  const offerDepartureTime = match.driverOfferType === 'oneTimeTrip'
    ? trips.find((trip) => trip.id === match.driverOfferId)?.departureTime
    : match.driverOfferType === 'regularRoute'
      ? routes.find((route) => route.id === match.driverOfferId)?.recurrence.typicalDepartureTime
      : match.driverOfferDepartureTime;
  const serviceStartTime = source.serviceEventId
    ? services.find((service) => service.id === source.serviceEventId && service.date === date)?.startTime
    : undefined;
  const boundaryTime = isLocalTime(offerDepartureTime)
    ? offerDepartureTime
    : isLocalTime(serviceStartTime)
      ? serviceStartTime
      : undefined;

  if (!boundaryTime) {
    return isRideDateCurrent(date, now);
  }

  const boundary = getLocalDeparture(date, boundaryTime);
  return boundary !== null && now.getTime() < boundary.getTime();
}

export function republishPassengerRequest(
  source: RequestSource,
  passengerCount: number,
  id: string,
  createdAt: string,
): PassengerRequest | null {
  const targetedSource = isTargetedRequestSource(source);
  const serviceDate = targetedSource ? source.rideDate : source.serviceDate;
  if (!serviceDate || !Number.isInteger(passengerCount) || passengerCount < 1) {
    return null;
  }

  return {
    id,
    churchId: source.churchId,
    firstName: source.firstName,
    phonePrivate: source.phonePrivate,
    emailPrivate: source.emailPrivate,
    serviceEvent: source.serviceEvent,
    serviceEventId: source.serviceEventId,
    serviceDate,
    passengerCount,
    pickupZone: { label: source.pickupZone.label },
    safePublicComment: targetedSource ? source.privateComment : source.safePublicComment,
    consentToShareContact: source.consentToShareContact,
    status: 'open',
    publicVisible: true,
    createdAt,
    updatedAt: createdAt,
    sourcePassengerRequestId: source.id,
  };
}

export function markRemainingNeedHandled(match: RideMatch, updatedAt: string) {
  return { ...match, remainingNeedHandledAt: updatedAt, updatedAt };
}

function getDriverName(driverNames: Record<string, string>, driverId: string) {
  return driverNames[driverId] ?? 'водителя';
}

function getRootPassengerRequest(
  request: PassengerRequest,
  requestsById: Map<string, PassengerRequest>,
) {
  let current = request;
  const seen = new Set([request.id]);

  while (current.sourcePassengerRequestId && !seen.has(current.sourcePassengerRequestId)) {
    const source = requestsById.get(current.sourcePassengerRequestId);
    if (!source) break;
    current = source;
    seen.add(source.id);
  }

  return current;
}

export function getPublicPassengerRequestItems({
  churchId,
  passengerRequests,
  rideMatches,
}: {
  churchId: string;
  passengerRequests: PassengerRequest[];
  rideMatches: RideMatch[];
}): PublicPassengerRequestItem[] {
  const requestsById = new Map(passengerRequests.map((request) => [request.id, request]));
  const successfulMatches = rideMatches.filter(
    (match) =>
      match.churchId === churchId &&
      (match.status === 'confirmed' || match.status === 'completed'),
  );
  const activeByRoot = new Map<string, PassengerRequest>();

  passengerRequests
    .filter(
      (request) =>
        request.churchId === churchId &&
        request.status === 'open' &&
        request.publicVisible === true,
    )
    .forEach((request) => {
      const root = getRootPassengerRequest(request, requestsById);
      if (!activeByRoot.has(root.id)) {
        activeByRoot.set(root.id, request);
      }
    });

  return [...activeByRoot.entries()].map(([rootRequestId, request]) => {
    const root = requestsById.get(rootRequestId) ?? request;
    const confirmedCount = successfulMatches.reduce((total, match) => {
      const matchedRequest = requestsById.get(match.passengerRequestId);
      if (!matchedRequest || getRootPassengerRequest(matchedRequest, requestsById).id !== rootRequestId) {
        return total;
      }
      return total + match.confirmedPassengerCount;
    }, 0);
    const partial = request.id !== root.id || confirmedCount > 0 || request.passengerCount < root.passengerCount;

    return {
      id: request.id,
      firstName: request.firstName,
      serviceEvent: request.serviceEvent,
      pickupArea: request.pickupZone.label,
      safePublicComment: request.safePublicComment,
      rootRequestId,
      originalPassengerCount: root.passengerCount,
      remainingPassengerCount: request.passengerCount,
      partial,
      countLabel: partial
        ? `Нужно ещё ${formatSeatCount(request.passengerCount)} из первоначальных ${root.passengerCount}`
        : formatPassengerCount(request.passengerCount),
      statusLabel: partial ? 'Часть группы уже едет' : 'Ищет поездку',
    };
  });
}

export function getCompletedActivitySummaries({
  churchId,
  passengerRequests,
  rideMatches,
  routes,
  trips,
  driverNames,
  now,
  limit = 5,
}: {
  churchId: string;
  passengerRequests: PassengerRequest[];
  rideMatches: RideMatch[];
  routes: Route[];
  trips: Trip[];
  driverNames: Record<string, string>;
  now: Date;
  limit?: number;
}): CompletedActivitySummary[] {
  const requestsById = new Map(passengerRequests.map((request) => [request.id, request]));
  const successfulMatches = rideMatches.filter(
    (match) =>
      match.churchId === churchId &&
      (match.status === 'confirmed' || match.status === 'completed') &&
      (getRideMatchDeparture(match, routes, trips)?.getTime() ?? 0) >= now.getTime(),
  );
  const activeRequestRoots = new Set(
    getPublicPassengerRequestItems({ churchId, passengerRequests, rideMatches }).map(
      (item) => item.rootRequestId,
    ),
  );
  const requestMatchesByRoot = new Map<string, RideMatch[]>();

  successfulMatches.forEach((match) => {
    const request = requestsById.get(match.passengerRequestId);
    if (!request) return;
    const rootRequestId = getRootPassengerRequest(request, requestsById).id;
    requestMatchesByRoot.set(rootRequestId, [
      ...(requestMatchesByRoot.get(rootRequestId) ?? []),
      match,
    ]);
  });

  const requestSummaries = [...requestMatchesByRoot.entries()].flatMap(
    ([rootRequestId, matches]): CompletedActivitySummary[] => {
      const rootRequest = requestsById.get(rootRequestId);
      if (!rootRequest || activeRequestRoots.has(rootRequestId)) return [];

      const confirmedCount = matches.reduce(
        (total, match) => total + match.confirmedPassengerCount,
        0,
      );
      const resolved =
        confirmedCount >= rootRequest.passengerCount ||
        matches.some((match) => Boolean(match.remainingNeedHandledAt));
      if (!resolved) return [];

      return [{
        id: `request-${rootRequestId}`,
        kind: 'passengerRequest',
        section: 'passengerRequests',
        message: formatAgreementCount(confirmedCount, rootRequest.passengerCount),
        detail: `${rootRequest.firstName} · ${rootRequest.serviceEvent}`,
        occurredAt: matches.map((match) => match.confirmedAt).sort().at(-1) ?? rootRequest.createdAt,
      }];
    },
  );

  const tripSummaries = trips.flatMap((trip): CompletedActivitySummary[] => {
    if (trip.churchId !== churchId || !isRideDateCurrent(trip.date, now)) {
      return [];
    }
    const availability = getOfferAvailability({
      offerId: trip.id,
      offerType: 'oneTimeTrip',
      rideDate: trip.date,
      routes,
      trips,
      rideMatches,
      now,
    });
    if (availability.reason !== 'full') {
      return [];
    }
    const relatedMatches = successfulMatches.filter((match) => match.driverOfferId === trip.id);
    const occurredAt = relatedMatches.map((match) => match.confirmedAt).sort().at(-1) ?? trip.date;
    return [{
      id: `full-trip-${trip.id}`,
      kind: 'fullTrip',
      section: 'oneTimeTrips',
      message: 'Свободных мест не осталось',
      detail: `${formatDateTime(trip.date, trip.departureTime)} · ${trip.originLabel} · Водитель: ${getDriverName(driverNames, trip.driverId)}`,
      occurredAt,
      offerTypeLabel: 'Разовая поездка',
    }];
  });

  const routeOccurrences = new Map<string, RideMatch[]>();
  successfulMatches
    .filter((match) => match.driverOfferType === 'regularRoute')
    .forEach((match) => {
      const key = `${match.driverOfferId}:${match.rideDate}`;
      routeOccurrences.set(key, [...(routeOccurrences.get(key) ?? []), match]);
    });
  const routeSummaries = [...routeOccurrences.entries()].flatMap(([key, matches]): CompletedActivitySummary[] => {
    const [routeId, rideDate] = key.split(':');
    const route = routes.find((item) => item.id === routeId && item.churchId === churchId);
    if (!route) {
      return [];
    }
    const occupiedSeats = matches.reduce(
      (total, match) => total + match.confirmedPassengerCount,
      0,
    );
    const full = occupiedSeats >= route.seats;
    return [{
      id: `route-occurrence-${key}`,
      kind: full ? 'fullRouteOccurrence' : 'partialRouteOccurrence',
      section: 'regularRouteOccurrences',
      message: full
        ? `Все ${formatSeatCount(route.seats)} заняты`
        : formatOccupiedOfTotal(occupiedSeats, route.seats),
      detail: `Дата поездки: ${formatDate(rideDate)} · ${route.originLabel} · Водитель: ${getDriverName(driverNames, route.driverId)}`,
      occurredAt: matches.map((match) => match.confirmedAt).sort().at(-1) ?? rideDate,
      badge: full ? undefined : 'Часть мест занята',
      offerTypeLabel: 'Регулярная поездка',
    }];
  });

  return [...requestSummaries, ...tripSummaries, ...routeSummaries]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);
}
