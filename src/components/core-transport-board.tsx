import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  answerPassengerResponseAction,
  cancelDriverOccurrenceAction,
  cancelPassengerRequestAction,
  cancelRideAgreementAction,
  confirmRideResponseAction,
  declineRideResponseAction,
  publishDriverOccurrenceAction,
  publishDriverResponseWithOccurrenceAction,
  publishDriverSeriesAction,
  publishPassengerRequestAction,
  publishPassengerResponseWithRequestAction,
  rejectPassengerResponseAction,
  restorePassengerRequestAction,
  revealAgreementAction,
  startDriverOccurrenceContextualAction,
  startDriverResponseContextualAction,
  startDriverSeriesContextualAction,
  startPassengerContextualAction,
  startPassengerResponseContextualAction,
  stopDriverSeriesAction,
  submitDriverResponseAction,
  submitPassengerResponseAction,
  withdrawRideResponseAction,
} from '@/app/core-transport/actions';
import { searchPlacesAction } from '@/app/core-transport/place-search';
import type { CoreTransportData } from '@/lib/core-transport/types';
import { detourSummary, matchesOccurrence, matchesRequest, type QualityMatch } from '@/lib/geo/match';
import type { SavedPlace } from '@/lib/geo/types';
import { PlaceField } from './place-field';

type Props = CoreTransportData & { status?: string };

const statuses: Record<string, string> = {
  'action-failed': 'Действие не выполнено. Проверьте данные и актуальное состояние поездки.',
  'agreement-cancelled': 'Договорённость отменена. Доступ к контактам закрыт.',
  'agreement-confirmed': 'Договорённость подтверждена.',
  'backend-unavailable': 'Сервис временно недоступен.',
  'invalid-input': 'Проверьте заполненные поля.',
  'offer-cancelled': 'Предложение поездки отменено.',
  'offer-published': 'Предложение поездки опубликовано.',
  'publication-complete': 'Действие опубликовано.',
  'rate-limited': 'Слишком много попыток. Подождите и попробуйте снова.',
  'request-cancelled': 'Запрос отменён.',
  'request-published': 'Запрос опубликован.',
  'request-restored': 'Запрос снова опубликован.',
  'response-answered': 'Условия отправлены пассажиру.',
  'response-declined': 'Ответ отклонён.',
  'response-sent': 'Ответ отправлен.',
  'response-withdrawn': 'Ответ отозван.',
  'series-published': 'Регулярное предложение опубликовано.',
  'series-stopped': 'Регулярное предложение остановлено.',
};

const stateLabels: Record<string, string> = {
  accepted: 'принято', active: 'опубликовано', archived: 'в архиве',
  await_driver: 'ожидает ответа водителя', await_passenger: 'ожидает решения пассажира',
  cancelled: 'отменено', change_pending: 'ожидает согласования изменений',
  completed: 'поездка завершена', declined: 'отклонено', expired: 'срок истёк',
  fulfilled: 'все места найдены', full: 'свободных мест нет', no_outcome: 'итог не указан',
  outcome: 'итог указан', partial: 'часть мест ещё нужна', restore: 'ожидает повторной публикации',
  stale: 'условия больше недоступны', stopped: 'остановлено', withdrawn: 'отозвано',
};

function stateLabel(value: string) { return stateLabels[value] ?? 'состояние обновлено'; }

function Hidden({ churchId, churchName, slug, timezone }: {
  churchId: string; churchName: string; slug: string; timezone: string;
}) {
  return <>
    <input name="church_id" type="hidden" value={churchId} />
    <input name="church_name" type="hidden" value={churchName} />
    <input name="church_slug" type="hidden" value={slug} />
    <input name="timezone" type="hidden" value={timezone} />
    <input name="client_key" type="hidden" value={randomUUID()} />
  </>;
}

