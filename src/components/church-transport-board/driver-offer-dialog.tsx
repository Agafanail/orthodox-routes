import { useEffect, useRef } from 'react';
import { ServiceSelectionField } from '@/components/church-transport-board/service-selection-field';
import { CountControl } from '@/components/church-transport-board/count-control';
import type {
  DriverOfferDraft,
  DriverOfferDraftErrors,
  DriverOfferMode,
} from '@/lib/driverOfferState';
import { maxDetourKmValues } from '@/lib/driverOfferState';
import type { ChurchService } from '@/lib/types';
import { getChurchServiceOptions } from '@/lib/serviceOptions';

const weekdayOptions = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];

const maxDetourLabels: Record<(typeof maxDetourKmValues)[number], string> = {
  0: '0 км — только по маршруту',
  2: 'до 2 км',
  5: 'до 5 км',
  10: 'до 10 км',
  15: 'до 15 км',
  20: 'до 20 км',
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <span className="min-h-5 text-sm font-normal text-red-700" id={id} role={message ? 'alert' : undefined}>
      {message}
    </span>
  );
}

const fieldClassName =
  'w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 font-normal';

export function DriverOfferDialog({
  draft,
  errors,
  savedProfile,
  services,
  submitAttempt,
  successPrefill,
  onAddRegular,
  onBlur,
  onCancel,
  onChange,
  onModeChange,
  onSubmit,
}: {
  draft: DriverOfferDraft;
  errors: DriverOfferDraftErrors;
  savedProfile: { publicName: string } | null;
  services: ChurchService[];
  submitAttempt: number;
  successPrefill: DriverOfferDraft | null;
  onAddRegular: () => void;
  onBlur: (fieldName: keyof DriverOfferDraft) => void;
  onCancel: () => void;
  onChange: (draft: DriverOfferDraft, fieldName: keyof DriverOfferDraft) => void;
  onModeChange: (mode: DriverOfferMode) => void;
  onSubmit: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [submitAttempt]);

  function toggleWeekday(day: number, checked: boolean) {
    const weekdays = checked ? [...draft.weekdays, day] : draft.weekdays.filter((value) => value !== day);
    onChange({ ...draft, weekdays }, 'weekdays');
  }

  function handleBlur(fieldName: keyof DriverOfferDraft) {
    if (blurValidationReadyRef.current) onBlur(fieldName);
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
      ref={dialogRef}
    >
      <div className="mx-auto min-h-full w-full min-w-0 overflow-hidden bg-white p-5 shadow-xl sm:min-h-0 sm:max-w-3xl sm:rounded-lg sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              className={successPrefill ? 'text-3xl font-bold text-emerald-900' : 'text-2xl font-bold'}
              id="driver-offer-dialog-title"
            >
              {successPrefill ? 'Поездка создана' : 'Создать поездку'}
            </h2>
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

        {successPrefill ? (
          <section className="offer-success-panel mt-8 max-w-2xl">
            <h3 className="text-lg font-semibold text-stone-800">Ездите в храм так регулярно?</h3>
            <p className="mt-2 leading-6 text-stone-600">
              Можно добавить регулярную поездку с теми же данными.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                className="rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white"
                onClick={onAddRegular}
                type="button"
              >
                Добавить регулярную поездку
              </button>
              <button
                className="rounded-lg border border-stone-300 bg-white px-5 py-3 font-semibold"
                onClick={onCancel}
                type="button"
              >
                Оставить разовой
              </button>
            </div>
          </section>
        ) : (
          <>
            <div aria-label="Тип поездки" className="mt-5 grid grid-cols-2 rounded-lg bg-stone-100 p-1" role="group">
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
                Регулярная поездка
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
                  <p className="mt-1">Ваши контактные данные будут использованы для этой поездки.</p>
                </section>
              ) : (
                <fieldset className="grid min-w-0 gap-4 rounded-lg border border-stone-200 p-4 md:grid-cols-2">
                  <legend className="px-1 font-semibold">Данные водителя</legend>
                  <p className="text-sm text-stone-600 md:col-span-2">Поля со звёздочкой обязательны.</p>
                  <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
                    Имя*
                    <input
                      aria-describedby={errors.publicName ? 'driver-public-name-error' : undefined}
                      aria-invalid={Boolean(errors.publicName)}
                      className={fieldClassName}
                      data-dialog-initial-focus
                      onBlur={() => handleBlur('publicName')}
                      onChange={(event) => onChange({ ...draft, publicName: event.target.value }, 'publicName')}
                      required
                      value={draft.publicName}
                    />
                    <FieldError id="driver-public-name-error" message={errors.publicName} />
                  </label>
                  <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
                    Телефон*
                    <input
                      aria-describedby={errors.phone ? 'driver-phone-error driver-contact-help' : 'driver-contact-help'}
                      aria-invalid={Boolean(errors.phone)}
                      className={fieldClassName}
                      inputMode="tel"
                      onBlur={() => handleBlur('phone')}
                      onChange={(event) => onChange({ ...draft, phone: event.target.value }, 'phone')}
                      placeholder="+39 333 123 4567"
                      required
                      type="tel"
                      value={draft.phone}
                    />
                    <FieldError id="driver-phone-error" message={errors.phone} />
                  </label>
                  <label className="grid min-w-0 content-start gap-1 text-sm font-semibold">
                    <span>Email <span className="font-normal text-stone-500">(необязательно)</span></span>
                    <input
                      aria-describedby={errors.email ? 'driver-email-error driver-contact-help' : 'driver-contact-help'}
                      aria-invalid={Boolean(errors.email)}
                      className={fieldClassName}
                      onBlur={() => handleBlur('email')}
                      onChange={(event) => onChange({ ...draft, email: event.target.value }, 'email')}
                      type="email"
                      value={draft.email}
                    />
                    <FieldError id="driver-email-error" message={errors.email} />
                  </label>
                  <p className="text-xs leading-5 text-stone-600 md:col-span-2" id="driver-contact-help">
                    После подтверждения поездки пассажир увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.
                  </p>
                </fieldset>
              )}

              <fieldset className="grid min-w-0 gap-4 md:grid-cols-2">
                <legend className="sr-only">Данные поездки</legend>
                <label className="grid min-w-0 gap-1 text-sm font-semibold">
                  Откуда вы едете?*
                  <input
                    aria-describedby={errors.originLabel ? 'offer-origin-error' : undefined}
                    aria-invalid={Boolean(errors.originLabel)}
                    className={fieldClassName}
                    data-dialog-initial-focus={savedProfile ? true : undefined}
                    onBlur={() => handleBlur('originLabel')}
                    onChange={(event) => onChange({ ...draft, originLabel: event.target.value }, 'originLabel')}
                    placeholder="Squillace"
                    required
                    value={draft.originLabel}
                  />
                  <FieldError id="offer-origin-error" message={errors.originLabel} />
                </label>

                <label className="grid min-w-0 gap-1 text-sm font-semibold md:col-span-2">
                  На сколько километров вы готовы отклониться от маршрута?*
                  <select
                    aria-describedby={errors.maxDetourKm ? 'offer-max-detour-error' : undefined}
                    aria-invalid={Boolean(errors.maxDetourKm)}
                    className={fieldClassName}
                    onBlur={() => handleBlur('maxDetourKm')}
                    onChange={(event) => onChange({ ...draft, maxDetourKm: event.target.value }, 'maxDetourKm')}
                    required
                    value={draft.maxDetourKm}
                  >
                    <option value="">Выберите</option>
                    {maxDetourKmValues.map((value) => (
                      <option key={value} value={value}>{maxDetourLabels[value]}</option>
                    ))}
                  </select>
                  <FieldError id="offer-max-detour-error" message={errors.maxDetourKm} />
                </label>

                <div className="grid min-w-0 gap-1">
                  <CountControl
                    describedBy={errors.seats ? 'offer-seats-error' : undefined}
                    invalid={Boolean(errors.seats)}
                    label="Свободных мест*"
                    onBlur={() => handleBlur('seats')}
                    onChange={(value) => onChange({ ...draft, seats: value }, 'seats')}
                    value={draft.seats}
                  />
                  <FieldError id="offer-seats-error" message={errors.seats} />
                </div>

                {draft.offerType === 'trip' ? (
                  <>
                    <div className="grid min-w-0 gap-3 md:col-span-2">
                      <ServiceSelectionField
                        error={errors.date ?? errors.selectedServiceId}
                        errorId="offer-service-error"
                        label="Когда вы едете *"
                        name="driver-service"
                        onBlur={handleBlur}
                        onChange={(selection, fieldName) =>
                          onChange({ ...draft, ...selection }, fieldName)
                        }
                        options={getChurchServiceOptions(services)}
                        selection={draft}
                      />
                    </div>
                    <label className="grid min-w-0 gap-1 text-sm font-semibold md:col-span-2">
                      Примерное время выезда*
                      <input
                        aria-describedby={errors.departureTime ? 'offer-time-error offer-time-help' : 'offer-time-help'}
                        aria-invalid={Boolean(errors.departureTime)}
                        className={fieldClassName}
                        onBlur={() => handleBlur('departureTime')}
                        onInput={(event) => onChange({ ...draft, departureTime: event.currentTarget.value }, 'departureTime')}
                        required
                        type="time"
                        value={draft.departureTime}
                      />
                      <span className="text-xs font-normal leading-5 text-stone-600" id="offer-time-help">
                        Пассажир увидит это время и сможет понять, подходит ли ему поездка.
                      </span>
                      <FieldError id="offer-time-error" message={errors.departureTime} />
                    </label>
                  </>
                ) : (
                  <>
                    <fieldset
                      aria-describedby={errors.weekdays ? 'offer-weekdays-error' : undefined}
                      aria-invalid={Boolean(errors.weekdays)}
                      className="grid min-w-0 gap-2 md:col-span-2"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          handleBlur('weekdays');
                        }
                      }}
                      tabIndex={-1}
                    >
                      <legend className="text-sm font-semibold">Дни недели*</legend>
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
                      Обычное время выезда*
                      <input
                        aria-describedby={errors.departureTime ? 'offer-time-error' : undefined}
                        aria-invalid={Boolean(errors.departureTime)}
                        className={fieldClassName}
                        onBlur={() => handleBlur('departureTime')}
                        onInput={(event) => onChange({ ...draft, departureTime: event.currentTarget.value }, 'departureTime')}
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
                Могу подвезти обратно
              </label>

              <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
                <button className="w-full rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white sm:w-auto" type="submit">
                  {draft.offerType === 'trip' ? 'Создать поездку' : 'Создать регулярную поездку'}
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
          </>
        )}
      </div>
    </div>
  );
}
