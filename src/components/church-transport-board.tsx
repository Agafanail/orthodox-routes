'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActiveDriverResponses } from '@/components/church-transport-board/active-driver-responses';
import { DriverOfferDialog } from '@/components/church-transport-board/driver-offer-dialog';
import { DriverOffers } from '@/components/church-transport-board/driver-offers';
import { NotificationCenter } from '@/components/church-transport-board/notification-center';
import { PageActions } from '@/components/church-transport-board/page-actions';
import { PassengerRequestList } from '@/components/church-transport-board/passenger-request-list';
import { RequestDialog } from '@/components/church-transport-board/request-dialog';
import { TargetedRequestPanel } from '@/components/church-transport-board/targeted-request-panel';
import type {
  RequestDialogContext,
  TargetedRequestDialogInput,
} from '@/components/church-transport-board/types';
import { formatDateTime } from '@/lib/dateFormat';
import {
  cancelLocalRoute,
  cancelLocalTrip,
  clearDriverOfferDraftFieldError,
  createEmptyDriverOfferDraft,
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
  type DriverOfferDraftErrors,
  type DriverOfferMode,
} from '@/lib/driverOfferState';
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
import { isOneTimeTripAvailable } from '@/lib/tripVisibility';
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
  localDriverProfile: 'orthodox-routes:local-driver-profile',
  localTrips: 'orthodox-routes:local-trips',
  localRoutes: 'orthodox-routes:local-routes',
} as const;

