import {
  EMAIL_VALIDATION_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
} from './passengerRequestValidation';
import { isOneTimeTripAvailable } from './tripVisibility';
import { resolveServiceSelection, validateServiceSelection } from './serviceOptions';
import type {
  ChurchService,
  DriverPublicProfile,
  LocalDriverProfile,
  Route,
  Trip,
} from './types';

export type DriverOfferMode = 'trip' | 'route';

export const maxDetourKmValues = [0, 2, 5, 10, 15, 20] as const;

export type DriverOfferDraft = {
  offerType: DriverOfferMode;
  publicName: string;
  phone: string;
  email: string;
  originLabel: string;
  maxDetourKm: string;
  seats: string;
  returnTrip: boolean;
  selectedServiceId: string;
  date: string;
  departureTime: string;
  weekdays: number[];
};

export type DriverOfferDraftErrors = Partial<Record<keyof DriverOfferDraft, string>>;

export function createEmptyDriverOfferDraft(offerType: DriverOfferMode = 'trip'): DriverOfferDraft {
  return {
    offerType,
    publicName: '',
    phone: '',
    email: '',
    originLabel: '',
    maxDetourKm: '',
    seats: '1',
    returnTrip: false,
    selectedServiceId: '',
    date: '',
    departureTime: '',
    weekdays: [],
  };
}

export function clearDriverOfferDraftFieldError(
  errors: DriverOfferDraftErrors,
  fieldName: keyof DriverOfferDraft,
) {
  if (!errors[fieldName]) {
    return errors;
  }

  const remainingErrors = { ...errors };
  delete remainingErrors[fieldName];
  return remainingErrors;
}

function getLocalDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? { date, year, month, day }
    : null;
}

function isLocalDate(value: unknown): value is string {
  return typeof value === 'string' && getLocalDateParts(value) !== null;
}

function isLocalTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

export function resolveDriverOfferDate(draft: DriverOfferDraft, services: ChurchService[] = []) {
  return resolveServiceSelection(draft, services).date;
}

export function validateDriverOfferDraft(
  draft: DriverOfferDraft,
  requireProfile: boolean,
  now: Date,
  services: ChurchService[] = [],
) {
  const errors: DriverOfferDraftErrors = {};
  const seats = Number(draft.seats);

  if (requireProfile) {
    if (!draft.publicName.trim()) {
      errors.publicName = 'Введите имя.';
    }

    if (!isInternationalPhoneValid(draft.phone)) {
      errors.phone = PHONE_VALIDATION_MESSAGE;
    }

    if (!isOptionalEmailValid(draft.email)) {
      errors.email = EMAIL_VALIDATION_MESSAGE;
    }
  }

  if (!draft.originLabel.trim()) {
    errors.originLabel = 'Укажите, откуда вы едете.';
  }

  if (!maxDetourKmValues.some((value) => String(value) === draft.maxDetourKm)) {
    errors.maxDetourKm = 'Выберите максимальное отклонение от маршрута.';
  }

  if (!Number.isInteger(seats) || seats < 1 || seats > 55) {
    errors.seats = 'Выберите количество свободных мест.';
  }

  if (draft.offerType === 'trip') {
    const serviceErrors = validateServiceSelection(draft, services, now);
    Object.assign(errors, serviceErrors);

    if (!draft.departureTime) {
      errors.departureTime = 'Укажите примерное время выезда.';
    }

    const tripDate = resolveDriverOfferDate(draft, services);
    if (
      !errors.selectedServiceId &&
      !errors.date &&
      tripDate &&
      draft.departureTime &&
      Number.isInteger(seats) &&
      seats >= 1 &&
      seats <= 55 &&
      !isOneTimeTripAvailable(
        { date: tripDate, departureTime: draft.departureTime, seatsAvailable: seats, status: 'open' },
        now,
      )
    ) {
      errors.date = 'Дата и время выезда уже прошли.';
    }
  } else {
    if (draft.weekdays.length === 0) {
      errors.weekdays = 'Выберите хотя бы один день недели.';
    }

    if (!draft.departureTime) {
      errors.departureTime = 'Укажите обычное время выезда.';
    }
  }

  return { errors, normalizedPhone: normalizePhone(draft.phone), seats };
}

