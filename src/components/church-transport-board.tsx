'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActiveDriverResponses } from '@/components/church-transport-board/active-driver-responses';
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

function usePersistentArray<T>(key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setItems(readStoredArray<T>(window.localStorage, key));
      setLoaded(true);
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, [key]);

  useEffect(() => {
    if (loaded) {
      window.localStorage.setItem(key, JSON.stringify(items));
    }
  }, [items, key, loaded]);

  return [items, setItems] as const;
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
  const serviceOptions = useMemo(() => getServiceOptions(routes, trips), [routes, trips]);
  const [dialogContext, setDialogContext] = useState<RequestDialogContext | null>(null);
  const [draft, setDraft] = useState<PassengerRequestDraft>(getInitialDraft);
  const [draftErrors, setDraftErrors] = useState<PassengerRequestDraftErrors>({});
  const [passengerRequests, setPassengerRequests] = usePersistentArray<PassengerRequest>(storageKeys.passengerRequests);
  const [driverResponses, setDriverResponses] = usePersistentArray<DriverResponse>(storageKeys.driverResponses);
  const [targetedRequests, setTargetedRequests] = usePersistentArray<TargetedPassengerRequest>(
    storageKeys.targetedRequests,
  );
  const [notifications, setNotifications] = usePersistentArray<MockNotification>(storageKeys.notifications);

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

      if (routes.length > 0 || trips.length > 0) {
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
  const churchTargetedRequests = targetedRequests.filter((request) => request.churchId === church.id);
  const churchNotifications = notifications.filter((notification) => notification.churchId === church.id);

  return (
    <section className="mt-5 grid gap-5">
      <NotificationCenter notifications={churchNotifications} />

      <PageActions
        onCreateOffer={() => addNotification('Создание поездки / маршрута будет добавлено в следующем mock-flow.')}
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
        drivers={drivers}
        onRequestRide={openTargetedRequestDialog}
        routes={routes}
        trips={trips}
      />

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