const emptyDraft: PassengerRequestDraft = {
  firstName: '',
  phone: '',
  email: '',
  serviceEvent: '',
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

function getServiceOptions(routes: Route[], trips: Trip[]) {
  const tripOptions = trips.map((trip) => {
    const dateTime = formatDateTime(trip.date, trip.departureTime);
    return {
      value: `Литургия ${dateTime}`,
      label: `Литургия ${dateTime}, выезд из ${trip.originLabel}`,
    };
  });

  const routeOptions = routes.map((route) => ({
    value: `Воскресная литургия, выезд в ${route.recurrence.typicalDepartureTime}`,
    label: `Воскресная литургия, маршрут от ${route.originLabel} в ${route.recurrence.typicalDepartureTime}`,
  }));

  return [...tripOptions, ...routeOptions, { value: 'Литургия', label: 'Литургия' }];
}

export function ChurchTransportBoard({ church, drivers, routes, trips }: ChurchTransportBoardProps) {
  const [dialogContext, setDialogContext] = useState<RequestDialogContext | null>(null);
  const [draft, setDraft] = useState<PassengerRequestDraft>(getInitialDraft);
  const [draftErrors, setDraftErrors] = useState<PassengerRequestDraftErrors>({});
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [offerDraft, setOfferDraft] = useState<DriverOfferDraft>(() => createEmptyDriverOfferDraft());
  const [offerDraftErrors, setOfferDraftErrors] = useState<DriverOfferDraftErrors>({});
  const [regularRouteSuggestion, setRegularRouteSuggestion] = useState<DriverOfferDraft | null>(null);
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

  const localDriverIdCollides = Boolean(
    localDriverProfile && drivers.some((driver) => driver.id === localDriverProfile.driverId),
  );
  const eligibleLocalTrips = useMemo(
    () =>
      localDriverProfile && !localDriverIdCollides
        ? excludeIdCollisions(
            localTrips.filter((trip) => trip.driverId === localDriverProfile.driverId),
            trips,
          )
        : [],
    [localDriverIdCollides, localDriverProfile, localTrips, trips],
  );
  const eligibleLocalRoutes = useMemo(
    () =>
      localDriverProfile && !localDriverIdCollides
        ? excludeIdCollisions(
            localRoutes.filter((route) => route.driverId === localDriverProfile.driverId),
            routes,
          )
        : [],
    [localDriverIdCollides, localDriverProfile, localRoutes, routes],
  );
  const visibleLocalTrips = useMemo(
    () =>
      eligibleLocalTrips.filter(
        (trip) => trip.churchId === church.id && isOneTimeTripAvailable(trip, availabilityNow),
      ),
    [availabilityNow, church.id, eligibleLocalTrips],
  );
  const visibleLocalRoutes = useMemo(
    () =>
      eligibleLocalRoutes.filter(
        (route) => route.churchId === church.id && isRegularRouteAvailable(route),
      ),
    [church.id, eligibleLocalRoutes],
  );
  const mergedTrips = useMemo(
    () => [
      ...trips.filter((trip) => trip.churchId === church.id && isOneTimeTripAvailable(trip, availabilityNow)),
      ...visibleLocalTrips,
    ],
    [availabilityNow, church.id, trips, visibleLocalTrips],
  );
  const mergedRoutes = useMemo(
    () => [
      ...routes.filter((route) => route.churchId === church.id && isRegularRouteAvailable(route)),
      ...visibleLocalRoutes,
    ],
    [church.id, routes, visibleLocalRoutes],
  );
  const localVisibleChurchIds = useMemo(
    () => [
      ...new Set([
        ...eligibleLocalRoutes.filter(isRegularRouteAvailable).map((route) => route.churchId),
        ...eligibleLocalTrips
          .filter((trip) => isOneTimeTripAvailable(trip, availabilityNow))
          .map((trip) => trip.churchId),
      ]),
    ],
    [availabilityNow, eligibleLocalRoutes, eligibleLocalTrips],
  );
  const localPublicDriver =
    localDriverProfile && (visibleLocalRoutes.length > 0 || visibleLocalTrips.length > 0)
      ? toDriverPublicProfile(localDriverProfile, localVisibleChurchIds)
      : null;
  const mergedDrivers = useMemo(
    () =>
      localPublicDriver
        ? [...drivers.filter((driver) => driver.id !== localPublicDriver.id), localPublicDriver]
        : drivers,
    [drivers, localPublicDriver],
  );
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
  const serviceOptions = useMemo(
    () => getServiceOptions(mergedRoutes, mergedTrips),
    [mergedRoutes, mergedTrips],
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
    setOfferDialogOpen(true);
  }

  function closeDriverOfferDialog() {
    setOfferDialogOpen(false);
    setOfferDraftErrors({});
  }

  function changeDriverOfferMode(mode: DriverOfferMode) {
    setOfferDraft((current) => ({ ...current, offerType: mode }));
    setOfferDraftErrors({});
  }

  function openOpenRequestDialog() {
    setDraft((current) => ({ ...current, serviceEvent: '', comment: '', consent: false }));
    setDraftErrors({});
    setDialogContext({ mode: 'open' });
  }

  function openTargetedRequestDialog(context: TargetedRequestDialogInput) {
    setDraft((current) => ({ ...current, serviceEvent: '', comment: '', consent: false }));
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
        serviceEvent: draft.serviceEvent,
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
    const { errors } = validateDriverOfferDraft(offerDraft, !localDriverProfile, now);

    if (Object.keys(errors).length > 0) {
      setOfferDraftErrors(errors);
      return;
    }

    const profile =
      localDriverProfile ??
      createLocalDriverProfile(offerDraft, makeId('local-owner'), makeId('local-driver'));

    if (!localDriverProfile) {
      setLocalDriverProfile(profile);
    }

    if (offerDraft.offerType === 'trip') {
      const trip = createLocalTrip(offerDraft, church.id, profile.driverId, makeId('local-trip'));
      setLocalTrips((current) => [trip, ...current]);
      addNotification(`Создана поездка: ${formatDateTime(trip.date, trip.departureTime)}, выезд из ${trip.originLabel}.`);
      setRegularRouteSuggestion(createRegularRoutePrefill(offerDraft));
    } else {
      const route = createLocalRoute(offerDraft, church.id, profile.driverId, makeId('local-route'));
      setLocalRoutes((current) => [route, ...current]);
      addNotification(`Создан регулярный маршрут: выезд из ${route.originLabel} в ${route.recurrence.typicalDepartureTime}.`);
      setRegularRouteSuggestion(null);
    }

    if (
      passengerRequests.some(
        (request) => request.churchId === church.id && isPassengerRequestPublic(request),
      )
    ) {
      addNotification('Найдены возможные пассажиры для нового предложения.');
    }

    setAvailabilityNow(now);
    setOfferDraft(createEmptyDriverOfferDraft());
    closeDriverOfferDialog();
  }

  function handleCancelTrip(trip: Trip) {
    if (
      !isLocallyOwnedOffer(trip, localTrips, localDriverProfile) ||
      !window.confirm('Отменить поездку? Она исчезнет с публичной доски, но останется в локальной истории.')
    ) {
      return;
    }

    setLocalTrips((current) => current.map((item) => (item.id === trip.id ? cancelLocalTrip(item) : item)));
    setAvailabilityNow(new Date());
    addNotification('Поездка отменена.');
  }

  function handleCancelRoute(route: Route) {
    if (
      !isLocallyOwnedOffer(route, localRoutes, localDriverProfile) ||
      !window.confirm('Отменить маршрут? Он исчезнет с публичной доски, но останется в локальной истории.')
    ) {
      return;
    }

    setLocalRoutes((current) => current.map((item) => (item.id === route.id ? cancelLocalRoute(item) : item)));
    addNotification('Маршрут отменен.');
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
    if (!window.confirm('Отменить отклик и вернуть запрос в публичный список?')) {
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

      {regularRouteSuggestion ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-lg font-bold">Едете так каждую неделю?</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white"
              onClick={() => openDriverOfferDialog(regularRouteSuggestion)}
              type="button"
            >
              Создать регулярный маршрут
            </button>
            <button
              className="rounded-lg border border-stone-300 px-4 py-3 font-semibold"
              onClick={() => setRegularRouteSuggestion(null)}
              type="button"
            >
              Не сейчас
            </button>
          </div>
        </section>
      ) : null}

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
              ? { publicName: localDriverProfile.publicName, departureArea: localDriverProfile.departureArea }
              : null
          }
          onCancel={closeDriverOfferDialog}
          onChange={(nextDraft, fieldName) => {
            setOfferDraft(nextDraft);
            setOfferDraftErrors((current) => clearDriverOfferDraftFieldError(current, fieldName));
          }}
          onModeChange={changeDriverOfferMode}
          onSubmit={handleSubmitDriverOffer}
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
            setDraftErrors((current) => clearPassengerRequestDraftFieldError(current, fieldName));
          }}
          onSubmit={handleSubmitRequest}
          serviceOptions={serviceOptions}
        />
      ) : null}
    </section>
  );
}
