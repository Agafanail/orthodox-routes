// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const contextualAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/contextual-registration/actions', () => ({
  beginContextualRegistrationAction: contextualAction,
}));
import { ChurchTransportBoard } from './church-transport-board';
import { driverOfferStorageKeys } from '../lib/driverOfferStorage';
import type {
  Church,
  DriverPublicProfile,
  DriverResponse,
  LocalDriverProfile,
  PassengerRequest,
  RideMatch,
  TargetedPassengerRequest,
  Trip,
} from '../lib/types';

const now = new Date('2030-01-01T10:00:00.000Z');
const timestamp = now.toISOString();
const churchId = 'integration-church';
const driverId = 'integration-driver';
const passengerPhone = '+390000000701';
const passengerEmail = 'passenger.integration@example.test';
const driverPhone = '+390000000702';
const driverEmail = 'driver.integration@example.test';

const actAwareGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActEnvironment = actAwareGlobal.IS_REACT_ACT_ENVIRONMENT;
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

const storageKeys = {
  passengerRequests: 'orthodox-routes:passenger-requests',
  driverResponses: 'orthodox-routes:driver-responses',
  targetedRequests: 'orthodox-routes:targeted-requests',
  rideMatches: 'orthodox-routes:ride-matches',
  notifications: 'orthodox-routes:notifications',
};

const church: Church = {
  id: churchId,
  name: 'Integration Church',
  slug: 'integration-church',
  jurisdiction: 'Test jurisdiction',
  languages: ['Russian'],
  address: 'Integration address',
  imageUrl: '/church.png',
  imageAlt: 'Integration church',
  imageSource: 'default',
  location: { lat: 0, lng: 0 },
  status: 'verified',
};

const drivers: DriverPublicProfile[] = [];

const trip: Trip = {
  id: 'integration-trip',
  churchId,
  driverId,
  date: '2030-01-03',
  departureTime: '08:00',
  originLabel: 'Integration origin',
  maxDetourKm: 5,
  seatsTotal: 3,
  seatsAvailable: 3,
  returnTrip: false,
  status: 'open',
};

const driverProfile: LocalDriverProfile = {
  ownerId: 'integration-owner',
  driverId,
  publicName: 'Driver Integration',
  phonePrivate: driverPhone,
  emailPrivate: driverEmail,
};

