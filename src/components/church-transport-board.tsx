'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { NotificationCenter } from '@/components/church-transport-board/notification-center';
import { PassengerRequestCard } from '@/components/church-transport-board/passenger-request-card';
import { RequestDialog } from '@/components/church-transport-board/request-dialog';
import type { RequestDialogContext } from '@/components/church-transport-board/types';
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

const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

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

function getDriverName(drivers: DriverPublicProfile[], driverId: string) {
  return drivers.find((driver) => driver.id === driverId)?.publicName ?? 'Водитель';
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

  function openTargetedRequestDialog(context: Omit<Extract<RequestDialogContext, { mode: 'targeted' }>, 'mode'>) {
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

      if (routes.length > 0 || trips.some((trip) => trip.seatsAvailable > 0)) {
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

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Действия на странице храма</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-lg bg-stone-950 px-5 py-4 font-semibold text-white"
            onClick={openOpenRequestDialog}
            type="button"
          >
            Создать запрос
          </button>
          <button
            className="rounded-lg border border-stone-300 px-5 py-4 font-semibold"
            onClick={() => addNotification('Создание поездки / маршрута будет добавлено в следующем mock-flow.')}
            type="button"
          >
            Создать поездку / маршрут
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Кому нужно место</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Открытые запросы пассажиров. Публично показываются только безопасные данные.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {activeRequests.length > 0 ? (
            activeRequests.map((request) => (
              <PassengerRequestCard key={request.id} onRespond={handleRespond} request={request} />
            ))
          ) : (
            <p className="rounded-lg bg-stone-100 p-4 text-sm text-stone-600">Пока нет открытых запросов.</p>
          )}
        </div>
      </section>

      {activeResponses.length > 0 ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-xl font-bold">Мой отклик</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            В реальном приложении это увидит только водитель, который откликнулся.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {activeResponses.map((response) => {
              const request = churchRequests.find((item) => item.id === response.passengerRequestId);

              if (!request) {
                return null;
              }

              return (
                <article className="rounded-lg bg-white p-4" key={response.id}>
                  <h3 className="font-semibold">Отклик на запрос {request.firstName}</h3>
                  <dl className="mt-3 grid gap-2 text-sm text-stone-700">
                    <div>
                      <dt className="font-semibold">Телефон</dt>
                      <dd>{request.phonePrivate}</dd>
                    </div>
                    {request.emailPrivate ? (
                      <div>
                        <dt className="font-semibold">Email</dt>
                        <dd>{request.emailPrivate}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="font-semibold">Точка встречи</dt>
                      <dd>{request.pickupZone.label}</dd>
                    </div>
                  </dl>
                  <button
                    className="mt-4 rounded-lg border border-stone-300 px-4 py-3 font-semibold"
                    onClick={() => handleCancelResponse(response)}
                    type="button"
                  >
                    Отменить отклик
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {churchTargetedRequests.length > 0 ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-xl font-bold">Мой запрос водителю</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">
            Это личная mock-зона. Контакты пока не переданы: водитель еще не принял запрос.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {churchTargetedRequests.map((request) => (
              <article className="rounded-lg bg-white p-4" key={request.id}>
                <h3 className="font-semibold">Водитель: {request.driverName}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-700">{request.offerContext}</p>
                <dl className="mt-3 grid gap-2 text-sm text-stone-700">
                  <div>
                    <dt className="font-semibold">Пассажиры</dt>
                    <dd>{request.passengerCount}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Точка встречи</dt>
                    <dd>{request.pickupZone.label}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs font-semibold uppercase text-emerald-800">Ожидает ответа водителя</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Видимые водители</h2>
          <div className="mt-4 grid gap-3">
            {drivers.map((driver) => (
              <Link className="rounded-lg bg-stone-100 p-4" href={`/drivers/${driver.id}`} key={driver.id}>
                <div className="flex items-center gap-3">
                  {driver.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" className="h-12 w-12 rounded-full object-cover" src={driver.photoUrl} />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-800 font-bold text-white">
                      {driver.publicName.slice(0, 1)}
                    </span>
                  )}
                  <div>
                    <p className="font-semibold">{driver.publicName}</p>
                    <p className="text-sm text-stone-600">{driver.departureArea}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Кто едет регулярно</h2>
          <div className="mt-4 grid gap-3">
            {routes.map((route) => {
              const driverName = getDriverName(drivers, route.driverId);
              const offerContext = `Регулярный маршрут: ${route.originLabel} → ${church.name}, ${route.recurrence.daysOfWeek
                .map((day) => dayNames[day])
                .join(', ')} в ${route.recurrence.typicalDepartureTime}`;

              return (
                <article className="rounded-lg bg-stone-100 p-4" key={route.id}>
                  <h3 className="font-semibold">
                    {route.originLabel} → {church.name}
                  </h3>
                  <p className="mt-2 text-sm text-stone-700">
                    {route.recurrence.daysOfWeek.map((day) => dayNames[day]).join(', ')} в{' '}
                    {route.recurrence.typicalDepartureTime}; мест: {route.seats}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                  <button
                    className="mt-4 w-full rounded-lg bg-white px-4 py-3 font-semibold text-stone-950"
                    onClick={() =>
                      openTargetedRequestDialog({
                        offerId: route.id,
                        offerType: 'regularRoute',
                        driverId: route.driverId,
                        driverName,
                        offerContext,
                      })
                    }
                    type="button"
                  >
                    Попросить подвезти
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Ближайшие поездки</h2>
          <div className="mt-4 grid gap-3">
            {trips.map((trip) => {
              const driverName = getDriverName(drivers, trip.driverId);
              const dateTime = formatDateTime(trip.date, trip.departureTime);
              const offerContext = `Разовая поездка: ${dateTime}, выезд из ${trip.originLabel}`;

              return (
                <article className="rounded-lg bg-stone-100 p-4" key={trip.id}>
                  <h3 className="font-semibold">{dateTime}</h3>
                  <p className="mt-2 text-sm text-stone-700">
                    Выезд из {trip.originLabel}; свободных мест: {trip.seatsAvailable}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                  <button
                    className="mt-4 w-full rounded-lg bg-white px-4 py-3 font-semibold text-stone-950"
                    onClick={() =>
                      openTargetedRequestDialog({
                        offerId: trip.id,
                        offerType: 'oneTimeTrip',
                        driverId: trip.driverId,
                        driverName,
                        offerContext,
                      })
                    }
                    type="button"
                  >
                    Попросить подвезти
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

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