function IdentityFields() {
  return <fieldset className="grid gap-3 rounded-md border border-stone-200 p-3">
    <legend className="px-1 font-semibold">Ваши данные для регистрации</legend>
    <label className="grid gap-1">Имя<input autoComplete="name" maxLength={80} name="display_name" required /></label>
    <label className="grid gap-1">Email<input autoComplete="email" maxLength={254} name="email" required type="email" /></label>
    <label className="grid gap-1">Телефон<input autoComplete="tel" maxLength={16} name="phone" placeholder="+390000000000" required type="tel" /></label>
    <label className="grid gap-1">Язык
      <select defaultValue="ru" name="preferred_language">
        <option value="ru">Русский</option><option value="en">English</option><option value="it">Italiano</option>
        <option value="ro">Română</option><option value="uk">Українська</option><option value="de">Deutsch</option>
      </select>
    </label>
  </fieldset>;
}

type PlaceContext = {
  mapAvailable: boolean;
  browserKey: string | null;
  savedPlaces: SavedPlace[];
  near?: { lat: number; lng: number };
};

function PassengerFields({ places }: { places: PlaceContext }) {
  return <>
    <label className="grid gap-1">Желаемое прибытие<input name="desired_arrival_local" required type="datetime-local" /></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">Всего пассажиров<input defaultValue={1} max={55} min={1} name="passenger_count" required type="number" /></label>
      <label className="grid gap-1">Из них детей<input defaultValue={0} max={55} min={0} name="children_count" required type="number" /></label>
    </div>
    <PlaceField
      browserKey={places.browserKey}
      hint="Укажите, где вас удобно забрать. Всем будет видна только примерная область около 1 км."
      legend="Место встречи"
      mapAvailable={places.mapAvailable}
      maximum={3}
      name="places"
      near={places.near}
      savedPlaces={places.savedPlaces}
      searchPlaces={searchPlacesAction}
    />
    <label><input name="child_seat_required" type="checkbox" value="yes" /> Нужно детское кресло</label>
    <label><input name="return_required" type="checkbox" value="yes" /> Нужна обратная дорога</label>
    <label className="grid gap-1">Комментарий<textarea maxLength={300} name="public_note" /></label>
  </>;
}

function DriverFields({ places, series = false }: { places: PlaceContext; series?: boolean }) {
  return <>
    {series ? <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">Начало<input name="starts_on" required type="date" /></label>
        <label className="grid gap-1">Конец<input name="ends_on" required type="date" /></label>
        <label className="grid gap-1">Выезд<input name="local_departure_time" required type="time" /></label>
        <label className="grid gap-1">Прибытие<input name="local_arrival_time" required type="time" /></label>
      </div>
      <fieldset><legend className="font-semibold">Дни недели</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'].map((label, value) => (
            <label key={label}><input name="weekdays" type="checkbox" value={value} /> {label}</label>
          ))}
        </div>
      </fieldset>
    </> : <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">Выезд<input name="departure_local" required type="datetime-local" /></label>
      <label className="grid gap-1">Прибытие<input name="arrival_local" required type="datetime-local" /></label>
    </div>}
    <PlaceField
      browserKey={places.browserKey}
      hint="Укажите, откуда вы выезжаете. Всем будет видна только примерная область около 1 км, а маршрут поездки не публикуется."
      legend="Место отправления"
      mapAvailable={places.mapAvailable}
      maximum={1}
      name="origin"
      near={places.near}
      savedPlaces={places.savedPlaces}
      searchPlaces={searchPlacesAction}
    />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">Свободных мест<input defaultValue={1} max={55} min={1} name="seats_available" required type="number" /></label>
      <label className="grid gap-1">Максимальный крюк
        <select defaultValue="5" name="max_detour_km">{[0, 2, 5, 10, 15, 20].map((value) => <option key={value} value={value}>{value} км</option>)}</select>
      </label>
    </div>
    <label><input name="children_allowed" type="checkbox" value="yes" /> Можно с детьми</label>
    <label><input name="driver_child_seat_available" type="checkbox" value="yes" /> Есть детское кресло</label>
    <label><input name="return_available" type="checkbox" value="yes" /> Возможна обратная дорога</label>
    <label className="grid gap-1">Комментарий<textarea maxLength={300} name="public_note" /></label>
  </>;
}

