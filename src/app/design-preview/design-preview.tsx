'use client';

import { useState } from 'react';
import { ChurchPlaceholder } from './church-placeholder';
import styles from './design-preview.module.css';

type ScreenId =
  | 'mobile-directory'
  | 'mobile-church-header'
  | 'mobile-board'
  | 'mobile-passenger-form'
  | 'desktop-directory'
  | 'desktop-church-board'
  | 'desktop-trips'
  | 'responsive-full-church'
  | 'responsive-catalog'
  | 'responsive-empty-church';

const screens: ReadonlyArray<{ id: ScreenId; label: string; kind: 'mobile' | 'desktop' | 'responsive' }> = [
  { id: 'mobile-directory', label: 'Мобильный каталог', kind: 'mobile' },
  { id: 'mobile-church-header', label: 'Мобильная шапка храма', kind: 'mobile' },
  { id: 'mobile-board', label: 'Мобильная транспортная доска', kind: 'mobile' },
  { id: 'mobile-passenger-form', label: 'Мобильная форма просьбы', kind: 'mobile' },
  { id: 'desktop-directory', label: 'Каталог на компьютере', kind: 'desktop' },
  { id: 'desktop-church-board', label: 'Храм и доска на компьютере', kind: 'desktop' },
  { id: 'desktop-trips', label: 'Мои поездки на компьютере', kind: 'desktop' },
  { id: 'responsive-full-church', label: 'Полная страница храма', kind: 'responsive' },
  { id: 'responsive-catalog', label: 'Каталог из 12 храмов', kind: 'responsive' },
  { id: 'responsive-empty-church', label: 'Пустая страница храма', kind: 'responsive' },
];

type IconName = 'back' | 'bell' | 'car' | 'chevron-down' | 'expand' | 'filter' | 'mail' | 'map' | 'phone' | 'pin' | 'profile' | 'save' | 'search' | 'share';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    back: <path d="M15 5l-7 7 7 7" />,
    bell: <><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
    car: <><path d="M4 15h16M5.5 15l1.6-5a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.6 5" /><path d="M4 15v3h3v-3M17 15v3h3v-3" /></>,
    'chevron-down': <path d="m7 9.5 5 5 5-5" />,
    expand: <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />,
    filter: <><path d="M4 7h11M19 7h1M4 17h6M14 17h6" /><circle cx="17" cy="7" r="2" /><circle cx="12" cy="17" r="2" /></>,
    mail: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
    map: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    phone: <path d="M6.4 4h2.8l1.4 4-2 1.5a11 11 0 0 0 5.9 5.9l1.5-2 4 1.4v2.8a2.4 2.4 0 0 1-2.6 2.4A14.4 14.4 0 0 1 4 6.6 2.4 2.4 0 0 1 6.4 4Z" />,
    pin: <><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
    profile: <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></>,
    save: <path d="M6 4h12v16l-6-4-6 4Z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    share: <><circle cx="17" cy="6" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="m8.3 10.8 6.4-3.5M8.3 13.2l6.4 3.5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon} data-icon={name}>{paths[name]}</svg>;
}

