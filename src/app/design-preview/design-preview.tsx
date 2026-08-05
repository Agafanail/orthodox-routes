'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import styles from './design-preview.module.css';

type ScreenId = 'mobile-directory' | 'mobile-church' | 'mobile-form' | 'desktop-directory' | 'desktop-church' | 'desktop-trips';
type IconName = 'arrow' | 'bell' | 'calendar' | 'car' | 'check' | 'chevron' | 'church' | 'clock' | 'filter' | 'globe' | 'location' | 'mail' | 'minus' | 'people' | 'person' | 'phone' | 'plus' | 'search' | 'share' | 'shield' | 'star' | 'wheel';

const screens: Array<{ id: ScreenId; label: string; short: string; kind: 'mobile' | 'desktop' }> = [
  { id: 'mobile-directory', label: 'Мобильный каталог храмов и карта', short: 'Мобильный каталог', kind: 'mobile' },
  { id: 'mobile-church', label: 'Мобильная страница храма и транспортная доска', short: 'Мобильная страница храма', kind: 'mobile' },
  { id: 'mobile-form', label: 'Мобильная форма просьбы, шаг 2', short: 'Мобильная форма просьбы', kind: 'mobile' },
  { id: 'desktop-directory', label: 'Каталог храмов и карта на компьютере', short: 'Каталог на компьютере', kind: 'desktop' },
  { id: 'desktop-church', label: 'Страница храма и транспортная доска на компьютере', short: 'Страница храма на компьютере', kind: 'desktop' },
  { id: 'desktop-trips', label: 'Мои поездки на компьютере', short: 'Мои поездки на компьютере', kind: 'desktop' },
];

const churchImage = '/images/church-fallback.png';

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    car: <><path d="M5 11 6.5 7h11l1.5 4"/><path d="M4 11h16a2 2 0 0 1 2 2v5H2v-5a2 2 0 0 1 2-2Z"/><path d="M6 18v2M18 18v2M6.5 15h1M16.5 15h1"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    church: <><path d="M12 2v4M10 4h4M7 21V11h10v10M4 21h16M9 11a3 3 0 0 1 6 0M10 21v-5h4v5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    filter: <><path d="M4 6h5M13 6h7M4 12h9M17 12h3M4 18h3M11 18h9"/><circle cx="11" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    minus: <path d="M5 12h14"/>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.98.72 2.92a2 2 0 0 1-.45 2.11L8.1 10.03a16 16 0 0 0 5.87 5.87l1.28-1.28a2 2 0 0 1 2.11-.45c.94.35 1.92.59 2.92.72A2 2 0 0 1 22 16.92Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    share: <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>,
    wheel: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M4.2 9h5.1M19.8 9h-5.1M7 19l3.5-4.5M17 19l-3.5-4.5"/></>,
  };
  return <svg aria-hidden="true" className={styles.icon} data-icon={name} fill="none" height={size} viewBox="0 0 24 24" width={size}>{paths[name]}</svg>;
}

function IconButton({ label, icon }: { label: string; icon: IconName }) {
  return <button aria-label={label} className={styles.iconButton} data-icon-only type="button"><Icon name={icon}/></button>;
}

function Brand() {
  return <div className={styles.brand}><span className={styles.brandMark}><Icon name="church"/></span><span>Orthodox Routes</span></div>;
}

function DesktopHeader({ active }: { active: 'churches' | 'trips' }) {
  return <header className={styles.desktopHeader}>
    <Brand/>
    <nav aria-label="Основная навигация" className={styles.desktopNav}>
      {['Храмы', 'Мои поездки', 'Поддержать'].map((item) => <a aria-current={(active === 'churches' && item === 'Храмы') || (active === 'trips' && item === 'Мои поездки') ? 'page' : undefined} href={`#${item}`} key={item}>{item}</a>)}
    </nav>
    <div className={styles.headerControls}><button className={styles.languageButton} type="button">RU <Icon name="chevron" size={16}/></button><IconButton icon="bell" label="Уведомления"/><IconButton icon="person" label="Профиль"/></div>
  </header>;
}

