'use client';

import { useState } from 'react';
import { ChurchPlaceholder } from './church-placeholder';
import styles from './design-preview.module.css';

type ScreenId =
  | 'mobile-directory'
  | 'mobile-church-header'
  | 'mobile-board'
  | 'mobile-ride-map'
  | 'mobile-passenger-form'
  | 'desktop-directory'
  | 'desktop-church-board'
  | 'desktop-ride-map'
  | 'desktop-trips'
  | 'responsive-full-church'
  | 'responsive-catalog'
  | 'responsive-empty-church';

const screens: ReadonlyArray<{ id: ScreenId; label: string; kind: 'mobile' | 'desktop' | 'responsive' }> = [
  { id: 'mobile-directory', label: 'Мобильный каталог', kind: 'mobile' },
  { id: 'mobile-church-header', label: 'Мобильная шапка храма', kind: 'mobile' },
  { id: 'mobile-board', label: 'Мобильная транспортная доска', kind: 'mobile' },
  { id: 'mobile-ride-map', label: 'Мобильная карта поездок', kind: 'mobile' },
  { id: 'mobile-passenger-form', label: 'Мобильная форма просьбы', kind: 'mobile' },
  { id: 'desktop-directory', label: 'Каталог на компьютере', kind: 'desktop' },
  { id: 'desktop-church-board', label: 'Храм и доска на компьютере', kind: 'desktop' },
  { id: 'desktop-ride-map', label: 'Карта поездок на компьютере', kind: 'desktop' },
  { id: 'desktop-trips', label: 'Мои поездки на компьютере', kind: 'desktop' },
  { id: 'responsive-full-church', label: 'Полная страница храма', kind: 'responsive' },
  { id: 'responsive-catalog', label: 'Каталог из 12 храмов', kind: 'responsive' },
  { id: 'responsive-empty-church', label: 'Пустая страница храма', kind: 'responsive' },
];

type IconName = 'back' | 'bell' | 'car' | 'chevron-down' | 'close' | 'expand' | 'filter' | 'mail' | 'map' | 'phone' | 'pin' | 'profile' | 'route' | 'save' | 'search' | 'share';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    back: <path d="M15 5l-7 7 7 7" />,
    bell: <><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    car: <><path d="M4 15h16M5.5 15l1.6-5a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.6 5" /><path d="M4 15v3h3v-3M17 15v3h3v-3" /></>,
    'chevron-down': <path d="m7 9.5 5 5 5-5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    expand: <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />,
    filter: <><path d="M4 7h11M19 7h1M4 17h6M14 17h6" /><circle cx="17" cy="7" r="2" /><circle cx="12" cy="17" r="2" /></>,
    mail: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
    map: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    phone: <path d="M6.4 4h2.8l1.4 4-2 1.5a11 11 0 0 0 5.9 5.9l1.5-2 4 1.4v2.8a2.4 2.4 0 0 1-2.6 2.4A14.4 14.4 0 0 1 4 6.6 2.4 2.4 0 0 1 6.4 4Z" />,
    pin: <><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
    profile: <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></>,
    route: <><path d="m3 6.5 6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5Z" /><path d="M9 4v13M15 6.5v13" /></>,
    save: <path d="M6 4h12v16l-6-4-6 4Z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    share: <><circle cx="17" cy="6" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="m8.3 10.8 6.4-3.5M8.3 13.2l6.4 3.5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon} data-icon={name}>{paths[name]}</svg>;
}

function IconButton({ label, icon, className = '', onClick }: { label: string; icon: IconName; className?: string; onClick?: () => void }) {
  return <button type="button" className={`${styles.iconButton} ${className}`} aria-label={label} data-icon-only onClick={onClick}><Icon name={icon} /></button>;
}

