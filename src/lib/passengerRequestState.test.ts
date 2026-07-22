import { describe, expect, it } from 'vitest';
import { isDriverResponseActive, isPassengerRequestPublic } from './passengerRequestState';
import type { DriverResponse, PassengerRequest, TargetedPassengerRequest } from './types';

const openRequest: PassengerRequest = {
  id: 'request-1',
  churchId: 'church-1',
  firstName: 'Мария',
  phonePrivate: '+393331234567',
  serviceEvent: 'Литургия',
  serviceDate: '2026-07-20',
  passengerCount: 1,
  pickupZone: { label: 'Вокзал' },
  consentToShareContact: true,
  status: 'open',
  publicVisible: true,
  createdAt: '2026-07-19T06:00:00.000Z',
};

const response: DriverResponse = {
  id: 'response-1',
  driverId: 'driver-1',
  passengerRequestId: openRequest.id,
  driverOfferId: 'trip-1',
  driverOfferType: 'oneTimeTrip',
  rideDate: '2026-07-20',
  offeredPassengerCount: 1,
  status: 'pendingPassengerConfirmation',
  createdAt: '2026-07-19T06:05:00.000Z',
  updatedAt: '2026-07-19T06:05:00.000Z',
};

describe('passenger request public visibility', () => {
  it('keeps an open public request visible while driver responses are pending', () => {
    expect(isPassengerRequestPublic(openRequest)).toBe(true);
    expect(isDriverResponseActive(response)).toBe(true);
  });

  it.each(['matched', 'partiallyMatched', 'cancelled', 'expired'] as const)('hides a %s request', (status) => {
    expect(isPassengerRequestPublic({ ...openRequest, status, publicVisible: false })).toBe(false);
  });

  it('never treats a targeted request as public', () => {
    const targetedRequest: Pick<TargetedPassengerRequest, 'status' | 'publicVisible'> = {
      status: 'waitingForDriver',
      publicVisible: false,
    };
    expect(isPassengerRequestPublic(targetedRequest)).toBe(false);
  });

  it('does not treat terminal responses as active', () => {
    expect(isDriverResponseActive({ ...response, status: 'accepted' })).toBe(false);
    expect(isDriverResponseActive({ ...response, status: 'declined' })).toBe(false);
    expect(isDriverResponseActive({ ...response, status: 'cancelled' })).toBe(false);
    expect(isDriverResponseActive({ ...response, status: 'expired' })).toBe(false);
  });
});