function FormShell({ children, title }: { children: ReactNode; title: string }) {
  return <details className="rounded-lg border border-stone-200 bg-white p-4">
    <summary className="cursor-pointer font-bold text-amber-900">{title}</summary>
    {children}
  </details>;
}

function date(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
  } catch { return value; }
}

/**
 * What a confirmed agreement opens, and only that.
 *
 * The driver receives the one meeting place chosen for this ride; the passenger receives the
 * driver's exact departure place. The passenger's other places are never part of this, and the
 * whole block appears only after an explicit participant action.
 */
function AgreementDisclosure({ disclosure }: { disclosure: NonNullable<Props['disclosure']> }) {
  return <dl className="mt-3 rounded border border-amber-200 bg-amber-50 p-3" data-agreement-disclosure>
    <div>
      <dt className="font-semibold">Контакт</dt>
      <dd>{disclosure.counterpartyName}: {disclosure.email}, {disclosure.phone}</dd>
    </div>
    <div>
      <dt className="font-semibold">Точное место встречи</dt>
      <dd>{disclosure.meetingPlace?.exactAddress ?? disclosure.exactMeetingLabel}</dd>
    </div>
    {disclosure.departurePlace ? <div>
      <dt className="font-semibold">Точное место отправления водителя</dt>
      <dd>{disclosure.departurePlace.exactAddress}</dd>
    </div> : null}
  </dl>;
}

/**
 * The whole user-facing result of matching: one plain word plus facts a person can check.
 * There is no percentage, no score, and no claim that one driver is better than another.
 */
function MatchBadge({ match }: { match?: QualityMatch }) {
  if (!match) return null;
  const best = match.places.find((place) => place.best) ?? match.places[0];
  return <p className="mt-2 text-sm font-semibold text-amber-900" data-quality-match>
    Подходит · {detourSummary(match)}
    {best ? <span className="block font-normal text-stone-700">
      {match.places.length > 1 ? 'Лучше всего подходит' : 'Подходит место встречи'}: {best.publicAreaLabel}
    </span> : null}
    {match.places.length > 1 ? <span className="block font-normal text-stone-600">
      Также подходит: {match.places.filter((place) => !place.best).map((place) => place.publicAreaLabel).join(', ')}
    </span> : null}
  </p>;
}

function actionHidden(slug: string) {
  return <><input name="church_slug" type="hidden" value={slug} /><input name="client_key" type="hidden" value={randomUUID()} /></>;
}

