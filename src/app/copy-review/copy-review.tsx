'use client';

import { useState, useSyncExternalStore } from 'react';
import { ChurchPlaceholder } from '../design-preview/church-placeholder';
import styles from './copy-review.module.css';

/**
 * Temporary isolated surface for the manual Russian copy review. Group 1 covers the church catalog,
 * church page, transport board and the empty church state. Group 2 covers the passenger request form
 * after the owner decision of 22 August 2026 (Foundation 1.9, IA §10.1): four semantic screens —
 * when, where to pick up, who is travelling, and the final details. Group 2A (the first three
 * semantic screens) was approved on 24 August 2026; group 2B — the fourth screen «Последние детали»,
 * the final layout of «Где вас забрать?» and the corrections made on the assembled form — was
 * approved on 26 August 2026.
 *
 * Group 3 covers the driver offer «Могу подвезти». After the owner decisions of 27 and 28 August
 * 2026 it is four semantic screens — when, where from, the details of the trip, and a review that
 * only shows — replacing the eleven steps the first assembly reproduced from IA §11.1. No driver
 * string is approved yet.
 *
 * The request states are not ten steps: they are entry points into **one** interactive form that
 * keeps its own answers in memory, so the owner can walk the real path — forward, back, edit an
 * earlier answer — instead of reading ten static pictures. There is no persistence, no backend and
 * no maps provider behind it.
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
  | 'request-when-custom'
  | 'request-place-empty'
  | 'request-map'
  | 'request-place'
  | 'request-place-three'
  | 'request-people'
  | 'request-people-children'
  | 'request-final'
  | 'request-final-filled'
  | 'offer-when'
  | 'offer-when-custom'
  | 'offer-when-recurring'
  | 'offer-where-empty'
  | 'offer-where'
  | 'offer-seats'
  | 'offer-seats-children'
  | 'offer-final'
  | 'offer-final-filled'
  | 'offer-final-recurring';

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

type Sample = {
  id: SampleId;
  /**
   * `church` — group 1; `request` — an entry point into the one interactive passenger form;
   * `offer` — an entry point into the one interactive driver form (group 3, not yet reviewed).
   */
  group: 'church' | 'request' | 'offer';
  label: string;
  title: string;
  description: string;
};

