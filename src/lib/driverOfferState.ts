import {
  EMAIL_VALIDATION_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
} from './passengerRequestValidation';
import { isOneTimeTripAvailable } from './tripVisibility';
import type { DriverPublicProfile, LocalDriverProfile, Route, Trip } from './types';

export type DriverOfferMode = 'trip' | 'route';

export type DriverOfferDraft = {
  offerType: DriverOfferMode;
  publicName: string;
  phone: string;
  email: string;
  departureArea: string;
  originLabel: string;
  meetingPoint: string;
  seats: string;
  returnTrip: boolean;
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
    departureArea: '',
    originLabel: '',
    meetingPoint: '',
    seats: '1',
    returnTrip: false,
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

export function validateDriverOfferDraft(draft: DriverOfferDraft, requireProfile: boolean, now: Date) {
  const errors: DriverOfferDraftErrors = {};
  const seats = Number(draft.seats);

  if (requireProfile) {
    if (!draft.publicName.trim()) {
      errors.publicName = 'Введите публичное имя.';
    }

    if (!isInternationalPhoneValid(draft.phone)) {
      errors.phone = PHONE_VALIDATION_MESSAGE;
    }

    if (!isOptionalEmailValid(draft.email)) {
      errors.email = EMAIL_VALIDATION_MESSAGE;
    }

    if (!draft.departureArea.trim()) {
      errors.departureArea = 'Укажите примерный район выезда.';
    }
  }

  if (!draft.originLabel.trim()) {
    errors.originLabel = 'Укажите место выезда.';
  }

  if (!draft.meetingPoint.trim()) {
    errors.meetingPoint = 'Укажите одну точку встречи.';
  }

  if (!Number.isInteger(seats) || seats < 1) {
    errors.seats = 'Укажите количество мест от 1.';
  }

  if (draft.offerType === 'trip') {
    if (!draft.date) {
      errors.date = 'Укажите дату поездки.';
    }

    if (!draft.departureTime) {
      errors.departureTime = 'Укажите время выезда.';
    }

    if (
      draft.date &&
      draft.departureTime &&
      Number.isInteger(seats) &&
      seats > 0 &&
      !isOneTimeTripAvailable(
        {
          date: draft.date,
          departureTime: draft.departureTime,
          seatsAvailable: seats,
          status: 'open',
        },
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
    departureArea: draft.departureArea.trim(),
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
      (typeof profile.emailPrivate === 'string' && isOptionalEmailValid(profile.emailPrivate))) &&
    typeof profile.departureArea === 'string' &&
    Boolean(profile.departureArea.trim())
  );
}

export function toDriverPublicProfile(
  profile: LocalDriverProfile,
  visibleChurchIds: string[],
): DriverPublicProfile {
  return {
    id: profile.driverId,
    publicName: profile.publicName,
    departureArea: profile.departureArea,
    visibleChurchIds,
  };
}

export function createLocalTrip(
  draft: DriverOfferDraft,
  churchId: string,
  driverId: string,
  tripId: string,
): Trip {
  const seats = Number(draft.seats);
  return {
    id: tripId,
    churchId,
    driverId,
    date: draft.date,
    departureTime: draft.departureTime,
    originLabel: draft.originLabel.trim(),
    meetingPoints: [{ label: draft.meetingPoint.trim() }],
    seatsTotal: seats,
    seatsAvailable: seats,
    returnTrip: draft.returnTrip,
    status: 'open',
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
    meetingPoints: [{ label: draft.meetingPoint.trim() }],
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
    publicName: '',
    phone: '',
    email: '',
    departureArea: '',
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isLocalDate(value: unknown): value is string {
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

function parseMeetingPoints(value: unknown): Route['meetingPoints'] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((point) => {
    if (!point || typeof point !== 'object') {
      return false;
    }

    return isNonEmptyString((point as { label?: unknown }).label);
  })) {
    return null;
  }

  return value.map((point) => ({ label: (point as { label: string }).label.trim() }));
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
    departureArea: value.departureArea.trim(),
  };
}

export function parseLocalTrip(value: unknown): Trip | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const trip = value as Partial<Trip>;
  const meetingPoints = parseMeetingPoints(trip.meetingPoints);
  const validStatuses: Trip['status'][] = ['open', 'full', 'cancelled', 'completed'];

  if (
    !isNonEmptyString(trip.id) ||
    !isNonEmptyString(trip.churchId) ||
    !isNonEmptyString(trip.driverId) ||
    !isLocalDate(trip.date) ||
    !isLocalTime(trip.departureTime) ||
    !isNonEmptyString(trip.originLabel) ||
    !meetingPoints ||
    !Number.isInteger(trip.seatsTotal) ||
    Number(trip.seatsTotal) < 1 ||
    !Number.isInteger(trip.seatsAvailable) ||
    Number(trip.seatsAvailable) < 0 ||
    Number(trip.seatsAvailable) > Number(trip.seatsTotal) ||
    typeof trip.returnTrip !== 'boolean' ||
    !validStatuses.includes(trip.status as Trip['status']) ||
    (trip.routeId !== undefined && !isNonEmptyString(trip.routeId))
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
    originLabel: trip.originLabel.trim(),
    meetingPoints,
    seatsTotal: Number(trip.seatsTotal),
    seatsAvailable: Number(trip.seatsAvailable),
    returnTrip: trip.returnTrip,
    status: trip.status as Trip['status'],
  };
}

export function parseLocalRoute(value: unknown): Route | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const route = value as Partial<Route>;
  const meetingPoints = parseMeetingPoints(route.meetingPoints);
  const recurrence = route.recurrence;
  const validStatuses: Route['status'][] = ['active', 'paused', 'archived', 'cancelled'];

  if (
    !isNonEmptyString(route.id) ||
    !isNonEmptyString(route.churchId) ||
    !isNonEmptyString(route.driverId) ||
    !isNonEmptyString(route.originLabel) ||
    !meetingPoints ||
    !recurrence ||
    !Array.isArray(recurrence.daysOfWeek) ||
    recurrence.daysOfWeek.length === 0 ||
    !recurrence.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
    !isLocalTime(recurrence.typicalDepartureTime) ||
    !Number.isInteger(route.seats) ||
    Number(route.seats) < 1 ||
    typeof route.returnTrip !== 'boolean' ||
    !validStatuses.includes(route.status as Route['status'])
  ) {
    return null;
  }

  return {
    id: route.id,
    churchId: route.churchId,
    driverId: route.driverId,
    originLabel: route.originLabel.trim(),
    meetingPoints,
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

export function isTargetedOfferAvailable(
  offerId: string,
  offerType: 'regularRoute' | 'oneTimeTrip',
  routes: Route[],
  trips: Trip[],
  now: Date,
) {
  return offerType === 'regularRoute'
    ? routes.some((route) => route.id === offerId && isRegularRouteAvailable(route))
    : trips.some((trip) => trip.id === offerId && isOneTimeTripAvailable(trip, now));
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
