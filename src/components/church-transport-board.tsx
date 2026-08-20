'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionFeedback, type ActionFeedbackMessage } from '@/components/church-transport-board/action-feedback';
import { beginContextualRegistrationAction } from '@/app/contextual-registration/actions';
import { ActiveDriverResponses } from '@/components/church-transport-board/active-driver-responses';
import { getBoardCardId } from '@/components/church-transport-board/board-card';
import { CompletedActivity } from '@/components/church-transport-board/completed-activity';
import { DriverOfferDialog } from '@/components/church-transport-board/driver-offer-dialog';
import { DriverOffers } from '@/components/church-transport-board/driver-offers';
import { DriverResponseDialog } from '@/components/church-transport-board/driver-response-dialog';
import { MatchCancellationDialog } from '@/components/church-transport-board/match-cancellation-dialog';
import { NotificationCenter } from '@/components/church-transport-board/notification-center';
import { OfferCancellationDialog } from '@/components/church-transport-board/offer-cancellation-dialog';
import { PageActions } from '@/components/church-transport-board/page-actions';
import { PassengerRequestList } from '@/components/church-transport-board/passenger-request-list';
import { RequestDialog } from '@/components/church-transport-board/request-dialog';
import { RideMatchPanel } from '@/components/church-transport-board/ride-match-panel';
import { TargetedRequestPanel } from '@/components/church-transport-board/targeted-request-panel';
import type { RequestDialogContext, TargetedRequestDialogInput } from '@/components/church-transport-board/types';
import { mergeChurchOffers } from '@/lib/churchOfferCounts';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import {
  cancelLocalRoute,
  cancelLocalTrip,
  createEmptyDriverOfferDraft,
  createLocalDriverProfile,
  createLocalRoute,
  createLocalTrip,
  isLocallyOwnedOffer,
  parseLocalDriverProfile,
  parseLocalRoute,
  parseLocalTrip,
  validateDriverOfferDraft,
  validateDriverOfferField,
  type DriverOfferDraft,
  type DriverOfferDraftErrors,
  type DriverOfferMode,
} from '@/lib/driverOfferState';
import { driverOfferStorageKeys } from '@/lib/driverOfferStorage';
import { getDriverPrivateContact } from '@/lib/mockPrivateData';
import { isDriverResponseActive } from '@/lib/passengerRequestState';
import {
  parsePassengerRequestDraft,
  validatePassengerRequestDraft,
  type PassengerRequestDraft,
  type PassengerRequestDraftErrors,
} from '@/lib/passengerRequestValidation';
import {
  canDirectlyRepublish,
  cancelDriverResponse,
  cancelFutureMatchesForOffer,
  cancelRideMatch,
  confirmRideMatch,
  createPrivateDriverResponse,
  createPendingDriverResponse,
  createTargetedRequestFromPassengerRequest,
  declineDriverResponse,
  declineTargetedRequest,
  getCompatibleOwnedOffers,
  getCompatiblePassengerRequests,
  getCompletedActivitySummaries,
  getFutureConfirmedMatchesForOffer,
  getOfferAvailability,
  getFutureRouteOccurrences,
  getOverCapacityRequestWarning,
  getPublicPassengerRequestItems,
  isLocalDate,
  markRemainingNeedHandled,
  offerPartialTargetedRequest,
  parseDriverResponse,
  parseMockNotification,
  parsePassengerRequest,
  parseRideMatch,
  parseTargetedPassengerRequest,
  republishPassengerRequest,
  routeIncludesDate,
  validatePrivateDriverOfferDraft,
  type CompatibleDriverOffer,
  type PrivateDriverOfferDraft,
  type RideWorkflowState,
} from '@/lib/rideMatchState';
import { rideMatchStorageKey } from '@/lib/rideMatchStorage';
import { formatSeatCount } from '@/lib/russianCount';
import { formatServiceSelection, getChurchServiceOptions, getFutureChurchServices } from '@/lib/serviceOptions';
import { readStoredArray } from '@/lib/storage';
import type {
  Church,
  DriverPublicProfile,
  DriverResponse,
  LocalDriverProfile,
  MockNotification,
  PassengerRequest,
  RideMatch,
  Route,
  TargetedPassengerRequest,
  Trip,
} from '@/lib/types';

type ChurchTransportBoardProps = {
  church: Church;
  drivers: DriverPublicProfile[];
  participationBackendAvailable?: boolean;
  routes: Route[];
  trips: Trip[];
};

const storageKeys = {
  passengerDraft: 'orthodox-routes:passenger-draft',
  passengerRequests: 'orthodox-routes:passenger-requests',
  driverResponses: 'orthodox-routes:driver-responses',
  targetedRequests: 'orthodox-routes:targeted-requests',
  notifications: 'orthodox-routes:notifications',
  rideMatches: rideMatchStorageKey,
  ...driverOfferStorageKeys,
} as const;

const emptyDraft: PassengerRequestDraft = {
  firstName: '',
  phone: '',
  email: '',
  selectedServiceId: '',
  date: '',
  passengerCount: '1',
  pickupArea: '',
  comment: '',
  consent: false,
};

function getInitialDraft(): PassengerRequestDraft {
  if (typeof window === 'undefined') return emptyDraft;

  try {
    const savedDraft = window.localStorage.getItem(storageKeys.passengerDraft);
    if (!savedDraft) return emptyDraft;
    const parsed = parsePassengerRequestDraft(JSON.parse(savedDraft) as unknown);
    if (parsed) return parsed;
    window.localStorage.removeItem(storageKeys.passengerDraft);
  } catch {
    window.localStorage.removeItem(storageKeys.passengerDraft);
  }

  return emptyDraft;
}

function usePersistentArray<T>(key: string, parseItem: (value: unknown) => T | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredArray<unknown>(window.localStorage, key);
      setItems(stored.map(parseItem).filter((item): item is T => item !== null));
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, parseItem]);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(key, JSON.stringify(items));
  }, [items, key, loaded]);

  return [items, setItems] as const;
}

