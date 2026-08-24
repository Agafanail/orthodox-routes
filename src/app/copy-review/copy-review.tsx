'use client';

import { useState, useSyncExternalStore } from 'react';
import { ChurchPlaceholder } from '../design-preview/church-placeholder';
import styles from './copy-review.module.css';

/**
 * Temporary isolated surface for the manual Russian copy review. Group 1 covers the church catalog,
 * church page, transport board and the empty church state. Group 2A covers the first four semantic
 * screens of the passenger request form after the owner decision of 22 August 2026 (Foundation 1.9,
 * IA §10.1): when, where to pick up, who is travelling, and the map selection behind the place.
 *
 * It renders the proposed wording of the UX Copy and Localization Foundation inside canonical Design
 * System V2 composition so the owner can judge the words in context. It is unlinked, it changes no
 * production screen, and it approves nothing.
 */

type SampleId =
  | 'catalog'
  | 'church'
  | 'board'
  | 'empty-church'
  | 'request-when'
  | 'request-map'
  | 'request-place'
  | 'request-people';

type SourceMark = 'IA' | 'PS' | 'DS' | 'Решение' | 'Утверждено' | 'Проект';

type StringSource = {
  /** The visible string, exactly as it appears on the screen. */
  text: string;
  /**
   * Where the wording comes from, using the marks of the Foundation section 1.4. `Утверждено` and
   * `Решение` carry the owner review of 22 August 2026; `Проект` still needs the next review.
   */
  mark: SourceMark;
  note?: string;
};

const samples: ReadonlyArray<{ id: SampleId; label: string; title: string; description: string }> = [
  {
    id: 'catalog',
    label: '1 · Каталог храмов',
    title: 'Каталог храмов, заполненное состояние',
    description:
      'Один общий поиск по храму, городу и стране, «Рядом со мной», карта-полоса и список без изображений. Отдельных фильтров страны и населённого пункта больше нет. Поиск на этом экране работает.',
  },
  {
    id: 'church',
    label: '2 · Страница храма',
    title: 'Страница храма: сведения и расписание',
    description:
      'Название, адрес-строка без видимой подписи действия, свёрнутый блок «О храме», одно хронологическое расписание из трёх ближайших служб с раскрытием остальных, предупреждение и два главных действия.',
  },
  {
    id: 'board',
    label: '3 · Поездки храма',
    title: 'Транспортная доска того же храма',
    description:
      'Нижняя часть той же страницы храма: фильтры «Все / Водители / Пассажиры», метки карточек «Водитель» и «Пассажир» в собственных тихих цветах роли, один поток карточек одной службы. Фильтры на этом экране работают.',
  },
  {
    id: 'empty-church',
    label: '4 · Пустой храм',
    title: 'Храм без фотографии, расписания и поездок',
    description:
      'Тот же порядок блоков, что и на заполненной странице: заглушка, название, адрес, «О храме», пустое расписание, главные действия, пустая доска поездок.',
  },
  {
    id: 'request-when',
    label: '5 · Просьба: когда',
    title: 'Просьба пассажира, экран 1: когда',
    description:
      'Первый из четырёх смысловых экранов формы. Служба и собственные дата со временем — два способа ответить на один вопрос, поэтому они стоят рядом в одном списке выбора. Выбор на этом экране работает.',
  },
  {
    id: 'request-map',
    label: '6 · Где вас забрать: карта',
    title: 'Экран 2 «Где вас забрать?»: вложенная карта',
    description:
      'Карта — вложенный экран второго смыслового экрана, а не отдельный шаг формы. Человек открывает её из «Где вас забрать?», выбирает место и возвращается на тот же экран. Отдельного поля «Как назвать это место» здесь нет: ориентир пишется в обычном необязательном примечании на последнем экране. Карта — детерминированное изображение для проверки слов и вёрстки, а не поставщик карт.',
  },
  {
    id: 'request-place',
    label: '7 · Где вас забрать: места',
    title: 'Экран 2 «Где вас забрать?»: возврат с карты, место сохранено',
    description:
      'Тот же второй экран после возврата с карты. Это состояние одного шага, а не третий шаг: адрес показан один раз, рядом «Изменить это место», ниже «Добавить место». До трёх мест — альтернативы, а не остановки по пути: карточки разделены словом «или», подсказка говорит то же словами. Добавление и удаление на этом экране работают.',
  },
  {
    id: 'request-people',
    label: '8 · Просьба: сколько вас',
    title: 'Просьба пассажира, экран 3: сколько вас будет',
    description:
      'Общее число пассажиров, число детей и детское кресло — один вопрос на одном экране. Кресло появляется, когда в группе есть дети (IA §47.6). Счётчики на этом экране работают.',
  },
];

/* ------------------------------------------------------------------ proposed and approved copy */

/**
 * One place per string. The same constants feed the screens and the review-only source key, so the
 * owner always compares the wording that is actually rendered.
 */
const copy = {
  navChurches: 'Храмы',
  navTrips: 'Поездки',
  navNotifications: 'Уведомления',

  catalogTitle: 'Храмы',
  catalogSearchPlaceholder: 'Храм, город или страна',
  catalogSearchLabel: 'Поиск',
  catalogNearMe: 'Рядом со мной',
  catalogMapExpand: 'Открыть карту на весь экран',
  catalogNextService: 'Ближайшая служба',
  catalogNoSchedule: 'Расписание пока не добавлено',
  catalogEmptySearch: 'Ничего не нашлось. Попробуйте другое название, город или страну.',

  churchAddressAction: 'Открыть карту',
  churchOfficialName: 'Официальное название',
  churchDescription: 'О храме',
  churchContacts: 'Связаться с храмом',
  churchScheduleTitle: 'Расписание',
  churchScheduleFull: 'Показать всё расписание',
  churchScheduleChanged: 'Время изменено',
  churchScheduleUpdated: 'Расписание обновлено 12 августа',
  churchScheduleWarning:
    'Расписание могло измениться. Если нужной службы здесь нет, но вы знаете, что она состоится, создайте поездку на собственные дату и время.',
  churchScheduleEmpty:
    'Расписание пока не добавлено. Вы всё равно можете создать поездку на собственные дату и время.',
  churchActionNeedRide: 'Нужна поездка',
  churchActionCanDrive: 'Могу подвезти',
  churchReport: 'Пожаловаться',

  boardTitle: 'Поездки',
  boardFilterAll: 'Все',
  boardFilterDrivers: 'Водители',
  boardFilterPassengers: 'Пассажиры',
  boardTypeDriver: 'Водитель',
  boardTypePassenger: 'Пассажир',
  boardOrigin: 'Место отправления',
  boardMeetingArea: 'Место встречи',
  boardChildSeatNeeded: 'Нужно детское кресло',
  boardChildSeatProvided: 'Детское кресло есть у водителя',
  boardNoChildren: 'Не может везти детей',
  boardReturnNeeded: 'Обратная поездка — нужна',
  boardReturnNotNeeded: 'Обратная поездка — не нужна',
  boardReturnOffered: 'Может подвезти обратно',
  boardActionAsk: 'Попросить подвезти',
  boardActionOffer: 'Предложить подвезти',
  boardMapMobile: 'Поездки на карте',
  boardEmpty:
    'Поездок пока никто не предлагал. Вы можете попросить о поездке или предложить свободные места.',
  boardAgreed: 'Уже договорились: 3 впереди · 12 за последние 30 дней',
} as const;

