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
  getMaxDetourCopy,
  isLocallyOwnedOffer,
  isRegularRouteAvailable,
  parseLocalDriverProfile,
  parseLocalRoute,
  parseLocalTrip,
  toDriverPublicProfile,
  validateDriverOfferDraft,
  type DriverOfferDraft,
} from './driverOfferState';
import {
  getChurchServiceOptions,
  getFutureChurchServices,
  selectAlternativeDate,
  selectChurchService,
} from './serviceOptions';
import type { ChurchService } from './types';

const services: ChurchService[] = [
  { id: 'past-service', name: 'Вечерня', date: '2026-07-19', startTime: '11:00' },
  { id: 'service-1', name: 'Литургия', date: '2026-07-20', startTime: '09:00' },
  { id: 'service-2', name: 'Молебен', date: '2026-07-21', startTime: '10:00' },
];

const validTripDraft: DriverOfferDraft = {
  offerType: 'trip',
  publicName: 'Иван',
  phone: '+39 333 123 4567',
  email: 'ivan@example.com',
  originLabel: 'Squillace',
  maxDetourKm: '5',
  seats: '3',
  returnTrip: true,
  selectedServiceId: 'service-1',
  date: '',
  departureTime: '08:15',
  weekdays: [],
};

const now = new Date(2026, 6, 19, 12, 0);

describe('local driver profile', () => {
  it('requires name and phone but does not require a departure area', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, publicName: '', phone: '' },
      true,
      now,
      services,
    );

    expect(result.errors.publicName).toBe('Введите имя.');
    expect(result.errors.phone).toBeDefined();
    expect(result.errors).not.toHaveProperty('departureArea');
  });

  it('keeps private contacts out of the public profile and offers', () => {
    const profile = createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1');
    const publicProfile = toDriverPublicProfile(profile, ['church-1'], 'Squillace');
    const trip = createLocalTrip(validTripDraft, 'church-1', profile.driverId, 'trip-1', services);

    expect(publicProfile).toMatchObject({ departureArea: 'Squillace' });
    expect(publicProfile).not.toHaveProperty('phonePrivate');
    expect(trip).not.toHaveProperty('phonePrivate');
  });
});

describe('driver offer validation and creation', () => {
  it('requires an origin and maximum detour', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, originLabel: '', maxDetourKm: '' },
      false,
      now,
      services,
    );

    expect(result.errors.originLabel).toBe('Укажите, откуда вы едете.');
    expect(result.errors.maxDetourKm).toBe('Выберите максимальное отклонение от маршрута.');
  });

  it.each(['0', '2', '5', '10', '15', '20'])('accepts an approved detour: %s km', (maxDetourKm) => {
    const result = validateDriverOfferDraft({ ...validTripDraft, maxDetourKm }, false, now, services);
    expect(result.errors.maxDetourKm).toBeUndefined();
  });

  it.each(['', '-1', '1', '3', '21', 'abc'])('rejects an unsupported detour: %s', (maxDetourKm) => {
    const result = validateDriverOfferDraft({ ...validTripDraft, maxDetourKm }, false, now, services);
    expect(result.errors.maxDetourKm).toBe('Выберите максимальное отклонение от маршрута.');
  });

  it('does not require old pickup fields for a new offer', () => {
    const result = validateDriverOfferDraft(validTripDraft, false, now, services);
    expect(result.errors).not.toHaveProperty('pickupMethod');
    expect(result.errors).not.toHaveProperty('pickupDetails');
  });

  it('requires exactly one of a service or alternative date', () => {
    const missing = validateDriverOfferDraft(
      { ...validTripDraft, selectedServiceId: '', date: '' },
      false,
      now,
      services,
    );
    const duplicated = validateDriverOfferDraft(
      { ...validTripDraft, date: '2026-07-22' },
      false,
      now,
      services,
    );

    expect(missing.errors.selectedServiceId).toBe('Выберите службу или другую дату.');
    expect(duplicated.errors.selectedServiceId).toBe('Выберите службу или другую дату.');
  });

  it('keeps service and alternative-date selection mutually exclusive', () => {
    const withAlternativeDate = selectAlternativeDate(validTripDraft, '2026-07-22');
    const withService = selectChurchService(withAlternativeDate, 'service-2');

    expect(withAlternativeDate).toMatchObject({ selectedServiceId: '', date: '2026-07-22' });
    expect(withService).toMatchObject({ selectedServiceId: 'service-2', date: '' });
  });

  it('uses the same compact options for both passenger and driver consumers', () => {
    const futureServices = getFutureChurchServices(services, now);
    expect(getChurchServiceOptions(futureServices)).toEqual([
      { value: 'service-1', label: 'Литургия — 20.07.2026, 09:00' },
      { value: 'service-2', label: 'Молебен — 21.07.2026, 10:00' },
    ]);
  });

  it('excludes past services and limits future choices', () => {
    const manyServices = [
      ...services,
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `extra-${index}`,
        name: 'Литургия',
        date: `2026-07-${22 + index}`,
        startTime: '09:00',
      })),
    ];

    const result = getFutureChurchServices(manyServices, now);
    expect(result).toHaveLength(5);
    expect(result.map((service) => service.id)).not.toContain('past-service');
  });

  it('supports a no-schedule church with the alternative date only', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, selectedServiceId: '', date: '2026-07-22' },
      false,
      now,
      [],
    );

    expect(getChurchServiceOptions(getFutureChurchServices([], now))).toEqual([]);
    expect(result.errors.selectedServiceId).toBeUndefined();
    expect(result.errors.date).toBeUndefined();
  });

  it('rejects a past alternative date', () => {
    const result = validateDriverOfferDraft(
      { ...validTripDraft, selectedServiceId: '', date: '2026-07-18' },
      false,
      now,
      services,
    );
    expect(result.errors.date).toBe('Выберите сегодняшнюю или будущую дату.');
  });

  it.each(['', '0', '-1', '1.5', '56', 'abc'])('limits seat values to integers from 1 through 55: %s', (seats) => {
    const result = validateDriverOfferDraft({ ...validTripDraft, seats }, false, now, services);
    expect(result.errors.seats).toBe('Выберите количество свободных мест.');
  });

  it('creates a one-time trip with a numeric maximum detour', () => {
    const trip = createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1', services);

    expect(trip).toMatchObject({
      id: 'trip-1',
      date: '2026-07-20',
      serviceEventId: 'service-1',
      status: 'open',
      originLabel: 'Squillace',
      maxDetourKm: 5,
      seatsTotal: 3,
      seatsAvailable: 3,
    });
    expect(trip).not.toHaveProperty('pickupMethod');
    expect(trip).not.toHaveProperty('meetingPoints');
  });

  it('creates a regular trip with a numeric maximum detour', () => {
    const route = createLocalRoute(
      { ...validTripDraft, offerType: 'route', weekdays: [0], maxDetourKm: '2' },
      'church-1',
      'driver-1',
      'route-1',
    );
    expect(route.maxDetourKm).toBe(2);
  });

  it('prefills a regular trip with detour but without date or service', () => {
    const prefill = createRegularRoutePrefill(validTripDraft);

    expect(prefill).toMatchObject({
      offerType: 'route',
      originLabel: 'Squillace',
      maxDetourKm: '5',
      departureTime: '08:15',
      seats: '3',
      returnTrip: true,
      selectedServiceId: '',
      date: '',
      weekdays: [],
    });
  });

  it('formats public detour copy for zero and positive distances', () => {
    expect(getMaxDetourCopy(0)).toBe('Едет только по своему маршруту');
    expect(getMaxDetourCopy(5)).toBe('Готов отклониться от маршрута до 5 км');
  });
});

