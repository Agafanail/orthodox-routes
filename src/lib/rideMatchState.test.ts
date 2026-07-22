import { describe, expect, it } from 'vitest';
import {
  canDirectlyRepublish,
  cancelDriverResponse,
  cancelFutureMatchesForOffer,
  cancelRideMatch,
  confirmRideMatch,
  createPendingDriverResponse,
  createPrivateDriverResponse,
  createTargetedRequestFromPassengerRequest,
  declineDriverResponse,
  getCompatiblePassengerRequests,
  getCompatibleOwnedOffers,
  getCompletedActivitySummaries,
  getFutureConfirmedMatchesForOffer,
  getFutureRouteOccurrences,
  getOfferAvailability,
  getOverCapacityRequestWarning,
  getPublicPassengerRequestItems,
  offerPartialTargetedRequest,
  parseDriverResponse,
  parseMockNotification,
  parsePassengerRequest,
  parseRideMatch,
  parseTargetedPassengerRequest,
  republishPassengerRequest,
  type CompatibleDriverOffer,
  type RideWorkflowState,
} from './rideMatchState';
import type {
  DriverResponse,
  LocalDriverProfile,
  PassengerRequest,
  PrivateContact,
  RideMatch,
  Route,
  TargetedPassengerRequest,
  Trip,
} from './types';