/**
 * Group 2A: the passenger request form. The owner reviewed these screens on 24 August 2026, so the
 * wording of the three semantic screens is approved and the source key marks it `Утверждено`. Keys
 * follow Foundation 4.5 and 4.4.2 so the owner compares the rendered screen with the master text
 * line by line. The last screen, «Последние детали», was not part of that review and is not here.
 */
const requestCopy = {
  title: 'Нужна поездка',
  back: 'Назад',
  next: 'Далее',

  whenTitle: 'Когда вам нужна поездка?',
  whenOr: 'или',
  whenCustom: 'Указать свои дату и время',
  whenCustomHint:
    'Если нужной службы нет в расписании, укажите дату и время, к которому нужно приехать.',
  whenArrivalLabel: 'Хочу приехать к',
  whenHorizon: 'Просьбу можно создать не больше чем на 8 недель вперёд.',

  placeTitle: 'Где вас забрать?',
  placePrimary: 'Основное место встречи',
  placeAlternative: 'Ещё одно место встречи',
  placePrivacy:
    'Для вашей безопасности всем будет видна только примерная область. Точное место и контакты откроются только после договорённости.',
  placeAdd: 'Добавить место',
  placeAlternativesHint:
    'Можно указать до трёх мест. Водитель выберет одно из них — это не остановки по пути.',
  placeOr: 'или',
  placeLimit: 'Больше трёх мест указать нельзя.',
  placeChange: 'Изменить это место',
  placeRemove: 'Убрать это место',

  mapSearch: 'Найти адрес',
  mapHint: 'Введите адрес или передвиньте маркер на карте.',
  mapConfirm: 'Подтвердить место',

  peopleTitle: 'Сколько вас будет?',
  peopleTotal: 'Всего пассажиров, включая детей',
  peopleChildren: 'Из них детей',
  peopleChildSeat: 'Нужно детское кресло',
  peopleChildSeatHint:
    'По умолчанию кресло обеспечивает взрослый, который едет с ребёнком. Водитель отдельно указывает, есть ли кресло у него.',
} as const;

type PluralForms = { one: string; few: string; many: string };