function MobileNavigation() {
  return <nav aria-label="Мобильная навигация" className={styles.mobileNav}>
    <a aria-current="page" href="#churches"><Icon name="church"/><span>Храмы</span></a>
    <a href="#trips"><Icon name="car"/><span>Поездки</span></a>
    <a href="#notifications"><Icon name="bell"/><span>Уведомления</span></a>
  </nav>;
}

function MapPin({ className = '', selected = false }: { className?: string; selected?: boolean }) {
  return <span className={`${styles.mapMarker} ${className} ${selected ? styles.selectedMarker : ''}`}>
    <svg aria-hidden="true" viewBox="0 0 32 44">
      <path className={styles.markerShape} d="M16 1.5C8.27 1.5 2 7.77 2 15.5C2 25.73 16 42 16 42S30 25.73 30 15.5C30 7.77 23.73 1.5 16 1.5Z" vectorEffect="non-scaling-stroke"/>
      <circle className={styles.markerDot} cx="16" cy="15.5" r="4.5"/>
    </svg>
    {selected ? <span className={styles.srOnly}>Выбранный объект</span> : null}
  </span>;
}

function MapArtwork({ compact = false, selectedLabel = 'Покров Пресвятой Богородицы' }: { compact?: boolean; selectedLabel?: string }) {
  return <div aria-label={`Схематичная карта. Выбрано: ${selectedLabel}. Текстовые сведения приведены рядом с картой.`} className={`${styles.map} ${compact ? styles.mapCompact : ''}`} role="img">
    <svg aria-hidden="true" className={styles.mapDrawing} preserveAspectRatio="none" viewBox="0 0 900 620">
      <rect fill="#f2f5ed" height="620" width="900"/>
      <path d="M670 0C610 120 720 210 650 325c-55 92-80 188-42 295H900V0Z" fill="#dcecf2"/>
      <g fill="none" stroke="#d3ddd1" strokeWidth="11"><path d="M-30 480C170 390 260 470 430 330S610 130 760 95"/><path d="M70 30c140 120 140 220 320 260s290 20 420 170"/><path d="M120 590c80-170 250-180 300-350S600 80 700 10"/></g>
      <g fill="none" stroke="#fff" strokeWidth="4"><path d="M-30 480C170 390 260 470 430 330S610 130 760 95"/><path d="M70 30c140 120 140 220 320 260s290 20 420 170"/><path d="M120 590c80-170 250-180 300-350S600 80 700 10"/></g>
      <g fill="#667069" fontFamily="system-ui" fontSize="22"><text x="350" y="310">Catanzaro</text><text x="565" y="505">Catanzaro Lido</text><text x="160" y="420">Mater Domini</text><text x="500" y="130">Siano</text></g>
    </svg>
    {compact ? <span className={styles.radius}/>: null}
    <MapPin className={styles.markerOne}/>
    {!compact ? <><MapPin className={styles.markerTwo}/><MapPin className={styles.markerThree}/></> : null}
    <MapPin selected/>
  </div>;
}

const churches = [
  { name: 'Покров Пресвятой Богородицы', city: 'Catanzaro', service: 'Ближайшая служба: вс, 9:00', counts: '3 предложения · 2 просьбы' },
  { name: 'Свято-Никольский храм', city: 'Vibo Valentia', service: 'Ближайшая служба: вс, 10:30', counts: '2 предложения · 1 просьба' },
  { name: 'Храм Рождества Христова', city: 'Reggio Calabria', service: 'Ближайшая служба: чт, 18:00', counts: '1 предложение · просьб пока нет' },
];

