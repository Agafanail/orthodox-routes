'use client';

import { useState, useSyncExternalStore } from 'react';
import { ChurchPlaceholder } from '../design-preview/church-placeholder';
import styles from './copy-review.module.css';

/**
 * Temporary isolated surface for the first manual Russian copy review group: church catalog, church
 * page, transport board and the empty church state. It renders the proposed wording of the UX Copy
 * and Localization Foundation inside canonical Design System V2 composition so the owner can judge
 * the words in context. It is unlinked, it changes no production screen, and it approves nothing.
 */

type SampleId = 'catalog' | 'church' | 'board' | 'empty-church';

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
    }
  }

  return (
    <div className={styles.reviewRoot}>
      <header className={styles.reviewHeader}>
        <p>Временная поверхность проверки · второй просмотр</p>
        <h1>Проверка русской копии: каталог, храм, поездки, пустое состояние</h1>
        <p>
          Четыре мобильных экрана шириной 390 px после правок владельца от 22 августа 2026 года.
          Производственный интерфейс не изменён; поверхность существует только для просмотра слов.
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
