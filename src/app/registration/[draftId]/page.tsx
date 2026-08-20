import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { parseContextualDraftId, type ContextualActionType } from '@/lib/contextual-registration/flow';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  cancelContextualDraftAction,
  acceptContextualTermsAction,
  createContextualAccountAction,
  declareContextualAdultAction,
  requestContextualPhoneVerificationAction,
  publishContextualDraftAction,
  verifyContextualPhoneAction,
} from '../actions';
import styles from '../../auth/auth.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Проверить действие — Православные маршруты',
  robots: { follow: false, index: false },
};

type RegistrationPageProps = {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type JsonObject = Record<string, unknown>;

const actionLabels: Record<ContextualActionType, string> = {
  church_admin_invite: 'Приглашение помощника храма',
  church_create: 'Добавление храма',
  driver_offer: 'Предложение поездки',
  passenger_request: 'Запрос места',
  ride_response: 'Ответ на поездку',
};

const payloadLabels: Record<string, string> = {
  churchId: 'Храм',
  churchName: 'Храм',
  childrenAllowed: 'Можно с детьми',
  childrenCount: 'Детей',
  date: 'Дата',
  arrivalAt: 'Прибытие',
  departureAt: 'Выезд',
  desiredArrivalAt: 'Желаемое время прибытия',
  departureDescription: 'Откуда',
  departureTime: 'Время выезда',
  driverOfferId: 'Поездка',
  driverChildSeatAvailable: 'Есть детское кресло',
  exactOriginLabel: 'Точное место выезда',
  maxDetourKm: 'Максимальный крюк, км',
  localArrivalTime: 'Время прибытия',
  localDepartureTime: 'Время выезда',
  offerId: 'Поездка',
  offerMode: 'Периодичность',
  passengerCount: 'Пассажиров',
  passengerRequestId: 'Запрос',
  pickupDescription: 'Место посадки',
  publicAreaLabel: 'Район посадки',
  publicOriginArea: 'Район выезда',
  publicNote: 'Комментарий',
  returnRequired: 'Нужна обратная дорога',
  returnAvailable: 'Возможна обратная дорога',
  seatsAvailable: 'Свободных мест',
  seatsRequested: 'Нужно мест',
  serviceDate: 'Дата службы',
  serviceEvent: 'Служба',
  serviceId: 'Служба',
  serviceName: 'Служба или дата',
  startsOn: 'Начало повторения',
  targetName: 'Ответ для',
  targetSummary: 'Выбранная карточка',
  endsOn: 'Конец повторения',
  weekdays: 'Дни недели',
};

const statusMessages: Record<string, string> = {
  'account-created': 'Профиль сохранён. Продолжите обязательные проверки ниже.',
  'account-input': 'Проверьте имя, язык и телефон. Телефон нужен в международном формате, например +390000000000.',
  'account-unavailable': 'Не удалось обновить профиль. Обновите страницу и попробуйте ещё раз.',
  'adult-declared': 'Подтверждение возраста сохранено.',
  'adult-required': 'Подтвердите, что вам уже исполнилось 18 лет.',
  'cancel-failed': 'Не удалось отменить сохранённое действие. Попробуйте ещё раз.',
  'phone-code-invalid': 'Код не подошёл. Проверьте шесть цифр и попробуйте ещё раз.',
  'phone-delivery-pending': 'Сообщение ещё не передано службе доставки. Попробуйте позже.',
  'phone-rate-limited': 'Новый код уже запрашивали недавно. Подождите минуту.',
  'phone-requested': 'Код поставлен в очередь на отправку.',
  'phone-unavailable': 'Проверка телефона сейчас недоступна.',
  'phone-verified': 'Телефон подтверждён.',
  'eligibility-required': 'Сначала завершите обязательные проверки и примите актуальные Условия участия.',
  'publication-failed': 'Не удалось отправить действие. Данные сохранены — попробуйте ещё раз.',
  'publication-invalid': 'Сохранённые данные больше нельзя отправить. Удалите действие и заполните форму заново.',
  'publication-saved': 'Действие опубликовано, но финальная отметка не сохранилась. Нажмите отправку ещё раз — дубликат не появится.',
  'publication-unavailable': 'Этот тип действия пока нельзя отправить из данного экрана.',
  'terms-accepted': 'Актуальные Условия участия приняты.',
  'terms-failed': 'Не удалось принять Условия участия. Обновите страницу и попробуйте ещё раз.',
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

const weekdayLabels = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function displayValue(key: string, value: unknown, timezone?: string) {
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (key === 'offerMode' && value === 'trip') return 'Разовая поездка';
  if (key === 'offerMode' && value === 'route') return 'Регулярная поездка';
  if (key === 'weekdays' && Array.isArray(value)) {
    const labels = value
      .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      .map((day) => weekdayLabels[day]);
    return labels.length > 0 ? labels.join(', ') : null;
  }
  if (typeof value === 'string') {
    const visible = value.trim();
    if (['arrivalAt', 'departureAt', 'desiredArrivalAt'].includes(key) && Number.isFinite(Date.parse(visible))) {
      try {
        return new Intl.DateTimeFormat('ru-RU', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: timezone ?? 'UTC',
        }).format(new Date(visible));
      } catch { return visible; }
    }
    return visible ? visible.slice(0, 240) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export default async function RegistrationPage({ params, searchParams }: RegistrationPageProps) {
  const { draftId: rawDraftId } = await params;
  const draftId = parseContextualDraftId(rawDraftId);
  const supabase = await createServerSupabaseClient();
  if (!draftId || !supabase) redirect('/auth?error=draft-unavailable');

  const draftResult = await supabase.schema('api').rpc('current_contextual_draft', {
    p_draft_id: draftId,
  });
  const draft = asObject(draftResult.data);
  if (draftResult.error || !draft || draft.status !== 'claimed') {
    redirect('/auth?error=draft-unavailable');
  }

  const accountResult = await supabase.schema('api').rpc('current_account');
  const account = asObject(accountResult.data);
  const eligibility = asObject(draft.eligibility) ?? {};
  const payload = asObject(draft.payload) ?? {};
  const registrationProfile = asObject(draft.registration_profile);
  const actionType = draft.action_type as ContextualActionType;
  const phoneResult = account && !account.phone_verified_at
    ? await supabase.schema('api').rpc('current_phone_verification')
    : null;
  const phoneAttempt = asObject(phoneResult?.data);
  const payloadTimezone = typeof payload.timezone === 'string' ? payload.timezone : undefined;
  const query = await searchParams;
  const status = typeof query.status === 'string' ? statusMessages[query.status] : null;
  const summary = Object.entries(payload)
    .filter(([key, value]) => (
      payloadLabels[key]
      && displayValue(key, value, payloadTimezone) !== null
      && !(key === 'churchId' && typeof payload.churchName === 'string')
      && !(key === 'serviceId' && typeof payload.serviceName === 'string')
      && !(key === 'serviceDate' && typeof payload.serviceName === 'string')
    ))
    .slice(0, 10);

  return (
    <main className={`${styles.authRoot} ${styles.shell}`}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" prefetch={false}>Православные маршруты</Link>
        <Link className={styles.quietLink} href="/churches" prefetch={false}>Храмы</Link>
      </header>

      <section className={styles.panel}>
        <p className={styles.eyebrow}>Финальная проверка</p>
        <h1 className={styles.title}>{actionLabels[actionType] ?? 'Сохранённое действие'}</h1>
        <p className={styles.lead}>
          Проверьте данные и завершите обязательные шаги. Подтверждение email само ничего не публикует и не отправляет.
        </p>
        {status ? <p className={styles.notice} role="status">{status}</p> : null}

        <dl className={styles.identity}>
          {summary.length > 0 ? summary.map(([key, value]) => (
            <div key={key}>
              <dt>{payloadLabels[key]}</dt>
              <dd>{displayValue(key, value, payloadTimezone)}</dd>
            </div>
          )) : (
            <div><dt>Данные</dt><dd>Сохранены и доступны только вам до завершения действия.</dd></div>
          )}
        </dl>

        {!account ? (
          <form action={createContextualAccountAction} className={styles.form}>
            <input name="draft_id" type="hidden" value={draftId} />
            <div className={styles.field}>
              <label htmlFor="display-name">Как к вам обращаться</label>
              <input autoComplete="name" defaultValue={typeof registrationProfile?.display_name === 'string' ? registrationProfile.display_name : ''} id="display-name" maxLength={80} name="display_name" required />
            </div>
            <div className={styles.field}>
              <label htmlFor="phone">Телефон</label>
              <input autoComplete="tel" defaultValue={typeof registrationProfile?.phone === 'string' ? registrationProfile.phone : ''} id="phone" inputMode="tel" maxLength={16} name="phone" placeholder="+390000000000" required type="tel" />
            </div>
            <div className={styles.field}>
              <label htmlFor="language">Язык сообщений</label>
              <select defaultValue={typeof registrationProfile?.preferred_language === 'string' ? registrationProfile.preferred_language : 'ru'} id="language" name="language">
                <option value="ru">Русский</option>
                <option value="en">English</option>
                <option value="it">Italiano</option>
                <option value="ro">Română</option>
                <option value="uk">Українська</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <button className={styles.primaryButton} type="submit">Сохранить профиль</button>
          </form>
        ) : (
          <>
            <dl className={styles.identity}>
              <div><dt>Имя</dt><dd>{String(account.display_name)}</dd></div>
              <div><dt>Email</dt><dd>{String(account.email)}</dd></div>
              <div><dt>Телефон</dt><dd>{String(account.phone)}</dd></div>
            </dl>

            {!account.adult_declared_at ? (
              <form action={declareContextualAdultAction} className={styles.form}>
                <input name="draft_id" type="hidden" value={draftId} />
                <label><input name="adult" required type="checkbox" value="yes" /> Мне уже исполнилось 18 лет</label>
                <button className={styles.secondaryButton} type="submit">Подтвердить возраст</button>
              </form>
            ) : null}

            {!account.phone_verified_at ? (
              <>
                <form action={requestContextualPhoneVerificationAction} className={styles.form}>
                  <input name="draft_id" type="hidden" value={draftId} />
                  <button className={styles.secondaryButton} type="submit">Получить код по SMS</button>
                </form>
                {phoneAttempt && ['sent', 'delivery_pending'].includes(String(phoneAttempt.status)) ? (
                  <form action={verifyContextualPhoneAction} className={styles.form}>
                    <input name="draft_id" type="hidden" value={draftId} />
                    <div className={styles.field}>
                      <label htmlFor="phone-code">Код из SMS</label>
                      <input autoComplete="one-time-code" id="phone-code" inputMode="numeric" maxLength={6} minLength={6} name="code" pattern="[0-9]{6}" required />
                    </div>
                    <button className={styles.secondaryButton} type="submit">Подтвердить телефон</button>
                  </form>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {!eligibility.current_terms_version ? (
          <p className={styles.notice}>
            Актуальные Условия участия ещё не опубликованы. Принять их и отправить действие сейчас нельзя.
          </p>
        ) : eligibility.current_terms_accepted !== true && account ? (
          <form action={acceptContextualTermsAction} className={styles.form}>
            <input name="draft_id" type="hidden" value={draftId} />
            <label>
              <input name="terms" required type="checkbox" value="yes" /> Я принимаю актуальные Условия участия
            </label>
            <button className={styles.secondaryButton} type="submit">Принять условия</button>
          </form>
        ) : null}

        {eligibility.eligible === true ? (
          <form action={publishContextualDraftAction} className={styles.form}>
            <input name="draft_id" type="hidden" value={draftId} />
            <button className={styles.primaryButton} type="submit">
              {actionType === 'ride_response' ? 'Отправить ответ' : 'Опубликовать'}
            </button>
          </form>
        ) : (
          <p className={styles.secondaryText}>
            Кнопка отправки появится только после всех обязательных проверок и повторной проверки данных сервером.
          </p>
        )}

        <form action={cancelContextualDraftAction} className={styles.form}>
          <input name="draft_id" type="hidden" value={draftId} />
          <button className={styles.secondaryButton} type="submit">Удалить сохранённое действие</button>
        </form>
      </section>
    </main>
  );
}
