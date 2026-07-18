import { useEffect } from 'react';
import type {
  PassengerRequestDraft,
  PassengerRequestDraftErrors,
} from '@/lib/passengerRequestValidation';
import type { RequestDialogContext } from '@/components/church-transport-board/types';
import { ServiceSelectionField } from '@/components/church-transport-board/service-selection-field';
import type { ServiceOption } from '@/lib/serviceOptions';

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="text-sm font-normal text-red-700" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

export function RequestDialog({
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
  errors: PassengerRequestDraftErrors;
  serviceOptions: ServiceOption[];
  onCancel: () => void;
  onChange: (draft: PassengerRequestDraft, fieldName: keyof PassengerRequestDraft) => void;
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
              Ваши контакты увидит только водитель, который откликнется.
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
                onChange={(event) => onChange({ ...draft, firstName: event.target.value }, 'firstName')}
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
                onChange={(event) => onChange({ ...draft, phone: event.target.value }, 'phone')}
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
                  label="К какой службе хотите поехать?*"
                  name="passenger-service"
                  onChange={(selection, fieldName) => onChange({ ...draft, ...selection }, fieldName)}
                  options={serviceOptions}
                  selection={draft}
                />
              </div>
            ) : null}
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Количество пассажиров
              <input
                aria-describedby={errors.passengerCount ? 'passenger-count-error' : undefined}
                aria-invalid={Boolean(errors.passengerCount)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                min="1"
                onChange={(event) => onChange({ ...draft, passengerCount: event.target.value }, 'passengerCount')}
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
              Комментарий <span className="font-normal text-stone-500">(необязательно)</span>
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
              onChange={(event) => onChange({ ...draft, consent: event.target.checked }, 'consent')}
              required
              type="checkbox"
            />
            <span className="min-w-0">
              Я согласен передать телефон и email водителю, который предложит подвезти меня.
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