function passengerRequest(overrides: Partial<PassengerRequest> = {}): PassengerRequest {
  return {
    id: 'integration-passenger-request',
    churchId,
    firstName: 'Passenger Integration',
    phonePrivate: passengerPhone,
    emailPrivate: passengerEmail,
    serviceEvent: 'Integration service',
    serviceDate: trip.date,
    passengerCount: 2,
    pickupZone: { label: 'Integration pickup' },
    consentToShareContact: true,
    status: 'open',
    publicVisible: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function targetedRequest(overrides: Partial<TargetedPassengerRequest> = {}): TargetedPassengerRequest {
  return {
    id: 'integration-targeted-request',
    churchId,
    driverId,
    driverName: 'Driver Integration',
    targetOfferId: trip.id,
    targetOfferType: 'oneTimeTrip',
    offerContext: 'Integration origin → Integration Church',
    rideDate: trip.date,
    serviceEvent: 'Integration service',
    firstName: 'Passenger Integration',
    phonePrivate: passengerPhone,
    emailPrivate: passengerEmail,
    passengerCount: 2,
    pickupZone: { label: 'Integration pickup' },
    consentToShareContact: true,
    status: 'waitingForDriver',
    publicVisible: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function driverResponse(overrides: Partial<DriverResponse> = {}): DriverResponse {
  return {
    id: 'integration-driver-response',
    driverId,
    passengerRequestId: 'integration-passenger-request',
    driverOfferId: trip.id,
    driverOfferType: 'oneTimeTrip',
    rideDate: trip.date,
    offeredPassengerCount: 2,
    status: 'pendingPassengerConfirmation',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function writeStored(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readMatches(): RideMatch[] {
  return JSON.parse(window.localStorage.getItem(storageKeys.rideMatches) ?? '[]') as RideMatch[];
}

function readNotifications(): unknown[] {
  return JSON.parse(window.localStorage.getItem(storageKeys.notifications) ?? '[]') as unknown[];
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

function renderBoard(participationBackendAvailable = false) {
  return render(<ChurchTransportBoard church={church} drivers={drivers} participationBackendAvailable={participationBackendAvailable} routes={[]} trips={[trip]} />);
}

async function hydrateBoard() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

function expectContactsHidden() {
  expect(screen.queryByText(passengerPhone, { exact: true })).toBeNull();
  expect(screen.queryByText(passengerEmail, { exact: true })).toBeNull();
  expect(screen.queryByText(driverPhone, { exact: true })).toBeNull();
  expect(screen.queryByText(driverEmail, { exact: true })).toBeNull();
}

function dispatchTwoRapidClicks(button: HTMLElement) {
  act(() => {
    expect(button.isConnected).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(button.isConnected).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  actAwareGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(now);
  window.localStorage.clear();
  window.localStorage.setItem(driverOfferStorageKeys.localDriverProfile, JSON.stringify(driverProfile));
  contextualAction.mockReset();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreProperty(window, 'matchMedia', originalMatchMediaDescriptor);
  restoreProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
  if (originalActEnvironment === undefined) Reflect.deleteProperty(actAwareGlobal, 'IS_REACT_ACT_ENVIRONMENT');
  else actAwareGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

describe('ChurchTransportBoard P0 integration', () => {
  it('stores a configured passenger action contextually without publishing browser-owned transport state', async () => {
    contextualAction.mockResolvedValue({
      draftId: '9b11b924-53fa-4b86-8194-d960f8f9db89',
      status: 'email-sent',
    });
    renderBoard(true);
    await hydrateBoard();

    fireEvent.click(screen.getAllByRole('button', { name: 'Попросить подвезти' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /Имя/ }), { target: { value: 'Passenger Integration' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Телефон/ }), { target: { value: passengerPhone } });
    fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), { target: { value: passengerEmail } });
    fireEvent.input(screen.getByLabelText('Другая дата'), { target: { value: '2030-01-03' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Район посадки/ }), { target: { value: 'Integration pickup' } });
    fireEvent.click(screen.getByRole('checkbox'));

    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Создать запрос' }).closest('form')!);
      await Promise.resolve();
    });

    expect(contextualAction).toHaveBeenCalledOnce();
    const submitted = contextualAction.mock.calls[0][0] as FormData;
    expect(submitted.get('action_type')).toBe('passenger_request');
    expect(String(submitted.get('client_key'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(submitted.get('display_name')).toBe('Passenger Integration');
    expect(submitted.get('email')).toBe(passengerEmail);
    expect(submitted.get('phone')).toBe(passengerPhone);
    expect(submitted.get('preferred_language')).toBe('ru');
    expect(JSON.parse(String(submitted.get('payload')))).toEqual(expect.objectContaining({
      churchId,
      passengerCount: 1,
      pickupDescription: 'Integration pickup',
      serviceDate: '2030-01-03',
    }));
    expect(JSON.parse(window.localStorage.getItem(storageKeys.passengerRequests) ?? '[]')).toEqual([]);
    expect(screen.getByText('Проверьте email, чтобы продолжить. Запрос ещё не опубликован.')).not.toBeNull();
  });

  it('lets the driver finish a full targeted request exactly once and reveals contacts only in the agreement', async () => {
    writeStored(storageKeys.targetedRequests, [targetedRequest()]);
    renderBoard();
    await hydrateBoard();

    expect(screen.getByText('Ожидает ответа водителя')).not.toBeNull();
    expect(readMatches()).toEqual([]);
    expectContactsHidden();

    const accept = screen.getByRole('button', { name: 'Принять 2 места' });
    dispatchTwoRapidClicks(accept);

    await hydrateBoard();
    expect(readMatches()).toHaveLength(1);
    expect(readMatches()[0]).toMatchObject({ status: 'confirmed', confirmedPassengerCount: 2 });
    expect(readNotifications()).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(storageKeys.targetedRequests) ?? '[]')[0].status).toBe('matched');
    expect(screen.queryByText('Ожидает ответа водителя')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Принять 2 места' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Мои договорённости' })).not.toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Passenger Integration и Driver Integration' })).toHaveLength(1);
    expect(screen.getByText('Свободно 1 из 3 мест')).not.toBeNull();
    expect(screen.getByText(passengerPhone, { exact: true })).not.toBeNull();
    expect(screen.getByText(passengerEmail, { exact: true })).not.toBeNull();
    expect(screen.getByText(driverPhone, { exact: true })).not.toBeNull();
    expect(screen.getByText(driverEmail, { exact: true })).not.toBeNull();
    expect(screen.getAllByRole('link', { name: 'Позвонить' })).toHaveLength(2);
  });

  it('lets the passenger finish a pending driver response exactly once', async () => {
    writeStored(storageKeys.passengerRequests, [passengerRequest()]);
    writeStored(storageKeys.driverResponses, [driverResponse()]);
    renderBoard();
    await hydrateBoard();

    expect(screen.getByText('Ожидает решения пассажира')).not.toBeNull();
    expect(readMatches()).toEqual([]);
    expectContactsHidden();

    const accept = screen.getByRole('button', { name: 'Принять 2 места' });
    dispatchTwoRapidClicks(accept);

    await hydrateBoard();
    expect(readMatches()).toHaveLength(1);
    expect(readMatches()[0]).toMatchObject({ status: 'confirmed', driverResponseId: 'integration-driver-response' });
    expect(readNotifications()).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(storageKeys.passengerRequests) ?? '[]')[0].status).toBe('matched');
    expect(JSON.parse(window.localStorage.getItem(storageKeys.driverResponses) ?? '[]')[0].status).toBe('accepted');
    expect(screen.queryByText('Ожидает решения пассажира')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Passenger Integration и Driver Integration' })).toHaveLength(1);
    expect(screen.getByText('Свободно 1 из 3 мест')).not.toBeNull();
    expect(screen.getByText(passengerPhone, { exact: true })).not.toBeNull();
    expect(screen.getByText(passengerEmail, { exact: true })).not.toBeNull();
    expect(screen.getByText(driverPhone, { exact: true })).not.toBeNull();
    expect(screen.getByText(driverEmail, { exact: true })).not.toBeNull();
  });

  it('requires the passenger to accept a partial targeted counteroffer before creating a match', async () => {
    writeStored(storageKeys.targetedRequests, [targetedRequest({ passengerCount: 3 })]);
    renderBoard();
    await hydrateBoard();

    expectContactsHidden();
    const partialCount = screen.getByRole('spinbutton', { name: 'Предложить меньше мест' });
    fireEvent.change(partialCount, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предложить' }));

    await hydrateBoard();
    expect(screen.getAllByText('Driver Integration может подвезти 2 из 3 человек.')).toHaveLength(2);
    expect(readMatches()).toEqual([]);
    expectContactsHidden();

    fireEvent.click(screen.getByRole('button', { name: 'Принять 2 места' }));
    await hydrateBoard();
    expect(readMatches()).toHaveLength(1);
    expect(readMatches()[0]).toMatchObject({ originalPassengerCount: 3, confirmedPassengerCount: 2 });
    expect(screen.getByText(passengerPhone, { exact: true })).not.toBeNull();
    expect(screen.getByText(driverPhone, { exact: true })).not.toBeNull();
  });

  it('hydrates malformed and legacy stored data safely through the parent board', async () => {
    window.localStorage.setItem(storageKeys.passengerRequests, '{broken json');
    writeStored(driverOfferStorageKeys.localTrips, [
      {
        id: 'legacy-trip',
        churchId,
        driverId,
        date: trip.date,
        departureTime: '07:45',
        departureArea: 'Legacy safe origin',
        seatsTotal: 2,
        seatsAvailable: 2,
        returnTrip: false,
        status: 'open',
        obsoleteField: 'obsolete',
        secretToken: 'legacy-secret-token',
      },
      { id: 'malformed-trip' },
    ]);
    window.localStorage.setItem(driverOfferStorageKeys.localDriverProfile, JSON.stringify({
      ...driverProfile,
      secretToken: 'profile-secret-token',
    }));

    renderBoard();
    await hydrateBoard();

    expect(screen.getByText(/Legacy safe origin/)).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Попросить подвезти' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('legacy-secret-token', { exact: true })).toBeNull();
    expect(screen.queryByText('profile-secret-token', { exact: true })).toBeNull();
    expect(screen.queryByText('malformed-trip', { exact: true })).toBeNull();
    expect(window.localStorage.getItem(storageKeys.passengerRequests)).toBe('[]');

    await hydrateBoard();
    const sanitizedTrips = JSON.parse(window.localStorage.getItem(driverOfferStorageKeys.localTrips) ?? '[]') as Array<Record<string, unknown>>;
    expect(sanitizedTrips).toHaveLength(1);
    expect(sanitizedTrips[0]).toMatchObject({ id: 'legacy-trip', originLabel: 'Legacy safe origin' });
    expect(sanitizedTrips[0]).not.toHaveProperty('secretToken');
    expect(sanitizedTrips[0]).not.toHaveProperty('obsoleteField');
    const sanitizedProfile = JSON.parse(window.localStorage.getItem(driverOfferStorageKeys.localDriverProfile) ?? '{}') as Record<string, unknown>;
    expect(sanitizedProfile).not.toHaveProperty('secretToken');
  });
});
