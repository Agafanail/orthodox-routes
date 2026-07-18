'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActiveDriverResponses } from '@/components/church-transport-board/active-driver-responses';
import { DriverOfferDialog } from '@/components/church-transport-board/driver-offer-dialog';
import { DriverOffers } from '@/components/church-transport-board/driver-offers';
import { NotificationCenter } from '@/components/church-transport-board/notification-center';
import { OfferCancellationDialog } from '@/components/church-transport-board/offer-cancellation-dialog';
import { PageActions } from '@/components/church-transport-board/page-actions';
import { PassengerRequestList } from '@/components/church-transport-board/passenger-request-list';
import { RequestDialog } from '@/components/church-transport-board/request-dialog';
import { TargetedRequestPanel } from '@/components/church-transport-board/targeted-request-panel';
import type {
  RequestDialogContext,
  TargetedRequestDialogInput,
} from '@/components/church-transport-board/types';
import { formatDateTime } from '@/lib/dateFormat';
import { mergeChurchOffers } from '@/lib/churchOfferCounts';
import {
  cancelLocalRoute,
  cancelLocalTrip,
  createEmptyDriverOfferDraft,
  createLocalDriverProfile,
  createLocalRoute,
  createLocalTrip,
  createRegularRoutePrefill,
  isLocallyOwnedOffer,
  isTargetedOfferAvailable,
  parseLocalDriverProfile,
  parseLocalRoute,
  parseLocalTrip,
  validateDriverOfferField,
  validateDriverOfferDraft,
  type DriverOfferDraft,
  type DriverOfferDraftErrors,
  type DriverOfferMode,
} from '@/lib/driverOfferState';
import { driverOfferStorageKeys } from '@/lib/driverOfferStorage';
import { formatServiceSelection, getChurchServiceOptions, getFutureChurchServices } from '@/lib/serviceOptions';
import {
  cancelDriverResponse,
  createPendingDriverResponse,
  isDriverResponseActive,
  isPassengerRequestPublic,
  markPassengerRequestResponded,
  restorePassengerRequestAfterCancellation,
} from '@/lib/passengerRequestState';
import {
  clearPassengerRequestDraftFieldError,
  validatePassengerRequestDraft,
  type PassengerRequestDraft,
  type PassengerRequestDraftErrors,
} from '@/lib/passengerRequestValidation';
import { readStoredArray } from '@/lib/storage';
import type {
  Church,
  DriverPublicProfile,
  DriverResponse,
  LocalDriverProfile,
  MockNotification,
  PassengerRequest,
  Route,
  TargetedPassengerRequest,
  Trip,
} from '@/lib/types';

type ChurchTransportBoardProps = {
  church: Church;
  drivers: DriverPublicProfile[];
  routes: Route[];
  trips: Trip[];
};

const storageKeys = {
  passengerDraft: 'orthodox-routes:passenger-draft',
  passengerRequests: 'orthodox-routes:passenger-requests',
  driverResponses: 'orthodox-routes:driver-responses',
  targetedRequests: 'orthodox-routes:targeted-requests',
  notifications: 'orthodox-routes:notifications',
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
  if (typeof window === 'undefined') {
    return emptyDraft;
  }

  const savedDraft = window.localStorage.getItem(storageKeys.passengerDraft);

  if (!savedDraft) {
    return emptyDraft;
  }

  try {
    const parsed = JSON.parse(savedDraft) as Partial<PassengerRequestDraft>;
    return { ...emptyDraft, ...parsed, consent: false };
  } catch {
    window.localStorage.removeItem(storageKeys.passengerDraft);
    return emptyDraft;
  }
}

function usePersistentArray<T>(key: string, parseItem?: (value: unknown) => T | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      const storedItems = readStoredArray<unknown>(window.localStorage, key);
      setItems(parseItem ? storedItems.map(parseItem).filter((item): item is T => item !== null) : (storedItems as T[]));
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, [key, parseItem]);

  useEffect(() => {
    if (loaded) {
      window.localStorage.setItem(key, JSON.stringify(items));
    }
  }, [items, key, loaded]);

  return [items, setItems] as const;
}