function ChurchCard({ church, selected, onSelect, desktop = false }: { church: typeof churches[number]; selected: boolean; onSelect: () => void; desktop?: boolean }) {
  return <button aria-pressed={selected} className={`${styles.churchCard} ${selected ? styles.selectedCard : ''} ${desktop ? styles.desktopChurchCard : ''}`} data-church-card onClick={onSelect} type="button">
    <span className={styles.churchThumb}><Image alt="" fill sizes={desktop ? '140px' : '110px'} src={churchImage}/></span>
    <span className={styles.churchCardText}><strong>{church.name}</strong><span><Icon name="location" size={17}/>{church.city}{desktop ? ', Italy' : ''}</span><span><Icon name="clock" size={17}/>{church.service}</span>{selected || desktop ? <span className={styles.counts}><Icon name="car" size={17}/>{church.counts}</span> : null}</span>
    {selected ? <span className={styles.srOnly}>Выбран</span> : null}
  </button>;
}

function ChurchActions() {
  return <div className={styles.churchActions}><button className={`${styles.churchAction} ${styles.churchActionPrimary}`} data-variant="primary" type="button"><Icon name="car"/>Нужна поездка</button><button className={`${styles.churchAction} ${styles.churchActionSecondary}`} data-variant="secondary" type="button"><Icon name="wheel"/>Могу подвезти</button></div>;
}

function Services() {
  return <section aria-labelledby="services-title" className={styles.sectionBlock}><h2 id="services-title"><Icon name="calendar"/>Ближайшие службы</h2><div className={styles.serviceRows}>
    <div className={styles.serviceRow}><time dateTime="2026-08-09"><b>09</b><span>авг.</span></time><span><strong>Литургия</strong><small>воскресенье, 9:00</small></span><em>Через 2 дня</em></div>
    <div className={styles.serviceRow}><time dateTime="2026-08-15"><b>15</b><span>авг.</span></time><span><strong>Всенощное бдение</strong><small>пятница, 18:00</small></span><em>Через 8 дней</em></div>
  </div></section>;
}

function RideBoard() {
  const [filter, setFilter] = useState('Все');
  return <section aria-labelledby="rides-title" className={styles.sectionBlock}><h2 id="rides-title"><Icon name="car"/>Поездки</h2><div aria-label="Фильтр поездок" className={styles.chips} role="group">{['Все', 'Есть места', 'Ищут место'].map((label) => <button aria-pressed={filter === label} key={label} onClick={() => setFilter(label)} type="button">{label}</button>)}</div><div className={styles.rideList}>
    <article className={`${styles.rideCard} ${styles.driverRide}`} data-ride-type="driver-offer"><span className={styles.rideIcon}><Icon name="car"/></span><div><span className={styles.rideType}>Предлагают места</span><h3>Из Catanzaro Lido</h3><p>вс, 10 авг. · 08:00</p><p>3 места · С детьми · Обратно</p></div><button type="button">Попросить подвезти</button></article>
    <article className={`${styles.rideCard} ${styles.passengerRide}`} data-ride-type="passenger-request"><span className={styles.rideIcon}><Icon name="person"/></span><div><span className={styles.rideType}>Ищут места</span><h3>Из Matera</h3><p>вс, 10 авг. · утро</p><p>2 человека · Нужна поездка обратно</p></div><button type="button">Предложить подвезти</button></article>
  </div></section>;
}

function AgreementSummary() { return <p className={styles.agreementSummary}><Icon name="people"/>Уже договорились: 8 впереди · 27 за 30 дней</p>; }

function MobileDirectory() {
  const [selected, setSelected] = useState(0);
  return <div className={styles.mobileScreen}><main className={styles.mobileDirectoryMain}>
    <div className={styles.directoryMap}><MapArtwork selectedLabel={churches[selected].name}/><div className={styles.mobileSearch}><label><span className={styles.srOnly}>Найти храм</span><Icon name="search"/><input placeholder="Найти храм" type="search"/></label><IconButton icon="filter" label="Открыть фильтры"/></div><div className={styles.mobileFilters}><button type="button"><Icon name="globe"/>Италия<Icon name="chevron" size={17}/></button><button type="button"><Icon name="location"/>Рядом со мной</button></div></div>
    <section aria-labelledby="mobile-churches-title" className={styles.bottomSheet}><span aria-hidden="true" className={styles.sheetHandle}/><h1 id="mobile-churches-title">Храмы</h1><p>6 храмов рядом</p><div className={styles.churchCards}>{churches.map((church, index) => <ChurchCard church={church} key={church.name} onSelect={() => setSelected(index)} selected={selected === index}/>)}</div></section>
  </main><MobileNavigation/></div>;
}

