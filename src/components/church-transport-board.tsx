'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/dateFormat';
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

type PassengerRequestDraft = {
  firstName: string;
  phone: string;
  email: string;
  serviceEvent: string;
  passengerCount: string;
  pickupArea: string;
  comment: string;
  consent: boolean;
};

type DraftErrors = Partial<Record<keyof PassengerRequestDraft, string>>;

type RequestDialogContext =
  | { mode: 'open' }
  | {
      mode: 'targeted';
      offerId: string;
      offerType: 'regularRoute' | 'oneTimeTrip';
      driverId: string;
      driverName: string;
      offerContext: string;
    };

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

function readStoredArray<T>(key: string): T[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    window.localStorage.removeItem(key);
    return [];
  }
}

function usePersistentArray<T>(key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setItems(readStoredArray<T>(key));
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

function normalizePhone(phone: string) {
  return phone.replace(/[\s\-()]/g, '');
}

function validateDraft(draft: PassengerRequestDraft, requireService: boolean) {
  const errors: DraftErrors = {};
  const normalizedPhone = normalizePhone(draft.phone);
  const passengerCount = Number.parseInt(draft.passengerCount, 10);

  if (!draft.firstName.trim()) {
    errors.firstName = 'Введите имя.';
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) {
    errors.phone = 'Введите номер в международном формате, например +39 333 123 4567.';
  }

  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    errors.email = 'Введите корректный email, например name@example.com.';
  }

  if (requireService && !draft.serviceEvent) {
    errors.serviceEvent = 'Выберите службу или событие.';
  }

  if (!Number.isFinite(passengerCount) || passengerCount < 1) {
    errors.passengerCount = 'Укажите количество пассажиров от 1.';
  }

  if (!draft.pickupArea.trim()) {
    errors.pickupArea = 'Укажите удобную точку встречи.';
  }

  if (!draft.consent) {
    errors.consent = 'Нужно подтвердить согласие на передачу контакта водителю.';
  }

  return { errors, normalizedPhone, passengerCount };
}