describe('stored local offer safety', () => {
  it('sanitizes an older profile with departureArea without depending on it', () => {
    const profile = parseLocalDriverProfile({
      ...createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1'),
      departureArea: 'Old area',
      unexpectedSecret: 'secret',
    });

    expect(profile).not.toHaveProperty('departureArea');
    expect(profile).not.toHaveProperty('unexpectedSecret');
  });

  it('reads old pickup fields and assigns a conservative zero detour', () => {
    const trip = createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1', services);
    const route = createLocalRoute(
      { ...validTripDraft, offerType: 'route', weekdays: [0] },
      'church-1',
      'driver-1',
      'route-1',
    );
    const { maxDetourKm: omittedTripDetour, ...oldTrip } = trip;
    const { maxDetourKm: omittedRouteDetour, ...oldRoute } = route;
    void omittedTripDetour;
    void omittedRouteDetour;

    expect(parseLocalTrip({ ...oldTrip, pickupMethod: 'along-route', meetingPoints: [{ label: 'A' }] }))
      .toMatchObject({ maxDetourKm: 0, originLabel: 'Squillace' });
    expect(parseLocalRoute({ ...oldRoute, pickupDetails: 'Old point' }))
      .toMatchObject({ maxDetourKm: 0, originLabel: 'Squillace' });
  });

  it('reads an older departure-place field when originLabel is absent', () => {
    const trip = createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1', services);
    const { originLabel: omittedOrigin, ...oldTrip } = trip;
    void omittedOrigin;
    expect(parseLocalTrip({ ...oldTrip, departurePlace: 'Old origin' })?.originLabel).toBe('Old origin');
  });

  it('removes unexpected private fields from stored offers', () => {
    const trip = parseLocalTrip({
      ...createLocalTrip(validTripDraft, 'church-1', 'driver-1', 'trip-1', services),
      phonePrivate: '+393331234567',
    });
    expect(trip).not.toHaveProperty('phonePrivate');
  });

  it('rejects malformed records and seats above 55', () => {
    expect(parseLocalTrip({ id: 'trip-1', status: 'open' })).toBeNull();
    expect(
      parseLocalRoute({
        ...createLocalRoute(
          { ...validTripDraft, offerType: 'route', weekdays: [0] },
          'church-1',
          'driver-1',
          'route-1',
        ),
        seats: 56,
      }),
    ).toBeNull();
  });

  it('excludes IDs reserved by static data and duplicate local IDs', () => {
    const localItems = [{ id: 'static-id' }, { id: 'local-id' }, { id: 'local-id' }];
    expect(excludeIdCollisions(localItems, [{ id: 'static-id' }])).toEqual([{ id: 'local-id' }]);
  });
});

describe('local offer cancellation and ownership', () => {
  const profile = createLocalDriverProfile(validTripDraft, 'owner-1', 'driver-1');
  const trip = createLocalTrip(validTripDraft, 'church-1', profile.driverId, 'trip-1', services);
  const route = createLocalRoute(
    { ...validTripDraft, offerType: 'route', weekdays: [0] },
    'church-1',
    profile.driverId,
    'route-1',
  );

  it('cancels a local trip and route without deleting history', () => {
    expect(isOneTimeTripAvailable(cancelLocalTrip(trip), now)).toBe(false);
    expect(isRegularRouteAvailable(cancelLocalRoute(route))).toBe(false);
  });

  it('does not mark static or foreign offers as locally owned', () => {
    expect(isLocallyOwnedOffer(trip, [trip], profile)).toBe(true);
    expect(isLocallyOwnedOffer({ ...trip, id: 'static-trip' }, [trip], profile)).toBe(false);
    expect(isLocallyOwnedOffer({ ...trip, driverId: 'driver-2' }, [trip], profile)).toBe(false);
  });

});