function ChurchHero({ mobile = false }: { mobile?: boolean }) {
  return <div className={`${styles.hero} ${mobile ? styles.mobileHero : ''}`}><Image alt="Православный храм среди кипарисов" fill priority sizes={mobile ? '430px' : '900px'} src={churchImage}/>{mobile ? <div className={styles.heroControls}><IconButton icon="arrow" label="Назад"/><span/><IconButton icon="share" label="Поделиться"/><IconButton icon="star" label="Сохранить храм"/></div> : null}</div>;
}

function ChurchIdentity() { return <><h1>Покров Пресвятой Богородицы</h1><p className={styles.locationLine}><Icon name="location"/>Catanzaro, Italy</p><p className={styles.address}>Via XX Settembre, 45, 88100 Catanzaro CZ, Italy</p><p className={styles.nextService}><Icon name="clock"/>Ближайшая служба: воскресенье, 9:00</p><ChurchActions/></>; }

function MobileChurch() { return <div className={styles.mobileScreen}><main className={styles.mobileChurchMain}><ChurchHero mobile/><div className={styles.mobileContentSheet}><ChurchIdentity/><Services/><RideBoard/><AgreementSummary/></div></main><MobileNavigation/></div>; }

function MobileForm() { return <div className={`${styles.mobileScreen} ${styles.formScreen}`}><main className={styles.formMain}>
  <header className={styles.formHeader}><IconButton icon="arrow" label="Назад к предыдущему шагу"/><h1>Новая просьба</h1></header><p className={styles.progressText}><strong>Шаг 2</strong> из 6</p><div aria-label="Выполнено два шага из шести" className={styles.progress}><span/><span/><i/><i/><i/><i/></div>
  <h2>Где вас забрать?</h2><MapArtwork compact selectedLabel="Примерная область вокруг Catanzaro Lido"/>
  <section className={styles.placeCard}><span><Icon name="location"/></span><div><small>Основное место встречи</small><strong>Catanzaro Lido</strong></div><button className={styles.outlineSmall} type="button">Изменить</button></section>
  <p className={styles.formHint}>Можно добавить ещё до двух вариантов</p><button className={styles.addPlace} type="button"><Icon name="plus"/>Добавить ещё место</button><button className={styles.addPlace} type="button"><Icon name="plus"/>Добавить ещё место</button><p className={styles.privacyNote}><Icon name="shield"/>Публично будет видна примерная область радиусом 1 км</p>
  </main><footer className={styles.stickyActions}><button className={styles.outlineButton} type="button">Назад</button><button className={styles.primaryButton} type="button">Далее</button></footer></div>; }

function DesktopDirectory() {
  const [selected, setSelected] = useState(0);
  return <div className={styles.desktopScreen}><DesktopHeader active="churches"/><main className={styles.desktopDirectoryMain}><section aria-labelledby="desktop-churches-title" className={styles.directoryPanel}><label className={styles.desktopSearch}><span className={styles.srOnly}>Найти храм</span><Icon name="search"/><input placeholder="Найти храм" type="search"/></label><div className={styles.desktopFilters}><button type="button"><Icon name="globe"/>Италия<Icon name="chevron" size={17}/></button><button type="button"><Icon name="location"/>Catanzaro<Icon name="chevron" size={17}/></button></div><h1 id="desktop-churches-title">Храмы рядом</h1><p>Найдено 24 храма</p><div className={styles.churchCards}>{churches.map((church,index) => <ChurchCard church={church} desktop key={church.name} onSelect={() => setSelected(index)} selected={selected === index}/>)}</div></section><section aria-label="Карта храмов" className={styles.desktopMapPanel}><MapArtwork selectedLabel={churches[selected].name}/><article className={styles.mapCallout}><span className={styles.churchThumb}><Image alt="" fill sizes="110px" src={churchImage}/></span><div><strong>{churches[selected].name}</strong><span><Icon name="location" size={16}/>{churches[selected].city}, Italy</span><span><Icon name="clock" size={16}/>{churches[selected].service}</span><span className={styles.counts}><Icon name="car" size={16}/>{churches[selected].counts}</span></div></article><div className={styles.mapControls}><IconButton icon="plus" label="Увеличить карту"/><IconButton icon="minus" label="Уменьшить карту"/><IconButton icon="location" label="Показать моё местоположение"/></div></section></main></div>;
}