export function validateDriverOfferField(
  draft: DriverOfferDraft,
  fieldName: keyof DriverOfferDraft,
  requireProfile: boolean,
  now: Date,
  services: ChurchService[] = [],
) {
  const { errors } = validateDriverOfferDraft(draft, requireProfile, now, services);

  if (fieldName === 'date' || fieldName === 'selectedServiceId') {
    return errors.date ?? errors.selectedServiceId;
  }

  return errors[fieldName];
}

export function createLocalDriverProfile(
  draft: DriverOfferDraft,
  ownerId: string,
  driverId: string,
): LocalDriverProfile {
  return {
    ownerId,
    driverId,
    publicName: draft.publicName.trim(),
    phonePrivate: normalizePhone(draft.phone),
    emailPrivate: draft.email.trim() || undefined,
  };
}

export function isLocalDriverProfile(value: unknown): value is LocalDriverProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const profile = value as Partial<LocalDriverProfile>;
  return (
    typeof profile.ownerId === 'string' &&
    Boolean(profile.ownerId) &&
    typeof profile.driverId === 'string' &&
    Boolean(profile.driverId) &&
    typeof profile.publicName === 'string' &&
    Boolean(profile.publicName.trim()) &&
    typeof profile.phonePrivate === 'string' &&
    isInternationalPhoneValid(profile.phonePrivate) &&
    (profile.emailPrivate === undefined ||
      (typeof profile.emailPrivate === 'string' && isOptionalEmailValid(profile.emailPrivate)))
  );
}

export function toDriverPublicProfile(
  profile: LocalDriverProfile,
  visibleChurchIds: string[],
  originLabel: string,
): DriverPublicProfile {
  return {
    id: profile.driverId,
    publicName: profile.publicName,
    departureArea: originLabel,
    visibleChurchIds,
  };
}

export function createLocalTrip(
  draft: DriverOfferDraft,
  churchId: string,
  driverId: string,
  tripId: string,
  services: ChurchService[] = [],
): Trip {
  const seats = Number(draft.seats);
  return {
    id: tripId,
    churchId,
    driverId,
    date: resolveDriverOfferDate(draft, services),
    departureTime: draft.departureTime,
    originLabel: draft.originLabel.trim(),
    maxDetourKm: Number(draft.maxDetourKm),
    seatsTotal: seats,
    seatsAvailable: seats,
    returnTrip: draft.returnTrip,
    status: 'open',
    serviceEventId: draft.selectedServiceId || undefined,
  };
}

export function createLocalRoute(
  draft: DriverOfferDraft,
  churchId: string,
  driverId: string,
  routeId: string,
): Route {
  return {
    id: routeId,
    churchId,
    driverId,
    originLabel: draft.originLabel.trim(),
    maxDetourKm: Number(draft.maxDetourKm),
    recurrence: {
      daysOfWeek: [...draft.weekdays].sort((left, right) => left - right),
      typicalDepartureTime: draft.departureTime,
    },
    seats: Number(draft.seats),
    returnTrip: draft.returnTrip,
    status: 'active',
  };
}

export function createRegularRoutePrefill(draft: DriverOfferDraft): DriverOfferDraft {
  return {
    ...draft,
    offerType: 'route',
    selectedServiceId: '',
    date: '',
    weekdays: [],
  };
}

export function cancelLocalTrip(trip: Trip): Trip {
  return { ...trip, status: 'cancelled' };
}

export function cancelLocalRoute(route: Route): Route {
  return { ...route, status: 'cancelled' };
}

export function isRegularRouteAvailable(route: Pick<Route, 'status'>) {
  return route.status === 'active';
}