/** Russian plural categories of the ICU `plural` strings proposed in the Foundation. */
function pluralRu(count: number, forms: PluralForms) {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = Math.abs(count) % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return `${count} ${forms.many}`;
  if (lastDigit === 1) return `${count} ${forms.one}`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${count} ${forms.few}`;
  return `${count} ${forms.many}`;
}

const offersPlural = { one: 'предложение подвезти', few: 'предложения подвезти', many: 'предложений подвезти' };
const requestsPlural = { one: 'просьба о поездке', few: 'просьбы о поездке', many: 'просьб о поездке' };
const seatsFreePlural = { one: 'свободное место', few: 'свободных места', many: 'свободных мест' };
const passengersPlural = { one: 'пассажир', few: 'пассажира', many: 'пассажиров' };
const childrenPlural = { one: 'ребёнок', few: 'ребёнка', many: 'детей' };

/**
 * The verb agrees with the taken count: «1 из 3 мест занято», «2 из 3 мест заняты». The rule works
 * for every realistic value, including 11–14 and 21.
 */
const seatsTaken = (taken: number, total: number) => {
  const lastTwoDigits = Math.abs(taken) % 100;
  const singular = Math.abs(taken) % 10 === 1 && !(lastTwoDigits >= 11 && lastTwoDigits <= 14);
  return `${taken} из ${total} мест ${singular ? 'занято' : 'заняты'}`;
};
const childrenOfThem = (count: number) => `из них ${pluralRu(count, childrenPlural)}`;

/* --------------------------------------------------------------------------- shared elements */

type IconName = 'back' | 'bell' | 'car' | 'chevron-down' | 'expand' | 'map' | 'pin' | 'route' | 'save' | 'search' | 'share';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    back: <path d="M15 5l-7 7 7 7" />,
    bell: <><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    car: <><path d="M4 15h16M5.5 15l1.6-5a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.6 5" /><path d="M4 15v3h3v-3M17 15v3h3v-3" /></>,
    'chevron-down': <path d="m7 9.5 5 5 5-5" />,
    expand: <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />,
    map: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    pin: <><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
    route: <><path d="m3 6.5 6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5Z" /><path d="M9 4v13M15 6.5v13" /></>,
    save: <path d="M6 4h12v16l-6-4-6 4Z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    share: <><circle cx="17" cy="6" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="m8.3 10.8 6.4-3.5M8.3 13.2l6.4 3.5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>{paths[name]}</svg>;
}

function IconButton({ label, icon, className = '' }: { label: string; icon: IconName; className?: string }) {
  return (
    <button type="button" className={`${styles.iconButton} ${className}`} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}

function PhoneFrame({ children, label, textZoom }: { children: React.ReactNode; label: string; textZoom: boolean }) {
  return (
    <section
      className={styles.phoneFrame}
      role="region"
      aria-label={label}
      data-product-screen
      data-text-zoom={textZoom ? '200' : undefined}
    >
      {children}
    </section>
  );
}

function MobileNavigation({ active }: { active: 'Храмы' | 'Поездки' }) {
  const items = [
    [copy.navChurches, 'pin'],
    [copy.navTrips, 'car'],
    [copy.navNotifications, 'bell'],
  ] as const;

  return (
    <nav className={styles.mobileNav} aria-label="Основные разделы">
      {items.map(([label, icon]) => (
        <a
          key={label}
          href={`#${label}`}
          className={active === label ? styles.navActive : undefined}
          aria-current={active === label ? 'page' : undefined}
          onClick={(event) => event.preventDefault()}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

function HeroControls() {
  return (
    <div className={styles.heroControls}>
      <IconButton label="Назад" icon="back" />
      <div>
        <IconButton label="Поделиться" icon="share" />
        <IconButton label="Сохранить" icon="save" />
      </div>
    </div>
  );
}

/**
 * The address itself is the row that opens the church map screen: marker, full address, chevron.
 * No visible action label duplicates it; assistive technology hears the action after the address.
 * The church page never embeds a map (Design System §8).
 */
function AddressRow({ address }: { address: string }) {
  return (
    <a href="#карта-храма" className={styles.addressRow} onClick={(event) => event.preventDefault()}>
      <Icon name="pin" />
      <span>
        {address}
        <span className={styles.srOnly}>{copy.churchAddressAction}</span>
      </span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

/**
 * Secondary church information sits above the schedule and stays collapsed, so the default path to
 * the schedule and to ride coordination stays short. Native disclosure keeps keyboard behaviour.
 */
function ChurchAbout({ officialName, description, contacts }: {
  officialName: string;
  description?: string;
  contacts?: string;
}) {
  return (
    <details className={styles.about}>
      <summary>
        <span>{copy.churchDescription}</span>
        <Icon name="chevron-down" />
      </summary>
      <div className={styles.aboutBody}>
        {description && <p className={styles.longCopy}>{description}</p>}
        <dl className={styles.definitionRows}>
          <div>
            <dt>{copy.churchOfficialName}</dt>
            <dd>{officialName}</dd>
          </div>
          {contacts && (
            <div>
              <dt>{copy.churchContacts}</dt>
              <dd>{contacts}</dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  );
}

function ChurchActions() {
  return (
    <div className={styles.churchActions}>
      <button type="button" className={styles.primaryButton}>{copy.churchActionNeedRide}</button>
      <button type="button" className={styles.secondaryButton}>{copy.churchActionCanDrive}</button>
    </div>
  );
}

/* ------------------------------------------------------------------- screen 1: church catalog */

function CatalogMap() {
  return (
    <div className={styles.mapArtwork} role="img" aria-label="Схематичная карта храмов">
      <svg viewBox="0 0 390 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-20 215 Q110 120 220 175 T410 100" className={styles.road} />
        <path d="M80 -20 Q135 130 95 320" className={styles.roadMinor} />
        <path d="M300 -20 Q265 145 335 320" className={styles.roadMinor} />
        <path d="M370 -20 L370 320" className={styles.water} />
      </svg>
      <span className={`${styles.mapLabel} ${styles.mapLabelOne}`}>Catanzaro</span>
      <span className={`${styles.mapLabel} ${styles.mapLabelTwo}`}>Catanzaro Lido</span>
      <span className={`${styles.mapPin} ${styles.mapPinPrimary}`} aria-hidden="true" />
      <span className={`${styles.mapPin} ${styles.mapPinSecond}`} aria-hidden="true" />
      <span className={`${styles.mapPin} ${styles.mapPinThird}`} aria-hidden="true" />
    </div>
  );
}

type CatalogChurch = {
  id: string;
  name: string;
  officialName?: string;
  locality: string;
  country: string;
  nextService?: string;
  offers?: number;
  requests?: number;
};

/** Content fixtures. Names, cities, dates and counts are sample content, not copy under review. */
const catalogChurches: ReadonlyArray<CatalogChurch> = [
  {
    id: 'pokrov-catanzaro',
    name: 'Храм Покрова Пресвятой Богородицы в Catanzaro',
    officialName: 'Parrocchia Ortodossa della Protezione della Santissima Madre di Dio',
    locality: 'Catanzaro',
    country: 'Италия',
    nextService: 'Всенощное бдение · суббота, 22 августа, 18:00',
    offers: 2,
    requests: 1,
  },
  {
    id: 'george-crotone',
    name: 'Храм святого великомученика Георгия Победоносца',
    officialName: 'Parrocchia Ortodossa di San Giorgio Megalomartire',
    locality: 'Crotone',
    country: 'Италия',
  },
  {
    id: 'nikolai-vibo',
    name: 'Свято-Никольский храм',
    locality: 'Vibo Valentia',
    country: 'Италия',
    nextService: 'Божественная литургия · воскресенье, 23 августа, 10:30',
    offers: 1,
  },
];

/**
 * One universal search over the fields a person actually types: localized name, official name,
 * locality and country. Nothing more: no ranking, no fuzzy matching, no separate filters.
 */
function matchesSearch(church: CatalogChurch, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [church.name, church.officialName, church.locality, church.country]
    .some((field) => field?.toLowerCase().includes(normalized));
}

function ChurchCard({ church }: { church: CatalogChurch }) {
  return (
    <article className={`${styles.card} ${styles.churchCard}`} data-church-card>
      <h3 className={styles.cardTitle}>{church.name}</h3>
      {church.officialName && <p className={styles.secondary}>{church.officialName}</p>}
      <p className={styles.secondary}>{church.locality}, {church.country}</p>
      {church.nextService ? (
        <p className={styles.data}>
          {copy.catalogNextService}: {church.nextService}
        </p>
      ) : (
        <p className={styles.data}>{copy.catalogNoSchedule}</p>
      )}
      {Boolean(church.offers || church.requests) && (
        <p className={styles.activity}>
          {church.offers ? <span>{pluralRu(church.offers, offersPlural)}</span> : null}
          {church.requests ? <span>{pluralRu(church.requests, requestsPlural)}</span> : null}
        </p>
      )}
    </article>
  );
}

function CatalogScreen({ textZoom }: { textZoom: boolean }) {
  const [query, setQuery] = useState('');
  const found = catalogChurches.filter((church) => matchesSearch(church, query));

  return (
    <PhoneFrame label="Каталог храмов" textZoom={textZoom}>
      <div className={styles.catalogMapArea}>
        <CatalogMap />
        {/* One universal search plus «Рядом со мной»: no separate country or locality selectors. */}
        <div className={styles.catalogControls}>
          <label className={styles.searchField}>
            <Icon name="search" />
            <span className={styles.srOnly}>{copy.catalogSearchLabel}</span>
            <input
              placeholder={copy.catalogSearchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className={styles.nearMe}>
            <Icon name="map" />
            {copy.catalogNearMe}
          </button>
        </div>
        <IconButton label={copy.catalogMapExpand} icon="expand" className={styles.expandButton} />
      </div>
      <main className={styles.listSheet}>
        <h1 className={styles.pageTitle}>{copy.catalogTitle}</h1>
        <p className={styles.secondary}>{found.length === 3 ? '3 храма · Италия' : `Найдено: ${found.length}`}</p>
        {found.length > 0 ? (
          <div className={styles.cardList} data-catalog-list>
            {found.map((church) => <ChurchCard key={church.id} church={church} />)}
          </div>
        ) : (
          <div className={styles.emptyState} data-empty-search>
            <p>{copy.catalogEmptySearch}</p>
          </div>
        )}
      </main>
      <MobileNavigation active="Храмы" />
    </PhoneFrame>
  );
}

/* --------------------------------------------------------------------- screen 2: church page */

/**
 * One chronological list of concrete service occurrences. Recurring and one-time services share it;
 * the storage model behind them is not exposed as public schedule categories. A changed or
 * cancelled occurrence keeps its visible state.
 */
type ServiceOccurrence = {
  day: string;
  month: string;
  title: string;
  time: string;
  state?: string;
};

const schedule: ReadonlyArray<ServiceOccurrence> = [
  { day: '22', month: 'авг', title: 'Всенощное бдение', time: 'суббота, 18:00' },
  { day: '23', month: 'авг', title: 'Божественная литургия', time: 'воскресенье, 9:00' },
  { day: '26', month: 'авг', title: 'Молебен с акафистом', time: 'среда, 18:00' },
  { day: '29', month: 'авг', title: 'Всенощное бдение', time: 'суббота, 18:00' },
  { day: '30', month: 'авг', title: 'Божественная литургия', time: 'воскресенье, 9:30', state: 'Время изменено' },
  { day: '2', month: 'сен', title: 'Молебен с акафистом', time: 'среда, 18:00' },
  { day: '5', month: 'сен', title: 'Всенощное бдение', time: 'суббота, 18:00' },
];

const initialServiceCount = 3;

function ScheduleList() {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? schedule : schedule.slice(0, initialServiceCount);

  return (
    <>
      <div data-schedule-list>
        {visible.map((service) => (
          <div className={styles.serviceRow} key={`${service.day}-${service.month}-${service.title}`} data-service-row>
            <p><strong>{service.day}</strong> <span>{service.month}</span></p>
            <div>
              <strong>{service.title}</strong>
              <span>{service.time}</span>
              {service.state && <span className={styles.serviceState}>{service.state}</span>}
            </div>
          </div>
        ))}
      </div>
      {!showAll && (
        <div className={styles.cardAction}>
          <button type="button" className={styles.quietButton} onClick={() => setShowAll(true)}>
            {copy.churchScheduleFull}
          </button>
        </div>
      )}
    </>
  );
}

function ChurchScreen({ textZoom }: { textZoom: boolean }) {
  return (
    <PhoneFrame label="Страница храма" textZoom={textZoom}>
      <div className={styles.hero}>
        <ChurchPlaceholder churchId="pokrov-catanzaro" className={styles.placeholder} />
        <HeroControls />
      </div>
      <main className={styles.mobileContent}>
        <h1 className={styles.pageTitle}>Храм Покрова Пресвятой Богородицы в Catanzaro</h1>
        <AddressRow address="Via XX Settembre, 45, 88100 Catanzaro CZ, Италия" />
        <ChurchAbout
          officialName="Parrocchia Ortodossa della Protezione della Santissima Madre di Dio"
          description="Приход объединяет православных жителей Catanzaro и соседних городов. Богослужения совершаются на церковнославянском и итальянском языках, после воскресной литургии прихожане остаются на общую трапезу."
          contacts="+39 0961 000 000 · parrocchia@example.invalid"
        />

        <section className={styles.section} aria-labelledby="church-schedule">
          <h2 id="church-schedule" className={styles.sectionTitle}>{copy.churchScheduleTitle}</h2>
          <ScheduleList />
          <p className={styles.scheduleNote}>{copy.churchScheduleUpdated}</p>
          <p className={styles.scheduleWarning}>{copy.churchScheduleWarning}</p>
        </section>

        <ChurchActions />
      </main>
      <MobileNavigation active="Храмы" />
    </PhoneFrame>
  );
}

/* ----------------------------------------------------------------- screen 3: transport board */

type BoardFilter = 'Все' | 'Водители' | 'Пассажиры';

/** The plural filter selects the singular role shown on the card badge. */
const filteredRole: Record<Exclude<BoardFilter, 'Все'>, BoardCard['type']> = {
  Водители: 'Водитель',
  Пассажиры: 'Пассажир',
};

const boardFilters: ReadonlyArray<BoardFilter> = [
  copy.boardFilterAll,
  copy.boardFilterDrivers,
  copy.boardFilterPassengers,
];

type BoardCard = {
  id: string;
  /** Role of the person behind the card. The filter uses the plural role, the badge the singular. */
  type: 'Водитель' | 'Пассажир';
  time: string;
  /** Label and value, so the stored place name never needs a Russian case ending. */
  placeLabel: string;
  place: string;
  facts: ReadonlyArray<string>;
  person: string;
  action: string;
};

const boardCards: ReadonlyArray<BoardCard> = [
  {
    id: 'offer-lido',
    type: 'Водитель',
    time: '23 августа, 08:00',
    placeLabel: copy.boardOrigin,
    place: 'Catanzaro Lido',
    facts: [
      pluralRu(2, seatsFreePlural),
      seatsTaken(1, 3),
      copy.boardChildSeatProvided,
      copy.boardReturnOffered,
    ],
    person: 'Алексей',
    action: copy.boardActionAsk,
  },
  {
    id: 'request-centro',
    type: 'Пассажир',
    time: '23 августа, 08:15',
    placeLabel: copy.boardMeetingArea,
    place: 'Catanzaro, центр',
    facts: [
      pluralRu(2, passengersPlural),
      childrenOfThem(1),
      copy.boardChildSeatNeeded,
      copy.boardReturnNeeded,
    ],
    person: 'Мария',
    action: copy.boardActionOffer,
  },
  {
    id: 'offer-siano',
    type: 'Водитель',
    time: '23 августа, 07:40',
    placeLabel: copy.boardOrigin,
    place: 'Siano',
    facts: [pluralRu(1, seatsFreePlural), copy.boardNoChildren],
    person: 'Игорь',
    action: copy.boardActionAsk,
  },
  {
    id: 'request-soverato',
    type: 'Пассажир',
    time: '23 августа, 08:00',
    placeLabel: copy.boardMeetingArea,
    place: 'Soverato',
    facts: [pluralRu(1, passengersPlural), copy.boardReturnNotNeeded],
    person: 'Ольга',
    action: copy.boardActionOffer,
  },
];

/** Public trip card: first name only, public area only, never a contact or an exact place. */
function RideCard({ card }: { card: BoardCard }) {
  return (
    <article className={styles.card} data-ride-card data-ride-type={card.type}>
      <span className={styles.typeTag} data-role={card.type === copy.boardTypeDriver ? 'driver' : 'passenger'}>
        {card.type}
      </span>
      <h4 className={styles.cardTitle}>{card.time}</h4>
      <p className={styles.data} data-ride-place>{card.placeLabel}: {card.place}</p>
      <p className={styles.rideFacts}>
        {card.facts.map((fact) => <span key={fact}>{fact}</span>)}
      </p>
      <p className={styles.personLine}>{card.person}</p>
      <div className={styles.cardAction}>
        <button type="button" className={styles.secondaryButton}>{card.action}</button>
      </div>
    </article>
  );
}

function BoardScreen({ textZoom }: { textZoom: boolean }) {
  const [filter, setFilter] = useState<BoardFilter>(copy.boardFilterAll);
  const visible = boardCards.filter((card) => filter === copy.boardFilterAll || card.type === filteredRole[filter]);

  return (
    <PhoneFrame label="Поездки храма" textZoom={textZoom}>
      <div className={styles.boardHost}>
        <main className={`${styles.mobileContent} ${styles.boardReserve}`}>
          <section aria-labelledby="board-title">
            <h2 id="board-title" className={styles.sectionTitle}>{copy.boardTitle}</h2>
            <div className={styles.chips} role="group" aria-label="Кого показывать">
              {boardFilters.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={candidate === filter ? styles.selectedChip : undefined}
                  aria-pressed={candidate === filter}
                  onClick={() => setFilter(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <h3 className={styles.groupTitle}>Божественная литургия · 23 августа, 9:00</h3>
            <div className={styles.cardList} data-board-list>
              {visible.map((card) => <RideCard key={card.id} card={card} />)}
            </div>
            <p className={styles.agreementCount}>{copy.boardAgreed}</p>
          </section>
          <div className={styles.cardAction}>
            <button type="button" className={styles.quietButton}>{copy.churchReport}</button>
          </div>
        </main>
        {/*
         * The group has active rides, so the map entry exists. It sits outside the card stream at
         * the bottom edge and outside the filter group. The ride map itself is a later copy group
         * and is not part of this review.
         */}
        <button type="button" className={styles.mapAction} data-map-entry>
          <Icon name="route" />
          <span className={styles.mapActionLabel}>{copy.boardMapMobile}</span>
        </button>
      </div>
      <MobileNavigation active="Храмы" />
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------- screen 4: empty church state */

function EmptyChurchScreen({ textZoom }: { textZoom: boolean }) {
  return (
    <PhoneFrame label="Храм без расписания и поездок" textZoom={textZoom}>
      <div className={styles.hero}>
        <ChurchPlaceholder churchId="george-crotone" className={styles.placeholder} />
        <HeroControls />
      </div>
      {/* The same block order as the populated church page, with empty states in place. */}
      <main className={styles.mobileContent}>
        <h1 className={styles.pageTitle}>Храм святого великомученика Георгия Победоносца</h1>
        <AddressRow address="Via Interna Marina, 12, 88900 Crotone KR, Италия" />
        <ChurchAbout officialName="Parrocchia Ortodossa di San Giorgio Megalomartire" />

        <section className={styles.section} aria-labelledby="empty-schedule">
          <h2 id="empty-schedule" className={styles.sectionTitle}>{copy.churchScheduleTitle}</h2>
          <div className={styles.emptyState} data-empty-schedule>
            <p>{copy.churchScheduleEmpty}</p>
          </div>
        </section>

        <ChurchActions />

        {/* No active rides in this group, so there is no filter group and no map entry at all. */}
        <section className={styles.section} aria-labelledby="empty-board">
          <h2 id="empty-board" className={styles.sectionTitle}>{copy.boardTitle}</h2>
          <div className={styles.emptyState} data-empty-board>
            <p>{copy.boardEmpty}</p>
          </div>
        </section>

        <div className={styles.cardAction}>
          <button type="button" className={styles.quietButton}>{copy.churchReport}</button>
        </div>
      </main>
      <MobileNavigation active="Храмы" />
    </PhoneFrame>
  );
}

/* ------------------------------------------ group 2A: the four passenger request form screens */

/**
 * The form chrome of every request screen: a quiet way back and the name of what is being created.
 * There is no stepper, no progress bar and no numbered wizard. Neither IA §28.3 nor Design System V2
 * requires one, and this group exists to judge the words, not to introduce a navigation pattern.
 */
function FormHeader() {
  return (
    <header className={styles.formHeader} data-form-header>
      <button type="button" className={styles.quietButton}>{requestCopy.back}</button>
      <p className={styles.formContext}>{requestCopy.title}</p>
    </header>
  );
}

/** One primary intent per screen, full width, at the end of the content (DS §5). */
function FormFooter({ action }: { action: string }) {
  return (
    <div className={styles.formFooter}>
      <button type="button" className={styles.primaryButton}>{action}</button>
    </div>
  );
}

/* --------------------------------------------------------- screen 5: when the passenger arrives */

/** Content fixture: the same church schedule the group 1 screens use, seen from inside the form. */
const upcomingServices: ReadonlyArray<{ id: string; title: string; when: string }> = [
  { id: 'vigil-22', title: 'Всенощное бдение', when: 'суббота, 22 августа, 18:00' },
  { id: 'liturgy-23', title: 'Божественная литургия', when: 'воскресенье, 23 августа, 9:00' },
  { id: 'moleben-26', title: 'Молебен с акафистом', when: 'среда, 26 августа, 18:00' },
  { id: 'vigil-29', title: 'Всенощное бдение', when: 'суббота, 29 августа, 18:00' },
];

/**
 * One question with two ways to answer it, so a service and an own date live in one radio group
 * (IA §10.1). Choosing the own date reveals the arrival field in place instead of opening a step.
 */
function RequestWhenScreen({ textZoom }: { textZoom: boolean }) {
  const [answer, setAnswer] = useState('liturgy-23');
  const custom = answer === 'custom';

  return (
    <PhoneFrame label="Просьба пассажира: когда" textZoom={textZoom}>
      <FormHeader />
      <main className={styles.formContent}>
        <p className={styles.formChurch}>Храм Покрова Пресвятой Богородицы в Catanzaro</p>
        <h1 className={styles.pageTitle}>{requestCopy.whenTitle}</h1>

        {/*
          * No visible label above the list: the question in the heading already names what the list
          * is for, and a second heading over the services would describe only four of the five
          * options in the group. The legend keeps the question available to assistive technology.
          */}
        <fieldset className={styles.choiceGroup} data-when-choice>
          <legend className={styles.srOnly}>{requestCopy.whenTitle}</legend>
          {upcomingServices.map((service) => (
            <label
              key={service.id}
              className={styles.choice}
              data-choice-selected={answer === service.id ? '' : undefined}
            >
              <input
                type="radio"
                name="request-when"
                checked={answer === service.id}
                onChange={() => setAnswer(service.id)}
              />
              <span>
                <strong>{service.title}</strong>
                <span>{service.when}</span>
              </span>
            </label>
          ))}

          {/*
            * The own date is the second way to answer the same question, not a separate step. The
            * quiet «или» separates the two ways without turning either of them into a section.
            */}
          <p className={styles.choiceOr} data-when-or>{requestCopy.whenOr}</p>
          <label className={styles.choice} data-choice-selected={custom ? '' : undefined} data-custom-choice>
            <input
              type="radio"
              name="request-when"
              checked={custom}
              onChange={() => setAnswer('custom')}
            />
            <span>
              <strong>{requestCopy.whenCustom}</strong>
            </span>
          </label>
        </fieldset>

        {custom && (
          <div className={styles.revealed} data-custom-arrival>
            <label className={styles.textField}>
              <span>{requestCopy.whenArrivalLabel}</span>
              <input type="datetime-local" defaultValue="2026-08-23T09:00" />
            </label>
            <p className={styles.fieldHint}>{requestCopy.whenCustomHint}</p>
          </div>
        )}

        <p className={styles.fieldHint}>{requestCopy.whenHorizon}</p>
        <FormFooter action={requestCopy.next} />
      </main>
    </PhoneFrame>
  );
}

/* ------------------------------------------------------ screen 6: picking the place on the map */

/**
 * A deterministic drawing, not a maps provider: the group reviews the words and the layout of the
 * place screen inside Design System V2, and introducing a real map here would review neither.
 */
function PickMapArtwork() {
  return (
    <div className={styles.mapArtwork} role="img" aria-label="Схематичная карта выбора места">
      <svg viewBox="0 0 390 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-20 250 Q120 180 210 240 T410 190" className={styles.road} />
        <path d="M120 -20 Q160 200 120 440" className={styles.roadMinor} />
        <path d="M290 -20 Q260 210 320 440" className={styles.roadMinor} />
      </svg>
      {/*
        * The pick map has its own label anchors: one grows down from the middle, one grows up from
        * the bottom edge. Percentage-from-the-top anchors pushed the lower label out of the drawing
        * once the reader enlarged text to 200 %.
        */}
      <span className={`${styles.mapLabel} ${styles.pickLabelOne}`}>Via Milano</span>
      <span className={`${styles.mapLabel} ${styles.pickLabelTwo}`}>Corso Mazzini</span>
    </div>
  );
}

function RequestMapScreen({ textZoom }: { textZoom: boolean }) {
  return (
    <PhoneFrame label="Просьба пассажира: выбор места на карте" textZoom={textZoom}>
      <div className={styles.pickMapArea}>
        <PickMapArtwork />
        <div className={styles.pickControls}>
          <IconButton label={requestCopy.back} icon="back" />
          <label className={styles.searchField}>
            <Icon name="search" />
            <span className={styles.srOnly}>{requestCopy.mapSearch}</span>
            <input placeholder={requestCopy.mapSearch} defaultValue="" />
          </label>
        </div>
        <p className={styles.pickHint}>{requestCopy.mapHint}</p>
        {/* The marker the person drags. The public circle is not drawn here: it is not the choice. */}
        <span className={styles.pickMarker} aria-hidden="true" />
      </div>

      {/*
        * The sheet of the nested map screen. It carries the question of the step it belongs to, the
        * address the marker resolved to, and the single confirming action. There is no separate
        * field for naming the place: a landmark like «у входа в библиотеку» belongs in the ordinary
        * optional note of the last screen, not in a second address-like field (IA §10.1).
        */}
      <div className={styles.pickSheet}>
        <h1 className={styles.sectionTitle}>{requestCopy.placeTitle}</h1>
        <p className={styles.data} data-picked-address>Выбрано: Via Milano, 8, 88100 Catanzaro CZ</p>
        {/*
         * The explanation of what becomes public stands before the person confirms the place, not
         * before publication: it is useful only while the choice is still open (IA §10.4).
         */}
        <p className={styles.privacyNote} data-place-privacy>{requestCopy.placePrivacy}</p>
        <button type="button" className={styles.primaryButton}>{requestCopy.mapConfirm}</button>
      </div>
    </PhoneFrame>
  );
}

/* ------------------------------------------------- screen 7: the chosen place and alternatives */

type ChosenPlace = { id: string; address: string };

const firstPlace: ChosenPlace = { id: 'via-milano', address: 'Via Milano, 8, 88100 Catanzaro CZ' };

const sparePlaces: ReadonlyArray<ChosenPlace> = [
  { id: 'piazza-matteotti', address: 'Piazza Matteotti, 88100 Catanzaro CZ' },
  { id: 'via-indipendenza', address: 'Via Indipendenza, 21, 88100 Catanzaro CZ' },
];

const maxPlaces = 3;

/**
 * The passenger's own form state, so the exact address is visible to its author. Nothing here is a
 * public representation: the public side of the same place is the approximate area (IA §6.1).
 *
 * Places are alternatives, never stops. Three things say so at once: the label of every additional
 * place, the word «или» between the cards, and the hint under «Добавить место». The list is a plain
 * container instead of an ordered list, so no numbering suggests a route.
 */
function RequestPlaceScreen({ textZoom }: { textZoom: boolean }) {
  const [places, setPlaces] = useState<ReadonlyArray<ChosenPlace>>([firstPlace]);
  const full = places.length >= maxPlaces;

  function addPlace() {
    const next = sparePlaces.find((candidate) => !places.some((place) => place.id === candidate.id));
    if (next) setPlaces([...places, next]);
  }

  return (
    <PhoneFrame label="Просьба пассажира: выбранные места встречи" textZoom={textZoom}>
      <FormHeader />
      <main className={styles.formContent}>
        <h1 className={styles.pageTitle}>{requestCopy.placeTitle}</h1>
        <p className={styles.privacyNote} data-place-privacy>{requestCopy.placePrivacy}</p>

        <div className={styles.placeList} data-place-list>
          {places.map((place, index) => (
            <div key={place.id}>
              {index > 0 && <p className={styles.placeOr} data-place-or>{requestCopy.placeOr}</p>}
              <article className={`${styles.card} ${styles.placeCard}`} data-place-card>
                <p className={styles.micro}>
                  {index === 0 ? requestCopy.placePrimary : requestCopy.placeAlternative}
                </p>
                <p className={styles.data}>{place.address}</p>
                <div className={styles.placeActions}>
                  <button type="button" className={styles.quietButton}>{requestCopy.placeChange}</button>
                  {index > 0 && (
                    <button
                      type="button"
                      className={styles.quietButton}
                      onClick={() => setPlaces(places.filter((item) => item.id !== place.id))}
                    >
                      {requestCopy.placeRemove}
                    </button>
                  )}
                </div>
              </article>
            </div>
          ))}
        </div>

        {/* The button never sits disabled without a reason next to it (IA §28.3). */}
        {full ? (
          <p className={styles.fieldHint} data-place-limit>{requestCopy.placeLimit}</p>
        ) : (
          <button type="button" className={styles.secondaryButton} onClick={addPlace} data-place-add>
            {requestCopy.placeAdd}
          </button>
        )}
        <p className={styles.fieldHint}>{requestCopy.placeAlternativesHint}</p>

        <FormFooter action={requestCopy.next} />
      </main>
    </PhoneFrame>
  );
}

/* ---------------------------------------------------------- screen 8: who is travelling */

/**
 * The value is an `output`, not a read-only input: a field a person cannot type into should not be
 * focusable and should not offer a text cursor. The two buttons carry the whole interaction, and
 * each of them names the field it changes, so the pair works without seeing the label (IA §28.1).
 */
function Stepper({ label, value, min, max, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className={styles.stepper} data-stepper role="group" aria-label={label}>
      <p className={styles.fieldLabel}>{label}</p>
      <div>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`${label}: меньше`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          className={styles.stepperButton}
          aria-label={`${label}: больше`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * One question, three fields. Splitting them into separate screens would follow the letter of «one
 * step — one question» and break its meaning: a person answers «сколько нас» once (IA §28.3).
 *
 * The child seat appears only when the group has children, because that is when the answer exists
 * (IA §47.6). Responsibility for the seat stays with the accompanying adult (IA §2.3).
 */
function RequestPeopleScreen({ textZoom }: { textZoom: boolean }) {
  const [total, setTotal] = useState(2);
  const [childrenCount, setChildrenCount] = useState(1);
  const [childSeat, setChildSeat] = useState(true);

  function changeTotal(next: number) {
    setTotal(next);
    if (childrenCount > next) setChildrenCount(next);
  }

  return (
    <PhoneFrame label="Просьба пассажира: сколько вас будет" textZoom={textZoom}>
      <FormHeader />
      <main className={styles.formContent}>
        <h1 className={styles.pageTitle}>{requestCopy.peopleTitle}</h1>

        <Stepper label={requestCopy.peopleTotal} value={total} min={1} max={8} onChange={changeTotal} />
        <Stepper
          label={requestCopy.peopleChildren}
          value={childrenCount}
          min={0}
          max={total}
          onChange={setChildrenCount}
        />

        {childrenCount > 0 && (
          <div className={styles.revealed} data-child-seat>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={childSeat} onChange={() => setChildSeat(!childSeat)} />
              <span>{requestCopy.peopleChildSeat}</span>
            </label>
            <p className={styles.fieldHint}>{requestCopy.peopleChildSeatHint}</p>
          </div>
        )}

        <FormFooter action={requestCopy.next} />
      </main>
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------------ review-only source key */

const sourcesBySample: Record<SampleId, ReadonlyArray<StringSource>> = {
  catalog: [
    { text: copy.catalogTitle, mark: 'IA', note: 'IA §8' },
    { text: copy.catalogSearchPlaceholder, mark: 'Решение', note: 'один общий поиск вместо отдельных фильтров' },
    { text: copy.catalogSearchLabel, mark: 'Проект', note: 'скрытая подпись поля, нужна проверка' },
    { text: copy.catalogNearMe, mark: 'IA', note: 'IA §8.1' },
    { text: copy.catalogMapExpand, mark: 'IA', note: 'IA §8.5' },
    { text: copy.catalogNextService, mark: 'IA', note: 'IA §8.3' },
    { text: copy.catalogNoSchedule, mark: 'Утверждено' },
    { text: '2 предложения подвезти', mark: 'Утверждено', note: 'полная форма подтверждена' },
    { text: '1 просьба о поездке', mark: 'Утверждено', note: 'полная форма подтверждена' },
    { text: '1 предложение подвезти', mark: 'Утверждено', note: 'единственное число той же строки' },
    { text: copy.catalogEmptySearch, mark: 'Проект', note: 'новая строка после отказа от фильтров' },
    { text: copy.navChurches, mark: 'IA', note: 'IA §7.2' },
    { text: copy.navTrips, mark: 'IA', note: 'IA §7.2' },
    { text: copy.navNotifications, mark: 'IA', note: 'IA §7.2' },
  ],
  church: [
    { text: copy.churchAddressAction, mark: 'Проект', note: 'скрытая подпись строки адреса, видимой подписи нет' },
    { text: copy.churchDescription, mark: 'Утверждено', note: 'свёрнут, выше расписания' },
    { text: copy.churchOfficialName, mark: 'Утверждено' },
    { text: copy.churchContacts, mark: 'Утверждено' },
    { text: copy.churchScheduleTitle, mark: 'IA', note: 'IA §9.1; один хронологический список' },
    { text: copy.churchScheduleFull, mark: 'Решение', note: 'раскрывает остальные службы' },
    { text: copy.churchScheduleChanged, mark: 'IA', note: 'IA §45.3; в первую группу проверки не входила' },
    { text: copy.churchScheduleUpdated, mark: 'Утверждено' },
    { text: copy.churchScheduleWarning, mark: 'PS', note: 'PS §7.2, дословно' },
    { text: copy.churchActionNeedRide, mark: 'IA', note: 'IA §9, главное действие' },
    { text: copy.churchActionCanDrive, mark: 'IA', note: 'IA §9, вторичное действие' },
  ],
  board: [
    { text: copy.boardTitle, mark: 'IA', note: 'IA §7.2, §9.2; подзаголовка больше нет' },
    { text: copy.boardFilterAll, mark: 'IA', note: 'IA §9.2' },
    { text: copy.boardFilterDrivers, mark: 'Решение', note: 'заменяет «Есть места»' },
    { text: copy.boardFilterPassengers, mark: 'Решение', note: 'заменяет «Ищут место»' },
    { text: copy.boardTypeDriver, mark: 'Решение', note: 'метка типа карточки' },
    { text: copy.boardTypePassenger, mark: 'Решение', note: 'метка типа карточки' },
    { text: 'Божественная литургия · 23 августа, 9:00', mark: 'Утверждено', note: 'схема {служба} · {дата}, {время}' },
    { text: '2 свободных места / 1 свободное место', mark: 'Утверждено' },
    { text: seatsTaken(1, 3), mark: 'Утверждено', note: 'согласование исправлено: 1 — занято, 2 и больше — заняты' },
    { text: '2 пассажира / 1 пассажир', mark: 'Утверждено' },
    { text: childrenOfThem(1), mark: 'Утверждено' },
    { text: copy.boardChildSeatNeeded, mark: 'Утверждено' },
    { text: copy.boardChildSeatProvided, mark: 'Утверждено' },
    { text: copy.boardNoChildren, mark: 'Утверждено' },
    { text: copy.boardReturnNeeded, mark: 'Утверждено' },
    { text: copy.boardReturnNotNeeded, mark: 'Утверждено' },
    { text: copy.boardReturnOffered, mark: 'Утверждено' },
    { text: `${copy.boardOrigin}: {место}`, mark: 'Проект', note: 'подпись и значение вместо «Из {место}»' },
    { text: `${copy.boardMeetingArea}: {место}`, mark: 'Проект', note: 'подпись и значение вместо «Из {место}»' },
    { text: 'Алексей · Мария · Игорь · Ольга', mark: 'Решение', note: 'решение 1.7 (3): только имя, без фамилии' },
    { text: copy.boardActionAsk, mark: 'DS', note: 'DS §10, действие в карточке' },
    { text: copy.boardActionOffer, mark: 'DS', note: 'DS §10, действие в карточке' },
    { text: copy.boardMapMobile, mark: 'DS', note: 'DS §8.1, IA §9.3; экран карты в эту группу не входит' },
    { text: copy.boardAgreed, mark: 'Утверждено', note: 'числа по IA §9.4' },
    { text: copy.churchReport, mark: 'IA', note: 'IA §9.4' },
  ],
  'empty-church': [
    { text: copy.churchAddressAction, mark: 'Проект', note: 'скрытая подпись строки адреса' },
    { text: copy.churchDescription, mark: 'Утверждено', note: 'свёрнут, тот же порядок блоков' },
    { text: copy.churchOfficialName, mark: 'Утверждено' },
    { text: copy.churchScheduleTitle, mark: 'IA', note: 'IA §9.1' },
    { text: copy.churchScheduleEmpty, mark: 'Утверждено' },
    { text: copy.churchActionNeedRide, mark: 'IA', note: 'IA §9' },
    { text: copy.churchActionCanDrive, mark: 'IA', note: 'IA §9' },
    { text: copy.boardTitle, mark: 'IA', note: 'IA §7.2, §9.2' },
    { text: copy.boardEmpty, mark: 'Утверждено', note: 'вторая формулировка из 5.4 снята' },
    { text: copy.churchReport, mark: 'IA', note: 'IA §9.4' },
  ],

  /*
   * Group 2A, approved by the owner on 24 August 2026. The note next to a row still names where the
   * wording came from; the mark records that the owner accepted it on the assembled screen.
   */
  'request-when': [
    { text: requestCopy.title, mark: 'Утверждено', note: 'копия 4.5; название того, что создаётся' },
    { text: requestCopy.back, mark: 'Утверждено', note: 'DS §5, тихое действие' },
    { text: requestCopy.whenTitle, mark: 'Утверждено', note: 'копия 4.5; один вопрос экрана' },
    { text: requestCopy.whenOr, mark: 'Утверждено', note: 'тихий разделитель двух способов ответить' },
    { text: requestCopy.whenCustom, mark: 'Утверждено', note: 'IA §10.1; второй способ ответить на тот же вопрос' },
    { text: requestCopy.whenArrivalLabel, mark: 'Утверждено', note: 'PS §12.2; появляется при своей дате' },
    { text: requestCopy.whenCustomHint, mark: 'Утверждено', note: 'PS §7.2, дословно' },
    { text: requestCopy.whenHorizon, mark: 'Утверждено', note: 'IA §10.3, `request.limit.horizon`' },
    { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5, одно главное действие' },
  ],
  'request-map': [
    { text: requestCopy.placeTitle, mark: 'Утверждено', note: 'PS §8.1' },
    { text: requestCopy.mapSearch, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.search`' },
    { text: requestCopy.mapHint, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.hint`; сокращена решением владельца' },
    { text: 'Выбрано: {адрес}', mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.selected`' },
    { text: requestCopy.placePrivacy, mark: 'Утверждено', note: 'IA §10.4, до подтверждения места; правка владельца, ждёт повторного просмотра' },
    { text: requestCopy.mapConfirm, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.confirm`' },
  ],
  'request-place': [
    { text: requestCopy.placeTitle, mark: 'Утверждено', note: 'PS §8.1; тот же вопрос после выбора' },
    { text: requestCopy.placePrivacy, mark: 'Утверждено', note: 'IA §10.4; та же строка, что на карте, — второй формулировки рядом нет' },
    { text: requestCopy.placePrimary, mark: 'Утверждено', note: 'копия 4.5' },
    { text: requestCopy.placeAlternative, mark: 'Утверждено', note: 'новое: подпись второго и третьего места' },
    { text: requestCopy.placeOr, mark: 'Утверждено', note: 'новое: разделитель между карточками мест' },
    { text: requestCopy.placeChange, mark: 'Утверждено', note: 'копия 4.5' },
    { text: requestCopy.placeRemove, mark: 'Утверждено', note: 'копия 4.5; у основного места не показывается' },
    { text: requestCopy.placeAdd, mark: 'Утверждено', note: 'решение 1.7 (6): «Добавить ещё точку» не используется' },
    { text: requestCopy.placeAlternativesHint, mark: 'Утверждено', note: 'IA §10.2, дословно' },
    { text: requestCopy.placeLimit, mark: 'Утверждено', note: 'новое: причина вместо неактивной кнопки, IA §28.3' },
    { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
  ],
  'request-people': [
    { text: requestCopy.peopleTitle, mark: 'Утверждено', note: 'копия 4.5; один вопрос, три поля' },
    { text: requestCopy.peopleTotal, mark: 'Утверждено', note: 'IA §47.6' },
    { text: requestCopy.peopleChildren, mark: 'Утверждено', note: 'IA §47.6' },
    { text: requestCopy.peopleChildSeat, mark: 'Утверждено', note: 'IA §2.3; появляется, когда есть дети' },
    { text: requestCopy.peopleChildSeatHint, mark: 'Утверждено', note: 'IA §2.3, дословно' },
    { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
  ],
};

function SourcePanel({ sample }: { sample: SampleId }) {
  const current = samples.find((item) => item.id === sample)!;
  const rows = sourcesBySample[sample];

  return (
    <aside className={styles.sourcePanel} aria-label="Источники формулировок на экране">
      <h2>{current.title}</h2>
      <p>{current.description}</p>
      <p>
        «Утверждено» и «Решение» — формулировки, принятые владельцем на проверке 22 августа 2026 года.
        IA, PS и DS — текст, закреплённый утверждённым документом. «Проект» — то, что изменилось после
        проверки и ждёт следующего просмотра.
      </p>
      {sample.startsWith('request-') && (
        <p>
          Экраны 5–8 — форма просьбы пассажира, просмотренная 24 августа 2026 года. Строки этих трёх
          смысловых экранов утверждены; пометка рядом показывает, откуда взята формулировка. Экран
          «Последние детали» в этот просмотр не входил и здесь не собран.
        </p>
      )}
      <dl className={styles.sourceList}>
        {rows.map((row) => (
          <div key={`${row.text}-${row.note ?? ''}`}>
            <dt>
              {row.text}
              {row.note && <span className={styles.sourceNote}>{row.note}</span>}
            </dt>
            <dd data-source-status={row.mark === 'Проект' ? 'draft' : 'fixed'}>{row.mark}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ------------------------------------------------------------------------------ review page */

/** Each screen has its own address, so the owner can open one directly: `/copy-review#board`. */
function subscribeToAddress(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readAddress(): SampleId | null {
  const requested = decodeURIComponent(window.location.hash.replace('#', ''));
  return samples.some((item) => item.id === requested) ? (requested as SampleId) : null;
}

export function CopyReview() {
  const [chosen, setChosen] = useState<SampleId | null>(null);
  const [textZoom, setTextZoom] = useState(false);
  const fromAddress = useSyncExternalStore(subscribeToAddress, readAddress, () => null);
  const sample = chosen ?? fromAddress ?? 'catalog';

  function screen() {
    switch (sample) {
      case 'catalog': return <CatalogScreen textZoom={textZoom} />;
      case 'church': return <ChurchScreen textZoom={textZoom} />;
      case 'board': return <BoardScreen textZoom={textZoom} />;
      case 'empty-church': return <EmptyChurchScreen textZoom={textZoom} />;
      case 'request-when': return <RequestWhenScreen textZoom={textZoom} />;
      case 'request-map': return <RequestMapScreen textZoom={textZoom} />;
      case 'request-place': return <RequestPlaceScreen textZoom={textZoom} />;
      case 'request-people': return <RequestPeopleScreen textZoom={textZoom} />;
    }
  }

  return (
    <div className={styles.reviewRoot}>
      <header className={styles.reviewHeader}>
        <p>Временная поверхность проверки · группы 1 и 2A просмотрены</p>
        <h1>Проверка русской копии: храм и первая половина просьбы пассажира</h1>
        <p>
          Мобильные экраны шириной 390 px. Экраны 1–4 — первая группа после правок владельца от
          22 августа 2026 года. Экраны 5–8 — форма просьбы пассажира в новой структуре из четырёх
          смысловых вопросов, без отдельного экрана проверки перед публикацией; просмотрены
          24 августа 2026 года. Производственный интерфейс не изменён; поверхность существует
          только для просмотра слов.
        </p>
      </header>
      <nav className={styles.reviewControls} aria-label="Выбор экрана проверки">
        {samples.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={sample === item.id}
            onClick={() => setChosen(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.zoomToggle}
          aria-pressed={textZoom}
          onClick={() => setTextZoom((current) => !current)}
        >
          Текст 200 %
        </button>
      </nav>
      <div className={styles.reviewStage} data-sample-id={sample} data-text-zoom={textZoom ? '200' : 'off'}>
        {screen()}
        <SourcePanel sample={sample} />
      </div>
    </div>
  );
}