function DesktopChurch() { return <div className={styles.desktopScreen}><DesktopHeader active="churches"/><main className={styles.desktopChurchMain}><section className={styles.desktopChurchContent}><ChurchHero/><div className={styles.desktopIdentity}><ChurchIdentity/></div><Services/><RideBoard/></section><aside className={styles.churchSidebar}><section aria-label="Карта храма" className={styles.churchMapCard}><MapArtwork compact selectedLabel="Покров Пресвятой Богородицы"/></section><AgreementSummary/></aside></main></div>; }

const tripRows = [
  { day: '10', month: 'авг.', title: 'Литургия · 9:00', status: 'Подтверждено', tone: 'confirmed' },
  { day: '15', month: 'авг.', title: 'Всенощное бдение · 18:00', status: 'Предстоит', tone: 'planned' },
  { day: '24', month: 'авг.', title: 'Литургия · 9:00', status: 'Ожидает ответа', tone: 'pending' },
  { day: '07', month: 'сент.', title: 'Литургия · 9:00', status: 'Завершено', tone: 'completed' },
] as const;

function DesktopTrips() { const [tab,setTab]=useState('Требуют ответа'); return <div className={styles.desktopScreen}><DesktopHeader active="trips"/><main className={styles.tripsMain}><section className={styles.tripListPanel}><h1>Мои поездки</h1><div aria-label="Разделы моих поездок" className={styles.tripTabs} role="tablist">{['Требуют ответа','Предстоящие','Объявления','История'].map((item)=><button aria-selected={tab===item} key={item} onClick={()=>setTab(item)} role="tab" type="button">{item}{item==='Требуют ответа'?<span>1</span>:null}</button>)}</div><div className={styles.tripRows}>{tripRows.map((row,index)=><button aria-pressed={index===0} key={row.day} type="button"><time dateTime={`2026-${row.month==='сент.'?'09':'08'}-${row.day}`}><b>{row.day}</b><span>{row.month}</span></time><span><strong>{row.title}</strong><small>Покров Пресвятой Богородицы</small><small><Icon name="location" size={16}/>Catanzaro, Italy</small></span><em className={`${styles.statusBadge} ${styles[`status${row.tone[0].toUpperCase()}${row.tone.slice(1)}`]}`} data-status-tone={row.tone}>{row.status}</em><Icon name="chevron"/></button>)}</div></section><section aria-labelledby="agreement-title" className={styles.agreementPanel}><div className={styles.agreementIntro}><span className={styles.churchThumb}><Image alt="" fill sizes="160px" src={churchImage}/></span><div><h2 id="agreement-title">Литургия · 10 авг., 9:00</h2><span className={`${styles.statusBadge} ${styles.statusConfirmed}`}>Подтверждено</span><p><Icon name="location"/>Покров Пресвятой Богородицы</p><p>Via XX Settembre, 45, 88100 Catanzaro CZ, Italy</p></div></div><dl className={styles.agreementDetails}><div><dt>Ваша роль</dt><dd>Пассажир</dd></div><div><dt>Место встречи</dt><dd>Catanzaro Lido, у входа в библиотеку · 08:00</dd></div><div><dt>Количество людей</dt><dd>2 человека</dd></div><div><dt>Поездка обратно</dt><dd>Обратно</dd></div><div><dt>Вы едете с</dt><dd>Алексей (пример)</dd></div></dl><div className={styles.contacts}><h3>Контакты · демонстрационные данные</h3><p><span><b>Алексей (водитель)</b><small>+39 000 000 00 00 · alexey@example.invalid</small></span><IconButton icon="phone" label="Позвонить Алексею"/><IconButton icon="mail" label="Написать Алексею по email"/></p></div><div className={styles.outcome}><span><b>Поездка состоялась?</b><small>Ответ поможет оценить работу сервиса</small></span><button type="button">Да</button><button type="button">Нет</button></div></section></main></div>; }