function MobileNavigation({ active = 'Храмы' }: { active?: 'Храмы' | 'Поездки' | 'Уведомления' }) {
  return (
    <nav className={styles.mobileNav} aria-label="Мобильная навигация">
      {([['Храмы', 'pin'], ['Поездки', 'car'], ['Уведомления', 'bell']] as const).map(([label, icon]) => (
        <a key={label} href={`#${label}`} className={active === label ? styles.navActive : undefined} aria-current={active === label ? 'page' : undefined}>
          <Icon name={icon} /><span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

function DesktopHeader({ active = 'Храмы' }: { active?: 'Храмы' | 'Мои поездки' }) {
  return (
    <header className={styles.desktopHeader}>
      <a href="#orthodox-routes" className={styles.brand}>Orthodox Routes</a>
      <nav aria-label="Основная навигация">
        {['Храмы', 'Мои поездки', 'Поддержать'].map((label) => (
          <a key={label} href={`#${label}`} className={active === label ? styles.navActive : undefined} aria-current={active === label ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className={styles.headerTools}>
        <button type="button" className={styles.language}>RU <span aria-hidden="true">⌄</span></button>
        <IconButton label="Уведомления" icon="bell" />
        <IconButton label="Профиль" icon="profile" />
      </div>
    </header>
  );
}

function MapArtwork({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.mapArtwork} ${compact ? styles.mapCompact : ''}`} aria-label="Схематичная карта храмов" role="img">
      <svg viewBox={compact ? '0 0 360 180' : '0 0 720 600'} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-20 430 Q210 230 420 340 T760 190" className={styles.road} />
        <path d="M150 -20 Q250 260 180 640" className={styles.roadMinor} />
        <path d="M550 -20 Q480 280 620 640" className={styles.roadMinor} />
        <path d="M680 -20 L680 640" className={styles.water} />
        {compact && <circle cx="208" cy="105" r="58" className={styles.radius} />}
      </svg>
      <span className={`${styles.mapLabel} ${styles.mapLabelOne}`}>Catanzaro</span>
      <span className={`${styles.mapLabel} ${styles.mapLabelTwo}`}>Catanzaro Lido</span>
      <span className={`${styles.mapLabel} ${styles.mapLabelThree}`}>Mater Domini</span>
      <span className={`${styles.mapPin} ${styles.mapPinPrimary}`} aria-hidden="true" />
      {!compact && <><span className={`${styles.mapPin} ${styles.mapPinSecond}`} aria-hidden="true" /><span className={`${styles.mapPin} ${styles.mapPinThird}`} aria-hidden="true" /></>}
    </div>
  );
}

type ChurchSummary = {
  id: string;
  name: string;
  city: string;
  service: string;
  rides: string;
};

const churches = [
  { id: 'pokrov', name: 'Покров Пресвятой Богородицы', city: 'Catanzaro, Италия', service: 'вс, 9:00', rides: '3 предложения · 2 просьбы' },
  { id: 'nikolai', name: 'Свято-Никольский храм', city: 'Vibo Valentia, Италия', service: 'вс, 10:30', rides: '2 предложения · 1 просьба' },
  { id: 'uk-long', name: 'Парафія Покрову Пресвятої Богородиці та святителя Миколая Чудотворця', city: 'Reggio Calabria, Італія', service: 'чт, 18:00', rides: 'Поездок пока никто не предлагал' },
  { id: 'de-long', name: 'Russisch-Orthodoxe Kirchengemeinde der Allerheiligsten Gottesmutter', city: 'Lamezia Terme, Italien', service: 'сб, 17:00', rides: '1 предложение · 3 просьбы' },
] as const satisfies ReadonlyArray<ChurchSummary>;

function ChurchCard({ church, selected = false }: { church: ChurchSummary; selected?: boolean }) {
  return (
    <article className={`${styles.card} ${selected ? styles.selectedCard : ''}`} data-church-card data-selected={selected || undefined}>
      <h3 className={styles.cardTitle}>{church.name}</h3>
      <p className={styles.secondary}>{church.city}</p>
      <p className={styles.data}>Ближайшая служба: <strong>{church.service}</strong></p>
      <p className={styles.secondary}>{church.rides}</p>
    </article>
  );
}

function DirectoryFilters() {
  return (
    <div className={styles.directoryFilters}>
      <label className={styles.searchField}><Icon name="search" /><span className={styles.srOnly}>Найти храм</span><input placeholder="Найти храм" /></label>
      <IconButton label="Фильтры" icon="filter" />
      <button type="button" className={styles.selector}>Италия <Icon name="chevron-down" /></button>
      <button type="button" className={styles.selector}>Catanzaro <Icon name="chevron-down" /></button>
      <button type="button" className={styles.quietButton} aria-label="Рядом со мной"><Icon name="map" /><span className={styles.locationLabel}>Рядом со мной</span></button>
    </div>
  );
}

function ChurchActions() {
  return (
    <div className={styles.churchActions}>
      <button type="button" className={styles.primaryButton} data-variant="primary">Нужна поездка</button>
      <button type="button" className={styles.secondaryButton} data-variant="secondary">Могу подвезти</button>
    </div>
  );
}

function AddressRow({
  city = 'Catanzaro, Италия',
  address = 'Via XX Settembre, 45, 88100 Catanzaro CZ',
}: {
  city?: string;
  address?: string;
}) {
  return (
    <a href="#карта-и-маршрут" className={styles.addressRow}>
      <Icon name="pin" />
      <span><strong>{city}</strong><small>{address}</small><em>Карта и маршрут</em></span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

function Services() {
  return (
    <section className={styles.services} aria-labelledby="other-services">
      <h2 id="other-services" className={styles.sectionTitle}>Другие службы</h2>
      <div className={styles.serviceRow}><p><strong>15</strong> <span>авг</span></p><div><strong>Всенощное бдение</strong><span>пятница, 18:00 · через 8 дней</span></div></div>
      <div className={styles.serviceRow}><p><strong>17</strong> <span>авг</span></p><div><strong>Литургия</strong><span>воскресенье, 9:00 · через 10 дней</span></div></div>
      <button type="button" className={styles.quietButton}>Всё расписание</button>
    </section>
  );
}

type Ride = {
  id: string;
  type: 'Есть места' | 'Ищут место';
  title: string;
  detail: string;
  action: string;
};

/** One service/date group. The ride map never mixes rides from other services or dates. */
const rides = [
  { id: 'offer-lido', type: 'Есть места', title: 'вс, 10 авг · 08:00 · 3 места', detail: 'Из Catanzaro Lido · с детьми · обратно', action: 'Попросить подвезти' },
  { id: 'request-matera', type: 'Ищут место', title: 'вс, 10 авг · утро · 2 человека', detail: 'Из Matera · нужна поездка обратно', action: 'Предложить подвезти' },
  { id: 'offer-siano', type: 'Есть места', title: 'вс, 10 авг · 07:40 · 1 место', detail: 'Из Siano · только туда', action: 'Попросить подвезти' },
  { id: 'request-centro', type: 'Ищут место', title: 'вс, 10 авг · 08:15 · 1 человек', detail: 'Из Catanzaro, центр · только туда', action: 'Предложить подвезти' },
] as const satisfies ReadonlyArray<Ride>;

function RideCard({ ride, showType = true, actionVariant = 'secondary', distance }: {
  ride: Ride;
  showType?: boolean;
  /** Primary only where the user has already selected this one ride and no other primary competes. */
  actionVariant?: 'secondary' | 'primary';
  /** Rounded distance to the public area or corridor; shown only where a location is available. */
  distance?: string;
}) {
  return (
    <article className={styles.card} data-ride-type={ride.type}>
      {showType && <span className={styles.typeTag}>{ride.type}</span>}
      <h3 className={styles.cardTitle}>{ride.title}</h3>
      <p className={styles.secondary}>{ride.detail}</p>
      {distance && <p className={styles.data} data-ride-distance>{distance}</p>}
      <div className={styles.cardAction}>
        <button type="button" className={actionVariant === 'primary' ? styles.primaryButton : styles.secondaryButton} data-variant={actionVariant}>{ride.action}</button>
      </div>
    </article>
  );
}

type Filter = 'Все' | 'Есть места' | 'Ищут место';

const filters: ReadonlyArray<Filter> = ['Все', 'Есть места', 'Ищут место'];

const groupTitle = 'Литургия · 10 августа';

function matchesFilter(ride: Ride, filter: Filter) {
  return filter === 'Все' || ride.type === filter;
}

function BoardFilters({ value, onChange, label }: { value: Filter; onChange: (filter: Filter) => void; label: string }) {
  return (
    <div className={styles.chips} role="group" aria-label={label} data-ride-filters>
      {filters.map((filter) => (
        <button key={filter} type="button" className={filter === value ? styles.selectedChip : undefined} aria-pressed={filter === value} onClick={() => onChange(filter)}>{filter}</button>
      ))}
    </div>
  );
}

/**
 * Map entry. Mobile keeps it outside the card flow near the bottom of the board; desktop attaches it
 * to the service/date group heading. Both use the same map-action treatment and stay out of the
 * filter group. Neither is a Primary CTA — the board remains the primary representation.
 */
function MobileMapAction({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles.mobileMapAction} data-map-entry="mobile" onClick={onOpen}>
      <Icon name="route" /><span className={styles.mapActionLabel}>Поездки на карте</span>
    </button>
  );
}

function GroupMapAction({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className={styles.groupMapAction} data-map-entry="group" onClick={onOpen}>
      <Icon name="route" /><span className={styles.mapActionLabel}>На карте</span>
    </button>
  );
}

function GroupHeading({ id, title, subtitle, onOpenMap }: { id: string; title: string; subtitle?: string; onOpenMap?: () => void }) {
  return (
    <div className={styles.groupHeading}>
      <div>
        <h2 id={id} className={styles.sectionTitle}>{title}</h2>
        {subtitle && <p className={styles.secondary}>{subtitle}</p>}
      </div>
      {onOpenMap && <GroupMapAction onOpen={onOpenMap} />}
    </div>
  );
}

/* ---------------------------------------------------------------- ride map */

type Point = readonly [number, number];

/**
 * Map objects live in a 0–100 square field. A passenger request is one or more approximate public
 * areas; a driver offer is an approximate direction corridor. Neither carries exact private data.
 */
type MapObject = {
  id: string;
  rideId: string;
  kind: 'area' | 'corridor';
  x: number;
  y: number;
  origin?: Point;
  tip?: Point;
  place?: { index: number; total: number };
};

const church = { x: 52, y: 44 };
const userLocation = { x: 50, y: 84 };
const areaRadius = 7;

/**
 * The same field renders about 60% larger on desktop, so identical unit sizes read far heavier
 * there. Markers and corridors carry their own desktop values, keeping the intended order:
 * selected ride → other rides → church → user location → base map.
 */
const fieldScale = {
  mobile: { church: 1, userRing: 4.2, userDot: 2, corridorWide: 7, corridorNarrow: 1.5 },
  desktop: { church: 0.72, userRing: 2.8, userDot: 1.3, corridorWide: 4.2, corridorNarrow: 1.2 },
} as const;

/**
 * A corridor is a ribbon tapering towards the church: narrow where the destination is public, wide
 * where the departure point must stay imprecise. Both edges bow the same way, so it reads as an
 * approximate direction rather than a street-by-street route.
 */
function corridorPath(origin: Point, tip: Point, wide: number, narrow: number) {
  const [ox, oy] = origin;
  const [tx, ty] = tip;
  const length = Math.hypot(tx - ox, ty - oy) || 1;
  const perpendicularX = -(ty - oy) / length;
  const perpendicularY = (tx - ox) / length;
  const bow = 3.4;
  const at = (x: number, y: number, offset: number): Point => [x + perpendicularX * offset, y + perpendicularY * offset];
  const format = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const control = (a: Point, b: Point) => at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -bow);

  const tipLeft = at(tx, ty, -narrow);
  const originLeft = at(ox, oy, -wide);
  const originRight = at(ox, oy, wide);
  const tipRight = at(tx, ty, narrow);

  return `M ${format(tipLeft)} Q ${format(control(tipLeft, originLeft))} ${format(originLeft)}`
    + ` L ${format(originRight)} Q ${format(control(originRight, tipRight))} ${format(tipRight)} Z`;
}

const mapObjects: ReadonlyArray<MapObject> = [
  { id: 'offer-lido-corridor', rideId: 'offer-lido', kind: 'corridor', x: 27, y: 66, origin: [12, 78], tip: [46, 50] },
  { id: 'offer-siano-corridor', rideId: 'offer-siano', kind: 'corridor', x: 74, y: 27, origin: [90, 16], tip: [58, 40] },
  { id: 'request-matera-area-1', rideId: 'request-matera', kind: 'area', x: 26, y: 42, place: { index: 1, total: 2 } },
  { id: 'request-matera-area-2', rideId: 'request-matera', kind: 'area', x: 40, y: 70, place: { index: 2, total: 2 } },
  { id: 'request-centro-area', rideId: 'request-centro', kind: 'area', x: 74, y: 60 },
];

/** Rounded values against the public area or corridor only, never against hidden exact geometry. */
const approximateDistances: Record<string, string> = {
  'offer-lido': '≈6 км от вас',
  'offer-siano': '≈23 км от вас',
  'request-matera': '≈31 км от вас',
  'request-centro': '≈3 км от вас',
};

const cityLabels = [
  { id: 'catanzaro', label: 'Catanzaro', x: 62, y: 30 },
  { id: 'lido', label: 'Catanzaro Lido', x: 18, y: 88 },
  { id: 'siano', label: 'Siano', x: 76, y: 9 },
  { id: 'church', label: 'Храм', x: 52, y: 55 },
] as const;

function objectLabel(ride: Ride, object: MapObject) {
  if (object.kind === 'corridor') return `${ride.type} · ${ride.title} · примерное направление`;
  if (object.place) return `${ride.type} · ${ride.title} · примерная область, место ${object.place.index} из ${object.place.total}`;
  return `${ride.type} · ${ride.title} · примерная область`;
}

function privacyLine(ride: Ride, areaCount: number) {
  if (ride.type === 'Есть места') {
    return 'Показано примерное направление к храму. Точка отправления, точный маршрут и остановки не публикуются.';
  }
  if (areaCount > 1) {
    return `Показаны ${areaCount} примерные области радиусом 1 км — это возможные места встречи одной просьбы. Точное место видит только тот, с кем пассажир договорится.`;
  }
  return 'Показана примерная область радиусом 1 км. Точное место находится внутри неё и видно только тому, с кем пассажир договорится.';
}

/** Roads and water are context texture only; they bleed across the whole canvas. */
function MapBackdrop() {
  return (
    <svg className={styles.bleedLayer} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path className={styles.mapWater} d="M -5 92 L 105 88" />
      <path className={styles.mapRoad} d="M -5 58 Q 30 46 56 54 T 105 44" />
      <path className={styles.mapRoadMinor} d="M 30 -5 Q 36 40 28 105" />
      <path className={styles.mapRoadMinor} d="M 78 -5 Q 70 44 84 105" />
    </svg>
  );
}

function MapShapes({ objects, selectedRideId, located, desktop }: {
  objects: ReadonlyArray<MapObject>;
  selectedRideId: string | null;
  located: boolean;
  desktop: boolean;
}) {
  const scale = fieldScale[desktop ? 'desktop' : 'mobile'];
  // The marker scales about its own point, so it stays planted on the same location.
  const churchAnchor = `translate(${church.x} ${church.y + 7}) scale(${scale.church}) translate(${-church.x} ${-(church.y + 7)})`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {objects.filter((object) => object.kind === 'corridor').map((object) => (
        <path
          key={object.id}
          className={styles.corridorShape}
          d={corridorPath(object.origin!, object.tip!, scale.corridorWide, scale.corridorNarrow)}
          data-map-shape="corridor"
          data-selected={object.rideId === selectedRideId || undefined}
        />
      ))}
      {objects.filter((object) => object.kind === 'area').map((object) => (
        <circle key={object.id} className={styles.areaShape} cx={object.x} cy={object.y} r={areaRadius} data-map-shape="area" data-selected={object.rideId === selectedRideId || undefined} />
      ))}
      <g transform={churchAnchor} data-map-shape="church">
        <path className={styles.churchMarker} d={`M ${church.x} ${church.y + 7} c -3.2 -4.2 -5 -6.2 -5 -8.6 a 5 5 0 1 1 10 0 c 0 2.4 -1.8 4.4 -5 8.6 Z`} />
        <circle className={styles.churchMarkerCore} cx={church.x} cy={church.y - 1.6} r={1.9} />
      </g>
      {located && (
        <g data-map-shape="user">
          <circle className={styles.userRing} cx={userLocation.x} cy={userLocation.y} r={scale.userRing} />
          <circle className={styles.userDot} cx={userLocation.x} cy={userLocation.y} r={scale.userDot} />
        </g>
      )}
    </svg>
  );
}

/** Hit targets share the field coordinate system, so they stay aligned with the shapes. */
function MapTargets({ objects, selectedRideId, onSelect }: {
  objects: ReadonlyArray<MapObject>;
  selectedRideId: string | null;
  onSelect: (rideId: string) => void;
}) {
  return (
    <>
      {cityLabels.map((label) => (
        <span key={label.id} className={styles.fieldLabel} style={{ left: `${label.x}%`, top: `${label.y}%` }}>{label.label}</span>
      ))}
      {objects.map((object) => {
        const ride = rides.find((candidate) => candidate.id === object.rideId);
        if (!ride) return null;
        const selected = ride.id === selectedRideId;
        const pillOffset = object.kind === 'area' ? areaRadius + 5 : 8;
        return (
          <span key={object.id} className={styles.fieldTarget}>
            <button
              type="button"
              className={styles.mapHit}
              style={{ left: `${object.x}%`, top: `${object.y}%` }}
              aria-label={objectLabel(ride, object)}
              aria-pressed={selected}
              data-map-object={object.kind}
              onClick={() => onSelect(ride.id)}
            />
            {selected && (
              <span className={styles.objectPill} style={{ left: `${object.x}%`, top: `${object.y - pillOffset}%` }}>{ride.type}</span>
            )}
          </span>
        );
      })}
    </>
  );
}

function RideMap({ desktop, filter, onFilterChange, onBack }: {
  desktop: boolean;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onBack: () => void;
}) {
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [located, setLocated] = useState(false);

  const visibleRides = rides.filter((ride) => matchesFilter(ride, filter));
  const visibleObjects = mapObjects.filter((object) => visibleRides.some((ride) => ride.id === object.rideId));
  const selectedRide = visibleRides.find((ride) => ride.id === selectedRideId) ?? null;
  const selectedAreaCount = selectedRide
    ? mapObjects.filter((object) => object.rideId === selectedRide.id && object.kind === 'area').length
    : 0;
  const emptyFilters = filters.filter((candidate) => candidate !== 'Все' && !rides.some((ride) => ride.type === candidate));

  return (
    <div
      className={`${styles.mapScreen} ${desktop ? styles.desktopMapScreen : ''}`}
      data-ride-map
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedRideId) setSelectedRideId(null);
      }}
    >
      <header className={styles.mapHeader}>
        <IconButton label="Назад к доске поездок" icon="back" onClick={onBack} />
        <div>
          <strong>{groupTitle}</strong>
          <small>Поездки этой службы · примерные области и направления</small>
        </div>
      </header>

      <div className={styles.mapFilters}>
        <div className={styles.chips} role="group" aria-label="Тип объявления" data-ride-filters>
          {filters.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === filter ? styles.selectedChip : undefined}
              aria-pressed={candidate === filter}
              disabled={emptyFilters.includes(candidate)}
              onClick={() => { onFilterChange(candidate); setSelectedRideId(null); }}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>

      {emptyFilters.length > 0 && (
        <p className={styles.noticeLine} data-empty-filter-reason>
          {emptyFilters.includes('Ищут место')
            ? 'Просьб пассажиров на эту службу пока нет — фильтр недоступен.'
            : 'Предложений водителей на эту службу пока нет — фильтр недоступен.'}
        </p>
      )}

      {located && (
        <p className={styles.noticeLine} data-location-note>
          Расстояния примерные: они считаются до публичной области или направления, а не до точного места.
        </p>
      )}

      <div className={styles.mapCanvas}>
        <MapBackdrop />

        <div className={styles.mapField}>
          <MapShapes objects={visibleObjects} selectedRideId={selectedRideId} located={located} desktop={desktop} />
          <MapTargets objects={visibleObjects} selectedRideId={selectedRideId} onSelect={setSelectedRideId} />
        </div>

        <div className={styles.mapOverlay}>
          <button type="button" className={styles.locateButton} aria-pressed={located} onClick={() => setLocated((current) => !current)}>
            <Icon name="map" />Показать, где я
          </button>
          <div className={styles.legend} role="note" aria-label="Условные обозначения">
            <span><span className={styles.legendArea} aria-hidden="true" />Круг — примерная область пассажира</span>
            <span><span className={styles.legendCorridor} aria-hidden="true" />Полоса — примерное направление водителя</span>
          </div>
        </div>

        {selectedRide && (
          <section
            className={desktop ? styles.detailPanel : styles.detailSheet}
            role="region"
            aria-label={`Карточка поездки: ${selectedRide.title}`}
            data-ride-detail
          >
            <div className={styles.detailHead}>
              <span>{selectedRide.type === 'Есть места' ? 'Предложение водителя' : 'Просьба пассажира'}</span>
              <IconButton label="Закрыть карточку и вернуться к карте" icon="close" onClick={() => setSelectedRideId(null)} />
            </div>
            <RideCard
              ride={selectedRide}
              showType={false}
              actionVariant="primary"
              distance={located ? approximateDistances[selectedRide.id] : undefined}
            />
            <p className={styles.privacyLine}>{privacyLine(selectedRide, selectedAreaCount)}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function MobileFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return <section className={styles.mobileFrame} role="region" aria-label={label}>{children}</section>;
}

function MobileDirectory() {
  return (
    <MobileFrame label="Мобильный каталог храмов">
      <div className={styles.mobileMapArea}><MapArtwork /><DirectoryFilters /><IconButton label="Открыть карту на весь экран" icon="expand" className={styles.expandButton} /></div>
      <main className={styles.mobileSheet}>
        <h1 className={styles.pageTitle}>Храмы</h1><p className={styles.secondary}>24 храма · Италия, Catanzaro</p>
        <div className={styles.cardList}>{churches.map((church, index) => <ChurchCard key={church.id} church={church} selected={index === 0} />)}</div>
      </main>
      <MobileNavigation />
    </MobileFrame>
  );
}

function HeroControls() {
  return <div className={styles.heroControls}><IconButton label="Назад" icon="back" /><div><IconButton label="Поделиться" icon="share" /><IconButton label="Сохранить" icon="save" /></div></div>;
}

function MobileChurchHeader() {
  return (
    <MobileFrame label="Мобильная шапка храма">
      <div className={styles.mobileHero}><ChurchPlaceholder churchId="pokrov-catanzaro" className={styles.placeholder} /><HeroControls /></div>
      <main className={styles.mobileContent}>
        <h1 className={styles.pageTitle}>Покров Пресвятой Богородицы</h1>
        <AddressRow />
        <div className={styles.nextService}><span>Ближайшая служба</span><strong>Литургия · воскресенье, 9 августа, 9:00</strong><em>через 2 дня</em></div>
        <ChurchActions />
        <Services />
        <p className={styles.scheduleNote}>Расписание обновлено 2 августа. Перед поездкой уточните время у храма.</p>
      </main>
      <MobileNavigation />
    </MobileFrame>
  );
}

function MobileBoard({ filter, onFilterChange, onOpenMap }: { filter: Filter; onFilterChange: (filter: Filter) => void; onOpenMap: () => void }) {
  const visible = rides.filter((ride) => matchesFilter(ride, filter));
  return (
    <MobileFrame label="Мобильная транспортная доска">
      <div className={styles.boardHost}>
        <main className={`${styles.mobileContent} ${styles.boardReserve}`}>
          <h1 className={styles.pageTitle}>Поездки</h1><p className={styles.secondary}>На литургию 10 августа</p>
          <BoardFilters value={filter} onChange={onFilterChange} label="Тип объявления" />
          <div className={styles.cardList}>{visible.map((ride) => <RideCard key={ride.id} ride={ride} />)}</div>
          <p className={styles.agreementCount}>Уже договорились: 8 впереди · 27 за 30 дней</p>
        </main>
        <MobileMapAction onOpen={onOpenMap} />
      </div>
      <MobileNavigation active="Поездки" />
    </MobileFrame>
  );
}

function MobileRideMap({ filter, onFilterChange, onBack }: { filter: Filter; onFilterChange: (filter: Filter) => void; onBack: () => void }) {
  return (
    <MobileFrame label="Мобильная карта поездок">
      <RideMap desktop={false} filter={filter} onFilterChange={onFilterChange} onBack={onBack} />
    </MobileFrame>
  );
}

function MobilePassengerForm() {
  return (
    <MobileFrame label="Мобильная форма просьбы пассажира">
      <header className={styles.formHeader}><IconButton label="Назад" icon="back" /><strong>Новая просьба</strong><span /></header>
      <main className={styles.mobileContent}>
        <p className={styles.secondary}><strong>Шаг 2</strong> из 6</p>
        <div className={styles.progress} aria-label="Выполнено 2 из 6 шагов">{[0, 1, 2, 3, 4, 5].map((step) => <span key={step} className={step < 2 ? styles.progressDone : undefined} />)}</div>
        <h1 className={styles.pageTitle}>Где вас забрать?</h1>
        <MapArtwork compact />
        <section className={`${styles.card} ${styles.placeCard}`} aria-label="Основное место встречи"><div><span className={styles.micro}>Основное место встречи</span><strong>Catanzaro Lido</strong></div><button type="button" className={styles.quietButton}>Изменить</button></section>
        <p className={styles.secondary}>Можно добавить ещё 2 места — так вас найдут больше водителей.</p>
        <button type="button" className={styles.addPlaceButton}><span aria-hidden="true">＋</span>Добавить место</button>
        <aside className={styles.privacyNote}>Публично будет видна примерная область радиусом 1 км. Точный адрес увидит только тот, с кем вы договоритесь.</aside>
      </main>
      <footer className={styles.formActions}><button type="button" className={styles.quietButton}>Назад</button><button type="button" className={styles.primaryButton}>Далее</button></footer>
    </MobileFrame>
  );
}

function DesktopFrame({ children, label, active = 'Храмы' }: { children: React.ReactNode; label: string; active?: 'Храмы' | 'Мои поездки' }) {
  return <section className={styles.desktopFrame} role="region" aria-label={label}><DesktopHeader active={active} />{children}</section>;
}

function DesktopDirectory() {
  return (
    <DesktopFrame label="Каталог храмов на компьютере">
      <main className={styles.desktopDirectory}>
        <section className={styles.directoryList}><h1 className={styles.pageTitle}>Храмы</h1><p className={styles.secondary}>24 храма · Италия, Catanzaro</p><DirectoryFilters /><div className={styles.cardList}>{churches.map((church, index) => <ChurchCard key={church.id} church={church} selected={index === 0} />)}</div></section>
        <section className={styles.directoryMap} aria-label="Карта храмов"><MapArtwork /></section>
      </main>
    </DesktopFrame>
  );
}

function DesktopRideColumns({ onOpenMap }: { onOpenMap: () => void }) {
  return (
    <section className={styles.desktopBoard} aria-labelledby="desktop-board-title">
      <GroupHeading id="desktop-board-title" title="Поездки на литургию 10 августа" onOpenMap={onOpenMap} />
      <div className={styles.rideColumns}>
        <section aria-labelledby="offers-column"><h3 id="offers-column" className={styles.micro}>Есть места · 2</h3>{rides.filter((ride) => ride.type === 'Есть места').map((ride) => <RideCard key={ride.id} ride={ride} showType={false} />)}</section>
        <section aria-labelledby="requests-column"><h3 id="requests-column" className={styles.micro}>Ищут место · 2</h3>{rides.filter((ride) => ride.type === 'Ищут место').map((ride) => <RideCard key={ride.id} ride={ride} showType={false} />)}</section>
      </div>
    </section>
  );
}

function DesktopChurchBoard({ onOpenMap }: { onOpenMap: () => void }) {
  return (
    <DesktopFrame label="Страница храма и транспортная доска на компьютере">
      <main className={styles.churchDesktopGrid}>
        <div><button type="button" className={styles.quietButton}>← Все храмы</button><ChurchPlaceholder churchId="pokrov-catanzaro" className={styles.desktopPlaceholder} /><h1 className={styles.pageTitle}>Покров Пресвятой Богородицы</h1><AddressRow /><div className={styles.nextService}><span>Ближайшая служба</span><strong>Литургия · воскресенье, 9 августа, 9:00</strong><em>через 2 дня</em></div><Services /><DesktopRideColumns onOpenMap={onOpenMap} /></div>
        <aside className={styles.stickyActions}><div className={styles.card}><ChurchActions /><p className={styles.secondary}>Уже договорились: 8 впереди · 27 за 30 дней</p></div><p className={styles.scheduleNote}>Расписание обновлено 2 августа. Перед поездкой уточните время у храма.</p><button type="button" className={styles.quietButton}>Сообщить об ошибке</button><button type="button" className={styles.quietButton}>Поддержать проект</button></aside>
      </main>
    </DesktopFrame>
  );
}

function DesktopRideMap({ filter, onFilterChange, onBack }: { filter: Filter; onFilterChange: (filter: Filter) => void; onBack: () => void }) {
  return (
    <DesktopFrame label="Карта поездок на компьютере">
      <RideMap desktop filter={filter} onFilterChange={onFilterChange} onBack={onBack} />
    </DesktopFrame>
  );
}

const tripRows = [
  { day: '10', service: 'Литургия · 9:00', role: 'Вы пассажир · действий не требуется', status: 'Подтверждено', tone: 'confirmed' },
  { day: '15', service: 'Всенощное бдение · 18:00', role: 'Вы водитель · действий не требуется', status: 'Предстоит', tone: 'planned' },
  { day: '24', service: 'Литургия · 9:00', role: 'Вы пассажир · ожидается ответ водителя', status: 'Ожидает подтверждения изменений', tone: 'pending' },
] as const;

function DesktopTrips() {
  return (
    <DesktopFrame label="Мои поездки на компьютере" active="Мои поездки">
      <main className={styles.tripsPage}>
        <h1 className={styles.pageTitle}>Мои поездки</h1>
        <div className={styles.chips} aria-label="Разделы поездок"><button type="button">Требуют ответа <span className={styles.countBadge}>1</span></button><button type="button" className={styles.selectedChip}>Предстоящие</button><button type="button">Объявления</button><button type="button">История</button></div>
        <div className={styles.tripsGrid}>
          <section className={styles.tripList} aria-label="Предстоящие поездки">{tripRows.map((trip, index) => <button type="button" key={trip.day} className={`${styles.tripRow} ${index === 0 ? styles.selectedCard : ''}`}><span className={styles.tripDate}><strong>{trip.day}</strong><small>авг</small></span><span className={styles.tripSummary}><strong>{trip.service}</strong><small>{trip.role}</small></span><span className={styles.statusBadge} data-status-tone={trip.tone}>{trip.status}</span></button>)}</section>
          <article className={`${styles.card} ${styles.tripDetail}`} aria-label="Детали поездки"><header><div><h2 className={styles.sectionTitle}>Литургия · воскресенье, 10 августа, 9:00</h2><p className={styles.secondary}>Покров Пресвятой Богородицы · Via XX Settembre, 45, Catanzaro</p></div><span className={styles.statusBadge} data-status-tone="confirmed">Подтверждено</span></header><section className={styles.meeting}><span className={styles.micro}>Где и когда встречаетесь</span><strong>Catanzaro Lido, у входа в библиотеку</strong><p>08:00 · за час до начала службы</p></section><dl className={styles.tripFacts}><div><dt>Ваша роль</dt><dd>Пассажир</dd></div><div><dt>Едут</dt><dd>2 человека</dd></div><div><dt>Обратная поездка</dt><dd>Нужна</dd></div></dl><section className={styles.contact}><div><h3 className={styles.cardTitle}>Алексей · водитель</h3><p className={styles.secondary}>+39 000 000 00 00 · alexey@example.invalid</p><small>Контакты открыты, потому что поездка подтверждена</small></div><IconButton label="Позвонить" icon="phone" /><IconButton label="Написать" icon="mail" /></section><footer className={styles.tripActions}><button type="button" className={styles.secondaryButton}>Изменить условия</button><button type="button" className={styles.destructiveButton} data-variant="destructive">Отменить поездку</button><button type="button" className={styles.quietButton}>Пожаловаться</button></footer></article>
        </div>
      </main>
    </DesktopFrame>
  );
}

function ResponsiveFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className={styles.responsiveFrame} role="region" aria-label={label}>
      <DesktopHeader />
      <header className={styles.responsiveMobileHeader}>
        <a href="#orthodox-routes" className={styles.brand}>Orthodox Routes</a>
        <div><IconButton label="Уведомления" icon="bell" /><IconButton label="Профиль" icon="profile" /></div>
      </header>
      {children}
      <div className={styles.responsiveMobileNav}><MobileNavigation /></div>
    </section>
  );
}

const fullSchedule = [
  { day: '10', month: 'авг', title: 'Божественная литургия', detail: 'воскресенье, 9:00 · через 2 дня' },
  { day: '15', month: 'авг', title: 'Всенощное бдение', detail: 'пятница, 18:00 · через 7 дней' },
  { day: '17', month: 'авг', title: 'Божественная литургия', detail: 'воскресенье, 9:00 · через 9 дней' },
] as const;

function FullSchedule() {
  return (
    <section className={styles.stressSection} aria-labelledby="full-upcoming-services">
      <h2 id="full-upcoming-services" className={styles.sectionTitle}>Ближайшие службы</h2>
      <div className={styles.stressSchedule}>
        {fullSchedule.map((service) => (
          <div className={styles.serviceRow} key={`${service.day}-${service.title}`}>
            <p><strong>{service.day}</strong> <span>{service.month}</span></p>
            <div><strong>{service.title}</strong><span>{service.detail}</span></div>
          </div>
        ))}
      </div>
      <h3 className={styles.cardTitle}>Регулярное расписание</h3>
      <dl className={styles.regularSchedule}>
        <div><dt>Суббота</dt><dd>18:00 · Всенощное бдение</dd></div>
        <div><dt>Воскресенье</dt><dd>9:00 · Божественная литургия</dd></div>
        <div><dt>Среда</dt><dd>18:00 · Молебен с акафистом</dd></div>
      </dl>
      <p className={styles.scheduleNote}>Расписание обновлено 2 августа. Оно могло измениться — перед поездкой уточните время у храма.</p>
    </section>
  );
}

function FullChurchInformation() {
  return (
    <section className={styles.stressSection} aria-labelledby="full-church-information">
      <h2 id="full-church-information" className={styles.sectionTitle}>О храме</h2>
      <p className={styles.longCopy}>Приход объединяет православных жителей Catanzaro и соседних городов. После воскресной литургии прихожане остаются на общую трапезу; богослужения совершаются преимущественно на церковнославянском и итальянском языках.</p>
      <dl className={styles.infoRows}>
        <div><dt>Официальное название</dt><dd>Parrocchia Ortodossa della Protezione della Santissima Madre di Dio</dd></div>
        <div><dt>Языки богослужений</dt><dd>Русский · Українська · Deutsch · Italiano</dd></div>
        <div><dt>Связаться с храмом</dt><dd>+39 000 000 00 00 · parrocchia@example.invalid</dd></div>
      </dl>
    </section>
  );
}

function FullTransportBoard({ filter, onFilterChange, onOpenMap }: { filter: Filter; onFilterChange: (filter: Filter) => void; onOpenMap: () => void }) {
  const visible = rides.filter((ride) => matchesFilter(ride, filter));
  return (
    <section className={`${styles.stressSection} ${styles.stressBoard}`} aria-labelledby="full-transport-board" data-stress-transport-board>
      <GroupHeading id="full-transport-board" title="Поездки на литургию 10 августа" subtitle="Предложения водителей и просьбы пассажиров этого храма" onOpenMap={onOpenMap} />
      <BoardFilters value={filter} onChange={onFilterChange} label="Тип объявления на полной странице" />
      <div className={styles.rideColumns}>
        <section aria-labelledby="full-offers-column"><h3 id="full-offers-column" className={styles.micro}>Есть места · {visible.filter((ride) => ride.type === 'Есть места').length}</h3>{visible.filter((ride) => ride.type === 'Есть места').map((ride) => <RideCard key={ride.id} ride={ride} />)}</section>
        <section aria-labelledby="full-requests-column"><h3 id="full-requests-column" className={styles.micro}>Ищут место · {visible.filter((ride) => ride.type === 'Ищут место').length}</h3>{visible.filter((ride) => ride.type === 'Ищут место').map((ride) => <RideCard key={ride.id} ride={ride} />)}</section>
      </div>
      <p className={styles.agreementCount}>Уже договорились: 8 впереди · 27 за последние 30 дней</p>
    </section>
  );
}

function FullDensityChurchPage({ filter, onFilterChange, onOpenMap }: { filter: Filter; onFilterChange: (filter: Filter) => void; onOpenMap: () => void }) {
  return (
    <ResponsiveFrame label="Адаптивная полная страница храма">
      <main className={styles.stressChurchPage} data-stress-screen="full-density-church">
        <section className={styles.stressIdentity} aria-labelledby="full-church-title">
          <div className={styles.responsiveHero}><ChurchPlaceholder churchId="pokrov-catanzaro-full" className={styles.placeholder} /><HeroControls /></div>
          <h1 id="full-church-title" className={styles.pageTitle}>Храм Покрова Пресвятой Богородицы в Catanzaro</h1>
          <p className={styles.secondary}>Parrocchia Ortodossa della Protezione della Santissima Madre di Dio</p>
          <AddressRow />
          <div className={styles.nextService}><span>Ближайшая служба</span><strong>Божественная литургия · воскресенье, 10 августа, 9:00</strong><em>через 2 дня</em></div>
        </section>
        <aside className={styles.stressSidebar}>
          <div className={styles.card}><ChurchActions /><p className={styles.secondary}>Выберите службу из расписания или укажите собственные дату и время.</p></div>
          <p className={styles.scheduleNote}>Уже договорились: 8 впереди · 27 за последние 30 дней.</p>
          <button type="button" className={styles.quietButton}>Пожаловаться</button>
          <button type="button" className={styles.quietButton}>Поддержать проект</button>
        </aside>
        <div className={styles.stressDetails}>
          <FullSchedule />
          <FullChurchInformation />
          <FullTransportBoard filter={filter} onFilterChange={onFilterChange} onOpenMap={onOpenMap} />
        </div>
      </main>
    </ResponsiveFrame>
  );
}

const catalogChurches = [
  { id: 'catanzaro-pokrov', name: 'Покров Пресвятой Богородицы', city: 'Catanzaro, Италия', service: 'вс, 9:00', rides: '3 предложения · 2 просьбы' },
  { id: 'vibo-nikolai', name: 'Свято-Никольский храм', city: 'Vibo Valentia, Италия', service: 'вс, 10:30', rides: '2 предложения · 1 просьба' },
  { id: 'reggio-uk', name: 'Парафія Покрову Пресвятої Богородиці та святителя Миколая Чудотворця', city: 'Reggio Calabria, Італія', service: 'чт, 18:00', rides: 'Поездок пока никто не предлагал' },
  { id: 'lamezia-de', name: 'Russisch-Orthodoxe Kirchengemeinde der Allerheiligsten Gottesmutter', city: 'Lamezia Terme, Italien', service: 'сб, 17:00', rides: '1 предложение · 3 просьбы' },
  { id: 'cosenza-trinity', name: 'Приход Святой Живоначальной Троицы', city: 'Cosenza, Италия', service: 'вс, 10:00', rides: '1 предложение · 1 просьба' },
  { id: 'crotone-george', name: 'Храм святого великомученика Георгия Победоносца', city: 'Crotone, Италия', service: 'сб, 18:30', rides: 'Поездок пока никто не предлагал' },
  { id: 'messina-andrew', name: 'Chiesa Ortodossa di Sant’Andrea il Primo Chiamato', city: 'Messina, Италия', service: 'вс, 9:30', rides: '2 предложения · 2 просьбы' },
  { id: 'siracusa-lucia', name: 'Comunità ortodossa di Santa Lucia e di tutti i santi della Sicilia', city: 'Siracusa, Италия', service: 'вс, 10:00', rides: '1 предложение · 2 просьбы' },
  { id: 'palermo-constantine', name: 'Храм святых равноапостольных Константина и Елены', city: 'Palermo, Италия', service: 'сб, 17:30', rides: '4 предложения · 3 просьбы' },
  { id: 'bari-nicholas', name: 'Православный приход святителя Николая Чудотворца в Бари', city: 'Bari, Италия', service: 'вс, 8:30', rides: '3 предложения · 1 просьба' },
  { id: 'napoli-nativity', name: 'Parrocchia ortodossa della Natività della Santissima Madre di Dio', city: 'Napoli, Италия', service: 'вс, 10:30', rides: '2 предложения · 4 просьбы' },
  { id: 'roma-catherine', name: 'Gemeinde der heiligen Großmärtyrerin Katharina in Rom', city: 'Roma, Italien', service: 'сб, 18:00', rides: '5 предложений · 2 просьбы' },
] as const satisfies ReadonlyArray<ChurchSummary>;

function ResponsiveCatalog() {
  const selectedChurch = catalogChurches[0];
  return (
    <ResponsiveFrame label="Адаптивный каталог из двенадцати храмов">
      <main className={styles.stressCatalog} data-stress-screen="twelve-church-catalog" data-selected-church-id={selectedChurch.id}>
        <section className={styles.stressCatalogMap} aria-label="Карта двенадцати храмов"><MapArtwork /><span className={styles.srOnly}>На карте выбран храм «{selectedChurch.name}».</span></section>
        <section className={`${styles.directoryList} ${styles.stressCatalogList}`}>
          <h1 className={styles.pageTitle}>Храмы</h1>
          <p className={styles.secondary}>12 храмов · Италия</p>
          <DirectoryFilters />
          <div className={styles.cardList} data-catalog-list>{catalogChurches.map((church, index) => <ChurchCard key={church.id} church={church} selected={index === 0} />)}</div>
        </section>
      </main>
    </ResponsiveFrame>
  );
}

function EmptyChurchPage() {
  return (
    <ResponsiveFrame label="Адаптивная пустая страница храма">
      <main className={styles.stressChurchPage} data-stress-screen="empty-church">
        <section className={styles.stressIdentity} aria-labelledby="empty-church-title">
          <div className={styles.responsiveHero}><ChurchPlaceholder churchId="crotone-george-empty" className={styles.placeholder} /><HeroControls /></div>
          <h1 id="empty-church-title" className={styles.pageTitle}>Храм святого великомученика Георгия Победоносца</h1>
          <p className={styles.secondary}>Parrocchia Ortodossa di San Giorgio Megalomartire</p>
          <AddressRow city="Crotone, Италия" address="Via Interna Marina, 12, 88900 Crotone KR" />
        </section>
        <aside className={styles.stressSidebar}>
          <div className={styles.card}><ChurchActions /><p className={styles.secondary}>Если нужной службы нет в расписании, укажите собственные дату и время.</p></div>
          <button type="button" className={styles.quietButton}>Пожаловаться</button>
          <button type="button" className={styles.quietButton}>Поддержать проект</button>
        </aside>
        <div className={styles.stressDetails}>
          <section className={`${styles.stressSection} ${styles.emptyState}`} aria-labelledby="empty-schedule-title" data-empty-schedule>
            <h2 id="empty-schedule-title" className={styles.sectionTitle}>Расписание пока не добавлено</h2>
            <p>Перед поездкой уточните дату и время службы у храма. Создать поездку можно и на собственные дату и время.</p>
          </section>
          <section className={`${styles.stressSection} ${styles.emptyState}`} aria-labelledby="empty-information-title" data-empty-information>
            <h2 id="empty-information-title" className={styles.sectionTitle}>Сведений о храме пока мало</h2>
            <p>Основной адрес уже доступен. Описание, контакты и языки богослужений появятся после обновления страницы.</p>
          </section>
          {/* No active rides in this group, so there is no map-entry action at all. */}
          <section className={`${styles.stressSection} ${styles.emptyState}`} aria-labelledby="empty-transport-title" data-empty-transport>
            <h2 id="empty-transport-title" className={styles.sectionTitle}>Поездок пока нет</h2>
            <p>Здесь появятся предложения водителей и просьбы пассажиров, которые собираются в этот храм.</p>
          </section>
          <p className={styles.scheduleNote}>Уже договорились: 0 впереди · 0 за последние 30 дней.</p>
        </div>
      </main>
    </ResponsiveFrame>
  );
}

export function DesignPreview() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>('mobile-directory');
  /** Shared so entering the map from a board carries the filter, and returning preserves it. */
  const [filter, setFilter] = useState<Filter>('Все');
  const selected = screens.find((screen) => screen.id === activeScreen)!;

  function screen() {
    switch (activeScreen) {
      case 'mobile-directory': return <MobileDirectory />;
      case 'mobile-church-header': return <MobileChurchHeader />;
      case 'mobile-board': return <MobileBoard filter={filter} onFilterChange={setFilter} onOpenMap={() => setActiveScreen('mobile-ride-map')} />;
      case 'mobile-ride-map': return <MobileRideMap filter={filter} onFilterChange={setFilter} onBack={() => setActiveScreen('mobile-board')} />;
      case 'mobile-passenger-form': return <MobilePassengerForm />;
      case 'desktop-directory': return <DesktopDirectory />;
      case 'desktop-church-board': return <DesktopChurchBoard onOpenMap={() => setActiveScreen('desktop-ride-map')} />;
      case 'desktop-ride-map': return <DesktopRideMap filter={filter} onFilterChange={setFilter} onBack={() => setActiveScreen('desktop-church-board')} />;
      case 'desktop-trips': return <DesktopTrips />;
      case 'responsive-full-church': return <FullDensityChurchPage filter={filter} onFilterChange={setFilter} onOpenMap={() => setActiveScreen('desktop-ride-map')} />;
      case 'responsive-catalog': return <ResponsiveCatalog />;
      case 'responsive-empty-church': return <EmptyChurchPage />;
    }
  }

  return (
    <main className={styles.previewRoot}>
      <header className={styles.previewHeader}>
        <p>Reference artifact · Design System V2</p>
        <h1>Контрольные экраны Orthodox Routes</h1>
        <p>12 контрольных экранов Design System V2. Производственный интерфейс не изменён.</p>
      </header>
      <nav className={styles.screenSelector} aria-label="Выбор контрольного экрана">
        {screens.map((item) => <button type="button" key={item.id} onClick={() => setActiveScreen(item.id)} aria-pressed={activeScreen === item.id}>{item.label}</button>)}
      </nav>
      <section className={styles.previewStage} data-screen-id={activeScreen} data-screen-kind={selected.kind} aria-live="polite">
        {screen()}
      </section>
    </main>
  );
}