const now = new Date(2026, 6, 19, 8, 0);
const timestamp = '2026-07-19T06:00:00.000Z';
const driverContact: PrivateContact = { phone: '+393330000001', email: 'driver@example.test' };
const passengerRequest: PassengerRequest = {
  id: 'request-1',
  churchId: 'church-1',
  firstName: 'Мария',
  phonePrivate: '+393330000002',
  emailPrivate: 'maria@example.test',
  serviceEvent: 'Литургия, 20.07.2026',
  serviceEventId: 'service-1',
  serviceDate: '2026-07-20',
  passengerCount: 4,
  pickupZone: { label: 'Вокзал' },
  safePublicComment: 'Нужны детские кресла',
  consentToShareContact: true,
  status: 'open',
  publicVisible: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const targetedRequest: TargetedPassengerRequest = {
  id: 'targeted-1',
  churchId: 'church-1',
  driverId: 'driver-1',
  driverName: 'Сергей',
  targetOfferId: 'trip-1',
  targetOfferType: 'oneTimeTrip',
  offerContext: 'Разовая поездка',
  rideDate: '2026-07-20',
  serviceEvent: 'Литургия, 20.07.2026',
  serviceEventId: 'service-1',
  firstName: 'Мария',
  phonePrivate: passengerRequest.phonePrivate,
  emailPrivate: passengerRequest.emailPrivate,
  passengerCount: 4,
  pickupZone: { label: 'Вокзал' },
  privateComment: 'Нужны детские кресла',
  consentToShareContact: true,
  status: 'waitingForDriver',
  publicVisible: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const trip: Trip = {
  id: 'trip-1',
  churchId: 'church-1',
  driverId: 'driver-1',
  date: '2026-07-20',
  departureTime: '08:30',
  originLabel: 'Squillace',
  maxDetourKm: 5,
  seatsTotal: 4,
  seatsAvailable: 4,
  returnTrip: true,
  status: 'open',
};
const route: Route = {
  id: 'route-1',
  churchId: 'church-1',
  driverId: 'driver-1',
  originLabel: 'Soverato',
  maxDetourKm: 2,
  recurrence: { daysOfWeek: [1], typicalDepartureTime: '08:00' },
  seats: 3,
  returnTrip: true,
  status: 'active',
};
const profile: LocalDriverProfile = {
  ownerId: 'owner-1',
  driverId: 'driver-1',
  publicName: 'Сергей',
  phonePrivate: driverContact.phone,
  emailPrivate: driverContact.email,
};
const compatibleOffer: CompatibleDriverOffer = {
  driverId: 'driver-1',
  offerId: trip.id,
  offerType: 'oneTimeTrip',
  rideDate: trip.date,
  label: '20.07.2026 в 08:30',
  availableSeats: 4,
  totalSeats: 4,
};
const republishMatch: RideMatch = {
  id: 'match-1',
  churchId: 'church-1',
  passengerRequestId: passengerRequest.id,
  targetedPassengerRequestId: targetedRequest.id,
  driverId: 'driver-1',
  driverOfferId: trip.id,
  driverOfferType: 'oneTimeTrip',
  rideDate: trip.date,
  originalPassengerCount: 4,
  confirmedPassengerCount: 2,
  status: 'confirmed',
  passengerName: passengerRequest.firstName,
  driverName: targetedRequest.driverName,
  passengerContactPrivate: { phone: passengerRequest.phonePrivate, email: passengerRequest.emailPrivate },
  driverContactPrivate: driverContact,
  confirmedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function emptyState(overrides: Partial<RideWorkflowState> = {}): RideWorkflowState {
  return {
    passengerRequests: [],
    driverResponses: [],
    targetedRequests: [],
    rideMatches: [],
    ...overrides,
  };
}

function makeResponse(id = 'response-1', count = 2): DriverResponse {
  return createPendingDriverResponse({
    request: passengerRequest,
    offer: compatibleOffer,
    offeredPassengerCount: count,
    id,
    createdAt: timestamp,
  }) as DriverResponse;
}

function confirmTargeted(state: RideWorkflowState, count: number) {
  return confirmRideMatch({
    source: 'targetedRequest',
    sourceId: targetedRequest.id,
    confirmedPassengerCount: count,
    matchId: 'match-1',
    timestamp,
    driverName: 'Сергей',
    driverContact,
    state,
    routes: [route],
    trips: [trip],
    now,
  });
}

function confirmResponse(state: RideWorkflowState, response: DriverResponse, matchId = 'match-1') {
  return confirmRideMatch({
    source: 'driverResponse',
    sourceId: response.id,
    confirmedPassengerCount: response.offeredPassengerCount,
    matchId,
    timestamp,
    driverName: 'Сергей',
    driverContact,
    state,
    routes: [route],
    trips: [trip],
    now,
  });
}

describe('targeted request confirmation', () => {
  it('does not create a RideMatch while the targeted request is pending', () => {
    const state = emptyState({ targetedRequests: [targetedRequest] });
    expect(state.rideMatches).toEqual([]);
    expect(state.targetedRequests[0].status).toBe('waitingForDriver');
  });

  it('creates one RideMatch when the driver accepts the full request', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rideMatches).toHaveLength(1);
    expect(result.rideMatch).toMatchObject({
      targetedPassengerRequestId: targetedRequest.id,
      driverOfferId: trip.id,
      rideDate: trip.date,
      confirmedPassengerCount: 4,
      status: 'confirmed',
    });
    expect(result.state.targetedRequests[0].status).toBe('matched');
  });

  it('creates no match for a partial offer until the passenger accepts', () => {
    const partial = offerPartialTargetedRequest(targetedRequest, 2, timestamp);
    expect(partial?.status).toBe('pendingPassengerConfirmation');
    const state = emptyState({ targetedRequests: partial ? [partial] : [] });
    expect(state.rideMatches).toEqual([]);

    const result = confirmTargeted(state, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rideMatch.confirmedPassengerCount).toBe(2);
  });
});

describe('driver response confirmation', () => {
  it('links a response to a concrete offer and date while leaving the request public', () => {
    const response = makeResponse();
    expect(response).toMatchObject({ driverOfferId: 'trip-1', driverOfferType: 'oneTimeTrip', rideDate: '2026-07-20' });
    expect(passengerRequest).toMatchObject({ status: 'open', publicVisible: true });
  });

  it('finds only compatible owned offers with available seats', () => {
    expect(getCompatibleOwnedOffers({ request: passengerRequest, routes: [route], trips: [trip], rideMatches: [], localDriverProfile: profile, now }))
      .toHaveLength(2);
    expect(getCompatibleOwnedOffers({ request: passengerRequest, routes: [route], trips: [trip], rideMatches: [], localDriverProfile: { ...profile, driverId: 'other' }, now }))
      .toEqual([]);
  });

  it('accepts one response, closes the request, and expires other pending responses', () => {
    const selected = makeResponse('response-1');
    const other = makeResponse('response-2');
    const result = confirmResponse(emptyState({ passengerRequests: [passengerRequest], driverResponses: [selected, other] }), selected);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.passengerRequests[0]).toMatchObject({ status: 'partiallyMatched', publicVisible: false });
    expect(result.state.driverResponses).toEqual([
      expect.objectContaining({ id: 'response-1', status: 'accepted' }),
      expect.objectContaining({ id: 'response-2', status: 'expired' }),
    ]);
  });

  it('does not reopen a request when a pending response is declined or cancelled', () => {
    const response = makeResponse();
    expect(declineDriverResponse(response, timestamp).status).toBe('declined');
    expect(cancelDriverResponse(response, timestamp).status).toBe('cancelled');
    expect(passengerRequest.status).toBe('open');
  });
});

