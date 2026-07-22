import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompatibleDriverOffer,
  PrivateDriverOfferDraft,
  PrivateDriverOfferDraftErrors,
} from '@/lib/rideMatchState';
import { validatePrivateDriverOfferDraft } from '@/lib/rideMatchState';
import type { LocalDriverProfile, PassengerRequest } from '@/lib/types';

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <span className="min-h-5 text-sm text-red-700" id={id} role={message ? 'alert' : undefined}>
      {message}
    </span>
  );
}

function createInitialPrivateDraft(request: PassengerRequest): PrivateDriverOfferDraft {
  return {
    publicName: '',
    phone: '',
    email: '',
    originLabel: '',
    departureTime: '',
    offeredPassengerCount: String(request.passengerCount),
    maxDetourKm: '',
    consent: false,
  };
}

export function DriverResponseDialog({
  request,
  churchName,
  offers,
  savedProfile,
  onCancel,
  onSubmit,
  onSubmitPrivate,
}: {
  request: PassengerRequest;
  churchName: string;
  offers: CompatibleDriverOffer[];
  savedProfile: Pick<LocalDriverProfile, 'publicName'> | null;
  onCancel: () => void;
  onSubmit: (offer: CompatibleDriverOffer, offeredPassengerCount: number) => void;
  onSubmitPrivate: (draft: PrivateDriverOfferDraft) => void;
}) {
  const [offerId, setOfferId] = useState(offers[0]?.offerId ?? '');
  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.offerId === offerId) ?? offers[0],
    [offerId, offers],
  );
  const maxCount = selectedOffer ? Math.min(request.passengerCount, selectedOffer.availableSeats) : 0;
  const [count, setCount] = useState(maxCount || 1);
  const [privateDraft, setPrivateDraft] = useState(() => createInitialPrivateDraft(request));
  const [privateErrors, setPrivateErrors] = useState<PrivateDriverOfferDraftErrors>({});
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
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
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

  const validCount = Math.min(Math.max(1, count), Math.max(1, maxCount));
  const requestTiming = request.serviceEvent.startsWith('Дата поездки: ')
    ? `дату ${request.serviceEvent.slice('Дата поездки: '.length)}`
    : request.serviceEvent;
  const fieldClassName = 'rounded-lg border border-stone-300 bg-white px-3 py-3 font-normal';
  const privateFieldClassName = (fieldName: keyof PrivateDriverOfferDraft) =>
    `rounded-lg border bg-white px-3 py-3 font-normal ${privateErrors[fieldName] ? 'border-red-600' : 'border-stone-300'}`;

  function setPrivateField<K extends keyof PrivateDriverOfferDraft>(
    fieldName: K,
    value: PrivateDriverOfferDraft[K],
  ) {
    const nextDraft = { ...privateDraft, [fieldName]: value };
    setPrivateDraft(nextDraft);
    if (!privateErrors[fieldName]) return;
    const message = validatePrivateDriverOfferDraft({
      draft: nextDraft,
      request,
      requireProfile: !savedProfile,
      now: new Date(),
    }).errors[fieldName];
    setPrivateErrors((current) => {
      const next = { ...current };
      if (message) next[fieldName] = message;
      else delete next[fieldName];
      return next;
    });
  }

  function validatePrivateField(fieldName: keyof PrivateDriverOfferDraft) {
    if (!blurValidationReadyRef.current) return;
    const message = validatePrivateDriverOfferDraft({
      draft: privateDraft,
      request,
      requireProfile: !savedProfile,
      now: new Date(),
    }).errors[fieldName];
    setPrivateErrors((current) => {
      const next = { ...current };
      if (message) next[fieldName] = message;
      else delete next[fieldName];
      return next;
    });
  }

  function submitPrivateOffer() {
    const validation = validatePrivateDriverOfferDraft({
      draft: privateDraft,
      request,
      requireProfile: !savedProfile,
      now: new Date(),
    });
    if (Object.keys(validation.errors).length > 0) {
      setPrivateErrors(validation.errors);
      window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    onSubmitPrivate(privateDraft);
  }

  return (
    <div
      aria-labelledby="driver-response-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/55 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      role="dialog"
      ref={dialogRef}
    >
      <section className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold" id="driver-response-title">
              {offers.length > 0 ? 'Предложить места' : 'Предложить места пассажиру'}
            </h2>
            {offers.length > 0 ? (
              <>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {request.firstName}: {request.passengerCount} пасс., {request.serviceEvent}.
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-600">Район посадки: {request.pickupZone.label}</p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-stone-700">
                Вы предлагаете подвезти {request.firstName} в храм {churchName} на {requestTiming}. Заполните недостающие данные о своей поездке, и мы отправим предложение пассажиру.
              </p>
            )}
          </div>
          <button aria-label="Закрыть" className="grid h-10 w-10 place-items-center rounded-full border border-stone-300 text-2xl" onClick={onCancel} type="button">×</button>
        </div>

        {offers.length > 0 ? (
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (selectedOffer) onSubmit(selectedOffer, validCount);
            }}
          >
            <label className="grid gap-1 text-sm font-semibold">
              Ваша поездка
              <select
                className={fieldClassName}
                data-dialog-initial-focus
                onChange={(event) => {
                  const nextOfferId = event.target.value;
                  const nextOffer = offers.find((offer) => offer.offerId === nextOfferId);
                  setOfferId(nextOfferId);
                  setCount(nextOffer ? Math.min(request.passengerCount, nextOffer.availableSeats) : 1);
                }}
                value={selectedOffer?.offerId}
              >
                {offers.map((offer) => <option key={offer.offerId} value={offer.offerId}>{offer.label} · свободно {offer.availableSeats}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Сколько мест предложить
              <input className={fieldClassName} max={maxCount} min="1" onChange={(event) => setCount(Number(event.target.value))} required type="number" value={validCount} />
            </label>
            <p className="text-sm leading-6 text-stone-600">Контакты останутся скрыты, пока пассажир не примет предложение.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white" type="submit">Отправить предложение</button>
              <button className="rounded-lg border border-stone-300 px-5 py-3 font-semibold" onClick={onCancel} type="button">Отмена</button>
            </div>
          </form>
        ) : (
          <form
            className="mt-5 grid gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitPrivateOffer();
            }}
          >
            {savedProfile ? (
              <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">Предложение от имени: {savedProfile.publicName}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid content-start gap-1 text-sm font-semibold">
                  Имя*
                  <input aria-describedby={privateErrors.publicName ? 'private-name-error' : undefined} aria-invalid={Boolean(privateErrors.publicName)} className={privateFieldClassName('publicName')} data-dialog-initial-focus onBlur={() => validatePrivateField('publicName')} onChange={(event) => setPrivateField('publicName', event.target.value)} value={privateDraft.publicName} />
                  <FieldError id="private-name-error" message={privateErrors.publicName} />
                </label>
                <label className="grid content-start gap-1 text-sm font-semibold">
                  Телефон*
                  <input aria-describedby={privateErrors.phone ? 'private-phone-error' : undefined} aria-invalid={Boolean(privateErrors.phone)} className={privateFieldClassName('phone')} inputMode="tel" onBlur={() => validatePrivateField('phone')} onChange={(event) => setPrivateField('phone', event.target.value)} placeholder="+39 333 123 4567" type="tel" value={privateDraft.phone} />
                  <FieldError id="private-phone-error" message={privateErrors.phone} />
                </label>
                <label className="grid content-start gap-1 text-sm font-semibold sm:col-span-2">
                  <span>Email <span className="font-normal text-stone-500">(необязательно)</span></span>
                  <input aria-describedby={privateErrors.email ? 'private-email-error' : undefined} aria-invalid={Boolean(privateErrors.email)} className={privateFieldClassName('email')} onBlur={() => validatePrivateField('email')} onChange={(event) => setPrivateField('email', event.target.value)} type="email" value={privateDraft.email} />
                  <FieldError id="private-email-error" message={privateErrors.email} />
                </label>
              </div>
            )}

            <label className="grid gap-1 text-sm font-semibold">
              Откуда вы едете?*
              <input aria-describedby={privateErrors.originLabel ? 'private-origin-error' : undefined} aria-invalid={Boolean(privateErrors.originLabel)} className={privateFieldClassName('originLabel')} data-dialog-initial-focus={savedProfile ? true : undefined} onBlur={() => validatePrivateField('originLabel')} onChange={(event) => setPrivateField('originLabel', event.target.value)} value={privateDraft.originLabel} />
              <FieldError id="private-origin-error" message={privateErrors.originLabel} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Время выезда*
              <input aria-describedby={privateErrors.departureTime ? 'private-time-error' : undefined} aria-invalid={Boolean(privateErrors.departureTime)} className={privateFieldClassName('departureTime')} onBlur={() => validatePrivateField('departureTime')} onChange={(event) => setPrivateField('departureTime', event.target.value)} type="time" value={privateDraft.departureTime} />
              <FieldError id="private-time-error" message={privateErrors.departureTime} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Сколько мест предложить*
              <input aria-describedby={privateErrors.offeredPassengerCount ? 'private-count-error' : undefined} aria-invalid={Boolean(privateErrors.offeredPassengerCount)} className={privateFieldClassName('offeredPassengerCount')} max={request.passengerCount} min="1" onBlur={() => validatePrivateField('offeredPassengerCount')} onChange={(event) => setPrivateField('offeredPassengerCount', event.target.value)} type="number" value={privateDraft.offeredPassengerCount} />
              <FieldError id="private-count-error" message={privateErrors.offeredPassengerCount} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              <span>Возможное отклонение от маршрута <span className="font-normal text-stone-500">(необязательно)</span></span>
              <select aria-describedby={privateErrors.maxDetourKm ? 'private-detour-error' : undefined} aria-invalid={Boolean(privateErrors.maxDetourKm)} className={privateFieldClassName('maxDetourKm')} onBlur={() => validatePrivateField('maxDetourKm')} onChange={(event) => setPrivateField('maxDetourKm', event.target.value)} value={privateDraft.maxDetourKm}>
                <option value="">Не указывать</option>
                <option value="0">Только по моему маршруту</option>
                <option value="2">До 2 км</option>
                <option value="5">До 5 км</option>
                <option value="10">До 10 км</option>
                <option value="15">До 15 км</option>
                <option value="20">До 20 км</option>
              </select>
              <FieldError id="private-detour-error" message={privateErrors.maxDetourKm} />
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-4 text-sm leading-6 ${privateErrors.consent ? 'border-red-600 bg-red-50' : 'border-stone-200 bg-stone-100'}`}>
              <input aria-describedby={privateErrors.consent ? 'private-consent-error' : undefined} aria-invalid={Boolean(privateErrors.consent)} checked={privateDraft.consent} className="mt-1 h-5 w-5 shrink-0" onBlur={() => validatePrivateField('consent')} onChange={(event) => setPrivateField('consent', event.target.checked)} type="checkbox" />
              <span>После подтверждения поездки пассажир увидит мой телефон и электронную почту, если я её указал, а я увижу его контакты. Я согласен на это.</span>
            </label>
            <FieldError id="private-consent-error" message={privateErrors.consent} />
            <p className="text-sm leading-6 text-stone-600">Это предложение увидит только пассажир. Неиспользованные места не появятся на общей доске.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="rounded-lg bg-stone-950 px-5 py-3 font-semibold text-white" type="submit">Предложить места</button>
              <button className="rounded-lg border border-stone-300 px-5 py-3 font-semibold" onClick={onCancel} type="button">Отмена</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