export function getMaxDetourCopy(maxDetourKm: number) {
  return maxDetourKm === 0
    ? 'Едет только по своему маршруту'
    : `Готов отклониться от маршрута до ${maxDetourKm} км`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function parseOriginLabel(value: Record<string, unknown>) {
  for (const candidate of [value.originLabel, value.departureArea, value.departurePlace]) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function parseMaxDetourKm(value: unknown) {
  return typeof value === 'number' && maxDetourKmValues.includes(value as (typeof maxDetourKmValues)[number])
    ? value
    : 0;
}

export function parseLocalDriverProfile(value: unknown): LocalDriverProfile | null {
  if (!isLocalDriverProfile(value)) {
    return null;
  }

  return {
    ownerId: value.ownerId,
    driverId: value.driverId,
    publicName: value.publicName.trim(),
    phonePrivate: normalizePhone(value.phonePrivate),
    emailPrivate: value.emailPrivate?.trim() || undefined,
  };
}

export function parseLocalTrip(value: unknown): Trip | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const trip = value as Partial<Trip> & Record<string, unknown>;
  const originLabel = parseOriginLabel(trip);
  const validStatuses: Trip['status'][] = ['open', 'full', 'cancelled', 'completed'];

  if (
    !isNonEmptyString(trip.id) ||
    !isNonEmptyString(trip.churchId) ||
    !isNonEmptyString(trip.driverId) ||
    !isLocalDate(trip.date) ||
    !isLocalTime(trip.departureTime) ||
    !originLabel ||
    !Number.isInteger(trip.seatsTotal) ||
    Number(trip.seatsTotal) < 1 ||
    Number(trip.seatsTotal) > 55 ||
    !Number.isInteger(trip.seatsAvailable) ||
    Number(trip.seatsAvailable) < 0 ||
    Number(trip.seatsAvailable) > Number(trip.seatsTotal) ||
    typeof trip.returnTrip !== 'boolean' ||
    !validStatuses.includes(trip.status as Trip['status']) ||
    (trip.routeId !== undefined && !isNonEmptyString(trip.routeId)) ||
    (trip.serviceEventId !== undefined && !isNonEmptyString(trip.serviceEventId))
  ) {
    return null;
  }

  return {
    id: trip.id,
    churchId: trip.churchId,
    driverId: trip.driverId,
    routeId: trip.routeId,
    date: trip.date,
    departureTime: trip.departureTime,
    originLabel,
    maxDetourKm: parseMaxDetourKm(trip.maxDetourKm),
    seatsTotal: Number(trip.seatsTotal),
    seatsAvailable: Number(trip.seatsAvailable),
    returnTrip: trip.returnTrip,
    status: trip.status as Trip['status'],
    serviceEventId: trip.serviceEventId,
  };
}

export function parseLocalRoute(value: unknown): Route | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const route = value as Partial<Route> & Record<string, unknown>;
  const originLabel = parseOriginLabel(route);
  const recurrence = route.recurrence;
  const validStatuses: Route['status'][] = ['active', 'paused', 'archived', 'cancelled'];

  if (
    !isNonEmptyString(route.id) ||
    !isNonEmptyString(route.churchId) ||
    !isNonEmptyString(route.driverId) ||
    !originLabel ||
    !recurrence ||
    !Array.isArray(recurrence.daysOfWeek) ||
    recurrence.daysOfWeek.length === 0 ||
    !recurrence.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
    !isLocalTime(recurrence.typicalDepartureTime) ||
    !Number.isInteger(route.seats) ||
    Number(route.seats) < 1 ||
    Number(route.seats) > 55 ||
    typeof route.returnTrip !== 'boolean' ||
    !validStatuses.includes(route.status as Route['status'])
  ) {
    return null;
  }

  return {
    id: route.id,
    churchId: route.churchId,
    driverId: route.driverId,
    originLabel,
    maxDetourKm: parseMaxDetourKm(route.maxDetourKm),
    recurrence: {
      daysOfWeek: [...new Set(recurrence.daysOfWeek)].sort((left, right) => left - right),
      typicalDepartureTime: recurrence.typicalDepartureTime,
      typicalArrivalTime: isLocalTime(recurrence.typicalArrivalTime) ? recurrence.typicalArrivalTime : undefined,
    },
    seats: Number(route.seats),
    returnTrip: route.returnTrip,
    status: route.status as Route['status'],
  };
}

export function excludeIdCollisions<T extends { id: string }>(
  localItems: T[],
  reservedItems: Array<{ id: string }>,
) {
  const seenIds = new Set(reservedItems.map((item) => item.id));
  return localItems.filter((item) => {
    if (seenIds.has(item.id)) {
      return false;
    }

    seenIds.add(item.id);
    return true;
  });
}

type OfferIdentity = Pick<Route | Trip, 'id' | 'driverId'>;

export function isLocallyOwnedOffer(
  offer: OfferIdentity,
  localOffers: OfferIdentity[],
  profile: LocalDriverProfile | null,
) {
  return Boolean(
    profile &&
      offer.driverId === profile.driverId &&
      localOffers.some((localOffer) => localOffer.id === offer.id && localOffer.driverId === profile.driverId),
  );
}
