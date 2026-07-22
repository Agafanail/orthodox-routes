import { useEffect, useRef } from 'react';
import type {
  PassengerRequestDraft,
  PassengerRequestDraftErrors,
} from '@/lib/passengerRequestValidation';
import type { RequestDialogContext } from '@/components/church-transport-board/types';
import { CountControl } from '@/components/church-transport-board/count-control';
import { ServiceSelectionField } from '@/components/church-transport-board/service-selection-field';
import type {
  CompatiblePassengerRequestSummary,
  RouteOccurrenceOption,
} from '@/lib/rideMatchState';
import type { ServiceOption } from '@/lib/serviceOptions';
import { formatSeatCount } from '@/lib/russianCount';

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <span className="min-h-5 text-sm font-normal text-red-700" id={id} role={message ? 'alert' : undefined}>
      {message}
    </span>
  );
}

export function RequestDialog({
  context,
  draft,
  errors,
  serviceOptions,
  onCancel,
  onChange,
  onBlur,
  onSubmit,
  submitAttempt,
  targetedAvailability,
  compatibleRequests,
  selectedReusableRequestId,
  creatingDifferentRequest,
  regularOccurrences,
  overCapacityWarning,
  onCreateDifferentRequest,
  onReuseRequest,
  onSelectReusableRequest,
}: {
  context: RequestDialogContext;
  draft: PassengerRequestDraft;
  errors: PassengerRequestDraftErrors;
  serviceOptions: ServiceOption[];
  onCancel: () => void;
  onChange: (draft: PassengerRequestDraft, fieldName: keyof PassengerRequestDraft) => void;
  onBlur: (fieldName: keyof PassengerRequestDraft) => void;
  onSubmit: () => void;
  submitAttempt: number;
  targetedAvailability?: number;
  compatibleRequests: CompatiblePassengerRequestSummary[];
  selectedReusableRequestId: string;
  creatingDifferentRequest: boolean;
  regularOccurrences: RouteOccurrenceOption[];
  overCapacityWarning?: string;
  onCreateDifferentRequest: () => void;
  onReuseRequest: () => void;
  onSelectReusableRequest: (requestId: string) => void;
}) {
  const targeted = context.mode === 'targeted';
  const selectedReusableRequest =
    compatibleRequests.find((request) => request.requestId === selectedReusableRequestId) ??
    (compatibleRequests.length === 1 ? compatibleRequests[0] : undefined);
  const waitingForRegularDate = targeted && context.offerType === 'regularRoute' && !draft.date;
  const dialogRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const blurValidationReadyRef = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      blurValidationReadyRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (submitAttempt > 0) {
      dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [submitAttempt]);

  function handleBlur(fieldName: keyof PassengerRequestDraft) {
    if (blurValidationReadyRef.current) onBlur(fieldName);
  }

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
      ref={dialogRef}
    >
      <div className="mx-auto min-h-full w-full min-w-0 overflow-hidden bg-white p-5 shadow-xl sm:min-h-0 sm:max-w-2xl sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold" id="request-dialog-title">
              {targeted ? 'Попросить подвезти' : 'Создать запрос на поездку'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Контакты станут видны участникам только после подтверждения поездки.
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
            {context.offerType === 'oneTimeTrip' && context.rideDate ? (
              <p className="mt-1">Дата поездки: {context.serviceEvent}</p>
            ) : null}
            {targetedAvailability !== undefined ? (
              <p className="mt-1 font-semibold">На выбранную дату свободно мест: {targetedAvailability}</p>
            ) : null}
          </div>
        ) : null}

        {targeted && context.offerType === 'regularRoute' ? (
          <label className="mt-5 grid min-w-0 gap-1 text-sm font-semibold">
            Дата поездки*
            <select
              aria-describedby={errors.date ? 'targeted-date-error targeted-date-help' : 'targeted-date-help'}
              aria-invalid={Boolean(errors.date)}
              className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 font-normal"
              data-dialog-initial-focus
              onBlur={() => handleBlur('date')}
              onChange={(event) => onChange({ ...draft, date: event.target.value }, 'date')}
              value={draft.date}
            >
              <option value="">Выберите дату поездки</option>
              {regularOccurrences.map((occurrence) => (
                <option disabled={occurrence.disabled} key={occurrence.date} value={occurrence.date}>
                  {occurrence.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal leading-5 text-stone-600" id="targeted-date-help">
              Доступность мест рассчитана отдельно для каждой поездки.
            </span>
            <FieldError id="targeted-date-error" message={errors.date} />
          </label>
        ) : null}

        {!waitingForRegularDate && targeted && compatibleRequests.length > 0 && !creatingDifferentRequest ? (
          <section className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="font-semibold">Использовать уже созданный запрос</h3>
            {compatibleRequests.length > 1 ? (
              <label className="mt-4 grid gap-1 text-sm font-semibold">
                Ваш запрос
                <select
                  className="rounded-lg border border-stone-300 bg-white px-3 py-3 font-normal"
                  data-dialog-initial-focus
                  onChange={(event) => onSelectReusableRequest(event.target.value)}
                  value={selectedReusableRequest?.requestId ?? ''}
                >
                  <option value="">Выберите запрос</option>
                  {compatibleRequests.map((request) => (
                    <option key={request.requestId} value={request.requestId}>
                      {request.serviceEvent} · {formatSeatCount(request.remainingPassengerCount)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedReusableRequest ? (
              <div className="mt-4 rounded-lg bg-white p-4 text-sm leading-6 text-stone-700">
                <p className="font-semibold">{selectedReusableRequest.serviceEvent}</p>
                <p>Нужно: {formatSeatCount(selectedReusableRequest.remainingPassengerCount)}</p>
                <p>Район посадки: {selectedReusableRequest.pickupArea}</p>
                {selectedReusableRequest.safePublicComment ? (
                  <p>Комментарий: {selectedReusableRequest.safePublicComment}</p>
                ) : null}
              </div>
            ) : null}
            {overCapacityWarning ? (
              <p className="mt-4 rounded-lg bg-amber-100 p-3 text-sm leading-6 text-amber-950">
                {overCapacityWarning}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                className="rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
                data-dialog-initial-focus={compatibleRequests.length === 1 ? true : undefined}
                disabled={!selectedReusableRequest || targetedAvailability === 0}
                onClick={onReuseRequest}
                type="button"
              >
                Отправить этот запрос
              </button>
              <button
                className="rounded-lg border border-stone-300 px-5 py-3 font-semibold"
                onClick={onCreateDifferentRequest}
                type="button"
              >
                Создать другой запрос
              </button>
            </div>
          </section>
        ) : waitingForRegularDate ? (
          <p className="mt-5 rounded-lg bg-stone-100 p-4 text-sm leading-6 text-stone-700">
            Сначала выберите конкретную дату регулярной поездки.
          </p>
        ) : (

        <form
          className="mt-5 grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          ref={formRef}
        >
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
              Имя*
              <input
                aria-describedby={errors.firstName ? 'first-name-error' : undefined}
                aria-invalid={Boolean(errors.firstName)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                data-dialog-initial-focus
                onBlur={() => handleBlur('firstName')}
                onChange={(event) => onChange({ ...draft, firstName: event.target.value }, 'firstName')}
                required
                value={draft.firstName}
              />
              <FieldError id="first-name-error" message={errors.firstName} />
            </label>
            <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
              Телефон*
              <input
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                aria-invalid={Boolean(errors.phone)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                inputMode="tel"
                onBlur={() => handleBlur('phone')}
                onChange={(event) => onChange({ ...draft, phone: event.target.value }, 'phone')}
                placeholder="+39 333 123 4567"
                required
                type="tel"
                value={draft.phone}
              />
              <FieldError id="phone-error" message={errors.phone} />
            </label>
            <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
              <span>Email <span className="font-normal text-stone-500">(необязательно)</span></span>
              <input
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={Boolean(errors.email)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onBlur={() => handleBlur('email')}
                onChange={(event) => onChange({ ...draft, email: event.target.value }, 'email')}
                type="email"
                value={draft.email}
              />
              <FieldError id="email-error" message={errors.email} />
            </label>
            {!targeted ? (
              <div className="min-w-0 lg:col-span-2">
                <ServiceSelectionField
                  error={errors.date ?? errors.selectedServiceId}
                  errorId="service-error"
                  label="Когда вы едете *"
                  name="passenger-service"
                  onBlur={handleBlur}
                  onChange={(selection, fieldName) => onChange({ ...draft, ...selection }, fieldName)}
                  options={serviceOptions}
                  selection={draft}
                />
              </div>
            ) : null}
            <div className="grid min-w-0 content-start gap-1">
              <CountControl
                describedBy={errors.passengerCount ? 'passenger-count-error' : undefined}
                invalid={Boolean(errors.passengerCount)}
                label="Количество пассажиров*"
                onBlur={() => handleBlur('passengerCount')}
                onChange={(value) => onChange({ ...draft, passengerCount: value }, 'passengerCount')}
                value={draft.passengerCount}
              />
              <FieldError id="passenger-count-error" message={errors.passengerCount} />
            </div>
            {overCapacityWarning ? (
              <p className="rounded-lg bg-amber-100 p-3 text-sm font-normal leading-6 text-amber-950 lg:col-span-2">
                {overCapacityWarning}
              </p>
            ) : null}
            <label className="grid min-w-0 gap-1 text-sm font-semibold lg:col-span-2">
              Район посадки*
              <input
                aria-describedby={errors.pickupArea ? 'pickup-area-error pickup-area-help' : 'pickup-area-help'}
                aria-invalid={Boolean(errors.pickupArea)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onBlur={() => handleBlur('pickupArea')}
                onChange={(event) => onChange({ ...draft, pickupArea: event.target.value }, 'pickupArea')}
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
              <span>Комментарий <span className="font-normal text-stone-500">(необязательно)</span></span>
              <textarea
                aria-describedby="comment-privacy-help"
                className="min-h-24 w-full min-w-0 resize-y rounded-lg border border-stone-300 px-3 py-3 font-normal"
                maxLength={300}
                onChange={(event) => onChange({ ...draft, comment: event.target.value }, 'comment')}
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
              onBlur={() => handleBlur('consent')}
              onChange={(event) => onChange({ ...draft, consent: event.target.checked }, 'consent')}
              required
              type="checkbox"
            />
            <span className="min-w-0">
              После подтверждения поездки водитель увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.<span aria-hidden="true"> *</span>
              <FieldError id="consent-error" message={errors.consent} />
            </span>
          </label>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button
              className="w-full rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
              disabled={targeted && targetedAvailability === 0}
              type="submit"
            >
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
        )}
      </div>
    </div>
  );
}