export function CoreTransportBoard(props: Props) {
  const eligible = props.eligibility?.eligible === true;
  const activeRequests = props.ownedRequests.filter((item) => ['active', 'partial'].includes(item.status));
  const activeOccurrences = props.ownedOccurrences.filter((item) => ['active', 'full'].includes(item.status) && item.availableSeats > 0);
  const notice = props.status ? statuses[props.status] : null;
  const common = {
    churchId: props.church.churchId, churchName: props.church.officialName,
    slug: props.church.slug, timezone: props.church.timezone,
  };
  const matches = props.qualityMatches;
  const matchedRequests = props.showMatchesOnly
    ? props.passengerRequests.filter((request) => matchesRequest(matches, request.requestId))
    : props.passengerRequests;
  const matchedOccurrences = props.showMatchesOnly
    ? props.driverOccurrences.filter((offer) => matchesOccurrence(matches, offer.occurrenceId))
    : props.driverOccurrences;
  const places: PlaceContext = {
    browserKey: props.mapBrowserKey,
    mapAvailable: props.mapAvailable,
    savedPlaces: props.savedPlaces,
    ...(props.church.lat === undefined || props.church.lng === undefined
      ? {}
      : { near: { lat: props.church.lat, lng: props.church.lng } }),
  };

  return <section className="mt-5 space-y-5" data-core-transport-board>
    {notice ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">{notice}</p> : null}
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Участие</h2>
      {props.accountName ? <p className="mt-2 text-stone-700">Вы вошли как {props.accountName}.</p> : (
        <p className="mt-2 text-stone-700">Можно посмотреть доску без регистрации. Для публикации понадобится подтвердить email, телефон, возраст и Условия участия.</p>
      )}
      {props.signedIn && !eligible ? <p className="mt-2 text-sm text-amber-900">Сервер пока не разрешает участие: завершите недостающие проверки через сохранённое действие.</p> : null}
      {!props.signedIn ? <Link className="mt-3 inline-block font-semibold text-amber-800" href="/auth">Войти</Link> : null}
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <FormShell title="Попросить подвезти">
        <form action={eligible ? publishPassengerRequestAction : startPassengerContextualAction} className="mt-4 grid gap-3">
          <Hidden {...common} />{!eligible ? <IdentityFields /> : null}<PassengerFields places={places} />
          <button className="rounded-md bg-amber-800 px-4 py-2 font-semibold text-white" type="submit">{eligible ? 'Опубликовать запрос' : 'Продолжить с регистрацией'}</button>
        </form>
      </FormShell>
      <FormShell title="Предложить разовую поездку">
        <form action={eligible ? publishDriverOccurrenceAction : startDriverOccurrenceContextualAction} className="mt-4 grid gap-3">
          <Hidden {...common} />{!eligible ? <IdentityFields /> : null}<DriverFields places={places} />
          <button className="rounded-md bg-amber-800 px-4 py-2 font-semibold text-white" type="submit">{eligible ? 'Опубликовать поездку' : 'Продолжить с регистрацией'}</button>
        </form>
      </FormShell>
      <FormShell title="Предложить регулярные поездки">
        <form action={eligible ? publishDriverSeriesAction : startDriverSeriesContextualAction} className="mt-4 grid gap-3">
          <Hidden {...common} />{!eligible ? <IdentityFields /> : null}<DriverFields places={places} series />
          <button className="rounded-md bg-amber-800 px-4 py-2 font-semibold text-white" type="submit">{eligible ? 'Опубликовать расписание' : 'Продолжить с регистрацией'}</button>
        </form>
      </FormShell>
    </div>

    {props.signedIn ? <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm" data-match-view>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className={`inline-flex min-h-11 items-center ${props.showMatchesOnly ? 'font-semibold text-stone-700' : 'font-bold text-amber-900'}`}
          href={`/churches/${props.church.slug}`}
        >Все объявления</Link>
        <Link
          className={`inline-flex min-h-11 items-center ${props.showMatchesOnly ? 'font-bold text-amber-900' : 'font-semibold text-stone-700'}`}
          href={`/churches/${props.church.slug}?view=matches`}
        >Подходящие мне</Link>
      </div>
      {props.showMatchesOnly && !props.matchingAvailable ? <p className="mt-3 text-sm" data-match-unavailable>
        Не удалось проверить подходящие поездки. Посмотрите все объявления.
      </p> : null}
      {props.showMatchesOnly && props.matchingAvailable ? <p className="mt-3 text-sm text-stone-600">
        Это подсказка. Договориться можно и с теми, кого здесь нет.
      </p> : null}
    </div> : null}

    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Пассажирам нужна помощь</h2>
        <div className="mt-4 space-y-3">
          {matchedRequests.length === 0 ? <p className="text-stone-600">{props.showMatchesOnly ? 'Пока нет просьб, которые вам подходят.' : 'Активных запросов пока нет.'}</p> : matchedRequests.map((request) => <article className="rounded-md bg-stone-50 p-4" key={request.requestId}>
            <h3 className="font-bold">{request.authorName}: {request.passengerCount} мест.</h3>
            <MatchBadge match={matches.find((match) => match.requestId === request.requestId && match.currentRole === 'driver')} />
            <p>{date(request.desiredArrivalAt, request.timezone)} · {request.placeOptions.map((place) => place.publicAreaLabel).join(' / ')}</p>
            <p className="text-sm text-stone-600">Детей: {request.childrenCount}. {request.returnRequired ? 'Нужна обратная дорога.' : ''}</p>
            {request.publicNote ? <p className="mt-1 text-sm">{request.publicNote}</p> : null}
            {eligible && activeOccurrences.length > 0 && !props.responses.some((response) => (
              response.requestId === request.requestId && ['await_driver', 'await_passenger'].includes(response.status)
            )) ? <form action={submitDriverResponseAction} className="mt-3 grid gap-2 rounded border border-stone-200 p-3">
              {actionHidden(props.church.slug)}<input name="request_id" type="hidden" value={request.requestId} />
              <label>Ваша поездка<select name="occurrence_id">{activeOccurrences.map((item) => <option key={item.occurrenceId} value={item.occurrenceId}>{date(props.driverOccurrences.find((offer) => offer.occurrenceId === item.occurrenceId)?.arrivalAt ?? '', props.church.timezone)} · {item.availableSeats} мест</option>)}</select></label>
              <label>Место<select name="place_id">{request.placeOptions.map((place) => <option key={place.placeId} value={place.placeId}>{place.publicAreaLabel}</option>)}</select></label>
              <label>Сколько пассажиров<input defaultValue={Math.min(request.passengerCount, activeOccurrences[0].availableSeats)} max={55} min={1} name="passenger_count" type="number" /></label>
              <button className="font-semibold text-amber-800" type="submit">Предложить поездку</button>
            </form> : null}
            {(!eligible || activeOccurrences.length === 0) && !props.responses.some((response) => (
              response.requestId === request.requestId && ['await_driver', 'await_passenger'].includes(response.status)
            )) ? <details className="mt-3 rounded border border-stone-200 p-3">
              <summary className="cursor-pointer font-semibold text-amber-900">Предложить поездку</summary>
              <form action={eligible ? publishDriverResponseWithOccurrenceAction : startDriverResponseContextualAction} className="mt-3 grid gap-3">
                <Hidden {...common} />{!eligible ? <IdentityFields /> : null}
                <input name="request_id" type="hidden" value={request.requestId} />
                <input name="target_name" type="hidden" value={request.authorName} />
                <input name="target_summary" type="hidden" value={`${date(request.desiredArrivalAt, request.timezone)} · ${request.placeOptions.map((place) => place.publicAreaLabel).join(' / ')}`} />
                <label className="grid gap-1">Место встречи<select name="place_id">{request.placeOptions.map((place) => <option key={place.placeId} value={place.placeId}>{place.publicAreaLabel}</option>)}</select></label>
                <label className="grid gap-1">Сколько пассажиров<input defaultValue={request.passengerCount} max={request.passengerCount} min={1} name="passenger_count" required type="number" /></label>
                <DriverFields places={places} />
                <button className="font-semibold text-amber-900" type="submit">{eligible ? 'Опубликовать поездку и ответить' : 'Продолжить с регистрацией'}</button>
              </form>
            </details> : null}
          </article>)}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Водители едут в храм</h2>
        <div className="mt-4 space-y-3">
          {matchedOccurrences.length === 0 ? <p className="text-stone-600">{props.showMatchesOnly ? 'Пока нет поездок, которые вам подходят.' : 'Активных предложений пока нет.'}</p> : matchedOccurrences.map((offer) => <article className="rounded-md bg-stone-50 p-4" key={offer.occurrenceId}>
            <h3 className="font-bold">{offer.authorName}: {offer.availableSeats} мест.</h3>
            <MatchBadge match={matches.find((match) => match.occurrenceId === offer.occurrenceId && match.currentRole === 'passenger')} />
            <p>{offer.publicOriginArea} · {date(offer.arrivalAt, offer.timezone)}</p>
            <p className="text-sm text-stone-600">Крюк до {offer.maxDetourKm} км. {offer.returnAvailable ? 'Возможна обратная дорога.' : ''}</p>
            {offer.publicNote ? <p className="mt-1 text-sm">{offer.publicNote}</p> : null}
            {eligible && activeRequests.length > 0 && !props.responses.some((response) => (
              response.occurrenceId === offer.occurrenceId && ['await_driver', 'await_passenger'].includes(response.status)
            )) ? <form action={submitPassengerResponseAction} className="mt-3 grid gap-2 rounded border border-stone-200 p-3">
              {actionHidden(props.church.slug)}<input name="occurrence_id" type="hidden" value={offer.occurrenceId} />
              <label>Ваш запрос<select name="request_id">{activeRequests.map((item) => <option key={item.requestId} value={item.requestId}>{item.remainingPassengers} мест</option>)}</select></label>
              <button className="font-semibold text-amber-800" type="submit">Попросить подвезти</button>
            </form> : null}
            {(!eligible || activeRequests.length === 0) && !props.responses.some((response) => (
              response.occurrenceId === offer.occurrenceId && ['await_driver', 'await_passenger'].includes(response.status)
            )) ? <details className="mt-3 rounded border border-stone-200 p-3">
              <summary className="cursor-pointer font-semibold text-amber-900">Попросить подвезти</summary>
              <form action={eligible ? publishPassengerResponseWithRequestAction : startPassengerResponseContextualAction} className="mt-3 grid gap-3">
                <Hidden {...common} />{!eligible ? <IdentityFields /> : null}
                <input name="occurrence_id" type="hidden" value={offer.occurrenceId} />
                <input name="target_name" type="hidden" value={offer.authorName} />
                <input name="target_summary" type="hidden" value={`${offer.publicOriginArea} · ${date(offer.arrivalAt, offer.timezone)}`} />
                <PassengerFields places={places} />
                <button className="font-semibold text-amber-900" type="submit">{eligible ? 'Опубликовать запрос и ответить' : 'Продолжить с регистрацией'}</button>
              </form>
            </details> : null}
          </article>)}
        </div>
      </section>
    </div>

    {props.signedIn ? <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Мои публикации</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {props.ownedRequests.map((item) => <article className="rounded bg-stone-50 p-3" key={item.requestId}><p>Запрос: {item.remainingPassengers} из {item.totalPassengers} мест · {stateLabel(item.status)}</p>
          {['active', 'partial'].includes(item.status) ? <form action={cancelPassengerRequestAction}>{actionHidden(props.church.slug)}<input name="request_id" type="hidden" value={item.requestId} /><button className="text-amber-900" type="submit">Отменить запрос</button></form> : null}
          {item.status === 'restore' ? <form action={restorePassengerRequestAction}>{actionHidden(props.church.slug)}<input name="request_id" type="hidden" value={item.requestId} /><button className="text-amber-900" type="submit">Опубликовать снова</button></form> : null}
        </article>)}
        {props.ownedOccurrences.map((item) => <article className="rounded bg-stone-50 p-3" key={item.occurrenceId}><p>Поездка: {item.availableSeats} свободно · {stateLabel(item.status)}</p>
          {['active', 'full'].includes(item.status) ? <form action={cancelDriverOccurrenceAction}>{actionHidden(props.church.slug)}<input name="occurrence_id" type="hidden" value={item.occurrenceId} /><button className="text-amber-900" type="submit">Отменить поездку</button></form> : null}
        </article>)}
        {props.ownedSeries.map((item) => <article className="rounded bg-stone-50 p-3" key={item.seriesId}><p>Регулярные поездки · {stateLabel(item.status)}</p>
          {item.status === 'active' ? <form action={stopDriverSeriesAction}>{actionHidden(props.church.slug)}<input name="series_id" type="hidden" value={item.seriesId} /><button className="text-amber-900" type="submit">Остановить расписание</button></form> : null}
        </article>)}
      </div>
    </section> : null}

    {props.responses.length > 0 ? <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Ответы</h2>
      <div className="mt-4 space-y-3">{props.responses.map((response) => {
        const request = props.passengerRequests.find((item) => item.requestId === response.requestId);
        return <article className="rounded bg-stone-50 p-4" key={response.responseId}>
          <p className="font-semibold">{response.passengerName} ↔ {response.driverName}</p><p>{response.offeredPassengerCount} мест · {stateLabel(response.status)}</p>
          {response.status === 'await_driver' && response.currentRole === 'driver' && request ? <div className="mt-2 flex flex-wrap gap-3">
            <form action={answerPassengerResponseAction} className="flex flex-wrap gap-2">{actionHidden(props.church.slug)}<input name="response_id" type="hidden" value={response.responseId} />
              <select name="place_id">{request.placeOptions.map((place) => <option key={place.placeId} value={place.placeId}>{place.publicAreaLabel}</option>)}</select><input defaultValue={response.offeredPassengerCount} max={55} min={1} name="passenger_count" type="number" /><button className="font-semibold text-amber-900" type="submit">Предложить условия</button>
            </form><form action={rejectPassengerResponseAction}>{actionHidden(props.church.slug)}<input name="response_id" type="hidden" value={response.responseId} /><button type="submit">Отклонить</button></form>
          </div> : null}
          {response.status === 'await_passenger' && response.currentRole === 'passenger' ? <div className="mt-2 flex gap-3"><form action={confirmRideResponseAction}>{actionHidden(props.church.slug)}<input name="response_id" type="hidden" value={response.responseId} /><button className="font-semibold text-amber-900" type="submit">Подтвердить</button></form><form action={declineRideResponseAction}>{actionHidden(props.church.slug)}<input name="response_id" type="hidden" value={response.responseId} /><button type="submit">Отклонить</button></form></div> : null}
          {['await_driver', 'await_passenger'].includes(response.status) && ((response.currentRole === 'passenger' && response.status === 'await_driver') || (response.currentRole === 'driver' && response.status === 'await_passenger')) ? <form action={withdrawRideResponseAction} className="mt-2">{actionHidden(props.church.slug)}<input name="response_id" type="hidden" value={response.responseId} /><button type="submit">Отозвать</button></form> : null}
        </article>;
      })}</div>
    </section> : null}

    {props.agreements.length > 0 ? <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Договорённости</h2>
      <div className="mt-4 space-y-3">{props.agreements.map((agreement) => <article className="rounded bg-stone-50 p-4" key={agreement.agreementId}>
        <p className="font-semibold">{agreement.passengerName} ↔ {agreement.driverName}</p><p>{agreement.confirmedPassengerCount} мест · {date(agreement.scheduledArrivalAt, agreement.timezone)} · {stateLabel(agreement.status)}</p>
        {props.disclosure?.agreementId === agreement.agreementId
          ? <AgreementDisclosure disclosure={props.disclosure} />
          : agreement.contactAvailable ? <form action={revealAgreementAction} className="mt-2"><input name="church_slug" type="hidden" value={props.church.slug} /><input name="agreement_id" type="hidden" value={agreement.agreementId} /><button className="font-semibold text-amber-900" type="submit">Показать контакт и точное место</button></form> : null}
        {['confirmed', 'change_pending'].includes(agreement.status) ? <form action={cancelRideAgreementAction} className="mt-2">{actionHidden(props.church.slug)}<input name="agreement_id" type="hidden" value={agreement.agreementId} /><button type="submit">Отменить договорённость</button></form> : null}
      </article>)}</div>
    </section> : null}
  </section>;
}
