import { describe, expect, it } from 'vitest';
import { getChurchOfferCounts, mergeChurchOffers } from './churchOfferCounts';
import type { DriverPublicProfile, LocalDriverProfile, Route, Trip } from './types';

const now = new Date(2026, 6, 19, 8, 0);
const staticDrivers: DriverPublicProfile[] = [
  { id: 'driver-1', publicName: 'One', departureArea: 'A', visibleChurchIds: ['church-1'] },
  { id: 'driver-2', publicName: 'Two', departureArea: 'B', visibleChurchIds: ['church-1'] },
];
const baseRoute: Route = {
  id: 'route-1',
  churchId: 'church-1',
  driverId: 'driver-1',
  originLabel: 'A',
  maxDetourKm: 0,
  recurrence: { daysOfWeek: [0], typicalDepartureTime: '08:00' },
  seats: 2,
  returnTrip: true,
  status: 'active',
};
const baseTrip: Trip = {
  id: 'trip-1',
  churchId: 'church-1',
  driverId: 'driver-1',
  date: '2026-07-20',
  departureTime: '08:00',
  originLabel: 'A',
  maxDetourKm: 0,
  seatsTotal: 2,
  seatsAvailable: 1,
  returnTrip: true,
  status: 'open',
};
const localProfile: LocalDriverProfile = {
  ownerId: 'owner-local',
  driverId: 'driver-local',
  publicName: 'Local',
  phonePrivate: '+393331234567',
};

function getCounts(overrides: Partial<Parameters<typeof getChurchOfferCounts>[0]> = {}) {
  return getChurchOfferCounts({
    churchId: 'church-1',
    staticDrivers,
    staticRoutes: [baseRoute],
    staticTrips: [baseTrip],
    localDriverProfile: localProfile,
    localRoutes: [],
    localTrips: [],
    now,
    ...overrides,
  });
}

describe('church offer counts', () => {
  it('merges static and local offers', () => {
    const localRoute = { ...baseRoute, id: 'route-local', driverId: 'driver-local', originLabel: 'Local origin' };
    const localTrip = { ...baseTrip, id: 'trip-local', driverId: 'driver-local', originLabel: 'Local origin' };

    expect(getCounts({ localRoutes: [localRoute], localTrips: [localTrip] })).toEqual({
      driverCount: 2,
      routeCount: 2,
      tripCount: 2,
    });
  });

  it('counts a driver only once across several active offers', () => {
    const secondTrip = { ...baseTrip, id: 'trip-2', driverId: 'driver-1' };
    expect(getCounts({ staticTrips: [baseTrip, secondTrip] }).driverCount).toBe(1);
  });

  it('excludes cancelled and inactive routes', () => {
    expect(
      getCounts({
        staticRoutes: [
          { ...baseRoute, status: 'cancelled' },
          { ...baseRoute, id: 'route-paused', status: 'paused' },
        ],
      }).routeCount,
    ).toBe(0);
  });

  it('excludes cancelled, expired, and full one-time trips', () => {
    expect(
      getCounts({
        staticTrips: [
          { ...baseTrip, status: 'cancelled' },
          { ...baseTrip, id: 'trip-expired', date: '2026-07-18' },
          { ...baseTrip, id: 'trip-full', seatsAvailable: 0 },
        ],
      }).tripCount,
    ).toBe(0);
  });

  it('isolates offers by church', () => {
    const otherRoute = { ...baseRoute, id: 'route-other', churchId: 'church-2' };
    const otherTrip = { ...baseTrip, id: 'trip-other', churchId: 'church-2' };
    expect(getCounts({ staticRoutes: [otherRoute], staticTrips: [otherTrip] })).toEqual({
      driverCount: 0,
      routeCount: 0,
      tripCount: 0,
    });
  });

  it('derives the local driver card origin from active offers for the current church', () => {
    const result = mergeChurchOffers({
      churchId: 'church-1',
      staticDrivers,
      staticRoutes: [],
      staticTrips: [],
      localDriverProfile: localProfile,
      localRoutes: [{ ...baseRoute, id: 'local-a', driverId: 'driver-local', originLabel: 'Squillace' }],
      localTrips: [{ ...baseTrip, id: 'local-b', driverId: 'driver-local', originLabel: 'Soverato' }],
      now,
    });

    expect(result.localPublicDriver?.departureArea).toBe('Squillace / Soverato');
    expect(result.localPublicDriver).not.toHaveProperty('phonePrivate');
  });
});