const samples: ReadonlyArray<Sample> = [
  {
    id: 'catalog',
    group: 'church',
    label: '1 · Каталог храмов',
    title: 'Каталог храмов, заполненное состояние',
    description:
      'Один общий поиск по храму, городу и стране, «Рядом со мной», карта-полоса и список без изображений. Отдельных фильтров страны и населённого пункта больше нет. Поиск на этом экране работает.',
  },
  {
    id: 'church',
    group: 'church',
    label: '2 · Страница храма',
    title: 'Страница храма: сведения и расписание',
    description:
      'Название, адрес-строка без видимой подписи действия, свёрнутый блок «О храме», одно хронологическое расписание из трёх ближайших служб с раскрытием остальных, предупреждение и два главных действия.',
  },
  {
    id: 'board',
    group: 'church',
    label: '3 · Поездки храма',
    title: 'Транспортная доска того же храма',
    description:
      'Нижняя часть той же страницы храма: фильтры «Все / Водители / Пассажиры», метки карточек «Водитель» и «Пассажир» в собственных тихих цветах роли, один поток карточек одной службы. Фильтры на этом экране работают.',
  },
  {
    id: 'empty-church',
    group: 'church',
    label: '4 · Пустой храм',
    title: 'Храм без фотографии, расписания и поездок',
    description:
      'Тот же порядок блоков, что и на заполненной странице: заглушка, название, адрес, «О храме», пустое расписание, главные действия, пустая доска поездок.',
  },
  {
    id: 'request-when',
    group: 'request',
    label: '5 · Когда: выбрана служба',
    title: 'Экран 1 «Когда вам нужна поездка?»: выбрана служба',
    description:
      'Первый из четырёх смысловых экранов формы. Служба и собственные дата со временем — два способа ответить на один вопрос, поэтому они стоят рядом в одном списке выбора. Отсюда можно пройти всю форму до конца: «Далее» ведёт вперёд, «Назад» возвращает, ответы сохраняются.',
  },
  {
    id: 'request-when-custom',
    group: 'request',
    label: '6 · Когда: свои дата и время',
    title: 'Экран 1 «Когда вам нужна поездка?»: собственные дата и время',
    description:
      'Тот же экран и тот же список: собственные дата и время — не отдельный шаг, а второй способ ответить на тот же вопрос. Поле «Хочу приехать к» раскрывается на месте, под выбранным вариантом. Выбранное время попадает в резюме на последнем экране.',
  },
  {
    id: 'request-place-empty',
    group: 'request',
    label: '7 · Где забрать: место не выбрано',
    title: 'Экран 2 «Где вас забрать?»: место ещё не выбрано',
    description:
      'Один смысловой экран, карта на нём видна всегда. Отдельных экранов «пусто → карта → выбранное место» больше нет: человек сразу видит карту, отмеченный адрес и способ сохранить его. Одно место обязательно, поэтому «Далее» здесь ещё нет, а «Добавить место» — единственное главное действие. Объяснение публичности сказано один раз, до выбора.',
  },
  {
    id: 'request-map',
    group: 'request',
    label: '8 · Где забрать: изменение места',
    title: 'Экран 2 «Где вас забрать?»: сохранённое место меняется на карте',
    description:
      'Тот же экран после нажатия «Изменить это место»: карточка подсвечена, маркер стоит на новом адресе, а действие под картой называется «Подтвердить место». Это состояние того же экрана, а не отдельный шаг — никуда не переходят и ниоткуда не возвращаются. Отдельного поля «Как назвать это место» нет: ориентир пишется в обычном примечании на последнем экране.',
  },
  {
    id: 'request-place',
    group: 'request',
    label: '9 · Где забрать: одно место',
    title: 'Экран 2 «Где вас забрать?»: одно место сохранено',
    description:
      'Тот же экран с одним сохранённым местом. Адрес показан один раз, рядом «Изменить это место»; маркер уже стоит на следующем свободном адресе, чтобы можно было сразу добавить второй вариант. Карта, отмеченный адрес и список мест видны одновременно.',
  },
  {
    id: 'request-place-three',
    group: 'request',
    label: '10 · Где забрать: три места',
    title: 'Экран 2 «Где вас забрать?»: три альтернативных места',
    description:
      'Предел из трёх мест. До трёх мест — альтернативы, а не остановки по пути: об этом говорят подписи «Ещё одно место встречи» и слово «или» между карточками. Вместо неактивной кнопки стоит одна короткая причина, почему больше добавить нельзя, — второго объясняющего текста рядом нет. Удаление здесь работает.',
  },
  {
    id: 'request-people',
    group: 'request',
    label: '11 · Сколько вас: без детей',
    title: 'Экран 3 «Сколько вас будет?»: только взрослые',
    description:
      'Общее число пассажиров, число детей и детское кресло — один вопрос на одном экране. Детей нет, поэтому вопроса о кресле на экране тоже нет: его незачем задавать (IA §47.6).',
  },
  {
    id: 'request-people-children',
    group: 'request',
    label: '12 · Сколько вас: дети и кресло',
    title: 'Экран 3 «Сколько вас будет?»: дети и детское кресло',
    description:
      'Тот же экран, когда в группе есть дети: появляется вопрос о детском кресле и объяснение, кто за него отвечает (IA §2.3). Счётчики связаны — детей не может быть больше, чем пассажиров всего. Отсюда обе величины уходят в резюме последнего экрана.',
  },
  {
    id: 'request-final',
    group: 'request',
    label: '13 · Последние детали',
    title: 'Экран 4 «Последние детали»: обычное начало',
    description:
      'Четвёртый смысловой экран: обратная поездка, необязательное примечание, компактное резюме и «Опубликовать». Резюме — несколько строк рядом с кнопкой, а не отдельный экран проверки: заголовков «Проверьте просьбу» и «Что увидят все» здесь нет и не будет. Строки этого экрана — «Проект»: они ждут просмотра.',
  },
  {
    id: 'request-final-filled',
    group: 'request',
    label: '14 · Последние детали: заполнено',
    title: 'Экран 4 «Последние детали»: заполненная форма',
    description:
      'Тот же экран, когда форма пройдена целиком: нужна поездка обратно, в примечании написан ориентир «у входа в библиотеку» — именно для него отдельного поля названия места не делается, — а в резюме собраны время, два места, число пассажиров с детьми и потребность в кресле. Тихое «Изменить» возвращает к нужному экрану, ответы сохраняются. Вход и проверка контактов остаются условием публикации и в эту подгруппу не входят: кнопка здесь ничего не публикует.',
  },


  /*
   * Group 3: the driver offer, restructured on the owner decision of 27 August 2026 into four
   * semantic screens — when, where from, how many seats, the final details. The former eleven-step
   * sequence of IA §11.1 is gone, and so are the separate «Как часто вы ездите?», «Ваш маршрут до
   * храма» and «Проверьте поездку» screens. Every string is still a proposal: none is approved.
   */
  {
    id: 'offer-when',
    group: 'offer',
    label: '15 · Когда: разовая, служба',
    title: 'Экран 1 «Когда вы едете?»: разовая поездка к службе',
    description:
      'Первый из четырёх смысловых экранов формы водителя. Разовая или регулярная — не отдельный экран, а первый ответ на тот же вопрос «когда», поэтому переключатель стоит вверху этого экрана. Отсюда можно пройти всю форму до конца: «Далее» ведёт вперёд, «Назад» возвращает, ответы сохраняются.',
  },
  {
    id: 'offer-when-custom',
    group: 'offer',
    label: '16 · Когда: свои дата и время',
    title: 'Экран 1 «Когда вы едете?»: собственные дата и время',
    description:
      'Тот же экран и тот же список: собственные дата и время — второй способ ответить на тот же вопрос. Указывается время прибытия к храму, а не выезда: время выезда предлагается на экране 2, где уже известна дорога.',
  },
  {
    id: 'offer-when-recurring',
    group: 'offer',
    label: '17 · Когда: регулярная поездка',
    title: 'Экран 1 «Когда вы едете?»: регулярная поездка, дни и период',
    description:
      'Тот же экран после выбора регулярной поездки: службы показываются недельным временем («по воскресеньям, 9:00»), а не одной датой, и под ними раскрываются дни недели и период. Раньше это был отдельный экран, на котором конкретная дата с прошлого шага уже ничего не значила.',
  },
  {
    id: 'offer-where-empty',
    group: 'offer',
    label: '18 · Откуда: выбор места',
    title: 'Экран 2 «Откуда вы едете?»: место отправления ещё не выбрано',
    description:
      'Режим выбора места: карта, поле адреса, короткая инструкция и одна тихая строка о публичности. Больше на экране ничего нет — маршрут и допустимое отклонение зависят от места и появятся вместе с ним. Отдельной выделенной панели приватности больше нет: правило сказано одним предложением.',
  },
  {
    id: 'offer-where',
    group: 'offer',
    label: '19 · Откуда: место выбрано',
    title: 'Экран 2 «Откуда вы едете?»: место выбрано, маршрут и отклонение',
    description:
      'Тот же экран после подтверждения места: поле адреса и инструкция убраны, адрес показан один раз, на карте нарисован маршрут, под ней — одна строка о дороге и компактный список допустимого отклонения. Времени выезда здесь больше нет: сопоставление поездок его не использует. «Изменить место» возвращает этот же экран в режим выбора.',
  },
  {
    id: 'offer-seats',
    group: 'offer',
    label: '20 · Детали поездки: без детей',
    title: 'Экран 3 «Детали поездки»: без детей',
    description:
      'Все оставшиеся изменяемые сведения о поездке на одном экране: свободные места, дети, детское кресло, обратная поездка и необязательное примечание. Водитель не может везти детей, поэтому вопроса о кресле здесь нет.',
  },
  {
    id: 'offer-seats-children',
    group: 'offer',
    label: '21 · Детали поездки: дети и примечание',
    title: 'Экран 3 «Детали поездки»: дети, кресло, обратная поездка и примечание',
    description:
      'Тот же экран, когда водитель может везти детей: появляется вопрос о кресле и объяснение, кто отвечает за правила перевозки (IA §2.3). Предупреждение о примечании стоит подсказкой внутри самого поля, а не текстом под ним.',
  },
  {
    id: 'offer-final',
    group: 'offer',
    label: '22 · Проверьте поездку',
    title: 'Экран 4 «Проверьте поездку»: обычное начало',
    description:
      'Экран только для проверки: новых вопросов здесь не задаётся. Пять строк резюме — когда, откуда, места и дети, обратно, примечание — с тихим «Изменить» и одно главное действие. Публичной картинки и повторного объяснения приватности здесь нет.',
  },
  {
    id: 'offer-final-filled',
    group: 'offer',
    label: '23 · Проверьте поездку: заполнено',
    title: 'Экран 4 «Проверьте поездку»: разовая поездка, форма пройдена целиком',
    description:
      'Тот же экран, когда форма пройдена: в резюме собраны служба, место отправления с допустимым отклонением, места и дети, обратная поездка и примечание. Тихое «Изменить» возвращает к нужному экрану, ответы сохраняются. Вход и проверка контактов остаются условием публикации и в эту группу не входят: кнопка ничего не публикует.',
  },
  {
    id: 'offer-final-recurring',
    group: 'offer',
    label: '24 · Проверьте поездку: регулярная',
    title: 'Экран 4 «Проверьте поездку»: регулярная поездка',
    description:
      'То же резюме для регулярной поездки: в строке «Когда» появляются дни недели и период, и рядом стоит напоминание, что каждая дата серии остаётся отдельной поездкой с отдельными местами (IA §11.3).',
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
 * The passenger request form. The owner reviewed the first three semantic screens on 24 August 2026
 * and the rest of the form — «Последние детали», the final layout of the place screen and the
 * corrections made on the assembled form — on 26 August 2026, so every string below is approved.
 * Keys follow Foundation 4.5 and 4.4.2 so the owner compares the rendered screen with the master
 * text line by line.
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
  whenArrivalLabel: 'Дата и время',
  whenHorizon: 'Просьбу можно создать не больше чем на 8 недель вперёд.',

  placeTitle: 'Где вас забрать?',
  placePrimary: 'Основное место встречи',
  placeAlternative: 'Ещё одно место встречи',
  placePrivacy:
    'Для вашей безопасности всем будет видна только примерная область. Точное место и контакты откроются только после договорённости.',
  placeAdd: 'Добавить место',
  placeOr: 'или',
  placeLimit: 'Больше трёх мест указать нельзя.',
  placeChange: 'Изменить это место',
  placeRemove: 'Убрать это место',

  mapSearch: 'Адрес',
  mapHint: 'Введите адрес или передвиньте маркер на карте.',
  mapConfirm: 'Подтвердить место',

  peopleTitle: 'Сколько вас будет?',
  peopleTotal: 'Всего пассажиров, включая детей',
  peopleChildren: 'Из них детей',
  peopleChildSeat: 'Нужно детское кресло',
  peopleChildSeatHint:
    'По умолчанию кресло обеспечивает взрослый, который едет с ребёнком. Водитель отдельно указывает, есть ли кресло у него.',

  /*
   * Screen 4, approved by the owner on 26 August 2026: the six keys below already stood in the
   * master text of Foundation 4.5, the five summary keys are new and are added to the corpus by
   * this work.
   */
  finalTitle: 'Последние детали',
  finalReturn: 'Нужна поездка обратно',
  finalNoteLabel: 'Примечание (необязательно)',
  finalNoteHint:
    'Короткое уточнение для водителя. Не пишите домашний адрес, телефон, email и ссылки.',
  finalPublish: 'Опубликовать',

  /*
   * The compact summary: a few lines next to the button on the same screen, never a review screen
   * (IA §10.1, decision 1.9 (23)). Its rows are named by the questions the person already answered,
   * so the quiet «Изменить» leads back to a screen he recognizes. `summaryGroup` and `summaryEdit`
   * are never seen: they are what assistive technology reads instead of four identical «Изменить».
   */
  summaryGroup: 'Кратко о вашей просьбе',
  summaryWhen: 'Когда',
  summaryPlace: 'Где вас забрать',
  summaryPeople: 'Сколько вас',
  edit: 'Изменить',
} as const;

/** The accessible name of a summary action: «Изменить» alone repeats four times without it. */
const summaryEditName = (section: string) => `${requestCopy.edit}: ${section}`;

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

/* ------------------------- group 2: one interactive passenger request form (IA §10.1, §29.5) */

/** Content fixture: the same church schedule the group 1 screens use, seen from inside the form. */
const upcomingServices: ReadonlyArray<{
  id: string;
  title: string;
  when: string;
  /**
   * The same service seen by a driver who goes every week. A recurring trip has no single date, so
   * naming one there would be wrong; the weekly slot is what the answer actually is.
   */
  weekly: string;
}> = [
  { id: 'vigil-22', title: 'Всенощное бдение', when: 'суббота, 22 августа, 18:00', weekly: 'по субботам, 18:00' },
  { id: 'liturgy-23', title: 'Божественная литургия', when: 'воскресенье, 23 августа, 9:00', weekly: 'по воскресеньям, 9:00' },
  { id: 'moleben-26', title: 'Молебен с акафистом', when: 'среда, 26 августа, 18:00', weekly: 'по средам, 18:00' },
  { id: 'vigil-29', title: 'Всенощное бдение', when: 'суббота, 29 августа, 18:00', weekly: 'по субботам, 18:00' },
];

/**
 * The addresses the deterministic map offers and where they sit inside the drawing. A real geocoder
 * would return anything; the review needs the same three answers every time, so that the wording and
 * the layout are what changes between two runs and nothing else.
 */
const mapAddresses: ReadonlyArray<{ id: string; address: string; left: number; top: number }> = [
  /*
   * The pins live in the lower half of the drawing on purpose: the guidance card floats over the
   * upper part and grows downwards as the reader enlarges text. Above 44 % a marker disappears
   * behind that card at 200 %.
   */
  { id: 'via-milano', address: 'Via Milano, 8, 88100 Catanzaro CZ', left: 50, top: 58 },
  { id: 'piazza-matteotti', address: 'Piazza Matteotti, 88100 Catanzaro CZ', left: 22, top: 76 },
  { id: 'via-indipendenza', address: 'Via Indipendenza, 21, 88100 Catanzaro CZ', left: 78, top: 68 },
];

const maxPlaces = 3;

type ChosenPlace = { id: string; address: string };
type RequestStep = 'when' | 'place' | 'people' | 'final';

/** The four semantic screens in the order a person meets them. The map is not among them. */
const stepOrder: ReadonlyArray<RequestStep> = ['when', 'place', 'people', 'final'];

/**
 * Everything the form knows. One object, held in memory by the form itself: moving between screens
 * never rebuilds it, so an answer given on the first screen is still there on the fourth and still
 * there after going back to change it. There is no storage, no draft on a server and no account
 * behind this — the review needs the behaviour, not the plumbing.
 */
type RequestState = {
  step: RequestStep;
  /**
   * The map belongs to the place screen and is always on it, so there is nothing to open or close.
   * `marker` is the address the marker stands on; `editing` names the saved place that marker is
   * about to replace, or `null` when it is about to become a new one.
   */
  marker: string;
  editing: string | null;
  /** A service id, or `custom` when the person answers with an own date and time. */
  when: string;
  arrival: string;
  places: ReadonlyArray<ChosenPlace>;
  total: number;
  childrenCount: number;
  childSeat: boolean;
  returnRide: boolean;
  note: string;
};

const blankRequest: RequestState = {
  step: 'when',
  marker: 'via-milano',
  editing: null,
  when: 'liturgy-23',
  arrival: '2026-08-23T09:00',
  places: [],
  total: 1,
  childrenCount: 0,
  childSeat: false,
  returnRide: false,
  note: '',
};

const placeAt = (index: number): ChosenPlace => ({
  id: mapAddresses[index].id,
  address: mapAddresses[index].address,
});

/**
 * Every review state is the same form with different answers already given — an entry point, not a
 * step of its own. Ten static mock-ups would drift apart from each other by the second correction.
 */
const requestSeeds: Partial<Record<SampleId, Partial<RequestState>>> = {
  'request-when': { step: 'when', when: 'liturgy-23' },
  'request-when-custom': { step: 'when', when: 'custom' },
  'request-place-empty': { step: 'place', places: [], marker: 'via-milano' },
  /*
   * The map is not a screen of its own any more, so this anchor is a state of the place screen:
   * the person pressed «Изменить это место» and the marker now stands on the saved place, waiting
   * to be confirmed. It is the only state in which the confirming action is visible.
   */
  'request-map': { step: 'place', places: [placeAt(0)], marker: 'piazza-matteotti', editing: 'via-milano' },
  'request-place': { step: 'place', places: [placeAt(0)], marker: 'piazza-matteotti' },
  'request-place-three': {
    step: 'place',
    places: [placeAt(0), placeAt(1), placeAt(2)],
    marker: 'via-milano',
  },
  'request-people': { step: 'people', places: [placeAt(0)], total: 2, childrenCount: 0 },
  'request-people-children': {
    step: 'people',
    places: [placeAt(0)],
    total: 3,
    childrenCount: 1,
    childSeat: true,
  },
  'request-final': { step: 'final', places: [placeAt(0)], total: 1 },
  'request-final-filled': {
    step: 'final',
    places: [placeAt(0), placeAt(1)],
    total: 3,
    childrenCount: 1,
    childSeat: true,
    returnRide: true,
    note: 'у входа в библиотеку',
  },
};

const monthsGenitive = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const weekdays = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/**
 * `2026-08-23T09:00` → «воскресенье, 23 августа, 9:00», the same shape the schedule uses, so the
 * summary reads the same whichever of the two ways the person answered the first question.
 */
function formatArrival(value: string) {
  const [date, time = '00:00'] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return value;
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${day} ${monthsGenitive[month - 1]}, ${time.replace(/^0/, '')}`;
}

function whenSummary(state: RequestState) {
  if (state.when === 'custom') return formatArrival(state.arrival);
  const service = upcomingServices.find((item) => item.id === state.when);
  return service ? `${service.title} · ${service.when}` : formatArrival(state.arrival);
}

function peopleSummary(state: RequestState) {
  const passengers = pluralRu(state.total, passengersPlural);
  return state.childrenCount > 0 ? `${passengers}, ${childrenOfThem(state.childrenCount)}` : passengers;
}

/**
 * The form chrome of every request screen: a quiet way back and the name of what is being created.
 * There is no stepper, no progress bar and no numbered wizard. Neither IA §28.3 nor Design System V2
 * requires one, and this group exists to judge the words, not to introduce a navigation pattern.
 */
function FormHeader({ context, backLabel, onBack }: {
  context: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <header className={styles.formHeader} data-form-header>
      <button type="button" className={styles.quietButton} onClick={onBack}>{backLabel}</button>
      <p className={styles.formContext}>{context}</p>
    </header>
  );
}

/** One primary intent per screen, full width, at the end of the content (DS §5). */
function FormFooter({ action, onAction }: { action: string; onAction: () => void }) {
  return (
    <div className={styles.formFooter}>
      <button type="button" className={styles.primaryButton} onClick={onAction}>{action}</button>
    </div>
  );
}

/**
 * The value is an `output`, not a read-only input: a field a person cannot type into should not be
 * focusable and should not offer a text cursor. The two buttons carry the whole interaction, and
 * each of them names the field it changes, so the pair works without seeing the label (IA §28.1).
 */
function Stepper({ label, value, min, max, labelHidden = false, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Set when the heading of the screen already asks the question the label would repeat. */
  labelHidden?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className={styles.stepper} data-stepper role="group" aria-label={label}>
      <p className={labelHidden ? styles.srOnly : styles.fieldLabel}>{label}</p>
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

/* ------------------------------------------------------------------------- the form itself */

/**
 * One component for the whole request. The review states differ only in the answers it starts with.
 *
 * Navigation is plainly linear, because the form is: «Далее» goes to the next of the four questions,
 * «Назад» to the previous one, and the quiet «Изменить» of the summary jumps straight to the screen
 * that owns the answer. Nothing is thrown away on the way: the state object outlives every move.
 */
function PassengerRequestForm({ seed, textZoom }: { seed: Partial<RequestState>; textZoom: boolean }) {
  const [form, setForm] = useState<RequestState>({ ...blankRequest, ...seed });
  const change = (patch: Partial<RequestState>) => setForm((current) => ({ ...current, ...patch }));

  const index = stepOrder.indexOf(form.step);
  const goTo = (step: RequestStep) => change({ step, editing: null });
  const back = () => index > 0 && goTo(stepOrder[index - 1]);
  const next = () => index < stepOrder.length - 1 && goTo(stepOrder[index + 1]);

  /* ------------------------------------------------------------------ screen 1: when */

  function whenScreen() {
    const custom = form.when === 'custom';

    return (
      <>
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
              data-choice-selected={form.when === service.id ? '' : undefined}
            >
              <input
                type="radio"
                name="request-when"
                checked={form.when === service.id}
                onChange={() => change({ when: service.id })}
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
              onChange={() => change({ when: 'custom' })}
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
              <input
                type="datetime-local"
                value={form.arrival}
                onChange={(event) => change({ arrival: event.target.value })}
              />
            </label>
          </div>
        )}

        {/*
         * One hint at a time, and it answers the question the person actually has. Before the own
         * date is chosen that question is «а если моей службы тут нет»; once the date field is open
         * it is «как далеко вперёд можно загадывать». Showing both at once made the horizon look
         * like a rule about the list of services.
         */}
        <p className={styles.fieldHint} data-when-hint>
          {custom ? requestCopy.whenHorizon : requestCopy.whenCustomHint}
        </p>
        <FormFooter action={requestCopy.next} onAction={next} />
      </>
    );
  }

  /* ------------------------------------------------ screen 2: where to pick up, map included */

  const markerAt = () => mapAddresses.find((item) => item.id === form.marker) ?? mapAddresses[0];

  const firstFree = (places: ReadonlyArray<ChosenPlace>) =>
    mapAddresses.find((candidate) => !places.some((place) => place.id === candidate.id));

  /**
   * Saving the marked point. Adding a place and changing one are the same movement — a point on the
   * map becomes one of the meeting places — so they share one implementation. Only the label of the
   * action differs, because «добавить» and «изменить» are two different intents of the person.
   *
   * Afterwards the marker moves to a place that is still free, so the map is ready for the next
   * alternative instead of standing on an address the list already holds.
   */
  function savePlace() {
    const marker = markerAt();
    const picked: ChosenPlace = { id: marker.id, address: marker.address };
    const kept = form.places.filter((place) => place.id !== picked.id && place.id !== form.editing);
    const at = form.editing
      ? form.places.findIndex((place) => place.id === form.editing)
      : kept.length;
    const places = [...kept];
    places.splice(Math.min(Math.max(at, 0), places.length), 0, picked);
    const saved = places.slice(0, maxPlaces);
    change({ places: saved, editing: null, marker: (firstFree(saved) ?? marker).id });
  }

  /** Typing an address moves the marker, exactly as the hint under the map promises. */
  function searchAddress(query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    const found = mapAddresses.find((item) => item.address.toLowerCase().includes(normalized));
    if (found) change({ marker: found.id });
  }

  /**
   * One semantic screen, with the map always on it. There is no empty state that becomes a map that
   * becomes a list: the person sees the map, the marked address, the places already saved and the
   * way to add another, all at once (owner decision of 26 August 2026).
   *
   * Places stay alternatives, never stops: the label of every additional place and the word «или»
   * between the cards say so, and the container is not an ordered list, so nothing numbers them.
   */
  function placeScreen() {
    const chosen = form.places.length > 0;
    const full = form.places.length >= maxPlaces;
    const marker = markerAt();
    /* Changing a saved place adds nothing, so the limit never blocks it. */
    const canSave = Boolean(form.editing) || !full;

    return (
      <>
        {/* The map takes the whole upper part: it is a map screen, not a field on a form screen. */}
        <div className={styles.pickMapArea}>
          <PickMapArtwork />
          <div className={styles.pickControls}>
            {/*
             * The quiet way back to the previous question. It sits over the map beside the search
             * instead of in a header bar, so the map keeps the full height of the screen.
             */}
            <button
              type="button"
              className={styles.iconButton}
              aria-label={requestCopy.back}
              onClick={back}
            >
              <Icon name="back" />
            </button>
            <label className={styles.searchField}>
              <Icon name="search" />
              <span className={styles.srOnly}>{requestCopy.mapSearch}</span>
              <input
                placeholder={requestCopy.mapSearch}
                defaultValue=""
                onChange={(event) => searchAddress(event.target.value)}
              />
            </label>
          </div>
          <p className={styles.pickHint}>{requestCopy.mapHint}</p>

          {/*
           * The place the marker stands on and the others it can be moved to. The public circle is
           * not drawn: it is not what is being chosen (DS §8.2). The pin is small, the target
           * around it is a full 44 px.
           */}
          <div className={styles.pickPoints} role="group" aria-label={requestCopy.mapHint}>
            {mapAddresses.map((point) => (
              <button
                key={point.id}
                type="button"
                className={styles.pickPoint}
                style={{ left: `${point.left}%`, top: `${point.top}%` }}
                aria-label={point.address}
                aria-pressed={point.id === marker.id}
                onClick={() => change({ marker: point.id })}
              >
                <span
                  className={point.id === marker.id ? styles.pickMarker : styles.pickSpare}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>

        {/*
         * The working sheet rides over the lower edge of the map: the question, the address the
         * marker stands on, the rule about what becomes public, the saved places and the actions.
         */}
        <div className={styles.pickSheet} data-request-step="place">
          <h1 className={styles.pageTitle}>{requestCopy.placeTitle}</h1>
          <p className={styles.data} data-picked-address>Выбрано: {marker.address}</p>
          {/*
           * The explanation of what becomes public is said once on the screen, before the action it
           * is about — never twice, and never as a step before publication (IA §10.4).
           */}
          <p className={styles.privacyNote} data-place-privacy>{requestCopy.placePrivacy}</p>

        {chosen && (
          <div className={styles.placeList} data-place-list>
            {form.places.map((place, order) => (
              <div key={place.id}>
                {order > 0 && <p className={styles.placeOr} data-place-or>{requestCopy.placeOr}</p>}
                <article
                  className={`${styles.card} ${styles.placeCard}`}
                  data-place-card
                  data-place-editing={form.editing === place.id ? '' : undefined}
                >
                  <p className={styles.micro}>
                    {order === 0 ? requestCopy.placePrimary : requestCopy.placeAlternative}
                  </p>
                  <p className={styles.data}>{place.address}</p>
                  <div className={styles.placeActions}>
                    <button
                      type="button"
                      className={styles.quietButton}
                      onClick={() => change({ editing: place.id, marker: place.id })}
                    >
                      {requestCopy.placeChange}
                    </button>
                    {order > 0 && (
                      <button
                        type="button"
                        className={styles.quietButton}
                        onClick={() => {
                          const left = form.places.filter((item) => item.id !== place.id);
                          change({
                            places: left,
                            editing: form.editing === place.id ? null : form.editing,
                            marker: (firstFree(left) ?? marker).id,
                          });
                        }}
                      >
                        {requestCopy.placeRemove}
                      </button>
                    )}
                  </div>

                  {/*
                   * Adding an alternative belongs to the place it is an alternative to, so it sits
                   * in the main card under «Изменить это место» — small and secondary, because it
                   * is the rarer intent. The one large primary of the screen stays «Далее» below.
                   * The reason for the limit replaces it in the same spot (IA §28.3).
                   */}
                  {order === 0 && !form.editing && (
                    canSave ? (
                      <button
                        type="button"
                        className={styles.cardAddPlace}
                        onClick={savePlace}
                        data-place-add
                      >
                        {requestCopy.placeAdd}
                      </button>
                    ) : (
                      <p className={styles.fieldHint} data-place-limit>{requestCopy.placeLimit}</p>
                    )
                  )}
                </article>
              </div>
            ))}
          </div>
        )}

          {/*
           * Before the first place there is one intent: mark a point and keep it. After it there are
           * two — move on, which is the ordinary one and stays primary, and add another alternative,
           * which is rarer and stays a smaller secondary. Neither of them leaves this screen: adding
           * saves the marked point right here and moves the marker on to a still-free address.
           *
           * While a saved place is being changed the single intent is confirming that change, so the
           * pair collapses back to one action. At three places the reason replaces the action rather
           * than leaving it disabled (IA §28.3).
           */}
          <div className={styles.sheetActions}>
            {form.editing ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={savePlace}
                data-place-add
              >
                {requestCopy.mapConfirm}
              </button>
            ) : chosen ? (
              /* The only large action of the screen. Adding an alternative lives in the card. */
              <button type="button" className={styles.primaryButton} onClick={next}>
                {requestCopy.next}
              </button>
            ) : (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={savePlace}
                data-place-add
              >
                {requestCopy.mapConfirm}
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  /* --------------------------------------------------------------- screen 3: who is travelling */

  /**
   * One question, three fields. Splitting them into separate screens would follow the letter of «one
   * step — one question» and break its meaning: a person answers «сколько нас» once (IA §28.3).
   *
   * The child seat appears only when the group has children, because that is when the answer exists
   * (IA §47.6). Responsibility for the seat stays with the accompanying adult (IA §2.3).
   */
  function peopleScreen() {
    return (
      <>
        <h1 className={styles.pageTitle}>{requestCopy.peopleTitle}</h1>

        <Stepper
          label={requestCopy.peopleTotal}
          value={form.total}
          min={1}
          max={8}
          onChange={(total) => change({ total, childrenCount: Math.min(form.childrenCount, total) })}
        />
        <Stepper
          label={requestCopy.peopleChildren}
          value={form.childrenCount}
          min={0}
          max={form.total}
          onChange={(childrenCount) => change({ childrenCount })}
        />

        {form.childrenCount > 0 && (
          <div className={styles.revealed} data-child-seat>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={form.childSeat}
                onChange={() => change({ childSeat: !form.childSeat })}
              />
              <span>{requestCopy.peopleChildSeat}</span>
            </label>
            <p className={styles.fieldHint}>{requestCopy.peopleChildSeatHint}</p>
          </div>
        )}

        <FormFooter action={requestCopy.next} onAction={next} />
      </>
    );
  }

  /* -------------------------------------------------------------- screen 4: the final details */

  function summaryRow(section: string, target: RequestStep, body: React.ReactNode) {
    return (
      <div className={styles.summaryRow} data-summary-row data-summary-section={section}>
        <div>
          <p className={styles.summaryLabel}>{section}</p>
          {body}
        </div>
        <button
          type="button"
          className={styles.quietButton}
          aria-label={summaryEditName(section)}
          onClick={() => goTo(target)}
        >
          {requestCopy.edit}
        </button>
      </div>
    );
  }

  /**
   * Return ride, an optional note, a compact summary, «Опубликовать» — in the order IA §10.1 lists
   * them. The summary is a few lines beside the button on the same screen, not a review screen: no
   * heading announces a check, and no «Что увидят все» block comes back under a new name
   * (decisions 1.9 (15) and 1.9 (23)).
   *
   * «Опубликовать» is the intent to publish. Signing in and verifying contacts remain the condition
   * of publication and belong to their own group, so nothing here pretends to publish anything.
   */
  function finalScreen() {
    return (
      <>
        <h1 className={styles.pageTitle}>{requestCopy.finalTitle}</h1>

        <div className={styles.revealed} data-return-ride>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.returnRide}
              onChange={() => change({ returnRide: !form.returnRide })}
            />
            <span>{requestCopy.finalReturn}</span>
          </label>
        </div>

        {/*
         * The ordinary optional note is also where a landmark goes — «у входа в библиотеку». No
         * second address-like field is created for it (decision 1.9 (20)). Its own short warning
         * about what not to write stands under the field (IA §6.4).
         */}
        <label className={styles.noteField} data-note-field>
          <span>{requestCopy.finalNoteLabel}</span>
          <textarea
            rows={3}
            maxLength={200}
            value={form.note}
            onChange={(event) => change({ note: event.target.value })}
          />
        </label>
        <p className={styles.fieldHint}>{requestCopy.finalNoteHint}</p>

        <section
          className={styles.summary}
          data-request-summary
          role="group"
          aria-label={requestCopy.summaryGroup}
        >
          {summaryRow(requestCopy.summaryWhen, 'when', (
            <p className={styles.summaryValue}>{whenSummary(form)}</p>
          ))}
          {summaryRow(requestCopy.summaryPlace, 'place', (
            form.places.length > 0 ? (
              <div>
                {form.places.map((place, order) => (
                  <p className={styles.summaryValue} key={place.id}>
                    {order > 0 && <span className={styles.summaryOr}>{requestCopy.placeOr} </span>}
                    {place.address}
                  </p>
                ))}
              </div>
            ) : (
              <p className={styles.summaryValue}>—</p>
            )
          ))}
          {summaryRow(requestCopy.summaryPeople, 'people', (
            <>
              <p className={styles.summaryValue}>{peopleSummary(form)}</p>
              {/* The seat is a fact of the request only while the group has children (IA §47.6). */}
              {form.childrenCount > 0 && form.childSeat && (
                <p className={styles.summaryValue} data-summary-child-seat>
                  {requestCopy.peopleChildSeat}
                </p>
              )}
            </>
          ))}
        </section>

        <FormFooter action={requestCopy.finalPublish} onAction={() => undefined} />
      </>
    );
  }

  /* ------------------------------------------------------------------------------- assembly */

  const frameLabel: Record<RequestStep, string> = {
    when: 'Просьба пассажира: когда',
    place: 'Просьба пассажира: где вас забрать',
    people: 'Просьба пассажира: сколько вас будет',
    final: 'Просьба пассажира: последние детали',
  };

  /*
   * «Где вас забрать?» is a map screen: the map runs to the top edge and the sheet rides over its
   * lower part, so it carries its own quiet way back over the map instead of the header bar. It is
   * still one screen of the same form — the back leads to the previous question, as everywhere.
   */
  if (form.step === 'place') {
    return (
      <PhoneFrame label={frameLabel.place} textZoom={textZoom}>
        {placeScreen()}
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame label={frameLabel[form.step]} textZoom={textZoom}>
      <FormHeader context={requestCopy.title} backLabel={requestCopy.back} onBack={back} />
      <main className={styles.formContent} data-request-step={form.step}>
        {form.step === 'when' && whenScreen()}
        {form.step === 'people' && peopleScreen()}
        {form.step === 'final' && finalScreen()}
      </main>
    </PhoneFrame>
  );
}

/* -------------------------- group 3: one interactive driver offer form (IA §11.1, §29.5) */

/**
 * The wording of the driver offer. Nothing here is approved: the group exists precisely so the
 * owner can read these words on the assembled screens first.
 *
 * The form is four semantic screens (owner decision of 27 August 2026), simplified again on
 * 28 August 2026: screen 2 keeps only what a person decides about the place, screen 3 collects
 * every remaining editable detail of the trip, and screen 4 only shows what was answered.
 */
const offerCopy = {
  title: 'Могу подвезти',
  back: 'Назад',
  next: 'Далее',

  whenTitle: 'Когда вы едете?',
  whenOneTime: 'Разовая поездка',
  whenRecurring: 'Регулярная поездка',
  whenRecurringHint:
    'Регулярная поездка создаётся не больше чем на 8 недель. Каждая дата остаётся отдельной поездкой с отдельными местами.',
  whenOr: 'или',
  whenCustom: 'Указать свои дату и время',
  whenCustomRecurring: 'Указать своё время',
  whenArrivalLabel: 'Когда нужно быть у храма',
  whenArrivalTimeLabel: 'Время у храма',
  daysTitle: 'По каким дням вы ездите',
  daysFrom: 'Первая поездка',
  daysTo: 'Последняя поездка',

  whereTitle: 'Откуда вы едете?',
  wherePrivacy:
    'Всем будет видна только примерная область отправления — точный адрес откроется после договорённости.',
  mapSearch: 'Адрес',
  mapHint: 'Введите адрес или передвиньте маркер на карте.',
  mapConfirm: 'Подтвердить место',
  whereChange: 'Изменить место',
  detourLabel: 'Допустимое отклонение от маршрута',
  detourNone: 'Только по маршруту',

  detailsTitle: 'Детали поездки',
  seatsLabel: 'Свободные места',
  childrenLabel: 'Дети',
  childrenYes: 'Могу везти детей',
  childrenNo: 'Не могу везти детей',
  childSeatYes: 'У меня есть подходящее детское кресло',
  childSeatHint:
    'Правила перевозки детей в вашей стране соблюдаете вы сами. Мы их не проверяем.',
  detailsReturn: 'Могу подвезти обратно',
  noteLabel: 'Примечание',
  notePlaceholder: 'Не указывайте цену, телефон, email, ссылки и точный адрес',

  reviewTitle: 'Проверьте поездку',
  publish: 'Опубликовать',

  summaryGroup: 'Кратко о вашей поездке',
  summaryWhen: 'Когда',
  summaryWhere: 'Откуда',
  summarySeats: 'Места и дети',
  summaryReturn: 'Обратно',
  summaryNote: 'Примечание',
  returnNo: 'Не могу подвезти обратно',
  empty: '—',
  edit: 'Изменить',
} as const;

const offerSummaryEditName = (section: string) => `${offerCopy.edit}: ${section}`;

const detourKm = (km: number) => `До ${km} км`;
const offerPeriod = (from: string, to: string) => `С ${from} по ${to}`;
const offerSeatsValue = (seats: number) => pluralRu(seats, seatsFreePlural);

/** The church the whole review surface is set in, seen from inside the driver form. */
const offerChurch = 'Храм Покрова Пресвятой Богородицы в Catanzaro';

/** Detour distances offered for the review. Product Scope fixes the unit, not the ladder. */
const detourChoices: ReadonlyArray<number> = [0, 2, 5, 10, 15, 20];

const weekdayChoices: ReadonlyArray<{ id: string; short: string; full: string }> = [
  { id: 'mon', short: 'Пн', full: 'понедельник' },
  { id: 'tue', short: 'Вт', full: 'вторник' },
  { id: 'wed', short: 'Ср', full: 'среда' },
  { id: 'thu', short: 'Чт', full: 'четверг' },
  { id: 'fri', short: 'Пт', full: 'пятница' },
  { id: 'sat', short: 'Сб', full: 'суббота' },
  { id: 'sun', short: 'Вс', full: 'воскресенье' },
];

type OfferStep = 'when' | 'where' | 'details' | 'review';

/** The four semantic screens in the order a person meets them. The map is not among them. */
const offerStepOrder: ReadonlyArray<OfferStep> = ['when', 'where', 'details', 'review'];

type OfferState = {
  step: OfferStep;
  kind: 'one-time' | 'recurring';
  /** A service id, or `custom` when the driver answers with an own date and time. */
  when: string;
  arrivalDate: string;
  arrivalTime: string;
  days: ReadonlyArray<string>;
  from: string;
  to: string;
  /**
   * The address the marker stands on. `departure` is the one the driver has confirmed; while it is
   * `null` the screen is in its place-selection mode, and «Изменить место» puts it back there.
   */
  marker: string;
  departure: string | null;
  detour: number;
  seats: number;
  children: boolean;
  childSeat: boolean;
  returnRide: boolean;
  note: string;
};

const blankOffer: OfferState = {
  step: 'when',
  kind: 'one-time',
  when: 'liturgy-23',
  arrivalDate: '2026-08-23',
  arrivalTime: '09:00',
  days: ['sun'],
  from: '2026-08-30',
  to: '2026-10-25',
  marker: 'via-milano',
  departure: null,
  detour: 5,
  seats: 3,
  children: true,
  childSeat: false,
  returnRide: false,
  note: '',
};

/** The note the filled states carry: a real driver clarification, without price or contacts. */
const offerNoteSample = 'Выезжаю от площади, подожду пять минут у входа.';

/** The answers a driver who has walked screens 1–3 would already have given. */
const offerFilled: Partial<OfferState> = {
  departure: 'via-milano',
  marker: 'via-milano',
  detour: 5,
  seats: 3,
  children: true,
  childSeat: true,
  returnRide: true,
  note: offerNoteSample,
};

/**
 * Ten entry points into the same form. Each one opens the screen it names with the answers a person
 * would already have given by then, so the owner reads every screen in a realistic state and can
 * still walk forwards and backwards from any of them.
 */
const offerSeeds: Partial<Record<SampleId, Partial<OfferState>>> = {
  'offer-when': { step: 'when', kind: 'one-time', when: 'liturgy-23' },
  'offer-when-custom': { step: 'when', kind: 'one-time', when: 'custom' },
  'offer-when-recurring': { step: 'when', kind: 'recurring', when: 'liturgy-23', days: ['sun'] },
  'offer-where-empty': { step: 'where', departure: null, marker: 'via-milano' },
  'offer-where': { step: 'where', departure: 'via-milano', marker: 'via-milano', detour: 5 },
  'offer-seats': { step: 'details', departure: 'via-milano', seats: 3, children: false },
  'offer-seats-children': {
    step: 'details',
    departure: 'via-milano',
    seats: 3,
    children: true,
    childSeat: true,
    returnRide: true,
    note: offerNoteSample,
  },
  'offer-final': { step: 'review', departure: 'via-milano' },
  'offer-final-filled': { step: 'review', kind: 'one-time', when: 'liturgy-23', ...offerFilled },
  'offer-final-recurring': {
    step: 'review',
    kind: 'recurring',
    when: 'liturgy-23',
    days: ['sat', 'sun'],
    ...offerFilled,
  },
};

/** `2026-08-30` → «30 августа», the shape the period line and the schedule already use. */
function formatDay(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${monthsGenitive[month - 1]}`;
}

const offerService = (state: OfferState) =>
  upcomingServices.find((item) => item.id === state.when);

const offerDaysSummary = (state: OfferState) =>
  weekdayChoices
    .filter((day) => state.days.includes(day.id))
    .map((day) => day.full)
    .join(', ');

/**
 * The «когда» answer as the summary of screen 4 states it. A one-time trip has a date; a recurring
 * one has weekdays and a period, because that is what it actually is.
 */
function offerWhenSummary(state: OfferState) {
  const service = offerService(state);
  if (state.kind === 'recurring') {
    const head = service ? `${service.title} · ${service.weekly}` : state.arrivalTime;
    return `${head} · ${offerDaysSummary(state)}`;
  }
  if (service) return `${service.title} · ${service.when}`;
  return formatArrival(`${state.arrivalDate}T${state.arrivalTime}`);
}

/**
 * The exact route the driver builds, drawn from the departure marker to the church over the same
 * map. There is no maps provider behind it — the group reviews the words and the composition.
 */
function OfferRouteOverlay() {
  return (
    <svg
      className={styles.routeOverlay}
      viewBox="0 0 390 420"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path d="M196 244 Q250 200 268 150 T322 74" className={styles.routeLine} />
      <circle cx="196" cy="244" r="7" className={styles.routeStart} />
    </svg>
  );
}

/* --------------------------------------------------------------------------- the form itself */

/**
 * One component for the whole driver offer. The ten review states differ only in the answers it
 * starts with, so a correction to a screen reaches every state that shows it.
 *
 * Navigation is plainly linear, because the form is: «Далее» goes to the next of the four
 * questions, «Назад» to the previous one, and the quiet «Изменить» of the review jumps straight to
 * the screen that owns the answer. The state object outlives every move.
 */
function DriverOfferForm({ seed, textZoom }: { seed: Partial<OfferState>; textZoom: boolean }) {
  const [form, setForm] = useState<OfferState>({ ...blankOffer, ...seed });
  const change = (patch: Partial<OfferState>) => setForm((current) => ({ ...current, ...patch }));

  const index = offerStepOrder.indexOf(form.step);
  const goTo = (step: OfferStep) => change({ step });
  const back = () => index > 0 && goTo(offerStepOrder[index - 1]);
  const next = () => index < offerStepOrder.length - 1 && goTo(offerStepOrder[index + 1]);

  /* ------------------------------------------------------------------ screen 1: when */

  /**
   * One question with two halves inside it: how often, and when exactly. Driving every week is not
   * a separate decision a person makes on a screen of its own — it is the first half of saying when
   * they go, and the second half reads differently depending on it.
   */
  function whenScreen() {
    const recurring = form.kind === 'recurring';
    const custom = form.when === 'custom';

    const toggleDay = (id: string) =>
      change({
        days: form.days.includes(id)
          ? form.days.filter((day) => day !== id)
          : weekdayChoices
            .filter((day) => day.id === id || form.days.includes(day.id))
            .map((day) => day.id),
      });

    return (
      <>
        <p className={styles.formChurch}>{offerChurch}</p>
        <h1 className={styles.pageTitle}>{offerCopy.whenTitle}</h1>

        {/* How often, at the top of the same screen: two words, not a screen of their own. */}
        <fieldset className={styles.segmented} data-offer-kind>
          <legend className={styles.srOnly}>{offerCopy.whenTitle}</legend>
          {([['one-time', offerCopy.whenOneTime], ['recurring', offerCopy.whenRecurring]] as const).map(
            ([id, label]) => (
              <label
                key={id}
                className={styles.segment}
                data-choice-selected={form.kind === id ? '' : undefined}
              >
                <input
                  type="radio"
                  name="offer-kind"
                  checked={form.kind === id}
                  onChange={() => change({ kind: id })}
                />
                <span>{label}</span>
              </label>
            ),
          )}
        </fieldset>

        {recurring && <p className={styles.fieldHint} data-offer-kind-hint>{offerCopy.whenRecurringHint}</p>}

        {/*
         * The services. A one-time trip names a date, a series names the weekly slot: a driver who
         * goes every week has no single date, and printing one there made the question about
         * weekdays below contradict the answer just given.
         */}
        <fieldset className={styles.choiceGroup} data-offer-when>
          <legend className={styles.srOnly}>{offerCopy.whenTitle}</legend>
          {upcomingServices.map((service) => (
            <label
              key={service.id}
              className={styles.choice}
              data-choice-selected={form.when === service.id ? '' : undefined}
            >
              <input
                type="radio"
                name="offer-when"
                checked={form.when === service.id}
                onChange={() => change({ when: service.id })}
              />
              <span>
                <strong>{service.title}</strong>
                <span>{recurring ? service.weekly : service.when}</span>
              </span>
            </label>
          ))}

          <p className={styles.choiceOr}>{offerCopy.whenOr}</p>
          <label className={styles.choice} data-choice-selected={custom ? '' : undefined}>
            <input
              type="radio"
              name="offer-when"
              checked={custom}
              onChange={() => change({ when: 'custom' })}
            />
            <span>
              <strong>{recurring ? offerCopy.whenCustomRecurring : offerCopy.whenCustom}</strong>
            </span>
          </label>
        </fieldset>

        {/*
         * The own answer, in the shape the trip actually has: a date and a time for one trip, only
         * a time for a series, whose dates come from the weekdays and the period below.
         */}
        {custom && (
          <div className={styles.revealed} data-offer-arrival>
            {recurring ? (
              <label className={styles.textField}>
                <span>{offerCopy.whenArrivalTimeLabel}</span>
                <input
                  type="time"
                  value={form.arrivalTime}
                  onChange={(event) => change({ arrivalTime: event.target.value })}
                />
              </label>
            ) : (
              <label className={styles.textField}>
                <span>{offerCopy.whenArrivalLabel}</span>
                <input
                  type="datetime-local"
                  value={`${form.arrivalDate}T${form.arrivalTime}`}
                  onChange={(event) => {
                    const [date, time = form.arrivalTime] = event.target.value.split('T');
                    change({ arrivalDate: date || form.arrivalDate, arrivalTime: time });
                  }}
                />
              </label>
            )}
          </div>
        )}

        {/* Weekdays and the period belong to the same question and stay on the same screen. */}
        {recurring && (
          <div className={styles.revealed} data-offer-series>
            <p className={styles.fieldLabel}>{offerCopy.daysTitle}</p>
            <div className={styles.dayToggles} role="group" aria-label={offerCopy.daysTitle} data-offer-days>
              {weekdayChoices.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  className={styles.dayToggle}
                  aria-pressed={form.days.includes(day.id)}
                  aria-label={day.full}
                  onClick={() => toggleDay(day.id)}
                >
                  {day.short}
                </button>
              ))}
            </div>

            <div className={styles.periodFields}>
              <label className={styles.textField}>
                <span>{offerCopy.daysFrom}</span>
                <input type="date" value={form.from} onChange={(event) => change({ from: event.target.value })} />
              </label>
              <label className={styles.textField}>
                <span>{offerCopy.daysTo}</span>
                <input type="date" value={form.to} onChange={(event) => change({ to: event.target.value })} />
              </label>
            </div>
            <p className={styles.data} data-offer-period>
              {offerPeriod(formatDay(form.from), formatDay(form.to))}
            </p>
          </div>
        )}

        <FormFooter action={offerCopy.next} onAction={next} />
      </>
    );
  }

  /* ------------------------------------------------------- screen 2: where from, map included */

  const markerAt = () => mapAddresses.find((item) => item.id === form.marker) ?? mapAddresses[0];
  const departureAt = () => mapAddresses.find((item) => item.id === form.departure) ?? null;

  function searchAddress(query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    const found = mapAddresses.find((item) => item.address.toLowerCase().includes(normalized));
    if (found) change({ marker: found.id });
  }

  /**
   * One semantic screen with the map always on it, in two modes of the same screen.
   *
   * Choosing: the map, the address field, one short instruction and one quiet line about what
   * becomes public. Nothing else, because everything else depends on the place.
   *
   * Chosen: the field and the instruction are gone — they have done their work — the address stands
   * once, the route is drawn on the map, and the two things the driver still decides are the detour
   * and whether to pick the place again.
   */
  function whereScreen() {
    const marker = markerAt();
    const saved = departureAt();

    return (
      <>
        <div className={styles.pickMapArea}>
          <PickMapArtwork />
          {saved && <OfferRouteOverlay />}
          <div className={styles.pickControls}>
            <button type="button" className={styles.iconButton} aria-label={offerCopy.back} onClick={back}>
              <Icon name="back" />
            </button>
            {/* The search belongs to choosing a place, so it leaves with that mode. */}
            {!saved && (
              <label className={styles.searchField}>
                <Icon name="search" />
                <span className={styles.srOnly}>{offerCopy.mapSearch}</span>
                <input
                  placeholder={offerCopy.mapSearch}
                  defaultValue=""
                  onChange={(event) => searchAddress(event.target.value)}
                />
              </label>
            )}
          </div>
          {!saved && <p className={styles.pickHint}>{offerCopy.mapHint}</p>}

          {/* Points are movable only while a place is being chosen. */}
          {!saved && (
            <div className={styles.pickPoints} role="group" aria-label={offerCopy.mapHint}>
              {mapAddresses.map((point) => (
                <button
                  key={point.id}
                  type="button"
                  className={styles.pickPoint}
                  style={{ left: `${point.left}%`, top: `${point.top}%` }}
                  aria-label={point.address}
                  aria-pressed={point.id === marker.id}
                  onClick={() => change({ marker: point.id })}
                >
                  <span
                    className={point.id === marker.id ? styles.pickMarker : styles.pickSpare}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.pickSheet} data-offer-step="where">
          <h1 className={styles.pageTitle}>{offerCopy.whereTitle}</h1>

          {saved ? (
            <>
              {/* The address, once. The label above it would only repeat the question. */}
              <p className={styles.data} data-offer-address>{saved.address}</p>
              <button
                type="button"
                className={styles.quietButton}
                data-offer-change-place
                onClick={() => change({ departure: null })}
              >
                {offerCopy.whereChange}
              </button>

              {/*
               * The detour is one short answer among many, so it is a compact list and not six
               * buttons taking a screenful (DS §4).
               */}
              <label className={styles.textField} data-offer-detour>
                <span>{offerCopy.detourLabel}</span>
                <select
                  value={form.detour}
                  onChange={(event) => change({ detour: Number(event.target.value) })}
                >
                  {detourChoices.map((km) => (
                    <option key={km} value={km}>
                      {km === 0 ? offerCopy.detourNone : detourKm(km)}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.sheetActions}>
                <button type="button" className={styles.primaryButton} onClick={next}>
                  {offerCopy.next}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.data} data-offer-marker>{marker.address}</p>
              {/*
               * The rule about what becomes public, said once and quietly, where the driver decides
               * the place. It is a sentence, not a panel: a highlighted block made a short rule look
               * like a warning about something going wrong (IA §11.6).
               */}
              <p className={styles.fieldHint} data-offer-privacy>{offerCopy.wherePrivacy}</p>

              {/* One place is required, so before it there is one intent and no «Далее». */}
              <div className={styles.sheetActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  data-offer-confirm
                  onClick={() => change({ departure: marker.id })}
                >
                  {offerCopy.mapConfirm}
                </button>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  /* --------------------------------------------------------- screen 3: the details of the trip */

  /**
   * Everything about the trip a person still edits, on one screen: how many people fit, whether
   * children are among them, whether there is a seat, whether the driver comes back and anything
   * short worth adding. The child seat appears only when children do (IA §2.3).
   */
  function detailsScreen() {
    return (
      <>
        <h1 className={styles.pageTitle}>{offerCopy.detailsTitle}</h1>

        <Stepper
          label={offerCopy.seatsLabel}
          value={form.seats}
          min={1}
          max={8}
          onChange={(seats) => change({ seats })}
        />

        <fieldset className={styles.choiceGroup} data-offer-children>
          <legend className={styles.fieldLabel}>{offerCopy.childrenLabel}</legend>
          {([[true, offerCopy.childrenYes], [false, offerCopy.childrenNo]] as const).map(([able, label]) => (
            <label
              key={label}
              className={styles.choice}
              data-choice-selected={form.children === able ? '' : undefined}
            >
              <input
                type="radio"
                name="offer-children"
                checked={form.children === able}
                onChange={() => change({ children: able, childSeat: able && form.childSeat })}
              />
              <span><strong>{label}</strong></span>
            </label>
          ))}
        </fieldset>

        {form.children && (
          <div className={styles.revealed} data-offer-child-seat>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={form.childSeat}
                onChange={() => change({ childSeat: !form.childSeat })}
              />
              <span>{offerCopy.childSeatYes}</span>
            </label>
            <p className={styles.fieldHint}>{offerCopy.childSeatHint}</p>
          </div>
        )}

        <div className={styles.revealed} data-offer-return>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.returnRide}
              onChange={() => change({ returnRide: !form.returnRide })}
            />
            <span>{offerCopy.detailsReturn}</span>
          </label>
        </div>

        {/*
         * The warning about what not to write stands inside the field, where the person is about to
         * write it, instead of as a paragraph under it that is read after the fact (IA §6.4).
         */}
        <label className={styles.noteField} data-offer-note>
          <span>{offerCopy.noteLabel}</span>
          <textarea
            rows={3}
            maxLength={200}
            placeholder={offerCopy.notePlaceholder}
            value={form.note}
            onChange={(event) => change({ note: event.target.value })}
          />
        </label>

        <FormFooter action={offerCopy.next} onAction={next} />
      </>
    );
  }

  /* ---------------------------------------------------------------- screen 4: check the trip */

  function summaryRow(section: string, target: OfferStep, body: React.ReactNode) {
    return (
      <div className={styles.summaryRow} data-summary-row data-summary-section={section}>
        <div>
          <p className={styles.summaryLabel}>{section}</p>
          {body}
        </div>
        <button
          type="button"
          className={styles.quietButton}
          aria-label={offerSummaryEditName(section)}
          onClick={() => goTo(target)}
        >
          {offerCopy.edit}
        </button>
      </div>
    );
  }

  /**
   * A screen that only shows. No question is asked here, nothing is entered here, and the privacy
   * rule is not repeated here — it was said on screen 2, where the place is chosen. Five rows, a
   * quiet «Изменить» beside each of them, and one action.
   */
  function reviewScreen() {
    const saved = departureAt();

    return (
      <>
        <h1 className={styles.pageTitle}>{offerCopy.reviewTitle}</h1>

        <section
          className={styles.summary}
          data-offer-summary
          role="group"
          aria-label={offerCopy.summaryGroup}
        >
          {summaryRow(offerCopy.summaryWhen, 'when', (
            <>
              <p className={styles.summaryValue}>{offerWhenSummary(form)}</p>
              {/* The rule about a series is said on screen 1, where the series is chosen. */}
              {form.kind === 'recurring' && (
                <p className={styles.summaryValue}>
                  {offerPeriod(formatDay(form.from), formatDay(form.to))}
                </p>
              )}
            </>
          ))}
          {summaryRow(offerCopy.summaryWhere, 'where', (
            <>
              <p className={styles.summaryValue}>{saved ? saved.address : offerCopy.empty}</p>
              <p className={styles.summaryValue}>
                {form.detour === 0 ? offerCopy.detourNone : detourKm(form.detour)}
              </p>
            </>
          ))}
          {summaryRow(offerCopy.summarySeats, 'details', (
            <>
              <p className={styles.summaryValue}>{offerSeatsValue(form.seats)}</p>
              <p className={styles.summaryValue}>
                {form.children ? offerCopy.childrenYes : offerCopy.childrenNo}
              </p>
              {form.children && form.childSeat && (
                <p className={styles.summaryValue} data-offer-summary-seat>{offerCopy.childSeatYes}</p>
              )}
            </>
          ))}
          {summaryRow(offerCopy.summaryReturn, 'details', (
            <p className={styles.summaryValue}>
              {form.returnRide ? offerCopy.detailsReturn : offerCopy.returnNo}
            </p>
          ))}
          {summaryRow(offerCopy.summaryNote, 'details', (
            <p className={styles.summaryValue} data-offer-summary-note>
              {form.note.trim() === '' ? offerCopy.empty : form.note}
            </p>
          ))}
        </section>

        <FormFooter action={offerCopy.publish} onAction={() => undefined} />
      </>
    );
  }

  /* ------------------------------------------------------------------------------- assembly */

  const frameLabel: Record<OfferStep, string> = {
    when: 'Предложение водителя: когда',
    where: 'Предложение водителя: откуда вы едете',
    details: 'Предложение водителя: детали поездки',
    review: 'Предложение водителя: проверьте поездку',
  };

  /*
   * «Откуда вы едете?» is a map screen: the map runs to the top edge and the sheet rides over its
   * lower part, so it carries its own quiet way back over the map instead of the header bar.
   */
  if (form.step === 'where') {
    return (
      <PhoneFrame label={frameLabel.where} textZoom={textZoom}>
        {whereScreen()}
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame label={frameLabel[form.step]} textZoom={textZoom}>
      <FormHeader context={offerCopy.title} backLabel={offerCopy.back} onBack={back} />
      <main className={styles.formContent} data-offer-step={form.step}>
        {form.step === 'when' && whenScreen()}
        {form.step === 'details' && detailsScreen()}
        {form.step === 'review' && reviewScreen()}
      </main>
    </PhoneFrame>
  );
}


/* ------------------------------------------------------------------ review-only source key */

/*
 * The request states share one form, so they share the rows of the screen they open on. Repeating
 * the same eleven rows in ten places would let two copies of one string drift apart.
 */

const whenRows: ReadonlyArray<StringSource> = [
  { text: requestCopy.title, mark: 'Утверждено', note: 'копия 4.5; название того, что создаётся' },
  { text: requestCopy.back, mark: 'Утверждено', note: 'DS §5, тихое действие' },
  { text: requestCopy.whenTitle, mark: 'Утверждено', note: 'копия 4.5; один вопрос экрана' },
  { text: requestCopy.whenOr, mark: 'Утверждено', note: 'тихий разделитель двух способов ответить' },
  { text: requestCopy.whenCustom, mark: 'Утверждено', note: 'IA §10.1; второй способ ответить на тот же вопрос' },
  { text: requestCopy.whenArrivalLabel, mark: 'Утверждено', note: 'заменяет «Хочу приехать к», решение владельца 26.08.2026' },
  { text: requestCopy.whenCustomHint, mark: 'Утверждено', note: 'PS §7.2; теперь стоит до выбора своей даты' },
  { text: requestCopy.whenHorizon, mark: 'Утверждено', note: 'IA §10.3; теперь стоит после выбора своей даты, вместо подсказки выше' },
  { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5, одно главное действие' },
];

/*
 * The map is part of this screen now, so the map strings are rows of it and there is no separate
 * map key. What is on the screen depends only on how many places are already saved.
 */
const placeMapRows: ReadonlyArray<StringSource> = [
  { text: requestCopy.placeTitle, mark: 'Утверждено', note: 'PS §8.1; один вопрос, один экран' },
  { text: requestCopy.placePrivacy, mark: 'Утверждено', note: 'IA §10.4; сказано один раз на экране' },
  { text: requestCopy.mapSearch, mark: 'Утверждено', note: 'заменяет «Найти адрес», решение владельца 26.08.2026' },
  { text: 'Выбрано: {адрес}', mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.selected`' },
  { text: requestCopy.mapHint, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.hint`' },
  { text: requestCopy.placeAdd, mark: 'Утверждено', note: 'решение 1.7 (6); сохраняет отмеченную точку' },
];

const placeEmptyRows: ReadonlyArray<StringSource> = placeMapRows;

const mapRows: ReadonlyArray<StringSource> = [
  ...placeMapRows.slice(0, 5),
  { text: requestCopy.mapConfirm, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.confirm`; при изменении сохранённого места вместо «Добавить место»' },
  { text: requestCopy.placePrimary, mark: 'Утверждено', note: 'копия 4.5' },
  { text: requestCopy.placeChange, mark: 'Утверждено', note: 'копия 4.5; переводит место на карту, никуда не уводя' },
];

const placeRows: ReadonlyArray<StringSource> = [
  ...placeMapRows,
  { text: requestCopy.placePrimary, mark: 'Утверждено', note: 'копия 4.5' },
  { text: requestCopy.placeAlternative, mark: 'Утверждено', note: 'подпись второго и третьего места' },
  { text: requestCopy.placeOr, mark: 'Утверждено', note: 'разделитель между карточками мест' },
  { text: requestCopy.placeChange, mark: 'Утверждено', note: 'копия 4.5; переводит место на карту, никуда не уводя' },
  { text: requestCopy.placeRemove, mark: 'Утверждено', note: 'копия 4.5; у основного места не показывается' },
  { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
];

/*
 * At three places the reason replaces the action, and it is the only thing said about the limit:
 * the longer «Можно указать до трёх мест…» is removed and not replaced (owner decision 26.08.2026).
 */
const placeFullRows: ReadonlyArray<StringSource> = [
  ...placeMapRows.slice(0, 5),
  { text: requestCopy.placeLimit, mark: 'Утверждено', note: 'причина вместо неактивной кнопки, IA §28.3; единственное объяснение предела' },
  { text: requestCopy.placePrimary, mark: 'Утверждено', note: 'копия 4.5' },
  { text: requestCopy.placeAlternative, mark: 'Утверждено', note: 'подпись второго и третьего места' },
  { text: requestCopy.placeOr, mark: 'Утверждено', note: 'разделитель между карточками мест' },
  { text: requestCopy.placeChange, mark: 'Утверждено', note: 'копия 4.5' },
  { text: requestCopy.placeRemove, mark: 'Утверждено', note: 'копия 4.5' },
  { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
];

const peopleRows: ReadonlyArray<StringSource> = [
  { text: requestCopy.peopleTitle, mark: 'Утверждено', note: 'копия 4.5; один вопрос, три поля' },
  { text: requestCopy.peopleTotal, mark: 'Утверждено', note: 'IA §47.6' },
  { text: requestCopy.peopleChildren, mark: 'Утверждено', note: 'IA §47.6' },
  { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
];

const peopleChildrenRows: ReadonlyArray<StringSource> = [
  ...peopleRows.slice(0, 3),
  { text: requestCopy.peopleChildSeat, mark: 'Утверждено', note: 'IA §2.3; появляется, когда есть дети' },
  { text: requestCopy.peopleChildSeatHint, mark: 'Утверждено', note: 'IA §2.3, дословно' },
  { text: requestCopy.next, mark: 'Утверждено', note: 'DS §5' },
];

/*
 * Screen 4, the subject of group 2B. The first six rows already stand in the master text of
 * Foundation 4.5; the five rows of the compact summary are new and are added to the corpus by this
 * work. The owner approved all of them on 26 August 2026.
 */
const finalRows: ReadonlyArray<StringSource> = [
  { text: requestCopy.finalTitle, mark: 'Утверждено', note: 'копия 4.5, `request.step.final.title`' },
  { text: requestCopy.finalReturn, mark: 'Утверждено', note: 'копия 4.5, `request.step.return`; IA §11.5' },
  { text: requestCopy.finalNoteLabel, mark: 'Утверждено', note: 'копия 4.5, `request.step.note.label`; IA §10.1' },
  { text: requestCopy.finalNoteHint, mark: 'Утверждено', note: 'копия 4.5, `request.step.note.hint`; IA §6.4' },
  { text: requestCopy.summaryWhen, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает вопросу экрана 1' },
  { text: requestCopy.summaryPlace, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает вопросу экрана 2' },
  { text: requestCopy.summaryPeople, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает вопросу экрана 3' },
  { text: requestCopy.edit, mark: 'Утверждено', note: 'копия 4.5, `request.edit`; DS §5, тихое действие' },
  { text: summaryEditName(requestCopy.summaryWhen), mark: 'Утверждено', note: 'новое: имя действия для вспомогательных технологий, на экране не видно' },
  { text: requestCopy.summaryGroup, mark: 'Утверждено', note: 'новое: имя блока резюме для вспомогательных технологий, на экране не видно' },
  { text: requestCopy.placeOr, mark: 'Утверждено', note: 'в резюме мест — та же строка, что на экране 2' },
  { text: requestCopy.peopleChildSeat, mark: 'Утверждено', note: 'в резюме — та же строка, что на экране 3' },
  { text: requestCopy.finalPublish, mark: 'Утверждено', note: 'копия 4.5, `request.publish`; IA §19.2; вход и проверка контактов — отдельная подгруппа' },
];

/*
 * The driver offer: four semantic screens (owner decision of 27 August 2026), simplified on
 * 28 and 29 August, and approved by the owner on 2 September 2026. `Утверждено` records that the
 * owner accepted the wording on the assembled screen; the note beside a row still names where the
 * wording came from. `IA`, `PS` and `DS` mark text an approved document already fixes.
 *
 * The screens share one form, so they share the rows of the screen they open on: repeating the
 * same rows in ten places would let two copies of one string drift apart.
 */
const offerChrome: ReadonlyArray<StringSource> = [
  { text: offerCopy.title, mark: 'IA', note: 'IA §9; название того, что создаётся' },
  { text: offerCopy.back, mark: 'DS', note: 'DS §5, тихое действие' },
  { text: offerCopy.next, mark: 'DS', note: 'DS §5, одно главное действие' },
];

const offerWhenRows: ReadonlyArray<StringSource> = [
  ...offerChrome,
  { text: offerCopy.whenTitle, mark: 'Утверждено', note: 'новое: заголовок экрана 1; заменяет «Как часто вы ездите?» и заголовок бывшего шага 2' },
  { text: offerCopy.whenOneTime, mark: 'IA', note: 'IA §11.2; переключатель вверху экрана 1, а не отдельный экран' },
  { text: offerCopy.whenRecurring, mark: 'IA', note: 'IA §11.3' },
  { text: offerCopy.whenOr, mark: 'Утверждено', note: 'тихий разделитель двух способов ответить, как в просьбе пассажира' },
  { text: offerCopy.whenCustom, mark: 'Утверждено', note: 'формулировка взята из формы пассажира и здесь ещё не проверена' },
  { text: offerCopy.whenArrivalLabel, mark: 'Утверждено', note: 'новое: называет, что водитель указывает время у храма; времени выезда форма больше не собирает' },
];

const offerWhenCustomRows: ReadonlyArray<StringSource> = offerWhenRows;

const offerWhenRecurringRows: ReadonlyArray<StringSource> = [
  ...offerWhenRows.slice(0, 6),
  { text: offerCopy.whenRecurringHint, mark: 'IA', note: 'IA §11.3; показывается только после выбора регулярной поездки' },
  { text: '{служба} · по воскресеньям, 9:00', mark: 'Утверждено', note: 'новое: у регулярной поездки служба называется недельным временем, а не одной датой' },
  { text: offerCopy.whenCustomRecurring, mark: 'Утверждено', note: 'новое: у регулярной поездки дата не спрашивается — её дают дни недели и период' },
  { text: offerCopy.whenArrivalTimeLabel, mark: 'Утверждено', note: 'новое: подпись собственного времени регулярной поездки' },
  { text: offerCopy.daysTitle, mark: 'Утверждено', note: 'копия 4.6, `offer.step.days.label`, из заголовка экрана превращена в подпись поля' },
  { text: 'Пн · Вт · Ср · Чт · Пт · Сб · Вс', mark: 'Утверждено', note: 'строки в корпусе текстов нет: короткие подписи дней, полное имя дня — для вспомогательных технологий' },
  { text: offerCopy.daysFrom, mark: 'Утверждено', note: 'строки в корпусе текстов нет: подпись начала периода' },
  { text: offerCopy.daysTo, mark: 'Утверждено', note: 'строки в корпусе текстов нет: подпись конца периода' },
  { text: offerPeriod('{от}', '{до}'), mark: 'Утверждено', note: 'копия 4.6, `offer.step.period`' },
];

/*
 * Screen 2 while a place is being chosen: the map, the address field, one short instruction and one
 * quiet line about what becomes public. Nothing else — everything else depends on the place.
 */
const offerWhereEmptyRows: ReadonlyArray<StringSource> = [
  ...offerChrome.slice(0, 2),
  { text: offerCopy.whereTitle, mark: 'Утверждено', note: 'новое: заголовок экрана 2; «Откуда вы поедете?» из копии 4.4.2 не используется' },
  { text: offerCopy.mapSearch, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.search`; у пассажира утверждена, здесь проверяется впервые' },
  { text: offerCopy.mapHint, mark: 'Утверждено', note: 'копия 4.4.2, `map.pick.hint`; после выбора места убирается вместе с полем адреса' },
  { text: offerCopy.wherePrivacy, mark: 'Утверждено', note: 'новое, короче прежнего: одно тихое предложение вместо выделенной панели; правило сказано один раз на всю форму (IA §11.6)' },
  { text: offerCopy.mapConfirm, mark: 'PS', note: 'PS §8.1; копия 4.4.2, `map.pick.confirm`' },
];

const offerWhereRows: ReadonlyArray<StringSource> = [
  ...offerChrome.slice(0, 3),
  { text: offerCopy.whereTitle, mark: 'Утверждено', note: 'новое: заголовок экрана 2' },
  { text: '{адрес}', mark: 'Утверждено', note: 'выбранный адрес показывается один раз; подписи над ним нет — её заменяет вопрос экрана' },
  { text: offerCopy.whereChange, mark: 'Утверждено', note: 'новое: возвращает этот же экран в режим выбора места, никуда не уводя' },
  { text: offerCopy.detourLabel, mark: 'Утверждено', note: 'копия 4.6, `offer.step.detour.label`; компактный список, а не экран с кнопками' },
  { text: offerCopy.detourNone, mark: 'Утверждено', note: 'копия 4.6, `offer.step.detour.none`' },
  { text: detourKm(15), mark: 'Утверждено', note: 'копия 4.6, `offer.step.detour.km`; лестница 0 / 2 / 5 / 10 / 15 / 20 км документами не закреплена' },
];

const offerDetailsRows: ReadonlyArray<StringSource> = [
  ...offerChrome,
  { text: offerCopy.detailsTitle, mark: 'Утверждено', note: 'новое: заголовок экрана 3; заменяет «Сколько мест вы можете предложить?», потому что экран уже не только о местах' },
  { text: offerCopy.seatsLabel, mark: 'Утверждено', note: 'строки в корпусе текстов нет: подпись счётчика мест' },
  { text: offerCopy.childrenLabel, mark: 'Утверждено', note: 'строки в корпусе текстов нет: подпись группы' },
  { text: offerCopy.childrenYes, mark: 'IA', note: 'IA §2.3' },
  { text: offerCopy.childrenNo, mark: 'IA', note: 'IA §2.3' },
  { text: offerCopy.detailsReturn, mark: 'IA', note: 'IA §11.5; копия 4.6, `offer.step.return`' },
  { text: offerCopy.noteLabel, mark: 'Утверждено', note: 'строки в корпусе текстов нет: подпись поля взята из формы пассажира' },
  { text: offerCopy.notePlaceholder, mark: 'Утверждено', note: 'новое: предупреждение IA §6.4 стоит подсказкой внутри поля; отдельного текста под полем больше нет' },
];

const offerDetailsChildrenRows: ReadonlyArray<StringSource> = [
  ...offerDetailsRows.slice(0, 8),
  { text: offerCopy.childSeatYes, mark: 'IA', note: 'IA §2.3; появляется, только когда водитель может везти детей' },
  { text: offerCopy.childSeatHint, mark: 'IA', note: 'IA §2.3; копия 4.6, `offer.step.child_seat.hint`' },
  ...offerDetailsRows.slice(8),
];

/*
 * Screen 4 shows and asks nothing. `offer.step.review.title` comes back as the name of this screen;
 * `offer.step.review.public` and the small public picture are withdrawn with it.
 */
const offerReviewRows: ReadonlyArray<StringSource> = [
  ...offerChrome.slice(0, 2),
  { text: offerCopy.reviewTitle, mark: 'Утверждено', note: 'копия 4.6, `offer.step.review.title`; экран только показывает, новых вопросов на нём нет' },
  { text: offerCopy.summaryWhen, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает вопросу экрана 1' },
  { text: offerCopy.summaryWhere, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает вопросу экрана 2' },
  { text: offerCopy.summarySeats, mark: 'Утверждено', note: 'новое: подпись строки резюме, отвечает части экрана 3' },
  { text: offerCopy.summaryReturn, mark: 'Утверждено', note: 'новое: подпись строки резюме; значение — та же строка, что на экране 3' },
  { text: offerCopy.summaryNote, mark: 'Утверждено', note: 'новое: подпись строки резюме' },
  { text: offerCopy.returnNo, mark: 'Утверждено', note: 'строки в корпусе текстов нет: отрицательный ответ о поездке обратно' },
  { text: offerCopy.empty, mark: 'Утверждено', note: 'необязательное поле, оставленное пустым; DS §10: пустое состояние не описывается как сбой' },
  { text: offerCopy.edit, mark: 'Утверждено', note: 'формулировка взята из формы пассажира; DS §5, тихое действие' },
  { text: offerSummaryEditName(offerCopy.summaryWhen), mark: 'Утверждено', note: 'новое: имя действия для вспомогательных технологий, на экране не видно' },
  { text: offerCopy.summaryGroup, mark: 'Утверждено', note: 'новое: имя блока резюме для вспомогательных технологий, на экране не видно' },
  { text: offerCopy.publish, mark: 'IA', note: 'IA §19.2; копия 4.6, `offer.publish`; вход и проверка контактов — отдельная подгруппа' },
];

/* A series adds only its period to the review: the rule about it belongs to screen 1. */
const offerReviewRecurringRows: ReadonlyArray<StringSource> = [
  ...offerReviewRows,
  { text: offerPeriod('{от}', '{до}'), mark: 'Утверждено', note: 'копия 4.6, `offer.step.period`; в резюме — та же строка, что на экране 1' },
];

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
   * The passenger request form: the first three screens approved on 24 August 2026 (group 2A), the
   * fourth screen and the corrections to the first three on 26 August 2026 (group 2B). The note
   * next to a row still names where the wording came from; the mark records that the owner accepted
   * it on the assembled screen.
   */
  'request-when': whenRows,
  'request-when-custom': whenRows,
  'request-place-empty': placeEmptyRows,
  'request-map': mapRows,
  'request-place': placeRows,
  'request-place-three': placeFullRows,
  'request-people': peopleRows,
  'request-people-children': peopleChildrenRows,
  'request-final': finalRows,
  'request-final-filled': finalRows,

  /* Group 3, the driver offer: proposed wording only, waiting for its own screen-by-screen review. */
  'offer-when': offerWhenRows,
  'offer-when-custom': offerWhenCustomRows,
  'offer-when-recurring': offerWhenRecurringRows,
  'offer-where-empty': offerWhereEmptyRows,
  'offer-where': offerWhereRows,
  'offer-seats': offerDetailsRows,
  'offer-seats-children': offerDetailsChildrenRows,
  'offer-final': offerReviewRows,
  'offer-final-filled': offerReviewRows,
  'offer-final-recurring': offerReviewRecurringRows,
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
          Состояния 5–14 — одна и та же форма просьбы пассажира с разными уже данными ответами, а не
          десять отдельных экранов. Строки трёх первых смысловых экранов утверждены 24 августа
          2026 года; экран «Последние детали», окончательная вёрстка «Где вас забрать?» и правки по
          собранной форме утверждены 26 августа 2026 года.
        </p>
      )}
      {sample.startsWith('offer-') && (
        <p>
          Состояния 15–24 — одна и та же форма предложения водителя с разными уже данными ответами.
          Четыре смысловых экрана: когда, откуда, детали поездки, проверьте поездку. Экран «откуда»
          упрощён до того, что человек на нём решает; все оставшиеся изменяемые сведения собраны на
          экране 3; экран 4 только показывает и вопросов не задаёт (решения владельца от 27, 28 и
          29 августа 2026 года). Строки этих экранов{' '}
          <strong>утверждены владельцем 2 сентября 2026 года</strong>. Сообщения об успешной
          публикации на собранной форме не показывались и остаются «Проект»: вход и проверка
          контактов проверяются своей группой.
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
      /*
       * One form per role for all of their states. The `key` restarts it when the owner picks
       * another state, so an entry point always opens with the answers it promises; inside a state
       * the form keeps everything the person has typed, forwards and backwards alike.
       */
      default:
        return sample.startsWith('offer-') ? (
          <DriverOfferForm key={sample} seed={offerSeeds[sample] ?? {}} textZoom={textZoom} />
        ) : (
          <PassengerRequestForm
            key={sample}
            seed={requestSeeds[sample] ?? {}}
            textZoom={textZoom}
          />
        );
    }
  }

  const choose = (group: Sample['group']) =>
    samples.filter((item) => item.group === group).map((item) => (
      <button
        key={item.id}
        type="button"
        aria-pressed={sample === item.id}
        onClick={() => setChosen(item.id)}
      >
        {item.label}
      </button>
    ));

  return (
    <div className={styles.reviewRoot}>
      <header className={styles.reviewHeader}>
        <p>Временная поверхность проверки · группы 1, 2A, 2B и 3 просмотрены</p>
        <h1>Проверка русской копии: храм, просьба пассажира и предложение водителя</h1>
        <p>
          Мобильные экраны шириной 390 px. Состояния 1–4 — первая группа после правок владельца от
          22 августа 2026 года. Состояния 5–14 — одна форма просьбы пассажира из четырёх смысловых
          вопросов, без отдельного экрана проверки перед публикацией. Форму можно пройти целиком:
          «Далее» и «Назад» работают, введённое сохраняется, «Изменить» в резюме возвращает к нужному
          экрану. Строки трёх первых экранов просмотрены 24 августа 2026 года, экран «Последние
          детали» и окончательная вёрстка «Где вас забрать?» — 26 августа 2026 года.
          Производственный интерфейс не изменён; поверхность существует только для просмотра слов.
        </p>
        <p>
          Состояния 15–24 — форма предложения водителя «Могу подвезти» из четырёх смысловых
          экранов: когда, откуда, детали поездки, проверьте поездку. Экран «откуда» после выбора
          места показывает адрес один раз, дорогу на карте и допустимое отклонение; времени выезда
          форма не собирает — сопоставление сравнивает указанные времена напрямую. Экран 4 только
          показывает введённое. Форму можно пройти целиком, ответы сохраняются. Строки этих экранов
          просмотрены 2 сентября 2026 года.
        </p>
      </header>
      <nav className={styles.reviewControls} aria-label="Выбор экрана проверки">
        <div>{choose('church')}</div>
        <div>{choose('request')}</div>
        <div>
          {choose('offer')}
          <button
            type="button"
            className={styles.zoomToggle}
            aria-pressed={textZoom}
            onClick={() => setTextZoom((current) => !current)}
          >
            Текст 200 %
          </button>
        </div>
      </nav>
      <div className={styles.reviewStage} data-sample-id={sample} data-text-zoom={textZoom ? '200' : 'off'}>
        {screen()}
        <SourcePanel sample={sample} />
      </div>
    </div>
  );
}