function IconButton({ label, icon, className = '' }: { label: string; icon: IconName; className?: string }) {
  return <button type="button" className={`${styles.iconButton} ${className}`} aria-label={label} data-icon-only><Icon name={icon} /></button>;
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

const rides = [
  { type: 'Есть места', title: 'вс, 10 авг · 08:00 · 3 места', detail: 'Из Catanzaro Lido · с детьми · обратно', action: 'Попросить подвезти' },
  { type: 'Ищут место', title: 'вс, 10 авг · утро · 2 человека', detail: 'Из Matera · нужна поездка обратно', action: 'Предложить подвезти' },
  { type: 'Есть места', title: 'вс, 10 авг · 07:40 · 1 место', detail: 'Из Siano · только туда', action: 'Попросить подвезти' },
  { type: 'Ищут место', title: 'вс, 10 авг · 08:15 · 1 человек', detail: 'Из Catanzaro, центр · только туда', action: 'Предложить подвезти' },
] as const;

function RideCard({ ride, showType = true }: { ride: (typeof rides)[number]; showType?: boolean }) {
  return (
    <article className={styles.card} data-ride-type={ride.type}>
      {showType && <span className={styles.typeTag}>{ride.type}</span>}
      <h3 className={styles.cardTitle}>{ride.title}</h3>
      <p className={styles.secondary}>{ride.detail}</p>
      <div className={styles.cardAction}><button type="button" className={styles.secondaryButton}>{ride.action}</button></div>
    </article>
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

function MobileBoard() {
  return (
    <MobileFrame label="Мобильная транспортная доска">
      <main className={styles.mobileContent}>
        <h1 className={styles.pageTitle}>Поездки</h1><p className={styles.secondary}>На литургию 10 августа</p>
        <div className={styles.chips} aria-label="Тип объявления"><button type="button" className={styles.selectedChip}>Все</button><button type="button">Есть места</button><button type="button">Ищут место</button></div>
        <div className={styles.cardList}>{rides.slice(0, 3).map((ride) => <RideCard key={ride.title} ride={ride} />)}</div>
        <p className={styles.agreementCount}>Уже договорились: 8 впереди · 27 за 30 дней</p>
      </main>
      <MobileNavigation />
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

function DesktopRideColumns() {
  return (
    <section className={styles.desktopBoard} aria-labelledby="desktop-board-title">
      <h2 id="desktop-board-title" className={styles.sectionTitle}>Поездки на литургию 10 августа</h2>
      <div className={styles.rideColumns}>
        <section aria-labelledby="offers-column"><h3 id="offers-column" className={styles.micro}>Есть места · 2</h3>{rides.filter((ride) => ride.type === 'Есть места').map((ride) => <RideCard key={ride.title} ride={ride} showType={false} />)}</section>
        <section aria-labelledby="requests-column"><h3 id="requests-column" className={styles.micro}>Ищут место · 2</h3>{rides.filter((ride) => ride.type === 'Ищут место').map((ride) => <RideCard key={ride.title} ride={ride} showType={false} />)}</section>
      </div>
    </section>
  );
}

function DesktopChurchBoard() {
  return (
    <DesktopFrame label="Страница храма и транспортная доска на компьютере">
      <main className={styles.churchDesktopGrid}>
        <div><button type="button" className={styles.quietButton}>← Все храмы</button><ChurchPlaceholder churchId="pokrov-catanzaro" className={styles.desktopPlaceholder} /><h1 className={styles.pageTitle}>Покров Пресвятой Богородицы</h1><AddressRow /><div className={styles.nextService}><span>Ближайшая служба</span><strong>Литургия · воскресенье, 9 августа, 9:00</strong><em>через 2 дня</em></div><Services /><DesktopRideColumns /></div>
        <aside className={styles.stickyActions}><div className={styles.card}><ChurchActions /><p className={styles.secondary}>Уже договорились: 8 впереди · 27 за 30 дней</p></div><p className={styles.scheduleNote}>Расписание обновлено 2 августа. Перед поездкой уточните время у храма.</p><button type="button" className={styles.quietButton}>Сообщить об ошибке</button><button type="button" className={styles.quietButton}>Поддержать проект</button></aside>
      </main>
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

function FullTransportBoard() {
  return (
    <section className={`${styles.stressSection} ${styles.stressBoard}`} aria-labelledby="full-transport-board" data-stress-transport-board>
      <h2 id="full-transport-board" className={styles.sectionTitle}>Поездки на литургию 10 августа</h2>
      <p className={styles.secondary}>Предложения водителей и просьбы пассажиров этого храма</p>
      <div className={styles.chips} aria-label="Тип объявления на полной странице"><button type="button" className={styles.selectedChip}>Все</button><button type="button">Есть места</button><button type="button">Ищут место</button></div>
      <div className={styles.rideColumns}>
        <section aria-labelledby="full-offers-column"><h3 id="full-offers-column" className={styles.micro}>Есть места · 2</h3>{rides.filter((ride) => ride.type === 'Есть места').map((ride) => <RideCard key={ride.title} ride={ride} />)}</section>
        <section aria-labelledby="full-requests-column"><h3 id="full-requests-column" className={styles.micro}>Ищут место · 2</h3>{rides.filter((ride) => ride.type === 'Ищут место').map((ride) => <RideCard key={ride.title} ride={ride} />)}</section>
      </div>
      <p className={styles.agreementCount}>Уже договорились: 8 впереди · 27 за последние 30 дней</p>
    </section>
  );
}

function FullDensityChurchPage() {
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
          <FullTransportBoard />
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

const components: Record<ScreenId, React.ComponentType> = {
  'mobile-directory': MobileDirectory,
  'mobile-church-header': MobileChurchHeader,
  'mobile-board': MobileBoard,
  'mobile-passenger-form': MobilePassengerForm,
  'desktop-directory': DesktopDirectory,
  'desktop-church-board': DesktopChurchBoard,
  'desktop-trips': DesktopTrips,
  'responsive-full-church': FullDensityChurchPage,
  'responsive-catalog': ResponsiveCatalog,
  'responsive-empty-church': EmptyChurchPage,
};

export function DesignPreview() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>('mobile-directory');
  const ActiveScreen = components[activeScreen];
  const selected = screens.find((screen) => screen.id === activeScreen)!;

  return (
    <main className={styles.previewRoot}>
      <header className={styles.previewHeader}>
        <p>Reference artifact · Design System V2</p>
        <h1>Контрольные экраны Orthodox Routes</h1>
        <p>10 контрольных экранов Design System V2. Производственный интерфейс не изменён.</p>
      </header>
      <nav className={styles.screenSelector} aria-label="Выбор контрольного экрана">
        {screens.map((screen) => <button type="button" key={screen.id} onClick={() => setActiveScreen(screen.id)} aria-pressed={activeScreen === screen.id}>{screen.label}</button>)}
      </nav>
      <section className={styles.previewStage} data-screen-id={activeScreen} data-screen-kind={selected.kind} aria-live="polite">
        <ActiveScreen />
      </section>
    </main>
  );
}
