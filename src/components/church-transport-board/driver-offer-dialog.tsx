import { useEffect, useRef } from 'react';
import type {
  DriverOfferDraft,
  DriverOfferDraftErrors,
  DriverOfferMode,
} from '@/lib/driverOfferState';

const weekdayOptions = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="text-sm font-normal text-red-700" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

export function DriverOfferDialog({
  draft,
  errors,
  savedProfile,
  onCancel,
  onChange,
  onModeChange,
  onSubmit,
}: {
  draft: DriverOfferDraft;
  errors: DriverOfferDraftErrors;
  savedProfile: { publicName: string; departureArea: string } | null;
  onCancel: () => void;
  onChange: (draft: DriverOfferDraft, fieldName: keyof DriverOfferDraft) => void;
  onModeChange: (mode: DriverOfferMode) => void;
  onSubmit: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

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
    if (Object.keys(errors).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);

  function toggleWeekday(day: number, checked: boolean) {
    const weekdays = checked ? [...draft.weekdays, day] : draft.weekdays.filter((value) => value !== day);
    onChange({ ...draft, weekdays }, 'weekdays');
  }

  return (
    <div
      aria-labelledby="driver-offer-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/55 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="dialog"
    >
      <div className="mx-auto min-h-full w-full min-w-0 overflow-hidden bg-white p-5 shadow-xl sm:min-h-0 sm:max-w-3xl sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold" id="driver-offer-dialog-title">
              Создать поездку / маршрут
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Контакты водителя сохраняются только в локальном mock-профиле и не показываются публично.
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

        <div aria-label="Тип предложения" className="mt-5 grid grid-cols-2 rounded-lg bg-stone-100 p-1" role="group">
          <button
            aria-pressed={draft.offerType === 'trip'}
            className={`rounded-lg px-3 py-3 text-sm font-semibold ${
              draft.offerType === 'trip' ? 'bg-white shadow-sm' : 'text-stone-600'
            }`}
            onClick={() => onModeChange('trip')}
            type="button"
          >
            Разовая поездка
          </button>
          <button
            aria-pressed={draft.offerType === 'route'}
            className={`rounded-lg px-3 py-3 text-sm font-semibold ${
              draft.offerType === 'route' ? 'bg-white shadow-sm' : 'text-stone-600'
            }`}
            onClick={() => onModeChange('route')}
            type="button"
          >
            Регулярный маршрут
          </button>
        </div>

        <form
          className="mt-5 grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          ref={formRef}
        >
          {savedProfile ? (
            <section className="rounded-lg bg-emerald-50 p-4 text-sm leading-6 text-stone-700">
              <h3 className="font-semibold">Водитель: {savedProfile.publicName}</h3>
              <p>{savedProfile.departureArea}</p>
              <p className="mt-1 text-xs">Сохраненный локальный профиль будет использован повторно.</p>
            </section>
          ) : (
            <fieldset className="grid min-w-0 gap-4 rounded-lg border border-stone-200 p-4 md:grid-cols-2">
              <legend className="px-1 font-semibold">Локальный профиль водителя</legend>
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Публичное имя
                <input
                  aria-describedby={errors.publicName ? 'driver-public-name-error' : undefined}
                  aria-invalid={Boolean(errors.publicName)}
                  autoFocus
                  className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                  onChange={(event) => onChange({ ...draft, publicName: event.target.value }, 'publicName')}
                  required
                  value={draft.publicName}
                />
                <FieldError id="driver-public-name-error" message={errors.publicName} />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Примерный район выезда
                <input
                  aria-describedby={errors.departureArea ? 'driver-area-error' : undefined}
                  aria-invalid={Boolean(errors.departureArea)}
                  className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                  onChange={(event) => onChange({ ...draft, departureArea: event.target.value }, 'departureArea')}
                  required
                  value={draft.departureArea}
                />
                <FieldError id="driver-area-error" message={errors.departureArea} />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Телефон
                <input
                  aria-describedby={errors.phone ? 'driver-phone-error driver-contact-help' : 'driver-contact-help'}
                  aria-invalid={Boolean(errors.phone)}
                  className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                  inputMode="tel"
                  onChange={(event) => onChange({ ...draft, phone: event.target.value }, 'phone')}
                  placeholder="+39 333 123 4567"
                  required
                  type="tel"
                  value={draft.phone}
                />
                <FieldError id="driver-phone-error" message={errors.phone} />
              </label>
              <label className="grid min-w-0 gap-1 text-sm font-semibold">
                Email <span className="font-normal text-stone-500">(необязательно)</span>
                <input
                  aria-describedby={errors.email ? 'driver-email-error driver-contact-help' : 'driver-contact-help'}
                  aria-invalid={Boolean(errors.email)}
                  className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                  onChange={(event) => onChange({ ...draft, email: event.target.value }, 'email')}
                  type="email"
                  value={draft.email}
                />
                <FieldError id="driver-email-error" message={errors.email} />
              </label>
              <p className="text-xs leading-5 text-stone-600 md:col-span-2" id="driver-contact-help">
                Телефон и email не попадут в публичный профиль, карточки поездок или уведомления.
              </p>
            </fieldset>
          )}

          <fieldset className="grid min-w-0 gap-4 md:grid-cols-2">
            <legend className="sr-only">Данные предложения</legend>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Место выезда
              <input
                aria-describedby={errors.originLabel ? 'offer-origin-error' : undefined}
                aria-invalid={Boolean(errors.originLabel)}
                autoFocus={Boolean(savedProfile)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onChange={(event) => onChange({ ...draft, originLabel: event.target.value }, 'originLabel')}
                required
                value={draft.originLabel}
              />
              <FieldError id="offer-origin-error" message={errors.originLabel} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Точка встречи
              <input
                aria-describedby={errors.meetingPoint ? 'offer-meeting-error' : undefined}
                aria-invalid={Boolean(errors.meetingPoint)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                onChange={(event) => onChange({ ...draft, meetingPoint: event.target.value }, 'meetingPoint')}
                required
                value={draft.meetingPoint}
              />
              <FieldError id="offer-meeting-error" message={errors.meetingPoint} />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              Количество мест
              <input
                aria-describedby={errors.seats ? 'offer-seats-error' : undefined}
                aria-invalid={Boolean(errors.seats)}
                className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                min="1"
                onChange={(event) => onChange({ ...draft, seats: event.target.value }, 'seats')}
                required
                type="number"
                value={draft.seats}
              />
              <FieldError id="offer-seats-error" message={errors.seats} />
            </label>

            {draft.offerType === 'trip' ? (
              <>
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Дата
                  <input
                    aria-describedby={errors.date ? 'offer-date-error' : undefined}
                    aria-invalid={Boolean(errors.date)}
                    className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                    onChange={(event) => onChange({ ...draft, date: event.target.value }, 'date')}
                    required
                    type="date"
                    value={draft.date}
                  />
                  <FieldError id="offer-date-error" message={errors.date} />
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Время выезда
                  <input
                    aria-describedby={errors.departureTime ? 'offer-time-error' : undefined}
                    aria-invalid={Boolean(errors.departureTime)}
                    className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                    onChange={(event) => onChange({ ...draft, departureTime: event.target.value }, 'departureTime')}
                    required
                    type="time"
                    value={draft.departureTime}
                  />
                  <FieldError id="offer-time-error" message={errors.departureTime} />
                </label>
              </>
            ) : (
              <>
                <fieldset
                  aria-describedby={errors.weekdays ? 'offer-weekdays-error' : undefined}
                  aria-invalid={Boolean(errors.weekdays)}
                  className="grid min-w-0 gap-2 md:col-span-2"
                  tabIndex={-1}
                >
                  <legend className="text-sm font-semibold">Дни недели</legend>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {weekdayOptions.map((day) => (
                      <label
                        className="flex min-w-0 items-center justify-center gap-2 rounded-lg border border-stone-300 px-2 py-3 text-sm font-semibold"
                        key={day.value}
                      >
                        <input
                          checked={draft.weekdays.includes(day.value)}
                          onChange={(event) => toggleWeekday(day.value, event.target.checked)}
                          type="checkbox"
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                  <FieldError id="offer-weekdays-error" message={errors.weekdays} />
                </fieldset>
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Обычное время выезда
                  <input
                    aria-describedby={errors.departureTime ? 'offer-time-error' : undefined}
                    aria-invalid={Boolean(errors.departureTime)}
                    className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                    onChange={(event) => onChange({ ...draft, departureTime: event.target.value }, 'departureTime')}
                    required
                    type="time"
                    value={draft.departureTime}
                  />
                  <FieldError id="offer-time-error" message={errors.departureTime} />
                </label>
              </>
            )}
          </fieldset>

          <label className="flex min-w-0 gap-3 rounded-lg bg-stone-100 p-4 text-sm leading-6 text-stone-700">
            <input
              checked={draft.returnTrip}
              className="mt-1 h-4 w-4"
              onChange={(event) => onChange({ ...draft, returnTrip: event.target.checked }, 'returnTrip')}
              type="checkbox"
            />
            Обратная поездка планируется
          </label>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button className="w-full rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white sm:w-auto" type="submit">
              {draft.offerType === 'trip' ? 'Создать поездку' : 'Создать маршрут'}
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
