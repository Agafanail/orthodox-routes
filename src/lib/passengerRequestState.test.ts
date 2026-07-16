import { describe, expect, it } from 'vitest';
import {
  cancelDriverResponse,
  createPendingDriverResponse,
  isDriverResponseActive,
  isPassengerRequestPublic,
  markPassengerRequestResponded,
  restorePassengerRequestAfterCancellation,
} from './passengerRequestState';
import type { PassengerRequest, TargetedPassengerRequest } from './types';

const openRequest: PassengerRequest = {
  id: 'request-1',
  churchId: 'church-1',
  firstName: 'Мария',
  phonePrivate: '+393331234567',
  serviceEvent: 'Литургия',
  passengerCount: 1,
  pickupZone: { label: 'Вокзал' },
  consentToShareContact: true,
  status: 'open',
  publicVisible: true,
  createdAt: '2026-07-19T06:00:00.000Z',
};

describe('passenger request public visibility', () => {
  it('shows an open public request', () => {
    expect(isPassengerRequestPublic(openRequest)).toBe(true);
  });

  it('hides an open request with publicVisible false', () => {
    expect(isPassengerRequestPublic({ ...openRequest, publicVisible: false })).toBe(false);
  });

  it('hides a pending-contact request', () => {
    expect(isPassengerRequestPublic({ ...openRequest, status: 'pendingContact', publicVisible: false })).toBe(false);
  });

  it('hides a cancelled request', () => {
    expect(isPassengerRequestPublic({ ...openRequest, status: 'cancelled', publicVisible: false })).toBe(false);
  });

  it('never treats a targeted request as public', () => {
    const targetedRequest: Pick<TargetedPassengerRequest, 'status' | 'publicVisible'> = {
      status: 'waitingForDriver',
      publicVisible: false,
    };
    expect(isPassengerRequestPublic(targetedRequest)).toBe(false);
  });
});

describe('driver response state transitions', () => {
  it('hides a passenger request when a driver responds', () => {
    const updated = markPassengerRequestResponded(openRequest);
    expect(updated.status).toBe('pendingContact');
    expect(updated.publicVisible).toBe(false);
  });

  it('creates an active pending-contact response from explicit values', () => {
    const response = createPendingDriverResponse('request-1', 'response-1', '2026-07-19T06:05:00.000Z');
    expect(response.status).toBe('pendingContact');
    expect(isDriverResponseActive(response)).toBe(true);
  });

  it('does not treat a cancelled response as active', () => {
    const response = createPendingDriverResponse('request-1', 'response-1', '2026-07-19T06:05:00.000Z');
    const cancelled = cancelDriverResponse(response, '2026-07-19T06:10:00.000Z');
    expect(cancelled.status).toBe('cancelled');
    expect(isDriverResponseActive(cancelled)).toBe(false);
  });

  it('restores a passenger request after response cancellation', () => {
    const pending = markPassengerRequestResponded(openRequest);
    const restored = restorePassengerRequestAfterCancellation(pending);
    expect(restored.status).toBe('open');
    expect(restored.publicVisible).toBe(true);
  });
});
