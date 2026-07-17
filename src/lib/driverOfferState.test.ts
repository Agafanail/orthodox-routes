import { describe, expect, it } from 'vitest';
import { isOneTimeTripAvailable } from './tripVisibility';
import {
  cancelLocalRoute,
  cancelLocalTrip,
  createLocalDriverProfile,
  createLocalRoute,
  createLocalTrip,
  createRegularRoutePrefill,
  excludeIdCollisions,
  isLocallyOwnedOffer,
  isRegularRouteAvailable,
  isTargetedOfferAvailable,
  parseLocalDriverProfile,
  parseLocalRoute,
  parseLocalTrip,
  toDriverPublicProfile,
  validateDriverOfferDraft,
  type DriverOfferDraft,
} from './driverOfferState';

const validTripDraft: DriverOfferDraft = {
  offerType: 'trip',
  publicName: 'Иван',
  phone: '+39 333 123 4567',
  email: 'ivan@example.com',
  departureArea: 'Catanzaro Lido',
  originLabel: 'Вокзал',
  meetingPoint: 'Главный вход',
  seats: '3',
  returnTrip: true,
  date: '2026-07-20',
  departureTime: '08:15',
  weekdays: [],
};

const now = new Date(2026, 6, 19, 12, 0);

describe('local driver profile', () => {
  it('requires the public name, private phone, and departure area for the first offer', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, publicName: '', phone: '', departureArea: '' },
      true,
      now,
    );

    expect(result.errors).toMatchObject({
      publicName: 'Введите публичное имя.',
      departureArea: 'Укажите примерный район выезда.',
    });
    expect(result.errors.phone).toBeDefined();
  });

  it('keeps private contacts out of the public profile and offers', () => {
    const profile = createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1');
    const publicProfile = toDriverPublicProfile(profile, ['church-1']);
    const trip = createLocalTrip(validTripDraft, 'church-1', profile.driverId, 'trip-1');

    expect(publicProfile).not.toHaveProperty('phonePrivate');
    expect(publicProfile).not.toHaveProperty('emailPrivate');
    expect(trip).not.toHaveProperty('phonePrivate');
    expect(trip).not.toHaveProperty('emailPrivate');
  });
});

describe('driver offer creation', () => {
  it('creates an open one-time trip with all seats available', () => {
    const trip = createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1');

    expect(trip).toMatchObject({
      id: 'trip-1',
      status: 'open',
      seatsTotal: 3,
      seatsAvailable: 3,
      returnTrip: true,
      meetingPoints: [{ label: 'Главный вход' }],
    });
  });

  it('rejects a one-time departure that has passed', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, date: '2026-07-19', departureTime: '11:59' },
      false,
      now,
    );

    expect(result.errors.date).toBe('Дата и время выезда уже прошли.');
  });

  it('creates an active regular route', () => {
    const draft = { ...validTripDraft, offerType: 'route' as const, weekdays: [1, 3] };
    const route = createLocalRoute(draft, 'church-1', 'driver-1', 'route-1');

    expect(route).toMatchObject({
      id: 'route-1',
      status: 'active',
      seats: 3,
      returnTrip: true,
      meetingPoints: [{ label: 'Главный вход' }],
      recurrence: { daysOfWeek: [1, 3], typicalDepartureTime: '08:15' },
    });
  });

  it('requires at least one weekday for a regular route', () => {
    const result = validateDriverOfferDraft({ ...validTripDraft, offerType: 'route' }, false, now);
    expect(result.errors.weekdays).toBe('Выберите хотя бы один день недели.');
  });

  it('prefills a regular route without carrying over the one-time date', () => {
    const prefill = createRegularRoutePrefill(validTripDraft);

    expect(prefill).toMatchObject({
      offerType: 'route',
      originLabel: 'Вокзал',
      meetingPoint: 'Главный вход',
      departureTime: '08:15',
      seats: '3',
      returnTrip: true,
      date: '',
      weekdays: [],
      publicName: '',
      phone: '',
      email: '',
      departureArea: '',
    });
  });
});

describe('persisted local offer safety', () => {
  it('sanitizes valid local records and removes unexpected private fields', () => {
    const profile = parseLocalDriverProfile({
      ...createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1'),
      unexpectedSecret: 'secret',
    });
    const trip = parseLocalTrip({
      ...createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1'),
      phonePrivate: '+393331234567',
    });

    expect(profile).not.toHaveProperty('unexpectedSecret');
    expect(trip).not.toHaveProperty('phonePrivate');
  });

  it('rejects malformed or outdated trip and route records', () => {
    expect(parseLocalTrip({ id: 'trip-1', status: 'open' })).toBeNull();
    expect(
      parseLocalRoute({
        ...createLocalRoute(
          { ...validTripDraft, offerType: 'route', weekdays: [0] },
          'church-1',
          'driver-1',
          'route-1',
        ),
        status: 'legacy',
      }),
    ).toBeNull();
  });

  it('retains a cancelled route as valid history while keeping it unavailable', () => {
    const route = createLocalRoute(
      { ...validTripDraft, offerType: 'route', weekdays: [0] },
      'church-1',
      'driver-1',
      'route-1',
    );
    const parsed = parseLocalRoute(cancelLocalRoute(route));

    expect(parsed?.status).toBe('cancelled');
    expect(parsed && isRegularRouteAvailable(parsed)).toBe(false);
  });

  it('excludes IDs reserved by static data and duplicate local IDs', () => {
    const localItems = [{ id: 'static-id' }, { id: 'local-id' }, { id: 'local-id' }];
    expect(excludeIdCollisions(localItems, [{ id: 'static-id' }])).toEqual([{ id: 'local-id' }]);
  });
});

describe('local offer cancellation and ownership', () => {
  const profile = createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1');
  const trip = createLocalTrip(validTripDraft, 'church-1', profile.driverId, 'trip-1');
  const route = createLocalRoute(
    { ...validTripDraft, offerType: 'route', weekdays: [0] },
    'church-1',
    profile.driverId,
    'route-1',
  );

  it('cancels a local trip and makes it unavailable', () => {
    const cancelled = cancelLocalTrip(trip);
    expect(cancelled.status).toBe('cancelled');
    expect(isOneTimeTripAvailable(cancelled, now)).toBe(false);
  });

  it('cancels a local route and makes it unavailable', () => {
    const cancelled = cancelLocalRoute(route);
    expect(cancelled.status).toBe('cancelled');
    expect(isRegularRouteAvailable(cancelled)).toBe(false);
  });

  it('does not mark static or foreign offers as locally owned', () => {
    expect(isLocallyOwnedOffer(trip, [trip], profile)).toBe(true);
    expect(isLocallyOwnedOffer({ ...trip, id: 'static-trip' }, [trip], profile)).toBe(false);
    expect(isLocallyOwnedOffer({ ...trip, driverId: 'driver-2' }, [trip], profile)).toBe(false);
  });

  it('removes cancelled and full offers from targeted request availability', () => {
    expect(isTargetedOfferAvailable(route.id, 'regularRoute', [route], [], now)).toBe(true);
    expect(isTargetedOfferAvailable(route.id, 'regularRoute', [cancelLocalRoute(route)], [], now)).toBe(false);
    expect(isTargetedOfferAvailable(trip.id, 'oneTimeTrip', [], [trip], now)).toBe(true);
    expect(
      isTargetedOfferAvailable(trip.id, 'oneTimeTrip', [], [{ ...trip, seatsAvailable: 0 }], now),
    ).toBe(false);
  });
});