describe('reusing an existing passenger request', () => {
  const compatibleRequestTwo: PassengerRequest = {
    ...passengerRequest,
    id: 'request-2',
    firstName: 'Анна',
    passengerCount: 2,
    pickupZone: { label: 'Площадь' },
    safePublicComment: undefined,
  };

  const findCompatible = (
    passengerRequests: PassengerRequest[],
    targetedRequests: TargetedPassengerRequest[] = [],
  ) => getCompatiblePassengerRequests({
    churchId: trip.churchId,
    offerId: trip.id,
    offerType: 'oneTimeTrip',
    rideDate: trip.date,
    serviceEventId: passengerRequest.serviceEventId,
    passengerRequests,
    targetedRequests,
  });

  it('returns zero, one, or several compatible open requests', () => {
    expect(findCompatible([{ ...passengerRequest, churchId: 'other-church' }])).toEqual([]);
    expect(findCompatible([passengerRequest])).toEqual([
      expect.objectContaining({
        requestId: passengerRequest.id,
        remainingPassengerCount: passengerRequest.passengerCount,
        pickupArea: passengerRequest.pickupZone.label,
      }),
    ]);
    expect(findCompatible([passengerRequest, compatibleRequestTwo]).map((item) => item.requestId))
      .toEqual(['request-1', 'request-2']);
  });

  it('prevents another targeted request to the same offer and date', () => {
    const linked = {
      ...targetedRequest,
      sourcePassengerRequestId: passengerRequest.id,
    };
    expect(findCompatible([passengerRequest], [linked])).toEqual([]);
  });

  it('links the targeted request to its source without copying it into public state', () => {
    const linked = createTargetedRequestFromPassengerRequest({
      source: passengerRequest,
      id: 'targeted-linked',
      driverId: trip.driverId,
      driverName: 'Сергей',
      offerId: trip.id,
      offerType: 'oneTimeTrip',
      offerContext: 'Разовая поездка',
      rideDate: trip.date,
      serviceEventId: passengerRequest.serviceEventId,
      createdAt: timestamp,
    });

    expect(linked).toMatchObject({
      sourcePassengerRequestId: passengerRequest.id,
      passengerCount: passengerRequest.passengerCount,
      publicVisible: false,
    });
  });

  it.each([
    ['full', 4, 'matched'],
    ['partial', 2, 'partiallyMatched'],
  ] as const)('closes the source request after %s confirmation', (_label, count, expectedStatus) => {
    const linked = createTargetedRequestFromPassengerRequest({
      source: passengerRequest,
      id: 'targeted-linked',
      driverId: trip.driverId,
      driverName: 'Сергей',
      offerId: trip.id,
      offerType: 'oneTimeTrip',
      offerContext: 'Разовая поездка',
      rideDate: trip.date,
      serviceEventId: passengerRequest.serviceEventId,
      createdAt: timestamp,
    });
    expect(linked).not.toBeNull();
    if (!linked) return;
    const pending = count === linked.passengerCount
      ? linked
      : offerPartialTargetedRequest(linked, count, timestamp);
    expect(pending).not.toBeNull();
    if (!pending) return;

    const result = confirmRideMatch({
      source: 'targetedRequest',
      sourceId: pending.id,
      confirmedPassengerCount: count,
      matchId: `match-${count}`,
      timestamp,
      driverName: 'Сергей',
      driverContact,
      state: emptyState({ passengerRequests: [passengerRequest], targetedRequests: [pending] }),
      routes: [],
      trips: [trip],
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rideMatch.passengerRequestId).toBe(passengerRequest.id);
    expect(result.state.passengerRequests[0]).toMatchObject({
      status: expectedStatus,
      publicVisible: false,
    });
  });

  it('expires competing pending responses when a reused targeted request is confirmed', () => {
    const linked = createTargetedRequestFromPassengerRequest({
      source: passengerRequest,
      id: 'targeted-linked',
      driverId: trip.driverId,
      driverName: 'Сергей',
      offerId: trip.id,
      offerType: 'oneTimeTrip',
      offerContext: 'Разовая поездка',
      rideDate: trip.date,
      serviceEventId: passengerRequest.serviceEventId,
      createdAt: timestamp,
    });
    const response = makeResponse('competing-response', 2);
    expect(linked).not.toBeNull();
    if (!linked) return;

    const result = confirmRideMatch({
      source: 'targetedRequest',
      sourceId: linked.id,
      confirmedPassengerCount: linked.passengerCount,
      matchId: 'linked-match',
      timestamp,
      driverName: 'Сергей',
      driverContact,
      state: emptyState({
        passengerRequests: [passengerRequest],
        targetedRequests: [linked],
        driverResponses: [response],
      }),
      routes: [],
      trips: [trip],
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.driverResponses[0].status).toBe('expired');
  });
});

describe('private targeted driver offers', () => {
  const draft = {
    publicName: '',
    phone: '',
    email: '',
    originLabel: 'Soverato',
    departureTime: '08:45',
    offeredPassengerCount: '2',
    maxDetourKm: '5',
    consent: true,
  };

  it('creates a safely persisted private response without a public trip or route', () => {
    const response = createPrivateDriverResponse({
      request: passengerRequest,
      draft,
      driverId: profile.driverId,
      id: 'private-response-1',
      createdAt: timestamp,
      requireProfile: false,
      now,
    });

    expect(response).toMatchObject({
      driverOfferId: 'private-response-1',
      driverOfferType: 'privateDriverOffer',
      rideDate: passengerRequest.serviceDate,
      privateOffer: { originLabel: 'Soverato', departureTime: '08:45', maxDetourKm: 5 },
    });
    expect(getCompatibleOwnedOffers({
      request: passengerRequest,
      routes: [],
      trips: [],
      rideMatches: [],
      localDriverProfile: profile,
      now,
    })).toEqual([]);
    expect(parseDriverResponse(response)).toEqual(response);
  });

  it('creates a RideMatch only after the passenger accepts the private response', () => {
    const response = createPrivateDriverResponse({
      request: passengerRequest,
      draft,
      driverId: profile.driverId,
      id: 'private-response-1',
      createdAt: timestamp,
      requireProfile: false,
      now,
    });
    expect(response).not.toBeNull();
    if (!response) return;

    const linkedTargeted = {
      ...targetedRequest,
      sourcePassengerRequestId: passengerRequest.id,
    };
    const pendingState = emptyState({
      passengerRequests: [passengerRequest],
      driverResponses: [response],
      targetedRequests: [linkedTargeted],
    });
    expect(pendingState.rideMatches).toEqual([]);
    const result = confirmRideMatch({
      source: 'driverResponse',
      sourceId: response.id,
      confirmedPassengerCount: response.offeredPassengerCount,
      matchId: 'private-match-1',
      timestamp,
      driverName: profile.publicName,
      driverContact,
      state: pendingState,
      routes: [],
      trips: [],
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rideMatch).toMatchObject({
      driverOfferType: 'privateDriverOffer',
      driverOfferDepartureTime: '08:45',
      confirmedPassengerCount: 2,
    });
    expect(result.state.driverResponses[0].status).toBe('accepted');
    expect(result.state.targetedRequests[0].status).toBe('expired');
  });
});

describe('regular-route occurrence selection and over-capacity requests', () => {
  const fullFirstOccurrence: RideMatch = {
    id: 'route-full',
    churchId: route.churchId,
    passengerRequestId: 'route-request',
    driverId: route.driverId,
    driverOfferId: route.id,
    driverOfferType: 'regularRoute',
    rideDate: '2026-07-20',
    originalPassengerCount: 3,
    confirmedPassengerCount: 3,
    status: 'confirmed',
    passengerName: 'Анна',
    driverName: 'Сергей',
    passengerContactPrivate: { phone: '+393330000003' },
    driverContactPrivate: driverContact,
    confirmedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  it('generates at most five future occurrences and keeps a full date visible but disabled', () => {
    const occurrences = getFutureRouteOccurrences({
      route,
      routes: [route],
      trips: [],
      rideMatches: [fullFirstOccurrence],
      now,
    });

    expect(occurrences).toHaveLength(5);
    expect(occurrences.map((occurrence) => occurrence.date)).toEqual([
      '2026-07-20',
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
    ]);
    expect(occurrences[0]).toMatchObject({ availableSeats: 0, disabled: true });
    expect(occurrences[0].label).toContain('20.07.2026');
    expect(occurrences[1]).toMatchObject({ availableSeats: 3, disabled: false });
  });

  it('allows an over-capacity request while seats remain and gives the exact yellow-warning copy', () => {
    expect(getOverCapacityRequestWarning(6, 8)).toBe(
      'Сейчас у водителя свободно 6 мест, а вам нужно 8. Можно отправить запрос: водитель сможет предложить часть мест или отклонить просьбу.',
    );
    expect(getOverCapacityRequestWarning(1, 2)).toContain('свободно 1 место');
    expect(getOverCapacityRequestWarning(0, 8)).toBeUndefined();
    expect(getOverCapacityRequestWarning(6, 6)).toBeUndefined();
  });
});

describe('capacity and coherent confirmation', () => {
  it('revalidates seats and prevents oversubscription', () => {
    const response = makeResponse('response-1', 2);
    const occupied: RideMatch = {
      id: 'occupied', churchId: 'church-1', passengerRequestId: 'other-request', driverId: 'driver-1',
      driverOfferId: 'trip-1', driverOfferType: 'oneTimeTrip', rideDate: '2026-07-20',
      originalPassengerCount: 3, confirmedPassengerCount: 3, status: 'confirmed', passengerName: 'Анна', driverName: 'Сергей',
      passengerContactPrivate: { phone: '+393330000003' }, driverContactPrivate: driverContact,
      confirmedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    };
    const result = confirmResponse(emptyState({ passengerRequests: [passengerRequest], driverResponses: [response], rideMatches: [occupied] }), response);
    expect(result).toEqual({ ok: false, reason: 'insufficientSeats' });
  });

  it('does not create a duplicate match on repeated acceptance', () => {
    const response = makeResponse('response-1', 2);
    const first = confirmResponse(emptyState({ passengerRequests: [passengerRequest], driverResponses: [response] }), response);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = confirmResponse(first.state, response, 'match-2');
    expect(second.ok).toBe(false);
    expect(first.state.rideMatches).toHaveLength(1);
  });

  it('decreases one-time availability and restores it on cancellation', () => {
    const response = makeResponse('response-1', 2);
    const confirmed = confirmResponse(emptyState({ passengerRequests: [passengerRequest], driverResponses: [response] }), response);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(getOfferAvailability({ offerId: trip.id, offerType: 'oneTimeTrip', rideDate: trip.date, routes: [], trips: [trip], rideMatches: confirmed.state.rideMatches, now }).availableSeats).toBe(2);
    const cancelled = cancelRideMatch(confirmed.state, confirmed.rideMatch.id, timestamp);
    expect(getOfferAvailability({ offerId: trip.id, offerType: 'oneTimeTrip', rideDate: trip.date, routes: [], trips: [trip], rideMatches: cancelled.rideMatches, now }).availableSeats).toBe(4);
    expect(cancelled.rideMatches[0].status).toBe('cancelled');
  });

  it('isolates regular-route capacity by occurrence date', () => {
    const match: RideMatch = {
      id: 'route-match', churchId: 'church-1', passengerRequestId: 'request-route', driverId: 'driver-1',
      driverOfferId: route.id, driverOfferType: 'regularRoute', rideDate: '2026-07-20',
      originalPassengerCount: 3, confirmedPassengerCount: 3, status: 'confirmed', passengerName: 'Мария', driverName: 'Сергей',
      passengerContactPrivate: { phone: passengerRequest.phonePrivate }, driverContactPrivate: driverContact,
      confirmedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    };
    expect(getOfferAvailability({ offerId: route.id, offerType: 'regularRoute', rideDate: '2026-07-20', routes: [route], trips: [], rideMatches: [match], now }).availableSeats).toBe(0);
    expect(getOfferAvailability({ offerId: route.id, offerType: 'regularRoute', rideDate: '2026-07-27', routes: [route], trips: [], rideMatches: [match], now }).availableSeats).toBe(3);
  });

  it('isolates capacity by church and offer type when stored IDs collide', () => {
    const collidingMatch: RideMatch = {
      id: 'colliding-match', churchId: 'another-church', passengerRequestId: 'request-other', driverId: 'driver-2',
      driverOfferId: trip.id, driverOfferType: 'regularRoute', rideDate: trip.date,
      originalPassengerCount: 4, confirmedPassengerCount: 4, status: 'confirmed', passengerName: 'Анна', driverName: 'Иван',
      passengerContactPrivate: { phone: '+390000000003' }, driverContactPrivate: { phone: '+390000000004' },
      confirmedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    };
    expect(getOfferAvailability({ offerId: trip.id, offerType: 'oneTimeTrip', rideDate: trip.date, routes: [], trips: [trip], rideMatches: [collidingMatch], now }).availableSeats).toBe(4);
  });

  it('cancels future matches with a cancelled offer but preserves history', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cancelled = cancelFutureMatchesForOffer(result.state, trip.id, 'oneTimeTrip', [route], [trip], now, timestamp);
    expect(cancelled.rideMatches).toHaveLength(1);
    expect(cancelled.rideMatches[0].status).toBe('cancelled');
  });

  it('does not cancel or count a match after its local departure time', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterDeparture = new Date(2026, 6, 20, 9, 0);
    expect(getFutureConfirmedMatchesForOffer(result.state.rideMatches, trip.id, 'oneTimeTrip', [route], [trip], afterDeparture)).toEqual([]);
    expect(cancelFutureMatchesForOffer(result.state, trip.id, 'oneTimeTrip', [route], [trip], afterDeparture, timestamp).rideMatches[0].status).toBe('confirmed');
  });
});

describe('remaining and republished requests', () => {
  it('creates the correct remaining count and copies preserved request data', () => {
    const republished = republishPassengerRequest(passengerRequest, 2, 'request-2', timestamp);
    expect(republished).toMatchObject({
      id: 'request-2', passengerCount: 2, firstName: passengerRequest.firstName,
      phonePrivate: passengerRequest.phonePrivate, emailPrivate: passengerRequest.emailPrivate,
      serviceEventId: passengerRequest.serviceEventId, serviceDate: passengerRequest.serviceDate,
      pickupZone: passengerRequest.pickupZone, safePublicComment: passengerRequest.safePublicComment,
      sourcePassengerRequestId: passengerRequest.id, status: 'open', publicVisible: true,
    });
  });

  it('supports a targeted request as the source of republication', () => {
    expect(republishPassengerRequest(targetedRequest, 2, 'request-2', timestamp)).toMatchObject({
      passengerCount: 2, serviceDate: targetedRequest.rideDate, safePublicComment: targetedRequest.privateComment,
    });
  });

  it.each([
    ['before the offer departure', new Date(2026, 6, 20, 8, 29), true],
    ['at the offer departure', new Date(2026, 6, 20, 8, 30), false],
    ['after the offer departure', new Date(2026, 6, 20, 8, 31), false],
  ])('handles direct republication %s', (_label, currentTime, expected) => {
    expect(canDirectlyRepublish({
      source: targetedRequest,
      match: republishMatch,
      routes: [],
      trips: [trip],
      now: currentTime,
    })).toBe(expected);
  });

  it.each([
    ['before the structured service starts', new Date(2026, 6, 20, 9, 59), true],
    ['at the structured service start', new Date(2026, 6, 20, 10, 0), false],
    ['after the structured service starts', new Date(2026, 6, 20, 10, 1), false],
  ])('handles direct republication %s', (_label, currentTime, expected) => {
    expect(canDirectlyRepublish({
      source: passengerRequest,
      match: { ...republishMatch, driverOfferId: 'missing-offer' },
      routes: [],
      trips: [],
      services: [{ id: 'service-1', name: 'Литургия', date: '2026-07-20', startTime: '10:00' }],
      now: currentTime,
    })).toBe(expected);
  });

  it('allows an alternative date for the whole local day', () => {
    expect(canDirectlyRepublish({
      source: { ...passengerRequest, serviceEventId: undefined },
      match: { ...republishMatch, driverOfferId: 'missing-offer' },
      routes: [],
      trips: [],
      now: new Date(2026, 6, 20, 23, 59, 59),
    })).toBe(true);
  });

  it('disables a previous date and allows a future date when no time is known', () => {
    const context = {
      match: { ...republishMatch, driverOfferId: 'missing-offer' },
      routes: [],
      trips: [],
      now: new Date(2026, 6, 20, 12, 0),
    };
    expect(canDirectlyRepublish({
      ...context,
      source: { ...passengerRequest, serviceEventId: undefined, serviceDate: '2026-07-19' },
    })).toBe(false);
    expect(canDirectlyRepublish({
      ...context,
      source: { ...passengerRequest, serviceEventId: undefined, serviceDate: '2026-07-21' },
    })).toBe(true);
  });
});

describe('privacy-safe matches, notifications, and summaries', () => {
  it('keeps contacts unavailable before confirmation and snapshots both contacts after confirmation', () => {
    const pending = emptyState({ targetedRequests: [targetedRequest] });
    expect(pending.rideMatches).toEqual([]);
    const result = confirmTargeted(pending, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rideMatch.passengerContactPrivate).toEqual({ phone: passengerRequest.phonePrivate, email: passengerRequest.emailPrivate });
    expect(result.rideMatch.driverContactPrivate).toEqual(driverContact);
  });

  it('keeps contacts out of public summaries and rejects contact-bearing notifications', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: [], rideMatches: result.state.rideMatches,
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now,
    });
    expect(JSON.stringify(summaries)).not.toContain(passengerRequest.phonePrivate);
    expect(JSON.stringify(summaries)).not.toContain(passengerRequest.emailPrivate);
    expect(parseMockNotification({ id: 'n1', churchId: 'church-1', message: 'Позвоните +39 333 000 0002', createdAt: timestamp })).toBeNull();
    expect(parseMockNotification({ id: 'n2', churchId: 'church-1', message: 'Напишите maria@example.test', createdAt: timestamp })).toBeNull();
  });

  it('aggregates a completed passenger request and full trip by their original board items', () => {
    const response = makeResponse('response-full', 4);
    const result = confirmResponse(
      emptyState({ passengerRequests: [passengerRequest], driverResponses: [response] }),
      response,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: result.state.passengerRequests, rideMatches: result.state.rideMatches,
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now,
    });
    expect(summaries.map((summary) => summary.kind)).toEqual(expect.arrayContaining(['passengerRequest', 'fullTrip']));
    expect(summaries).toHaveLength(2);
    expect(summaries.find((summary) => summary.kind === 'passengerRequest')?.message)
      .toBe('4 из 4 человек договорились о поездке');
  });

  it('keeps a republished remaining request active with clear partial wording and no completed duplicate', () => {
    const matchedRoot = { ...passengerRequest, status: 'partiallyMatched' as const, publicVisible: false };
    const remainingRequest: PassengerRequest = {
      ...passengerRequest,
      id: 'request-remaining',
      passengerCount: 2,
      sourcePassengerRequestId: passengerRequest.id,
      createdAt: '2026-07-19T07:00:00.000Z',
      status: 'open',
      publicVisible: true,
    };
    const items = getPublicPassengerRequestItems({
      churchId: 'church-1',
      passengerRequests: [remainingRequest, matchedRoot],
      rideMatches: [republishMatch],
    });
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1',
      passengerRequests: [remainingRequest, matchedRoot],
      rideMatches: [republishMatch],
      routes: [route],
      trips: [trip],
      driverNames: { 'driver-1': 'Сергей' },
      now,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      rootRequestId: passengerRequest.id,
      partial: true,
      countLabel: 'Нужно ещё 2 места из первоначальных 4',
      statusLabel: 'Часть группы уже едет',
    });
    expect(items[0]).not.toHaveProperty('request');
    expect(JSON.stringify(items[0])).not.toContain(passengerRequest.phonePrivate);
    expect(JSON.stringify(items[0])).not.toContain(passengerRequest.emailPrivate);
    expect(summaries.filter((summary) => summary.kind === 'passengerRequest')).toEqual([]);
    expect(summaries.filter((summary) => summary.kind === 'fullTrip')).toEqual([]);
  });

  it('moves a fully resolved request chain to one completed summary', () => {
    const matchedRoot = { ...passengerRequest, status: 'partiallyMatched' as const, publicVisible: false };
    const matchedRemaining: PassengerRequest = {
      ...passengerRequest,
      id: 'request-remaining',
      passengerCount: 2,
      sourcePassengerRequestId: passengerRequest.id,
      status: 'matched',
      publicVisible: false,
    };
    const secondMatch: RideMatch = {
      ...republishMatch,
      id: 'match-2',
      passengerRequestId: matchedRemaining.id,
      originalPassengerCount: 2,
      confirmedPassengerCount: 2,
      confirmedAt: '2026-07-19T07:00:00.000Z',
    };
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1',
      passengerRequests: [matchedRemaining, matchedRoot],
      rideMatches: [secondMatch, republishMatch],
      routes: [route],
      trips: [trip],
      driverNames: { 'driver-1': 'Сергей' },
      now,
    });

    expect(summaries.filter((summary) => summary.kind === 'passengerRequest')).toEqual([
      expect.objectContaining({
        id: `request-${passengerRequest.id}`,
        section: 'passengerRequests',
        message: '4 из 4 человек договорились о поездке',
      }),
    ]);
    expect(summaries.filter((summary) => summary.kind === 'fullTrip')).toHaveLength(1);
  });

  it('produces one full-trip summary for multiple matches and none while seats remain', () => {
    const secondMatch: RideMatch = {
      ...republishMatch,
      id: 'match-2',
      passengerRequestId: 'request-2',
      confirmedPassengerCount: 2,
      originalPassengerCount: 2,
      confirmedAt: '2026-07-19T07:00:00.000Z',
    };
    const partialSummaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: [], rideMatches: [republishMatch],
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now,
    });
    const fullSummaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: [], rideMatches: [secondMatch, republishMatch],
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now,
    });

    expect(partialSummaries.filter((summary) => summary.kind === 'fullTrip')).toEqual([]);
    expect(fullSummaries.filter((summary) => summary.kind === 'fullTrip')).toHaveLength(1);
  });

  it('creates a yellow partial regular-route occurrence summary without private data', () => {
    const partialRouteMatch: RideMatch = {
      ...republishMatch,
      id: 'route-match-partial',
      passengerRequestId: 'route-request-partial',
      driverOfferId: route.id,
      driverOfferType: 'regularRoute',
      confirmedPassengerCount: 2,
      originalPassengerCount: 2,
    };
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1',
      passengerRequests: [],
      rideMatches: [partialRouteMatch],
      routes: [route],
      trips: [trip],
      driverNames: { 'driver-1': 'Сергей' },
      now,
    });
    const routeSummary = summaries.find((summary) => summary.kind === 'partialRouteOccurrence');

    expect(routeSummary).toMatchObject({
      id: `route-occurrence-${route.id}:${trip.date}`,
      section: 'regularRouteOccurrences',
      badge: 'Часть мест занята',
      message: 'Занято 2 из 3 мест',
      offerTypeLabel: 'Регулярная поездка',
    });
    expect(routeSummary?.detail).toContain('20.07.2026');
    expect(JSON.stringify(routeSummary)).not.toContain(partialRouteMatch.passengerContactPrivate.phone);
    expect(JSON.stringify(routeSummary)).not.toContain(partialRouteMatch.driverContactPrivate.phone);
    expect(JSON.stringify(routeSummary)).not.toContain(passengerRequest.pickupZone.label);
    expect(JSON.stringify(routeSummary)).not.toContain(passengerRequest.safePublicComment);
  });

  it('aggregates a full regular-route occurrence by offer and ride date', () => {
    const firstRouteMatch: RideMatch = {
      ...republishMatch,
      id: 'route-match-1',
      passengerRequestId: 'route-request-1',
      driverOfferId: route.id,
      driverOfferType: 'regularRoute',
      confirmedPassengerCount: 1,
      originalPassengerCount: 1,
    };
    const secondRouteMatch: RideMatch = {
      ...firstRouteMatch,
      id: 'route-match-2',
      passengerRequestId: 'route-request-2',
      confirmedPassengerCount: 2,
      originalPassengerCount: 2,
    };
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1',
      passengerRequests: [],
      rideMatches: [secondRouteMatch, firstRouteMatch],
      routes: [route],
      trips: [trip],
      driverNames: { 'driver-1': 'Сергей' },
      now,
    });

    expect(summaries.filter((summary) => summary.kind === 'fullRouteOccurrence')).toEqual([
      expect.objectContaining({
        id: `route-occurrence-${route.id}:${trip.date}`,
        section: 'regularRouteOccurrences',
        message: 'Все 3 места заняты',
        offerTypeLabel: 'Регулярная поездка',
      }),
    ]);
  });

  it('keeps regular occurrence dates separate and groups completed offers without duplicate trips', () => {
    const firstRouteMatch: RideMatch = {
      ...republishMatch,
      id: 'route-match-date-1',
      passengerRequestId: 'route-request-date-1',
      driverOfferId: route.id,
      driverOfferType: 'regularRoute',
      confirmedPassengerCount: 1,
      originalPassengerCount: 1,
    };
    const laterRouteMatch: RideMatch = {
      ...firstRouteMatch,
      id: 'route-match-date-2',
      passengerRequestId: 'route-request-date-2',
      rideDate: '2026-07-27',
    };
    const secondTripMatch: RideMatch = {
      ...republishMatch,
      id: 'trip-match-2',
      passengerRequestId: 'trip-request-2',
      originalPassengerCount: 2,
      confirmedPassengerCount: 2,
    };
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1',
      passengerRequests: [],
      rideMatches: [secondTripMatch, republishMatch, laterRouteMatch, firstRouteMatch],
      routes: [route],
      trips: [trip],
      driverNames: { 'driver-1': 'Сергей' },
      now,
      limit: 10,
    });
    const completedOffers = summaries.filter(
      (summary) => summary.section === 'oneTimeTrips' || summary.section === 'regularRouteOccurrences',
    );

    expect(completedOffers.filter((summary) => summary.kind === 'fullTrip')).toHaveLength(1);
    expect(completedOffers.filter((summary) => summary.section === 'regularRouteOccurrences'))
      .toHaveLength(2);
    expect(new Set(completedOffers.map((summary) => summary.id)).size).toBe(completedOffers.length);
  });

  it('does not show cancelled matches as successful public activity', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cancelled = cancelRideMatch(result.state, result.rideMatch.id, timestamp);
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: [], rideMatches: cancelled.rideMatches,
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now,
    });
    expect(summaries).toEqual([]);
  });

  it('hides successful public activity after the local departure time', () => {
    const result = confirmTargeted(emptyState({ targetedRequests: [targetedRequest] }), 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summaries = getCompletedActivitySummaries({
      churchId: 'church-1', passengerRequests: [], rideMatches: result.state.rideMatches,
      routes: [route], trips: [trip], driverNames: { 'driver-1': 'Сергей' }, now: new Date(2026, 6, 20, 9, 0),
    });
    expect(summaries).toEqual([]);
  });
});

describe('safe persisted-record compatibility', () => {
  it('restores legacy pending-contact requests to a safe open state', () => {
    expect(parsePassengerRequest({ ...passengerRequest, status: 'pendingContact', publicVisible: false })).toMatchObject({ status: 'open', publicVisible: true });
  });

  it('expires legacy unlinked responses instead of exposing contacts', () => {
    expect(parseDriverResponse({ id: 'legacy', passengerRequestId: 'request-1', status: 'pendingContact', createdAt: timestamp }))
      .toMatchObject({ status: 'expired', driverOfferId: 'legacy-unlinked-offer' });
  });

  it('sanitizes targeted requests and rejects malformed matches', () => {
    expect(parseTargetedPassengerRequest({ ...targetedRequest, unexpectedPhone: '+390000000000' })).not.toHaveProperty('unexpectedPhone');
    expect(parseTargetedPassengerRequest({ id: 'broken' })).toBeNull();
    expect(parseRideMatch({ id: 'broken' })).toBeNull();
  });
});