function StateGallery() { return <section aria-labelledby="states-title" className={styles.stateGallery}><div className={styles.galleryHeading}><p>Компоненты и состояния</p><h2 id="states-title">Системные ответы</h2><span>Компактные образцы, а не дополнительные страницы.</span></div><div className={styles.stateGrid}>
  <article aria-busy="true"><span className={styles.skeleton}/><span className={styles.skeletonShort}/><h3>Загрузка</h3><p>Содержимое появится без резкого изменения макета.</p></article>
  <article><Icon name="church"/><h3>Поездок пока нет</h3><p>У этого храма ещё нет активных просьб и предложений.</p><div className={styles.stateActions}><button type="button">Нужна поездка</button><button type="button">Могу подвезти</button></div></article>
  <article><Icon name="car"/><h3>У вас пока нет поездок</h3><p>Начните со страницы нужного храма.</p><button type="button">Найти храм</button></article>
  <article className={styles.errorState}><h3>Не удалось загрузить данные</h3><p>Попробуйте ещё раз или вернитесь к храмам.</p><button type="button">Попробовать ещё раз</button></article>
  <article><h3>Поездка больше недоступна</h3><p>Ссылка истекла. Старые места и сведения не показываются.</p><button type="button">Посмотреть актуальные поездки</button></article>
  <article><h3>Нет доступа</h3><p>Закрытые сведения доступны только участникам этой договорённости.</p><button type="button">Войти под другим аккаунтом</button></article>
  <article><label htmlFor="preview-location">Место встречи</label><input aria-describedby="preview-location-error" aria-invalid="true" id="preview-location"/><p className={styles.fieldError} id="preview-location-error">Выберите место встречи на карте.</p></article>
  <article className={styles.successState} role="status"><Icon name="check"/><h3>Просьба сохранена</h3><p>Теперь проверьте сведения перед публикацией.</p></article>
  <article><h3>Действие пока недоступно</h3><p id="disabled-reason">Сначала выберите службу или укажите дату и время.</p><button aria-describedby="disabled-reason" disabled type="button">Продолжить</button></article>
  </div></section>; }

function SelectedScreen({ id }: { id: ScreenId }) { switch(id){case 'mobile-directory':return <MobileDirectory/>;case 'mobile-church':return <MobileChurch/>;case 'mobile-form':return <MobileForm/>;case 'desktop-directory':return <DesktopDirectory/>;case 'desktop-church':return <DesktopChurch/>;case 'desktop-trips':return <DesktopTrips/>;} }

export function DesignPreview() {
  const [screen, setScreen] = useState<ScreenId>('mobile-directory');
  const current = screens.find((item)=>item.id===screen) ?? screens[0];
  return <div className={styles.previewRoot}><header className={styles.previewHeader}><div><span>Development preview · Initial Design System V1</span><h1>Контрольные экраны Orthodox Routes</h1><p>Изолированная визуальная проверка. Это не действующее приложение и не интерактивная карта.</p></div></header><nav aria-label="Экранные образцы" className={styles.screenSelector}>{screens.map((item)=><button aria-label={item.short} aria-pressed={screen===item.id} key={item.id} onClick={()=>setScreen(item.id)} type="button"><span>{item.kind === 'mobile' ? 'Mobile' : 'Desktop'}</span>{item.short}</button>)}</nav><section aria-label={current.label} className={`${styles.previewStage} ${current.kind==='mobile'?styles.mobileStage:styles.desktopStage}`}><SelectedScreen id={screen}/></section><StateGallery/></div>;
}