function usePersistentValue<T>(key: string, parseValue: (value: unknown) => T | null) {
  const [value, setValue] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedValue = window.localStorage.getItem(key);
        if (storedValue) {
          const parsed = parseValue(JSON.parse(storedValue) as unknown);
          if (parsed) setValue(parsed);
          else window.localStorage.removeItem(key);
        }
      } catch {
        window.localStorage.removeItem(key);
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, parseValue]);

  useEffect(() => {
    if (loaded && value) window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, loaded, value]);

  return [value, setValue] as const;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ChurchTransportBoard({
  church,
  drivers,
  participationBackendAvailable = false,
  routes,
  trips,
}: ChurchTransportBoardProps) {
  const [dialogContext, setDialogContext] = useState<RequestDialogContext | null>(null);
  const [draft, setDraft] = useState<PassengerRequestDraft>(getInitialDraft);
  const [draftErrors, setDraftErrors] = useState<PassengerRequestDraftErrors>({});
  const [requestSubmitAttempt, setRequestSubmitAttempt] = useState(0);
  const [selectedReusableRequestId, setSelectedReusableRequestId] = useState('');
  const [creatingDifferentRequest, setCreatingDifferentRequest] = useState(false);
  const [responseRequest, setResponseRequest] = useState<PassengerRequest | null>(null);
  const [pendingMatchCancellation, setPendingMatchCancellation] = useState<{
    match: RideMatch;
    participant: 'passenger' | 'driver';
  } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackMessage | null>(null);
  const [revealTarget, setRevealTarget] = useState<{ id: string; sequence: number } | null>(null);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState<DriverOfferDraft>(() => createEmptyDriverOfferDraft());
  const [offerDraftErrors, setOfferDraftErrors] = useState<DriverOfferDraftErrors>({});
  const [offerSubmitAttempt, setOfferSubmitAttempt] = useState(0);
  const [contextualSubmissionPending, setContextualSubmissionPending] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<
    { offerType: 'trip'; offer: Trip } | { offerType: 'route'; offer: Route } | null
  >(null);
  const [availabilityNow, setAvailabilityNow] = useState(() => new Date());
  const confirmationLocks = useRef(new Set<string>());
  const revealSequence = useRef(0);

  const [passengerRequests, setPassengerRequests] = usePersistentArray(storageKeys.passengerRequests, parsePassengerRequest);
  const [driverResponses, setDriverResponses] = usePersistentArray(storageKeys.driverResponses, parseDriverResponse);
  const [targetedRequests, setTargetedRequests] = usePersistentArray(storageKeys.targetedRequests, parseTargetedPassengerRequest);
  const [rideMatches, setRideMatches] = usePersistentArray(storageKeys.rideMatches, parseRideMatch);
  const [notifications, setNotifications] = usePersistentArray(storageKeys.notifications, parseMockNotification);
  const [localDriverProfile, setLocalDriverProfile] = usePersistentValue<LocalDriverProfile>(storageKeys.localDriverProfile, parseLocalDriverProfile);
  const [localTrips, setLocalTrips] = usePersistentArray(storageKeys.localTrips, parseLocalTrip);
  const [localRoutes, setLocalRoutes] = usePersistentArray(storageKeys.localRoutes, parseLocalRoute);

  useEffect(() => {
    const timer = window.setInterval(() => setAvailabilityNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!revealTarget) return;

    let highlightTimer: number | undefined;
    const revealTimer = window.setTimeout(() => {
      const target = document.getElementById(revealTarget.id);
      if (!target) return;

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
      target.classList.add('action-result-highlight');
      highlightTimer = window.setTimeout(() => target.classList.remove('action-result-highlight'), 1_800);
    }, 50);

    return () => {
      window.clearTimeout(revealTimer);
      if (highlightTimer) window.clearTimeout(highlightTimer);
      document.getElementById(revealTarget.id)?.classList.remove('action-result-highlight');
    };
  }, [revealTarget]);

  const dismissActionFeedback = useCallback(() => setActionFeedback(null), []);

  function showActionFeedback(
    message: string,
    tone: ActionFeedbackMessage['tone'] = 'success',
    entityId?: string,
  ) {
    setActionFeedback({ id: makeId('action-feedback'), message, tone });
    if (entityId) {
      revealSequence.current += 1;
      setRevealTarget({ id: getBoardCardId(entityId), sequence: revealSequence.current });
    }
  }

  const mergedOffers = useMemo(
    () => mergeChurchOffers({
      churchId: church.id,
      staticDrivers: drivers,
      staticRoutes: routes,
      staticTrips: trips,
      localDriverProfile,
      localRoutes,
      localTrips,
      rideMatches,
      now: availabilityNow,
    }),
    [availabilityNow, church.id, drivers, localDriverProfile, localRoutes, localTrips, rideMatches, routes, trips],
  );
  const {
    drivers: mergedDrivers,
    routes: mergedRoutes,
    trips: mergedTrips,
    visibleLocalRoutes,
    visibleLocalTrips,
    eligibleLocalRoutes,
    eligibleRawLocalTrips,
    allRoutes,
    allRawTrips,
  } = mergedOffers;
  const ownedTripIds = useMemo(() => visibleLocalTrips.map((trip) => trip.id), [visibleLocalTrips]);
  const ownedRouteIds = useMemo(() => visibleLocalRoutes.map((route) => route.id), [visibleLocalRoutes]);
  const futureChurchServices = useMemo(
    () => getFutureChurchServices(church.schedule?.services, availabilityNow),
    [availabilityNow, church.schedule?.services],
  );
  const serviceOptions = useMemo(() => getChurchServiceOptions(futureChurchServices), [futureChurchServices]);
  const driverNames = useMemo(
    () => Object.fromEntries([
      ...mergedDrivers.map((driver) => [driver.id, driver.publicName] as const),
      ...(localDriverProfile
        ? [[localDriverProfile.driverId, localDriverProfile.publicName] as const]
        : []),
    ]),
    [localDriverProfile, mergedDrivers],
  );
  const targetedRoute =
    dialogContext?.mode === 'targeted' && dialogContext.offerType === 'regularRoute'
      ? allRoutes.find((route) => route.id === dialogContext.offerId)
      : undefined;
  const regularOccurrences = targetedRoute
    ? getFutureRouteOccurrences({
        route: targetedRoute,
        routes: allRoutes,
        trips: allRawTrips,
        rideMatches,
        now: availabilityNow,
      })
    : [];
  const targetedRideDate = dialogContext?.mode === 'targeted'
    ? dialogContext.rideDate ?? draft.date
    : '';
  const compatiblePassengerRequests =
    dialogContext?.mode === 'targeted' && isLocalDate(targetedRideDate)
      ? getCompatiblePassengerRequests({
          churchId: church.id,
          offerId: dialogContext.offerId,
          offerType: dialogContext.offerType,
          rideDate: targetedRideDate,
          serviceEventId: dialogContext.serviceEventId,
          passengerRequests,
          targetedRequests,
        })
      : [];
  const effectiveReusableRequestId = compatiblePassengerRequests.some(
    (request) => request.requestId === selectedReusableRequestId,
  )
    ? selectedReusableRequestId
    : compatiblePassengerRequests.length === 1
      ? compatiblePassengerRequests[0].requestId
      : '';

  function addNotification(message: string, audience?: MockNotification['audience']) {
    setNotifications((current) => [
      { id: makeId('notification'), churchId: church.id, message, createdAt: new Date().toISOString(), audience },
      ...current,
    ]);
  }

  function currentWorkflowState(): RideWorkflowState {
    return { passengerRequests, driverResponses, targetedRequests, rideMatches };
  }

  function applyWorkflowState(state: RideWorkflowState) {
    setPassengerRequests(state.passengerRequests);
    setDriverResponses(state.driverResponses);
    setTargetedRequests(state.targetedRequests);
    setRideMatches(state.rideMatches);
  }

  function closeDialog() {
    setDialogContext(null);
    setDraftErrors({});
    setRequestSubmitAttempt(0);
    setSelectedReusableRequestId('');
    setCreatingDifferentRequest(false);
  }

  function openDriverOfferDialog(nextDraft = createEmptyDriverOfferDraft()) {
    setResponseRequest(null);
    setOfferDraft(nextDraft);
    setOfferDraftErrors({});
    setOfferSubmitAttempt(0);
    setOfferDialogOpen(true);
  }

  function closeDriverOfferDialog() {
    setOfferDialogOpen(false);
    setOfferDraftErrors({});
    setOfferSubmitAttempt(0);
  }

  function changeDriverOfferMode(mode: DriverOfferMode) {
    setOfferDraft((current) => ({
      ...current,
      offerType: mode,
      selectedServiceId: mode === 'route' ? '' : current.selectedServiceId,
      date: mode === 'route' ? '' : current.date,
    }));
    setOfferDraftErrors({});
    setOfferSubmitAttempt(0);
  }

  function validateOfferField(fieldName: keyof DriverOfferDraft) {
    const message = validateDriverOfferField(offerDraft, fieldName, !localDriverProfile, new Date(), church.schedule?.services);
    setOfferDraftErrors((current) => {
      const next = { ...current };
      if (fieldName === 'date' || fieldName === 'selectedServiceId') {
        delete next.date;
        delete next.selectedServiceId;
      } else delete next[fieldName];
      if (message) next[fieldName] = message;
      return next;
    });
  }

  function changeOfferDraft(nextDraft: DriverOfferDraft, fieldName: keyof DriverOfferDraft) {
    setOfferDraft(nextDraft);
    setOfferDraftErrors((current) => {
      const shouldRevalidate = Boolean(current[fieldName]) || ((fieldName === 'date' || fieldName === 'selectedServiceId') && Boolean(current.date || current.selectedServiceId));
      if (!shouldRevalidate) return current;
      const message = validateDriverOfferField(nextDraft, fieldName, !localDriverProfile, new Date(), church.schedule?.services);
      const next = { ...current };
      if (fieldName === 'date' || fieldName === 'selectedServiceId') {
        delete next.date;
        delete next.selectedServiceId;
      } else delete next[fieldName];
      if (message) next[fieldName] = message;
      return next;
    });
  }

  function openOpenRequestDialog() {
    setDraft((current) => ({ ...current, selectedServiceId: '', date: '', comment: '', consent: false }));
    setDraftErrors({});
    setRequestSubmitAttempt(0);
    setDialogContext({ mode: 'open' });
  }

  function openTargetedRequestDialog(context: TargetedRequestDialogInput) {
    setDraft((current) => ({ ...current, selectedServiceId: '', date: context.rideDate ?? '', comment: '', consent: false }));
    setDraftErrors({});
    setRequestSubmitAttempt(0);
    setSelectedReusableRequestId('');
    setCreatingDifferentRequest(false);
    setDialogContext({ mode: 'targeted', ...context });
  }

  function getSourceForMatch(match: RideMatch) {
    return passengerRequests.find((request) => request.id === match.passengerRequestId)
      ?? targetedRequests.find((request) => request.id === match.targetedPassengerRequestId);
  }

  function openPrefilledRequest(source: PassengerRequest | TargetedPassengerRequest, count: number) {
    const targetedSource = 'targetOfferId' in source;
    const serviceDate = targetedSource ? source.rideDate : source.serviceDate;
    const hasFutureService = Boolean(source.serviceEventId && futureChurchServices.some((service) => service.id === source.serviceEventId));
    setDraft({
      firstName: source.firstName,
      phone: source.phonePrivate,
      email: source.emailPrivate ?? '',
      selectedServiceId: hasFutureService ? source.serviceEventId ?? '' : '',
      date: hasFutureService ? '' : serviceDate ?? '',
      passengerCount: String(count),
      pickupArea: source.pickupZone.label,
      comment: (targetedSource ? source.privateComment : source.safePublicComment) ?? '',
      consent: false,
    });
    setDraftErrors({});
    setRequestSubmitAttempt(0);
    setDialogContext({ mode: 'open', sourcePassengerRequestId: source.id });
  }

  function rememberPassengerDetails(phone: string, passengerCount: number) {
    window.localStorage.setItem(storageKeys.passengerDraft, JSON.stringify({
      firstName: draft.firstName.trim(),
      phone,
      email: draft.email.trim(),
      passengerCount: String(passengerCount),
      pickupArea: draft.pickupArea.trim(),
    }));
  }

  function getPassengerValidation(nextDraft: PassengerRequestDraft, now = new Date()) {
    if (!dialogContext) return null;
    const validation = validatePassengerRequestDraft(nextDraft, dialogContext.mode === 'open', now, church.schedule?.services);
    const errors = { ...validation.errors };
    let rideDate = nextDraft.date;

    if (dialogContext.mode === 'targeted') {
      rideDate = dialogContext.rideDate ?? nextDraft.date;
      if (!isLocalDate(rideDate)) errors.date = 'Выберите дату поездки.';
      else {
        const availability = getOfferAvailability({
          offerId: dialogContext.offerId,
          offerType: dialogContext.offerType,
          rideDate,
          routes: allRoutes,
          trips: allRawTrips,
          rideMatches,
          now,
        });
        if (availability.reason === 'wrongWeekday') errors.date = 'Водитель не ездит по этому маршруту в выбранный день.';
        else if (availability.reason === 'past') errors.date = 'Выберите будущую дату поездки.';
        else if (!availability.active) errors.date = 'В этой поездке уже недостаточно свободных мест.';
      }
    }

    return { ...validation, errors, rideDate };
  }

  function validateRequestField(fieldName: keyof PassengerRequestDraft) {
    const validation = getPassengerValidation(draft);
    if (!validation) return;
    setDraftErrors((current) => {
      const next = { ...current };
      if (fieldName === 'date' || fieldName === 'selectedServiceId') {
        delete next.date;
        delete next.selectedServiceId;
        const message = validation.errors.date ?? validation.errors.selectedServiceId;
        if (message) next[fieldName] = message;
      } else {
        delete next[fieldName];
        if (validation.errors[fieldName]) next[fieldName] = validation.errors[fieldName];
      }
      return next;
    });
  }

  function changeRequestDraft(nextDraft: PassengerRequestDraft, fieldName: keyof PassengerRequestDraft) {
    setDraft(nextDraft);
    setDraftErrors((current) => {
      const serviceField = fieldName === 'date' || fieldName === 'selectedServiceId';
      const shouldRevalidate = Boolean(current[fieldName]) || (serviceField && Boolean(current.date || current.selectedServiceId));
      if (!shouldRevalidate) return current;
      const validation = getPassengerValidation(nextDraft);
      if (!validation) return current;
      const next = { ...current };
      if (serviceField) {
        delete next.date;
        delete next.selectedServiceId;
        const message = validation.errors.date ?? validation.errors.selectedServiceId;
        if (message) next[fieldName] = message;
      } else {
        delete next[fieldName];
        if (validation.errors[fieldName]) next[fieldName] = validation.errors[fieldName];
      }
      return next;
    });
  }

  async function handleSubmitRequest() {
    if (!dialogContext) return;

    const now = new Date();
    const validation = getPassengerValidation(draft, now);
    if (!validation) return;
    const { errors, rideDate } = validation;

    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      setRequestSubmitAttempt((current) => current + 1);
      return;
    }

    if (participationBackendAvailable) {
      if (contextualSubmissionPending) return;
      setContextualSubmissionPending(true);
      try {
        const contextualForm = new FormData();
        contextualForm.set('action_type', 'passenger_request');
        contextualForm.set('client_key', crypto.randomUUID());
        contextualForm.set('display_name', draft.firstName);
        contextualForm.set('email', draft.email.trim());
        contextualForm.set('phone', validation.normalizedPhone);
        contextualForm.set('preferred_language', 'ru');
        contextualForm.set('payload', JSON.stringify({
          churchId: church.id,
          churchName: church.name,
          driverOfferId: dialogContext.mode === 'targeted' ? dialogContext.offerId : undefined,
          passengerCount: validation.passengerCount,
          pickupDescription: draft.pickupArea.trim(),
          publicNote: draft.comment.trim() || undefined,
          serviceDate: rideDate,
          serviceId: draft.selectedServiceId
            || (dialogContext.mode === 'targeted' ? dialogContext.serviceEventId : undefined),
          serviceName: formatServiceSelection(draft, church.schedule?.services ?? []),
        }));
        const result = await beginContextualRegistrationAction(contextualForm);
        if (result.status === 'ready') {
          window.location.assign('/auth?context=1');
          return;
        }
        if (result.status === 'email-sent') {
          setDraft((current) => ({
            ...emptyDraft,
            email: current.email.trim(),
            firstName: current.firstName.trim(),
            phone: validation.normalizedPhone,
          }));
          closeDialog();
          showActionFeedback('Проверьте email, чтобы продолжить. Запрос ещё не опубликован.');
          return;
        }
        showActionFeedback(
          result.status === 'rate-limited'
            ? 'Слишком много попыток. Подождите и попробуйте ещё раз.'
            : 'Не удалось безопасно сохранить запрос. Попробуйте ещё раз.',
          'error',
        );
      } finally {
        setContextualSubmissionPending(false);
      }
      return;
    }

    rememberPassengerDetails(validation.normalizedPhone, validation.passengerCount);
    const timestamp = now.toISOString();

    if (dialogContext.mode === 'targeted') {
      const serviceEvent = dialogContext.offerType === 'oneTimeTrip'
        ? dialogContext.serviceEvent
        : `Дата поездки: ${formatDate(rideDate)}`;
      const request: TargetedPassengerRequest = {
        id: makeId('targeted-request'),
        churchId: church.id,
        driverId: dialogContext.driverId,
        driverName: dialogContext.driverName,
        targetOfferId: dialogContext.offerId,
        targetOfferType: dialogContext.offerType,
        offerContext: dialogContext.offerContext,
        rideDate,
        serviceEvent,
        serviceEventId: dialogContext.serviceEventId,
        firstName: draft.firstName.trim(),
        phonePrivate: validation.normalizedPhone,
        emailPrivate: draft.email.trim() || undefined,
        passengerCount: validation.passengerCount,
        pickupZone: { label: draft.pickupArea.trim() },
        privateComment: draft.comment.trim() || undefined,
        consentToShareContact: true,
        status: 'waitingForDriver',
        publicVisible: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setTargetedRequests((current) => [request, ...current]);
      addNotification(`Запрос отправлен водителю ${request.driverName}.`, 'passenger');
      addNotification(`Новый запрос на ${request.passengerCount} пассажиров.`, 'driver');
      showActionFeedback('Запрос водителю отправлен', 'success', request.id);
    } else {
      const request: PassengerRequest = {
        id: makeId('passenger-request'),
        churchId: church.id,
        firstName: draft.firstName.trim(),
        phonePrivate: validation.normalizedPhone,
        emailPrivate: draft.email.trim() || undefined,
        serviceEvent: formatServiceSelection(draft, church.schedule?.services ?? []),
        serviceEventId: draft.selectedServiceId || undefined,
        serviceDate: draft.selectedServiceId
          ? church.schedule?.services?.find((service) => service.id === draft.selectedServiceId)?.date
          : draft.date,
        passengerCount: validation.passengerCount,
        pickupZone: { label: draft.pickupArea.trim() },
        safePublicComment: draft.comment.trim() || undefined,
        consentToShareContact: true,
        status: 'open',
        publicVisible: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        sourcePassengerRequestId: dialogContext.sourcePassengerRequestId,
      };
      setPassengerRequests((current) => [request, ...current]);
      addNotification(`Создан запрос: ${request.firstName} ищет место на ${request.serviceEvent}.`, 'passenger');
      showActionFeedback('Запрос опубликован', 'success', request.id);

      const hasCompatibleOffer = [...allRawTrips, ...allRoutes].some((offer) => {
        if (!request.serviceDate || offer.churchId !== church.id) return false;
        const offerType = 'seatsTotal' in offer ? 'oneTimeTrip' : 'regularRoute';
        const offerId = offer.id;
        return getOfferAvailability({ offerId, offerType, rideDate: request.serviceDate, routes: allRoutes, trips: allRawTrips, rideMatches, now }).active;
      });
      if (hasCompatibleOffer) addNotification('Возможно, эта поездка вам подходит.', 'passenger');
    }

    setDraft((current) => ({ ...emptyDraft, firstName: current.firstName.trim(), phone: validation.normalizedPhone, email: current.email.trim() }));
    closeDialog();
  }

  function handleReuseTargetedRequest() {
    if (dialogContext?.mode !== 'targeted' || !effectiveReusableRequestId) return;
    const source = passengerRequests.find((request) => request.id === effectiveReusableRequestId);
    const rideDate = dialogContext.rideDate ?? draft.date;
    if (!source || !isLocalDate(rideDate)) return;

    const stillCompatible = getCompatiblePassengerRequests({
      churchId: church.id,
      offerId: dialogContext.offerId,
      offerType: dialogContext.offerType,
      rideDate,
      serviceEventId: dialogContext.serviceEventId,
      passengerRequests,
      targetedRequests,
    }).some((request) => request.requestId === source.id);
    const availability = getOfferAvailability({
      offerId: dialogContext.offerId,
      offerType: dialogContext.offerType,
      rideDate,
      routes: allRoutes,
      trips: allRawTrips,
      rideMatches,
      now: new Date(),
    });
    if (!stillCompatible || !availability.active) {
      showActionFeedback('Не удалось отправить запрос: выбранная поездка больше недоступна.', 'error');
      closeDialog();
      return;
    }

    const timestamp = new Date().toISOString();
    const request = createTargetedRequestFromPassengerRequest({
      source,
      id: makeId('targeted-request'),
      driverId: dialogContext.driverId,
      driverName: dialogContext.driverName,
      offerId: dialogContext.offerId,
      offerType: dialogContext.offerType,
      offerContext: dialogContext.offerContext,
      rideDate,
      serviceEventId: dialogContext.serviceEventId,
      createdAt: timestamp,
    });
    if (!request) return;

    setTargetedRequests((current) => [request, ...current]);
    addNotification(`Запрос отправлен водителю ${request.driverName}.`, 'passenger');
    addNotification(`Новый запрос на ${request.passengerCount} пассажиров.`, 'driver');
    showActionFeedback('Запрос водителю отправлен', 'success', request.id);
    closeDialog();
  }

  async function handleSubmitDriverOffer() {
    const now = new Date();
    const { errors } = validateDriverOfferDraft(offerDraft, !localDriverProfile, now, church.schedule?.services);
    if (Object.keys(errors).length > 0) {
      setOfferDraftErrors(errors);
      setOfferSubmitAttempt((current) => current + 1);
      return;
    }

    if (participationBackendAvailable) {
      if (contextualSubmissionPending) return;
      const profileName = localDriverProfile?.publicName ?? offerDraft.publicName;
      const profilePhone = localDriverProfile?.phonePrivate ?? offerDraft.phone;
      const profileEmail = localDriverProfile?.emailPrivate ?? offerDraft.email;
      setContextualSubmissionPending(true);
      try {
        const contextualForm = new FormData();
        contextualForm.set('action_type', 'driver_offer');
        contextualForm.set('client_key', crypto.randomUUID());
        contextualForm.set('display_name', profileName);
        contextualForm.set('email', profileEmail?.trim() || '');
        contextualForm.set('phone', profilePhone);
        contextualForm.set('preferred_language', 'ru');
        contextualForm.set('payload', JSON.stringify({
          churchId: church.id,
          churchName: church.name,
          date: offerDraft.date || undefined,
          departureDescription: offerDraft.originLabel.trim(),
          departureTime: offerDraft.departureTime || undefined,
          maxDetourKm: Number(offerDraft.maxDetourKm),
          offerMode: offerDraft.offerType,
          returnRequired: offerDraft.returnTrip,
          seatsAvailable: Number(offerDraft.seats),
          serviceId: offerDraft.selectedServiceId || undefined,
          serviceName: formatServiceSelection(offerDraft, church.schedule?.services ?? []),
          weekdays: offerDraft.weekdays,
        }));
        const result = await beginContextualRegistrationAction(contextualForm);
        if (result.status === 'ready') {
          window.location.assign('/auth?context=1');
          return;
        }
        if (result.status === 'email-sent') {
          setOfferDraft(createEmptyDriverOfferDraft());
          closeDriverOfferDialog();
          showActionFeedback('Проверьте email, чтобы продолжить. Поездка ещё не опубликована.');
          return;
        }
        showActionFeedback(
          result.status === 'rate-limited'
            ? 'Слишком много попыток. Подождите и попробуйте ещё раз.'
            : 'Не удалось безопасно сохранить поездку. Попробуйте ещё раз.',
          'error',
        );
      } finally {
        setContextualSubmissionPending(false);
      }
      return;
    }

    const profile = localDriverProfile ?? createLocalDriverProfile(offerDraft, makeId('local-owner'), makeId('local-driver'));
    if (!localDriverProfile) setLocalDriverProfile(profile);

    if (offerDraft.offerType === 'trip') {
      const trip = createLocalTrip(offerDraft, church.id, profile.driverId, makeId('local-trip'), church.schedule?.services);
      setLocalTrips((current) => [trip, ...current]);
      addNotification(`Создана поездка: ${formatDateTime(trip.date, trip.departureTime)}, выезд из ${trip.originLabel}.`, 'driver');
      showActionFeedback('Поездка опубликована', 'success', trip.id);
      if (passengerRequests.some((request) => request.churchId === church.id && request.status === 'open' && request.serviceDate === trip.date)) {
        addNotification('Найдены возможные пассажиры для нового предложения.', 'driver');
      }
    } else {
      const route = createLocalRoute(offerDraft, church.id, profile.driverId, makeId('local-route'));
      setLocalRoutes((current) => [route, ...current]);
      addNotification(`Создана регулярная поездка: выезд из ${route.originLabel} в ${route.recurrence.typicalDepartureTime}.`, 'driver');
      showActionFeedback('Регулярная поездка опубликована', 'success', route.id);
      if (passengerRequests.some((request) => request.churchId === church.id && request.status === 'open' && Boolean(request.serviceDate && routeIncludesDate(route, request.serviceDate)))) {
        addNotification('Найдены возможные пассажиры для нового предложения.', 'driver');
      }
    }

    setOfferDraft(createEmptyDriverOfferDraft());
    closeDriverOfferDialog();
    setAvailabilityNow(now);
  }

  function handleCancelTrip(trip: Trip) {
    if (isLocallyOwnedOffer(trip, localTrips, localDriverProfile)) setPendingCancellation({ offerType: 'trip', offer: trip });
  }

  function handleCancelRoute(route: Route) {
    if (isLocallyOwnedOffer(route, localRoutes, localDriverProfile)) setPendingCancellation({ offerType: 'route', offer: route });
  }

  const affectedOfferMatches = pendingCancellation
    ? getFutureConfirmedMatchesForOffer(
        rideMatches,
        pendingCancellation.offer.id,
        pendingCancellation.offerType === 'trip' ? 'oneTimeTrip' : 'regularRoute',
        pendingCancellation.offer.churchId,
        allRoutes,
        allRawTrips,
        availabilityNow,
      )
    : [];

  function confirmOfferCancellation() {
    if (!pendingCancellation) return;
    const now = new Date();
    const timestamp = now.toISOString();
    const offerType = pendingCancellation.offerType === 'trip' ? 'oneTimeTrip' : 'regularRoute';
    const nextState = cancelFutureMatchesForOffer(currentWorkflowState(), pendingCancellation.offer.id, offerType, pendingCancellation.offer.churchId, allRoutes, allRawTrips, now, timestamp);
    applyWorkflowState(nextState);

    if (pendingCancellation.offerType === 'trip') {
      setLocalTrips((current) => current.map((item) =>
        item.id === pendingCancellation.offer.id && item.churchId === pendingCancellation.offer.churchId
          ? cancelLocalTrip(item)
          : item,
      ));
      addNotification('Поездка отменена.', 'driver');
      showActionFeedback('Поездка отменена');
    } else {
      setLocalRoutes((current) => current.map((item) =>
        item.id === pendingCancellation.offer.id && item.churchId === pendingCancellation.offer.churchId
          ? cancelLocalRoute(item)
          : item,
      ));
      addNotification('Регулярная поездка отменена.', 'driver');
      showActionFeedback('Регулярная поездка отменена');
    }
    if (nextState.rideMatches.filter((match) => match.cancelledAt === timestamp).length > 0) {
      addNotification('Договорённость отменена водителем. Можно опубликовать запрос снова.', 'passenger');
    }
    setPendingCancellation(null);
    setAvailabilityNow(now);
  }

  const compatibleResponseOffers = responseRequest
    ? getCompatibleOwnedOffers({
        request: responseRequest,
        routes: eligibleLocalRoutes,
        trips: eligibleRawLocalTrips,
        rideMatches,
        localDriverProfile,
        now: availabilityNow,
      }).filter((offer) => !driverResponses.some((response) => response.passengerRequestId === responseRequest.id && response.driverOfferId === offer.offerId && isDriverResponseActive(response)))
    : [];

  function handleSubmitResponse(offer: CompatibleDriverOffer, offeredPassengerCount: number) {
    if (!responseRequest) return;
    const now = new Date();
    const currentOffer = getCompatibleOwnedOffers({
      request: responseRequest,
      routes: eligibleLocalRoutes,
      trips: eligibleRawLocalTrips,
      rideMatches,
      localDriverProfile,
      now,
    }).find((item) => item.offerId === offer.offerId && item.offerType === offer.offerType);
    if (!currentOffer) {
      showActionFeedback('Не удалось отправить предложение: в поездке недостаточно мест.', 'error');
      setResponseRequest(null);
      return;
    }
    const response = createPendingDriverResponse({ request: responseRequest, offer: currentOffer, offeredPassengerCount, id: makeId('driver-response'), createdAt: now.toISOString() });
    if (!response) {
      showActionFeedback('Не удалось отправить предложение. Проверьте количество мест.', 'error');
      return;
    }
    setDriverResponses((current) => [response, ...current]);
    addNotification(`Водитель предложил ${formatSeatCount(response.offeredPassengerCount)} для запроса ${responseRequest.firstName}.`, 'passenger');
    showActionFeedback('Предложение отправлено', 'success', response.id);
    setResponseRequest(null);
  }

  function handleSubmitPrivateResponse(privateDraft: PrivateDriverOfferDraft) {
    if (!responseRequest) return;
    const now = new Date();
    const requireProfile = !localDriverProfile;
    const validation = validatePrivateDriverOfferDraft({
      draft: privateDraft,
      request: responseRequest,
      requireProfile,
      now,
    });
    if (Object.keys(validation.errors).length > 0) return;

    const profile: LocalDriverProfile = localDriverProfile ?? {
      ownerId: makeId('local-owner'),
      driverId: makeId('local-driver'),
      publicName: privateDraft.publicName.trim(),
      phonePrivate: validation.normalizedPhone,
      emailPrivate: privateDraft.email.trim() || undefined,
    };
    if (
      driverResponses.some(
        (response) =>
          response.passengerRequestId === responseRequest.id &&
          response.driverId === profile.driverId &&
          isDriverResponseActive(response),
      )
    ) {
      showActionFeedback('Не удалось отправить предложение: оно уже было отправлено.', 'error');
      setResponseRequest(null);
      return;
    }

    const response = createPrivateDriverResponse({
      request: responseRequest,
      draft: privateDraft,
      driverId: profile.driverId,
      id: makeId('driver-response'),
      createdAt: now.toISOString(),
      requireProfile,
      now,
    });
    if (!response) return;

    if (!localDriverProfile) setLocalDriverProfile(profile);
    setDriverResponses((current) => [response, ...current]);
    addNotification(`Водитель предложил ${formatSeatCount(response.offeredPassengerCount)} для запроса ${responseRequest.firstName}.`, 'passenger');
    showActionFeedback('Предложение отправлено', 'success', response.id);
    setResponseRequest(null);
  }

  function commitConfirmation(source: 'targetedRequest' | 'driverResponse', sourceId: string, count: number) {
    if (confirmationLocks.current.has(sourceId)) return;
    confirmationLocks.current.add(sourceId);
    const now = new Date();
    const targeted = targetedRequests.find((request) => request.id === sourceId);
    const response = driverResponses.find((item) => item.id === sourceId);
    const driverId = targeted?.driverId ?? response?.driverId ?? '';
    const result = confirmRideMatch({
      source,
      sourceId,
      confirmedPassengerCount: count,
      matchId: makeId('ride-match'),
      timestamp: now.toISOString(),
      driverName: targeted?.driverName ?? driverNames[driverId] ?? localDriverProfile?.publicName ?? 'Водитель',
      driverContact: getDriverPrivateContact(driverId, localDriverProfile),
      state: currentWorkflowState(),
      routes: allRoutes,
      trips: allRawTrips,
      now,
    });

    if (!result.ok) {
      showActionFeedback(
        result.reason === 'insufficientSeats'
          ? 'В этой поездке уже недостаточно свободных мест.'
          : result.reason === 'driverContactUnavailable'
            ? 'Контакт водителя недоступен. Выберите другое предложение.'
            : 'Эта договорённость уже обработана или больше недоступна.',
        'error',
      );
      confirmationLocks.current.delete(sourceId);
      return;
    }

    applyWorkflowState(result.state);
    addNotification(`Поездка подтверждена для ${result.rideMatch.confirmedPassengerCount} пассажиров.`, 'passenger');
    addNotification('Пассажир подтвердил поездку. Контакты доступны в договорённости.', 'driver');
    showActionFeedback('Поездка подтверждена', 'success', result.rideMatch.id);
    setAvailabilityNow(now);
  }

  function resolveTargetedRequest(request: TargetedPassengerRequest) {
    if (request.rideDate) return request;
    if (request.targetOfferType !== 'oneTimeTrip') return request;
    const trip = allRawTrips.find((item) => item.id === request.targetOfferId);
    return trip ? { ...request, rideDate: trip.date, serviceEvent: request.serviceEvent || `Дата поездки: ${formatDate(trip.date)}` } : request;
  }

  function handleAcceptTargetedFull(request: TargetedPassengerRequest) {
    const resolved = resolveTargetedRequest(request);
    if (!resolved.rideDate) return;
    if (confirmationLocks.current.has(resolved.id)) return;
    confirmationLocks.current.add(resolved.id);
    setTargetedRequests((current) => current.map((item) => item.id === resolved.id ? resolved : item));
    const state = { ...currentWorkflowState(), targetedRequests: targetedRequests.map((item) => item.id === resolved.id ? resolved : item) };
    const now = new Date();
    const result = confirmRideMatch({
      source: 'targetedRequest', sourceId: resolved.id, confirmedPassengerCount: resolved.passengerCount,
      matchId: makeId('ride-match'), timestamp: now.toISOString(), driverName: resolved.driverName,
      driverContact: getDriverPrivateContact(resolved.driverId, localDriverProfile), state,
      routes: allRoutes, trips: allRawTrips, now,
    });
    if (!result.ok) {
      showActionFeedback(
        result.reason === 'insufficientSeats'
          ? 'В этой поездке уже недостаточно свободных мест.'
          : 'Запрос больше нельзя подтвердить.',
        'error',
      );
      confirmationLocks.current.delete(resolved.id);
      return;
    }
    applyWorkflowState(result.state);
    addNotification(`Водитель ${resolved.driverName} подтвердил поездку.`, 'passenger');
    addNotification('Поездка подтверждена. Контакты участников открыты.', 'driver');
    showActionFeedback('Поездка подтверждена', 'success', result.rideMatch.id);
    setAvailabilityNow(now);
  }

  function handleOfferPartial(request: TargetedPassengerRequest, count: number) {
    const resolved = resolveTargetedRequest(request);
    if (!resolved.rideDate) return;
    const availability = getOfferAvailability({ offerId: resolved.targetOfferId, offerType: resolved.targetOfferType, rideDate: resolved.rideDate, routes: allRoutes, trips: allRawTrips, rideMatches, now: new Date() });
    if (!availability.active || count > availability.availableSeats) {
      showActionFeedback('Не удалось отправить предложение: в поездке недостаточно мест.', 'error');
      return;
    }
    const updated = offerPartialTargetedRequest(resolved, count, new Date().toISOString());
    if (!updated) return;
    setTargetedRequests((current) => current.map((item) => item.id === request.id ? updated : item));
    addNotification(`${resolved.driverName} может подвезти ${count} из ${resolved.passengerCount} человек.`, 'passenger');
    showActionFeedback('Предложение отправлено', 'success', updated.id);
  }

  function handleDeclineTargeted(request: TargetedPassengerRequest) {
    const timestamp = new Date().toISOString();
    setTargetedRequests((current) => current.map((item) => item.id === request.id ? declineTargetedRequest(item, timestamp) : item));
    addNotification('Адресный запрос отклонён.', request.status === 'waitingForDriver' ? 'passenger' : 'driver');
    showActionFeedback('Запрос отклонён');
  }

  function handleCancelResponse(response: DriverResponse) {
    const timestamp = new Date().toISOString();
    setDriverResponses((current) => current.map((item) => item.id === response.id ? cancelDriverResponse(item, timestamp) : item));
    addNotification('Предложение водителя отменено.', 'passenger');
    showActionFeedback('Предложение отменено');
  }

  function handleDeclineResponse(response: DriverResponse) {
    const timestamp = new Date().toISOString();
    setDriverResponses((current) => current.map((item) => item.id === response.id ? declineDriverResponse(item, timestamp) : item));
    addNotification('Пассажир отклонил предложение водителя.', 'driver');
    showActionFeedback('Предложение отклонено');
  }

  function handleCancelMatch(match: RideMatch, participant: 'passenger' | 'driver') {
    setPendingMatchCancellation({ match, participant });
  }

  function confirmMatchCancellation() {
    if (!pendingMatchCancellation) return;
    const now = new Date();
    applyWorkflowState(cancelRideMatch(currentWorkflowState(), pendingMatchCancellation.match.id, now.toISOString()));
    addNotification('Договорённость отменена. Запрос можно опубликовать снова.', 'passenger');
    addNotification('Договорённость отменена, места снова доступны.', 'driver');
    showActionFeedback('Договорённость отменена', 'success', pendingMatchCancellation.match.id);
    setPendingMatchCancellation(null);
    setAvailabilityNow(now);
  }

  function republishFromMatch(match: RideMatch, count: number) {
    const source = getSourceForMatch(match);
    if (!source) return;
    const timestamp = new Date().toISOString();
    const request = republishPassengerRequest(source, count, makeId('passenger-request'), timestamp);
    if (!request) return;
    setPassengerRequests((current) => [request, ...current]);
    setRideMatches((current) => current.map((item) => item.id === match.id ? markRemainingNeedHandled(item, timestamp) : item));
    addNotification(`Создан новый запрос для ${count} пассажиров.`, 'passenger');
    showActionFeedback('Запрос опубликован', 'success', request.id);
  }

  function handleNoMoreSeatsNeeded(match: RideMatch) {
    const timestamp = new Date().toISOString();
    setRideMatches((current) => current.map((item) => item.id === match.id ? markRemainingNeedHandled(item, timestamp) : item));
    showActionFeedback('Запрос обновлён', 'success', match.id);
  }

  const churchRequests = passengerRequests.filter((request) => request.churchId === church.id);
  const publicRequestItems = getPublicPassengerRequestItems({
    churchId: church.id,
    passengerRequests,
    rideMatches,
  });
  const activeResponses = driverResponses.filter((response) => isDriverResponseActive(response) && churchRequests.some((request) => request.id === response.passengerRequestId));
  const churchTargetedRequests = targetedRequests
    .filter((request) => request.churchId === church.id && (request.status === 'waitingForDriver' || request.status === 'pendingPassengerConfirmation'))
    .map(resolveTargetedRequest)
    .filter((request) => Boolean(request.rideDate));
  const targetedAvailability = Object.fromEntries(churchTargetedRequests.map((request) => [
    request.id,
    request.rideDate ? getOfferAvailability({ offerId: request.targetOfferId, offerType: request.targetOfferType, rideDate: request.rideDate, routes: allRoutes, trips: allRawTrips, rideMatches, now: availabilityNow }).availableSeats : 0,
  ]));
  const churchMatches = rideMatches.filter((match) => match.churchId === church.id);
  const directRepublishEnabled = Object.fromEntries(churchMatches.map((match) => {
    const source = getSourceForMatch(match);
    const alreadyRepublished = source ? passengerRequests.some((request) => request.sourcePassengerRequestId === source.id) : false;
    return [match.id, Boolean(source && !alreadyRepublished && canDirectlyRepublish({
      source,
      match,
      routes: allRoutes,
      trips: allRawTrips,
      services: church.schedule?.services,
      now: availabilityNow,
    }))];
  }));
  const alreadyRepublished = Object.fromEntries(churchMatches.map((match) => {
    const source = getSourceForMatch(match);
    return [match.id, Boolean(source && passengerRequests.some((request) => request.sourcePassengerRequestId === source.id))];
  }));
  const remainingActionsEnabled = Object.fromEntries(churchMatches.map((match) => {
    const source = getSourceForMatch(match);
    const alreadyRepublished = source ? passengerRequests.some((request) => request.sourcePassengerRequestId === source.id) : false;
    return [match.id, !match.remainingNeedHandledAt && !alreadyRepublished];
  }));
  const completedSummaries = getCompletedActivitySummaries({
    churchId: church.id,
    passengerRequests,
    rideMatches,
    routes: allRoutes,
    trips: allRawTrips,
    driverNames,
    now: availabilityNow,
  });
  const churchNotifications = notifications.filter((notification) => notification.churchId === church.id);
  const dialogTargetedAvailability = dialogContext?.mode === 'targeted' && isLocalDate(targetedRideDate)
    ? getOfferAvailability({
        offerId: dialogContext.offerId,
        offerType: dialogContext.offerType,
        rideDate: targetedRideDate,
        routes: allRoutes,
        trips: allRawTrips,
        rideMatches,
        now: availabilityNow,
      }).availableSeats
    : undefined;
  const selectedReusableRequest = compatiblePassengerRequests.find(
    (request) => request.requestId === effectiveReusableRequestId,
  );
  const targetedRequestedCount =
    selectedReusableRequest && !creatingDifferentRequest
      ? selectedReusableRequest.remainingPassengerCount
      : Number(draft.passengerCount);
  const overCapacityWarning = getOverCapacityRequestWarning(
    dialogTargetedAvailability,
    targetedRequestedCount,
  );

  return (
    <section className="mt-5 grid gap-5">
      <ActionFeedback feedback={actionFeedback} onDismiss={dismissActionFeedback} />
      <NotificationCenter notifications={churchNotifications} />
      <PageActions onCreateOffer={() => openDriverOfferDialog()} onCreateRequest={openOpenRequestDialog} />
      <ActiveDriverResponses
        driverNames={driverNames}
        onAcceptResponse={(response) => commitConfirmation('driverResponse', response.id, response.offeredPassengerCount)}
        onCancelResponse={handleCancelResponse}
        onDeclineResponse={handleDeclineResponse}
        passengerRequests={churchRequests}
        responses={activeResponses}
      />
      <TargetedRequestPanel
        availabilityByRequestId={targetedAvailability}
        onAcceptFull={handleAcceptTargetedFull}
        onAcceptPartial={(request) => request.offeredPassengerCount && commitConfirmation('targetedRequest', request.id, request.offeredPassengerCount)}
        onDecline={handleDeclineTargeted}
        onOfferPartial={handleOfferPartial}
        requests={churchTargetedRequests}
      />
      <RideMatchPanel
        alreadyRepublished={alreadyRepublished}
        directRepublishEnabled={directRepublishEnabled}
        matches={churchMatches}
        onCancelMatch={handleCancelMatch}
        onEditCancelled={(match) => {
          const source = getSourceForMatch(match);
          if (source) openPrefilledRequest(source, match.originalPassengerCount);
        }}
        onEditRemaining={(match) => {
          const source = getSourceForMatch(match);
          if (source) openPrefilledRequest(source, match.originalPassengerCount - match.confirmedPassengerCount);
        }}
        onNoMoreSeatsNeeded={handleNoMoreSeatsNeeded}
        onRepublishCancelled={(match) => republishFromMatch(match, match.originalPassengerCount)}
        onRepublishRemaining={(match) => republishFromMatch(match, match.originalPassengerCount - match.confirmedPassengerCount)}
        passengerRequests={passengerRequests}
        remainingActionsEnabled={remainingActionsEnabled}
        targetedRequests={targetedRequests}
      />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <PassengerRequestList
          onRespond={(requestId) => {
            const request = churchRequests.find((item) => item.id === requestId);
            if (request) setResponseRequest(request);
          }}
          requests={publicRequestItems}
        />
        <DriverOffers
          church={church}
          drivers={mergedDrivers}
          onCancelRoute={handleCancelRoute}
          onCancelTrip={handleCancelTrip}
          onRequestRide={openTargetedRequestDialog}
          ownedRouteIds={ownedRouteIds}
          ownedTripIds={ownedTripIds}
          routes={mergedRoutes}
          trips={mergedTrips}
        />
      </div>
      <CompletedActivity summaries={completedSummaries} />

      {responseRequest ? (
        <DriverResponseDialog
          churchName={church.name}
          offers={compatibleResponseOffers}
          onCancel={() => setResponseRequest(null)}
          onSubmit={handleSubmitResponse}
          onSubmitPrivate={handleSubmitPrivateResponse}
          request={responseRequest}
          savedProfile={localDriverProfile ? { publicName: localDriverProfile.publicName } : null}
        />
      ) : null}
      {offerDialogOpen ? (
        <DriverOfferDialog
          draft={offerDraft}
          errors={offerDraftErrors}
          onBlur={validateOfferField}
          onCancel={closeDriverOfferDialog}
          onChange={changeOfferDraft}
          onModeChange={changeDriverOfferMode}
          onSubmit={handleSubmitDriverOffer}
          savedProfile={localDriverProfile ? { publicName: localDriverProfile.publicName } : null}
          services={futureChurchServices}
          submitAttempt={offerSubmitAttempt}
          submitting={contextualSubmissionPending}
        />
      ) : null}
      {pendingCancellation ? (
        <OfferCancellationDialog
          affectedMatchCount={affectedOfferMatches.length}
          offerType={pendingCancellation.offerType}
          onCancel={() => setPendingCancellation(null)}
          onConfirm={confirmOfferCancellation}
        />
      ) : null}
      {pendingMatchCancellation ? (
        <MatchCancellationDialog
          onCancel={() => setPendingMatchCancellation(null)}
          onConfirm={confirmMatchCancellation}
          participant={pendingMatchCancellation.participant}
        />
      ) : null}
      {dialogContext ? (
        <RequestDialog
          compatibleRequests={compatiblePassengerRequests}
          context={dialogContext}
          creatingDifferentRequest={creatingDifferentRequest}
          draft={draft}
          errors={draftErrors}
          onCreateDifferentRequest={() => setCreatingDifferentRequest(true)}
          onBlur={validateRequestField}
          onCancel={closeDialog}
          onChange={changeRequestDraft}
          onReuseRequest={handleReuseTargetedRequest}
          onSelectReusableRequest={setSelectedReusableRequestId}
          onSubmit={handleSubmitRequest}
          overCapacityWarning={overCapacityWarning}
          regularOccurrences={regularOccurrences}
          selectedReusableRequestId={effectiveReusableRequestId}
          serviceOptions={serviceOptions}
          submitAttempt={requestSubmitAttempt}
          submitting={contextualSubmissionPending}
          targetedAvailability={dialogTargetedAvailability}
        />
      ) : null}
    </section>
  );
}