function usePersistentValue<T>(key: string, parseValue: (value: unknown) => T | null) {
  const [value, setValue] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        const storedValue = window.localStorage.getItem(key);

        if (storedValue) {
          const parsed: unknown = JSON.parse(storedValue);

          const parsedValue = parseValue(parsed);

          if (parsedValue) {
            setValue(parsedValue);
          } else {
            window.localStorage.removeItem(key);
          }
        }
      } catch {
        window.localStorage.removeItem(key);
      }

      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, [key, parseValue]);

  useEffect(() => {
    if (loaded && value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }, [key, loaded, value]);

  return [value, setValue] as const;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ChurchTransportBoard({ church, drivers, routes, trips }: ChurchTransportBoardProps) {
  const [dialogContext, setDialogContext] = useState<RequestDialogContext | null>(null);
  const [draft, setDraft] = useState<PassengerRequestDraft>(getInitialDraft);
  const [draftErrors, setDraftErrors] = useState<PassengerRequestDraftErrors>({});
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState<DriverOfferDraft>(() => createEmptyDriverOfferDraft());
  const [offerDraftErrors, setOfferDraftErrors] = useState<DriverOfferDraftErrors>({});
  const [offerSubmitAttempt, setOfferSubmitAttempt] = useState(0);
  const [regularRouteSuggestion, setRegularRouteSuggestion] = useState<DriverOfferDraft | null>(null);
  const [pendingCancellation, setPendingCancellation] = useState<
    { offerType: 'trip'; offer: Trip } | { offerType: 'route'; offer: Route } | null
  >(null);
  const [availabilityNow, setAvailabilityNow] = useState(() => new Date());
  const [passengerRequests, setPassengerRequests] = usePersistentArray<PassengerRequest>(storageKeys.passengerRequests);
  const [driverResponses, setDriverResponses] = usePersistentArray<DriverResponse>(storageKeys.driverResponses);
  const [targetedRequests, setTargetedRequests] = usePersistentArray<TargetedPassengerRequest>(
    storageKeys.targetedRequests,
  );
  const [notifications, setNotifications] = usePersistentArray<MockNotification>(storageKeys.notifications);
  const [localDriverProfile, setLocalDriverProfile] = usePersistentValue<LocalDriverProfile>(
    storageKeys.localDriverProfile,
    parseLocalDriverProfile,
  );
  const [localTrips, setLocalTrips] = usePersistentArray<Trip>(storageKeys.localTrips, parseLocalTrip);
  const [localRoutes, setLocalRoutes] = usePersistentArray<Route>(storageKeys.localRoutes, parseLocalRoute);

  useEffect(() => {
    const visibilityTimer = window.setInterval(() => setAvailabilityNow(new Date()), 60_000);
    return () => window.clearInterval(visibilityTimer);
  }, []);

  const mergedOffers = useMemo(
    () =>
      mergeChurchOffers({
        churchId: church.id,
        staticDrivers: drivers,
        staticRoutes: routes,
        staticTrips: trips,
        localDriverProfile,
        localRoutes,
        localTrips,
        now: availabilityNow,
      }),
    [availabilityNow, church.id, drivers, localDriverProfile, localRoutes, localTrips, routes, trips],
  );
  const {
    drivers: mergedDrivers,
    routes: mergedRoutes,
    trips: mergedTrips,
    visibleLocalRoutes,
    visibleLocalTrips,
    eligibleLocalRoutes,
    eligibleLocalTrips,
    localPublicDriver,
  } = mergedOffers;
  const ownedTripIds = useMemo(
    () =>
      visibleLocalTrips.map((trip) => trip.id),
    [visibleLocalTrips],
  );
  const ownedRouteIds = useMemo(
    () =>
      visibleLocalRoutes.map((route) => route.id),
    [visibleLocalRoutes],
  );
  const futureChurchServices = useMemo(
    () => getFutureChurchServices(church.schedule?.services, availabilityNow),
    [availabilityNow, church.schedule?.services],
  );
  const serviceOptions = useMemo(
    () => getChurchServiceOptions(futureChurchServices),
    [futureChurchServices],
  );

  function addNotification(message: string) {
    setNotifications((current) => [
      { id: makeId('notification'), churchId: church.id, message, createdAt: new Date().toISOString() },
      ...current,
    ]);
  }

  function closeDialog() {
    setDialogContext(null);
    setDraftErrors({});
  }

  function openDriverOfferDialog(nextDraft = createEmptyDriverOfferDraft()) {
    setRegularRouteSuggestion(null);
    setOfferDraft(nextDraft);
    setOfferDraftErrors({});
    setOfferSubmitAttempt(0);
    setOfferDialogOpen(true);
  }

  function closeDriverOfferDialog() {
    setOfferDialogOpen(false);
    setOfferDraftErrors({});
    setOfferSubmitAttempt(0);
    setRegularRouteSuggestion(null);
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
    const message = validateDriverOfferField(
      offerDraft,
      fieldName,
      !localDriverProfile,
      new Date(),
      church.schedule?.services,
    );

    setOfferDraftErrors((current) => {
      const next = { ...current };
      const errorField = fieldName === 'date' ? 'date' : fieldName;
      if (fieldName === 'date' || fieldName === 'selectedServiceId') {
        delete next.date;
        delete next.selectedServiceId;
      }
      if (message) {
        next[errorField] = message;
      } else {
        delete next[errorField];
      }
      return next;
    });
  }

  function changeOfferDraft(nextDraft: DriverOfferDraft, fieldName: keyof DriverOfferDraft) {
    setOfferDraft(nextDraft);
    setOfferDraftErrors((current) => {
      const shouldRevalidate =
        Boolean(current[fieldName]) ||
        ((fieldName === 'date' || fieldName === 'selectedServiceId') && Boolean(current.date || current.selectedServiceId));

      if (!shouldRevalidate) {
        return current;
      }

      const message = validateDriverOfferField(
        nextDraft,
        fieldName,
        !localDriverProfile,
        new Date(),
        church.schedule?.services,
      );
      const nextErrors = { ...current };
      if (fieldName === 'date' || fieldName === 'selectedServiceId') {
        delete nextErrors.date;
        delete nextErrors.selectedServiceId;
      } else {
        delete nextErrors[fieldName];
      }
      if (message) {
        nextErrors[fieldName === 'selectedServiceId' ? 'selectedServiceId' : fieldName] = message;
      }
      return nextErrors;
    });
  }

  function openOpenRequestDialog() {
    setDraft((current) => ({ ...current, selectedServiceId: '', date: '', comment: '', consent: false }));
    setDraftErrors({});
    setDialogContext({ mode: 'open' });
  }

  function openTargetedRequestDialog(context: TargetedRequestDialogInput) {
    setDraft((current) => ({ ...current, selectedServiceId: '', date: '', comment: '', consent: false }));
    setDraftErrors({});
    setDialogContext({ mode: 'targeted', ...context });
  }

  function rememberPassengerDetails(phone: string, passengerCount: number) {
    window.localStorage.setItem(
      storageKeys.passengerDraft,
      JSON.stringify({
        firstName: draft.firstName.trim(),
        phone,
        email: draft.email.trim(),
        passengerCount: String(passengerCount),
        pickupArea: draft.pickupArea.trim(),
      }),
    );
  }

  function handleSubmitRequest() {
    if (!dialogContext) {
      return;
    }

    const { errors, normalizedPhone, passengerCount } = validatePassengerRequestDraft(
      draft,
      dialogContext.mode === 'open',
      new Date(),
      church.schedule?.services,
    );

    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      return;
    }

    rememberPassengerDetails(normalizedPhone, passengerCount);

    if (dialogContext.mode === 'targeted') {
      const now = new Date();
      if (
        !isTargetedOfferAvailable(
          dialogContext.offerId,
          dialogContext.offerType,
          [...routes, ...eligibleLocalRoutes],
          [...trips, ...eligibleLocalTrips],
          now,
        )
      ) {
        addNotification('Это предложение больше недоступно.');
        closeDialog();
        return;
      }

      const targetedRequest: TargetedPassengerRequest = {
        id: makeId('targeted-request'),
        churchId: church.id,
        driverId: dialogContext.driverId,
        driverName: dialogContext.driverName,
        targetOfferId: dialogContext.offerId,
        targetOfferType: dialogContext.offerType,
        offerContext: dialogContext.offerContext,
        firstName: draft.firstName.trim(),
        phonePrivate: normalizedPhone,
        emailPrivate: draft.email.trim() || undefined,
        passengerCount,
        pickupZone: { label: draft.pickupArea.trim() },
        privateComment: draft.comment.trim() || undefined,
        consentToShareContact: true,
        status: 'waitingForDriver',
        publicVisible: false,
        createdAt: new Date().toISOString(),
      };

      setTargetedRequests((current) => [targetedRequest, ...current]);
      addNotification(`Запрос отправлен водителю ${targetedRequest.driverName}.`);
      addNotification('Водитель получит ваш запрос и сможет принять его.');
    } else {
      const request: PassengerRequest = {
        id: makeId('passenger-request'),
        churchId: church.id,
        firstName: draft.firstName.trim(),
        phonePrivate: normalizedPhone,
        emailPrivate: draft.email.trim() || undefined,
        serviceEvent: formatServiceSelection(draft, church.schedule?.services ?? []),
        serviceEventId: draft.selectedServiceId || undefined,
        serviceDate: draft.selectedServiceId
          ? church.schedule?.services?.find((service) => service.id === draft.selectedServiceId)?.date
          : draft.date,
        passengerCount,
        pickupZone: { label: draft.pickupArea.trim() },
        safePublicComment: draft.comment.trim() || undefined,
        consentToShareContact: true,
        status: 'open',
        publicVisible: true,
        createdAt: new Date().toISOString(),
      };

      setPassengerRequests((current) => [request, ...current]);
      addNotification(`Создан запрос: ${request.firstName} ищет место на ${request.serviceEvent}.`);

      if (mergedRoutes.length > 0 || mergedTrips.length > 0) {
        addNotification('Найдены возможные водители для вашего запроса.');
      }
    }

    setDraft((current) => ({
      ...emptyDraft,
      firstName: current.firstName.trim(),
      phone: normalizedPhone,
      email: current.email.trim(),
    }));
    closeDialog();
  }

  function handleSubmitDriverOffer() {
    const now = new Date();
    const { errors } = validateDriverOfferDraft(
      offerDraft,
      !localDriverProfile,
      now,
      church.schedule?.services,
    );

    if (Object.keys(errors).length > 0) {
      setOfferDraftErrors(errors);
      setOfferSubmitAttempt((current) => current + 1);
      return;
    }

    const profile =
      localDriverProfile ??
      createLocalDriverProfile(offerDraft, makeId('local-owner'), makeId('local-driver'));

    if (!localDriverProfile) {
      setLocalDriverProfile(profile);
    }

    if (offerDraft.offerType === 'trip') {
      const trip = createLocalTrip(
        offerDraft,
        church.id,
        profile.driverId,
        makeId('local-trip'),
        church.schedule?.services,
      );
      setLocalTrips((current) => [trip, ...current]);
      addNotification(`Создана поездка: ${formatDateTime(trip.date, trip.departureTime)}, выезд из ${trip.originLabel}.`);
      setRegularRouteSuggestion(createRegularRoutePrefill(offerDraft));
    } else {
      const route = createLocalRoute(offerDraft, church.id, profile.driverId, makeId('local-route'));
      setLocalRoutes((current) => [route, ...current]);
      addNotification(`Создана регулярная поездка: выезд из ${route.originLabel} в ${route.recurrence.typicalDepartureTime}.`);
      setRegularRouteSuggestion(null);
      setOfferDraft(createEmptyDriverOfferDraft());
      closeDriverOfferDialog();
    }

    if (
      passengerRequests.some(
        (request) => request.churchId === church.id && isPassengerRequestPublic(request),
      )
    ) {
      addNotification('Найдены возможные пассажиры для нового предложения.');
    }

    setAvailabilityNow(now);
  }

  function handleCancelTrip(trip: Trip) {
    if (!isLocallyOwnedOffer(trip, localTrips, localDriverProfile)) {
      return;
    }
    setPendingCancellation({ offerType: 'trip', offer: trip });
  }

  function handleCancelRoute(route: Route) {
    if (!isLocallyOwnedOffer(route, localRoutes, localDriverProfile)) {
      return;
    }
    setPendingCancellation({ offerType: 'route', offer: route });
  }

  function confirmOfferCancellation() {
    if (!pendingCancellation) {
      return;
    }

    if (pendingCancellation.offerType === 'trip') {
      setLocalTrips((current) =>
        current.map((item) =>
          item.id === pendingCancellation.offer.id ? cancelLocalTrip(item) : item,
        ),
      );
      addNotification('Поездка отменена.');
    } else {
      setLocalRoutes((current) =>
        current.map((item) =>
          item.id === pendingCancellation.offer.id ? cancelLocalRoute(item) : item,
        ),
      );
      addNotification('Регулярная поездка отменена.');
    }

    setPendingCancellation(null);
    setAvailabilityNow(new Date());
  }

  function handleRespond(request: PassengerRequest) {
    const response = createPendingDriverResponse(request.id, makeId('driver-response'), new Date().toISOString());

    setDriverResponses((current) => [response, ...current]);
    setPassengerRequests((current) =>
      current.map((item) => (item.id === request.id ? markPassengerRequestResponded(item) : item)),
    );
    addNotification(`Водитель откликнулся на запрос ${request.firstName}.`);
  }

  function handleCancelResponse(response: DriverResponse) {
    if (!window.confirm('Отменить отклик? Пассажир снова сможет получить предложения от водителей.')) {
      return;
    }

    const cancelledAt = new Date().toISOString();

    setDriverResponses((current) =>
      current.map((item) => (item.id === response.id ? cancelDriverResponse(item, cancelledAt) : item)),
    );
    setPassengerRequests((current) =>
      current.map((item) =>
        item.id === response.passengerRequestId ? restorePassengerRequestAfterCancellation(item) : item,
      ),
    );
    addNotification('Отклик отменен.');
  }

  const churchRequests = passengerRequests.filter((request) => request.churchId === church.id);
  const activeRequests = churchRequests.filter(isPassengerRequestPublic);
  const activeResponses = driverResponses.filter(
    (response) =>
      isDriverResponseActive(response) && churchRequests.some((request) => request.id === response.passengerRequestId),
  );
  const churchTargetedRequests = targetedRequests.filter(
    (request) =>
      request.churchId === church.id &&
      isTargetedOfferAvailable(
        request.targetOfferId,
        request.targetOfferType,
        [...routes, ...eligibleLocalRoutes],
        [...trips, ...eligibleLocalTrips],
        availabilityNow,
      ),
  );
  const churchNotifications = notifications.filter((notification) => notification.churchId === church.id);

  return (
    <section className="mt-5 grid gap-5">
      <NotificationCenter notifications={churchNotifications} />

      <PageActions
        onCreateOffer={() => openDriverOfferDialog()}
        onCreateRequest={openOpenRequestDialog}
      />

      <PassengerRequestList onRespond={handleRespond} requests={activeRequests} />

      <ActiveDriverResponses
        onCancelResponse={handleCancelResponse}
        passengerRequests={churchRequests}
        responses={activeResponses}
      />

      <TargetedRequestPanel requests={churchTargetedRequests} />

      <DriverOffers
        church={church}
        drivers={mergedDrivers}
        localDriverId={localPublicDriver?.id}
        onCancelRoute={handleCancelRoute}
        onCancelTrip={handleCancelTrip}
        onRequestRide={openTargetedRequestDialog}
        ownedRouteIds={ownedRouteIds}
        ownedTripIds={ownedTripIds}
        routes={mergedRoutes}
        trips={mergedTrips}
      />

      {offerDialogOpen ? (
        <DriverOfferDialog
          draft={offerDraft}
          errors={offerDraftErrors}
          savedProfile={
            localDriverProfile
              ? { publicName: localDriverProfile.publicName }
              : null
          }
          services={futureChurchServices}
          submitAttempt={offerSubmitAttempt}
          successPrefill={regularRouteSuggestion}
          onAddRegular={() => {
            if (regularRouteSuggestion) {
              setOfferDraft(regularRouteSuggestion);
              setOfferDraftErrors({});
              setRegularRouteSuggestion(null);
            }
          }}
          onBlur={validateOfferField}
          onCancel={closeDriverOfferDialog}
          onChange={changeOfferDraft}
          onModeChange={changeDriverOfferMode}
          onSubmit={handleSubmitDriverOffer}
        />
      ) : null}

      {pendingCancellation ? (
        <OfferCancellationDialog
          offerType={pendingCancellation.offerType}
          onCancel={() => setPendingCancellation(null)}
          onConfirm={confirmOfferCancellation}
        />
      ) : null}

      {dialogContext ? (
        <RequestDialog
          context={dialogContext}
          draft={draft}
          errors={draftErrors}
          onCancel={closeDialog}
          onChange={(nextDraft, fieldName) => {
            setDraft(nextDraft);
            setDraftErrors((current) => {
              if (fieldName === 'date' || fieldName === 'selectedServiceId') {
                const nextErrors = { ...current };
                delete nextErrors.date;
                delete nextErrors.selectedServiceId;
                return nextErrors;
              }
              return clearPassengerRequestDraftFieldError(current, fieldName);
            });
          }}
          onSubmit={handleSubmitRequest}
          serviceOptions={serviceOptions}
        />
      ) : null}
    </section>
  );
}
