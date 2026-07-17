import { describe, expect, it } from 'vitest';
import { getChurchTrips } from './mockData';
import { isOneTimeTripAvailable } from './tripVisibility';
import type { Trip } from './types';

const baseTrip: Trip = {
  id: 'trip-test',
  churchId: 'church-test',
  driverId: 'driver-test',
  date: '2026-07-19',
  departureTime: '08:15',
  originLabel: 'Test origin',
  meetingPoints: [{ label: 'Test meeting point' }],
  seatsTotal: 2,
  seatsAvailable: 1,
  returnTrip: false,
  status: 'open',
};

describe('one-time trip availability', () => {
  it('shows a future trip', () => {
    expect(isOneTimeTripAvailable(baseTrip, new Date(2026, 6, 18, 12, 0))).toBe(true);
  });

  it('shows a trip later today', () => {
    expect(isOneTimeTripAvailable(baseTrip, new Date(2026, 6, 19, 7, 30))).toBe(true);
  });

  it('hides a trip earlier today', () => {
    expect(isOneTimeTripAvailable(baseTrip, new Date(2026, 6, 19, 9, 0))).toBe(false);
  });

  it('hides a past trip', () => {
    expect(isOneTimeTripAvailable({ ...baseTrip, date: '2026-07-18' }, new Date(2026, 6, 19, 7, 30))).toBe(false);
  });

  it('hides a full trip', () => {
    expect(isOneTimeTripAvailable({ ...baseTrip, seatsAvailable: 0 }, new Date(2026, 6, 19, 7, 30))).toBe(false);
  });

  it('hides a trip with a non-open status', () => {
    expect(
      isOneTimeTripAvailable({ ...baseTrip, status: 'cancelled' }, new Date(2026, 6, 19, 7, 30)),
    ).toBe(false);
  });

  it('keeps unavailable trips out of the church trip selector', () => {
    const trips = getChurchTrips('pokrov-catanzaro', new Date(2026, 6, 17, 12, 0));

    expect(trips.map((trip) => trip.id)).toEqual(['trip-2']);
  });
});