function NotificationCenter({ notifications }: { notifications: MockNotification[] }) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-lg font-bold text-stone-950">Мои уведомления</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Это персональные mock-уведомления текущего пользователя. В реальном приложении они будут в личном центре
        уведомлений.
      </p>
      {notifications.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {notifications.map((notification) => (
            <li className="rounded-md bg-white px-3 py-2 text-sm text-stone-700" key={notification.id}>
              {notification.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-600">Пока нет уведомлений.</p>
      )}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="text-sm font-normal text-red-700" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

function RequestDialog({
  context,
  draft,
  errors,
  serviceOptions,
  onCancel,
  onChange,
  onSubmit,
}: {
  context: RequestDialogContext;
  draft: PassengerRequestDraft;
  errors: DraftErrors;
  serviceOptions: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onChange: (draft: PassengerRequestDraft) => void;
  onSubmit: () => void;
}) {
  const targeted = context.mode === 'targeted';

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      aria-labelledby="request-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/55 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="dialog"
    >
      <div className="mx-auto min-h-full w-full min-w-0 overflow-hidden bg-white p-5 shadow-xl sm:min-h-0 sm:max-w-2xl sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold" id="request-dialog-title">
              {targeted ? 'Попросить подвезти' : 'Создать запрос на поездку'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Контакты не будут видны публично. Они откроются только водителю, который откликнется.
            </p>
          </div>
          <button
            aria-label="Закрыть"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-stone-300 text-2xl leading-none"
            onClick={onCancel}
            title="Закрыть"
            type="button"
          >
            ×
          </button>
        </div>

        {targeted ? (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm leading-6 text-stone-700">
            <p className="font-semibold">Вы просите место у водителя: {context.driverName}</p>
            <p className="mt-1">{context.offerContext}</p>
          </div>
        ) : null}

        <form
          className="mt-5 grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Имя
              <input
                aria-describedby={errors.firstName ? 'first-name-error' : undefined}
                aria-invalid={Boolean(errors.firstName)}
                autoFocus
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onChange={(event) => onChange({ ...draft, firstName: event.target.value })}
                required
                value={draft.firstName}
              />
              <FieldError id="first-name-error" message={errors.firstName} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Телефон
              <input
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                aria-invalid={Boolean(errors.phone)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                inputMode="tel"
                onChange={(event) => onChange({ ...draft, phone: event.target.value })}
                placeholder="+39 333 123 4567"
                required
                type="tel"
                value={draft.phone}
              />
              <FieldError id="phone-error" message={errors.phone} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Email <span className="font-normal text-stone-500">(необязательно)</span>
              <input
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={Boolean(errors.email)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onChange={(event) => onChange({ ...draft, email: event.target.value })}
                type="email"
                value={draft.email}
              />
              <FieldError id="email-error" message={errors.email} />
            </label>
            {!targeted ? (
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Служба / событие
                <select
                  aria-describedby={errors.serviceEvent ? 'service-error' : undefined}
                  aria-invalid={Boolean(errors.serviceEvent)}
                  className="w-full min-w-0 max-w-full rounded-lg border border-stone-300 px-3 py-3 font-normal"
                  onChange={(event) => onChange({ ...draft, serviceEvent: event.target.value })}
                  required
                  value={draft.serviceEvent}
                >
                  <option value="">Выберите службу</option>
                  {serviceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError id="service-error" message={errors.serviceEvent} />
              </label>
            ) : null}
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Количество пассажиров
              <input
                aria-describedby={errors.passengerCount ? 'passenger-count-error' : undefined}
                aria-invalid={Boolean(errors.passengerCount)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                min="1"
                onChange={(event) => onChange({ ...draft, passengerCount: event.target.value })}
                required
                type="number"
                value={draft.passengerCount}
              />
              <FieldError id="passenger-count-error" message={errors.passengerCount} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold lg:col-span-2">
              Район посадки
              <input
                aria-describedby={errors.pickupArea ? 'pickup-area-error pickup-area-help' : 'pickup-area-help'}
                aria-invalid={Boolean(errors.pickupArea)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onChange={(event) => onChange({ ...draft, pickupArea: event.target.value })}
                required
                value={draft.pickupArea}
              />
              <span className="text-xs font-normal leading-5 text-stone-600" id="pickup-area-help">
                Укажите район, станцию, площадь, парковку или другую удобную точку встречи. Точный домашний адрес
                указывать не нужно.
              </span>
              <FieldError id="pickup-area-error" message={errors.pickupArea} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold lg:col-span-2">
              Комментарий <span className="font-normal text-stone-500">(необязательно)</span>
              <textarea
                aria-describedby="comment-privacy-help"
                className="min-h-24 w-full min-w-0 resize-y rounded-lg border border-stone-300 px-3 py-3 font-normal"
                maxLength={300}
                onChange={(event) => onChange({ ...draft, comment: event.target.value })}
                value={draft.comment}
              />
              <span className="text-xs font-normal leading-5 text-stone-600" id="comment-privacy-help">
                Не указывайте телефон, точный домашний адрес или другие личные данные.
              </span>
            </label>
          </div>

          <label className="flex min-w-0 gap-3 rounded-lg bg-stone-100 p-4 text-sm leading-6 text-stone-700">
            <input
              aria-describedby={errors.consent ? 'consent-error' : undefined}
              aria-invalid={Boolean(errors.consent)}
              checked={draft.consent}
              className="mt-1 h-4 w-4"
              onChange={(event) => onChange({ ...draft, consent: event.target.checked })}
              required
              type="checkbox"
            />
            <span className="min-w-0">
              Я понимаю, что мои телефон и email не будут видны публично, но будут открыты водителю, который нажмет
              «Подвезти».
              <FieldError id="consent-error" message={errors.consent} />
            </span>
          </label>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button className="w-full rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white sm:w-auto" type="submit">
              {targeted ? 'Попросить подвезти' : 'Создать запрос'}
            </button>
            <button
              className="w-full rounded-lg border border-stone-300 px-5 py-3 font-semibold sm:w-auto"
              onClick={onCancel}
              type="button"
            >
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PassengerRequestCard({
  request,
  onRespond,
}: {
  request: PassengerRequest;
  onRespond: (request: PassengerRequest) => void;
}) {
  return (
    <article className="rounded-lg bg-stone-100 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{request.firstName}</h3>
          <p className="mt-1 text-sm text-stone-700">
            {request.passengerCount} пасс., {request.pickupZone.label}
          </p>
        </div>
        <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-700">
          {request.serviceEvent}
        </span>
      </div>
      {request.safePublicComment ? (
        <p className="mt-3 text-sm leading-6 text-stone-700">{request.safePublicComment}</p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-stone-600">Контакт скрыт публично и откроется только после отклика.</p>
      <button
        className="mt-4 w-full rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white"
        onClick={() => onRespond(request)}
        type="button"
      >
        Подвезти
      </button>
    </article>
  );
}

export function ChurchTransportBoard({ church, drivers, routes, trips }: ChurchTransportBoardProps) {
  const serviceOptions = useMemo(() => getServiceOptions(routes, trips), [routes, trips]);
  const [dialogContext, setDialogContext] = useState<RequestDialogContext | null>(null);
  const [draft, setDraft] = useState<PassengerRequestDraft>(getInitialDraft);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
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

    const { errors, normalizedPhone, passengerCount } = validateDraft(draft, dialogContext.mode === 'open');

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
    const response: DriverResponse = {
      id: makeId('driver-response'),
      passengerRequestId: request.id,
      status: 'pendingContact',
      createdAt: new Date().toISOString(),
    };

    setDriverResponses((current) => [response, ...current]);
    setPassengerRequests((current) =>
      current.map((item) =>
        item.id === request.id ? { ...item, status: 'pendingContact', publicVisible: false } : item,
      ),
    );
    addNotification(`Водитель откликнулся на запрос ${request.firstName}.`);
  }

  function handleCancelResponse(response: DriverResponse) {
    if (!window.confirm('Отменить отклик и вернуть запрос в публичный список?')) {
      return;
    }

    setDriverResponses((current) =>
      current.map((item) =>
        item.id === response.id ? { ...item, status: 'cancelled', cancelledAt: new Date().toISOString() } : item,
      ),
    );
    setPassengerRequests((current) =>
      current.map((item) =>
        item.id === response.passengerRequestId ? { ...item, status: 'open', publicVisible: true } : item,
      ),
    );
    addNotification('Отклик отменен.');
  }

  const churchRequests = passengerRequests.filter((request) => request.churchId === church.id);
  const activeRequests = churchRequests.filter((request) => request.publicVisible && request.status === 'open');
  const activeResponses = driverResponses.filter(
    (response) =>
      response.status === 'pendingContact' && churchRequests.some((request) => request.id === response.passengerRequestId),
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
          onChange={(nextDraft) => {
            setDraft(nextDraft);
            setDraftErrors({});
          }}
          onSubmit={handleSubmitRequest}
          serviceOptions={serviceOptions}
        />
      ) : null}
    </section>
  );
}
