// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import CopyReviewPage from './page';

afterEach(cleanup);

/*
 * Group 5 of the manual Russian copy review: «Мои поездки» (IA §16, §16.1–16.5, §27.2–27.3, §29.3;
 * copy 4.7 and 4.8), as the owner approved it on 18 September 2026 after the reviews of 4, 5 and
 * 18 September. These tests guard the decisions he made.
 *
 * Both reviews were removals. The first replaced repetition with the event; the second removed the
 * event too, because inside «Требуют ответа» every card needs an answer by definition, and re-cut
 * «Мои объявления» by what the person published rather than by how busy each listing is.
 *
 * The tests guard both halves: the removed texts must not creep back, and what replaced them must
 * still say enough — two groups named after the two roles, a compact plate instead of a narrated
 * event, and own-listing management that is not confused with withdrawing from one person.
 *
 * The product rules underneath are unchanged and still guarded: one section for both roles, no
 * contact or exact place outside a confirmed trip, no claim that the person must answer a proposed
 * change the projection cannot attribute, and the route stays isolated from production.
 */

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

function sourceRows() {
  const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
  return [...panel.querySelectorAll('dt')].map((row) => row.firstChild?.textContent);
}

const press = (name: string) => fireEvent.click(within(productScreen()).getByRole('button', { name }));

const tabNames = () =>
  [...productScreen().querySelectorAll('[data-trips-tab]')].map((tab) => tab.textContent);

/**
 * The counters of one card, row or opened trip — its own, not those of its rows. Read exactly,
 * because a doubled number («3 3 свободных места») is a formatting fault a substring check misses.
 */
const facts = (host: HTMLElement) =>
  [...(host.querySelector('[data-trip-facts]')?.children ?? [])].map((fact) => fact.textContent);

const cardIds = () =>
  [...productScreen().querySelectorAll('[data-trip-card]')].map(
    (card) => (card as HTMLElement).dataset.tripCard,
  );

const card = (id: string) =>
  productScreen().querySelector(`[data-trip-card="${id}"]`) as HTMLElement;

const detail = (id: string) =>
  productScreen().querySelector(`[data-trip-detail="${id}"]`) as HTMLElement;

const plate = (host: HTMLElement) => {
  const found = host.querySelector('[data-tone]') as HTMLElement | null;
  return found ? [found.textContent, found.dataset.tone] : null;
};

/** Every entry point, in the order the review switch offers them, with its own address. */
const tripsSamples = [
  ['32 · Ответ пассажира', 'trips-needs-passenger'],
  ['33 · Ответ водителя', 'trips-needs-driver'],
  ['34 · Мои объявления: разные состояния', 'trips-waiting'],
  ['35 · Предстоящая: пассажир', 'trips-upcoming-passenger'],
  ['36 · Предстоящая: водитель', 'trips-upcoming-driver'],
  ['37 · Мои объявления: без ожидающих действий', 'trips-listings'],
  ['38 · История', 'trips-history'],
  ['39 · Пустые состояния', 'trips-empty'],
  ['40 · Мои поездки на компьютере', 'trips-desktop'],
] as const;

const tabLabels = ['Требуют ответа', 'Предстоящие', 'Мои объявления', 'История'];

/** Everything the owner took off these screens on 4 and 5 September 2026. None may come back. */
const removedCopy = [
  'Требует подтверждения',
  'Требует ответа',
  'Ждёт вашего ответа',
  'Ждём ответа водителя',
  'Ждём ответа пассажира',
  'Ждём ответа второго человека',
  'предлагает подвезти вас',
  'просит подвезти её',
  'Вы отправили просьбу водителю',
  'Вы предложили Игорю место',
  'отклик',
  'Отклик',
  'Ждут решения',
  'Активные',
  'Просьбы о поездке',
  'Предложения подвезти',
  'Нужно ответить',
  'Могу подвезти обратно',
  'О времени выезда и других деталях договоритесь напрямую.',
  'Эта дата уже в разделе',
  'Контакты откроются только после того, как обе стороны подтвердят поездку.',
  'Поездка подтверждена',
  'Вы видите эти контакты, потому что поездка подтверждена.',
  'Остальное — время выезда, багаж, разделение расходов на топливо',
  'Что происходило',
  'История поездки',
  'Время поездки прошло — просьба больше не действует.',
  'Ответ необязателен. Он помогает нам понять, работает ли сервис',
  'Найдите храм, чтобы попросить о поездке или предложить свободные места.',
  'Сейчас ничего не ждёт вашего решения',
  'Посмотреть предстоящие',
  'Посмотреть объявления',
];

/** Copy the owner approved earlier and this review did not touch. It must survive verbatim. */
const keptCopy: ReadonlyArray<readonly [string, string]> = [
  ['38 · История', 'Поездка состоялась?'],
  ['38 · История', 'Отвечать не обязательно, но так вы поможете работе сервиса.'],
  ['38 · История', 'До указанного времени договориться о поездке не удалось.'],
  ['39 · Пустые состояния', 'Здесь появятся ваши поездки'],
  ['39 · Пустые состояния', 'Найдите храм, чтобы попросить подвезти или предложить место в машине.'],
  ['39 · Пустые состояния', 'Найти храм'],
];

describe('My Trips review states', () => {
  it('opens each of the nine states directly from its own address', () => {
    tripsSamples.forEach(([label, anchor]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      expect(productScreen()).not.toBeNull();
      cleanup();
    });
    window.location.hash = '';
  }, 36000);

  it('names the listings tab «Мои объявления» in every state and no longer «Объявления»', () => {
    tripsSamples.forEach(([label, anchor]) => {
      render(<CopyReviewPage />);
      openSample(label);
      /* A state that opens one trip shows it instead of the list on the phone (IA §29.3). */
      if (anchor === 'trips-upcoming-passenger' || anchor === 'trips-upcoming-driver') press('Мои поездки');

      expect(tabNames().map((name) => name?.replace(/\d+$/, ''))).toEqual(tabLabels);
      const listings = productScreen().querySelector('[data-trips-tab="listings"]') as HTMLElement;
      expect(listings.textContent).toBe('Мои объявления');
      /* IA §16: one section serves both roles; a «водитель / пассажир» switch must not appear. */
      expect(within(productScreen()).queryByRole('button', { name: 'Водитель' })).toBeNull();
      expect(within(productScreen()).queryByRole('button', { name: 'Пассажир' })).toBeNull();
      cleanup();
    });
  }, 36000);

  it('never brings back a text the owner removed on 4, 5 or 18 September 2026', () => {
    tripsSamples.forEach(([label, anchor]) => {
      render(<CopyReviewPage />);
      openSample(label);
      const walk = (text: string) =>
        removedCopy.forEach((gone) => expect(`${anchor}: ${text.includes(gone)}`).toBe(`${anchor}: false`));

      walk(productScreen().textContent ?? '');
      /* Also inside every opened trip and listing, where these texts used to live. */
      [...productScreen().querySelectorAll('[data-trip-card]')].forEach((item) => {
        const opener = within(item as HTMLElement).queryByRole('button', { name: /^(Открыть|Ответить): / });
        if (!opener) return;
        fireEvent.click(opener);
        walk(productScreen().textContent ?? '');
        const back = within(productScreen()).queryByRole('button', { name: 'Мои поездки' });
        if (back) fireEvent.click(back);
      });
      if (anchor === 'trips-upcoming-passenger' || anchor === 'trips-upcoming-driver') {
        press('Мои поездки');
        walk(productScreen().textContent ?? '');
      }
      if (anchor === 'trips-empty') {
        fireEvent.click(screen.getByRole('button', { name: 'Пуст только выбранный раздел' }));
        tabLabels.forEach((tab) => {
          fireEvent.click(within(productScreen()).getByRole('tab', { name: new RegExp(`^${tab}`) }));
          walk(productScreen().textContent ?? '');
        });
      }
      cleanup();
    });
  }, 36000);

  it('keeps every earlier approved string of the group verbatim', () => {
    keptCopy.forEach(([label, kept]) => {
      render(<CopyReviewPage />);
      openSample(label);
      expect(`${kept}: ${productScreen().textContent?.includes(kept)}`).toBe(`${kept}: true`);
      cleanup();
    });
  }, 24000);

  it('leaves a card that needs an answer with the decision and nothing about the state', () => {
    render(<CopyReviewPage />);
    openSample('32 · Ответ пассажира');

    const cards = [...productScreen().querySelectorAll('[data-trip-card]')];
    expect(cards.map((item) => (item as HTMLElement).dataset.tripRole)).toEqual(['passenger', 'driver']);

    cards.forEach((item) => {
      /* No plate and no sentence about a required answer: the open tab is the state. */
      expect(plate(item as HTMLElement)).toBeNull();
      expect(item.querySelector('[data-trip-line]')).toBeNull();
      expect(within(item as HTMLElement).getByRole('button', { name: 'Подтвердить поездку' })).not.toBeNull();
      expect(within(item as HTMLElement).getByRole('button', { name: 'Отказаться' })).not.toBeNull();
    });

    /* What is left is what the decision is about: role, service, city, person, conditions. */
    const passenger = card('needs-passenger');
    expect(passenger.textContent).toContain('Вы пассажир');
    expect(passenger.textContent).toContain('Божественная литургия · 23 августа, 9:00');
    expect(passenger.textContent).toContain('Catanzaro');
    expect(passenger.querySelector('[class]')).not.toBeNull();
    expect(passenger.querySelector('p[class*=personLine]')?.textContent).toBe('Водитель: Алексей');
    expect(facts(passenger)).toEqual(['Может подвезти обратно']);
    expect(passenger.querySelector('[data-trip-sentence]')?.textContent)
      .toBe('Водитель предлагает 1 место из 2. Остальным нужно будет найти другую машину.');

    const driver = card('needs-driver');
    expect(driver.textContent).toContain('Вы водитель');
    expect(driver.querySelector('p[class*=personLine]')?.textContent).toBe('Пассажир: Мария');
    expect(facts(driver)).toEqual(['2 пассажира, из них 1 ребёнок', 'Нужно детское кресло']);
  });

  it('groups «Мои объявления» by what the person published, not by how busy a listing is', () => {
    render(<CopyReviewPage />);
    openSample('34 · Мои объявления: разные состояния');

    const groups = [...productScreen().querySelectorAll('[data-trips-group]')];
    expect(groups.map((group) => (group as HTMLElement).dataset.tripsGroup)).toEqual(['passenger', 'driver']);
    expect(groups.map((group) => group.querySelector('h2')?.textContent))
      .toEqual(['Ищу поездку', 'Могу подвезти']);

    /* Inside a group: what needs the person, then what waits, then what merely runs. */
    expect([...groups[0].querySelectorAll('[data-trip-card]')].map(
      (item) => (item as HTMLElement).dataset.tripPriority,
    )).toEqual(['needs', 'waiting', 'active']);
    expect([...groups[1].querySelectorAll('[data-trip-card]')].map(
      (item) => (item as HTMLElement).dataset.tripPriority,
    )).toEqual(['needs', 'waiting']);
    /* Those three are the plate, not three more headings. */
    expect(productScreen().querySelectorAll('h2').length).toBe(2);
  });

  it('says the state of an own listing with a compact plate and no narration', () => {
    render(<CopyReviewPage />);
    openSample('34 · Мои объявления: разные состояния');

    expect(plate(card('listing-responses'))).toEqual(['Нужен ваш ответ', 'attention']);
    expect(plate(card('listing-waiting'))).toEqual(['Ждём ответа', 'waiting']);
    expect(plate(card('listing-quiet'))).toEqual(['Активно', 'neutral']);
    expect(plate(card('listing-offer-responses'))).toEqual(['Нужен ваш ответ', 'attention']);
    expect(plate(card('listing-offered'))).toEqual(['Ждём ответа', 'waiting']);

    /* A listing that needs the person leads to the answer; the others just open. */
    expect(within(card('listing-responses')).getByRole('button', { name: /^Ответить: / })).not.toBeNull();
    expect(within(card('listing-offer-responses')).getByRole('button', { name: /^Ответить: / })).not.toBeNull();
    ['listing-waiting', 'listing-quiet', 'listing-offered'].forEach((id) => {
      expect(within(card(id)).getByRole('button', { name: /^Открыть: / })).not.toBeNull();
      expect(within(card(id)).queryByRole('button', { name: /^Ответить: / })).toBeNull();
    });
    /* A name on a card is never bare. */
    expect(card('listing-waiting').querySelector('p[class*=personLine]')?.textContent).toBe('Водитель: Игорь');
    expect(card('listing-offered').querySelector('p[class*=personLine]')?.textContent).toBe('Пассажир: Игорь');

    /* The body describes the listing; the workflow is not narrated in it. */
    [...productScreen().querySelectorAll('[data-trip-card]')].forEach((item) => {
      expect(item.querySelector('[data-trip-line]')).toBeNull();
    });
    expect(facts(card('listing-responses'))).toEqual(['2 пассажира, из них 1 ребёнок']);

    /* The list itself carries no confirm/decline pair: the answer waits inside the opened listing. */
    expect(within(productScreen()).queryByRole('button', { name: 'Подтвердить поездку' })).toBeNull();
    expect(within(productScreen()).queryByRole('button', { name: 'Отказаться' })).toBeNull();
  });

  it('separates removing your own listing from withdrawing from one person', () => {
    render(<CopyReviewPage />);
    openSample('34 · Мои объявления: разные состояния');

    /* «Ответить» opens the listing with the person's offer first and the two answers on it. */
    press('Ответить: Божественная литургия · 23 августа, 9:00');
    const own = detail('listing-responses');
    const incoming = own.querySelector('[data-trip-incoming]') as HTMLElement;
    expect(incoming.querySelector('p[class*=personLine]')?.textContent).toBe('Водитель: Алексей');
    expect(facts(incoming)).toEqual(['Может подвезти обратно']);
    expect(within(incoming).getByRole('button', { name: 'Подтвердить поездку' })).not.toBeNull();
    expect(within(incoming).getByRole('button', { name: 'Отказаться' })).not.toBeNull();
    /* Managing the listing itself is a separate block below, and never the answer to the person. */
    const management = own.querySelector('[data-trip-management]') as HTMLElement;
    expect(incoming.compareDocumentPosition(management) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(management).getByRole('button', { name: 'Изменить объявление' })).not.toBeNull();
    expect(within(management).getByRole('button', { name: 'Снять объявление' })).not.toBeNull();
    expect(within(management).queryByRole('button', { name: 'Подтвердить поездку' })).toBeNull();
    expect(within(own).queryByRole('button', { name: 'Отозвать просьбу' })).toBeNull();
    press('Мои поездки');

    /* A listing with nothing to answer opens without an incoming block. */
    press('Открыть: Божественная литургия · 13 сентября, 9:00');
    expect(detail('listing-quiet').querySelector('[data-trip-incoming]')).toBeNull();
    expect(within(detail('listing-quiet')).queryByRole('button', { name: 'Подтвердить поездку' })).toBeNull();
    press('Мои поездки');

    /* One request sent to one driver is withdrawn from that person, not taken off the board. */
    press('Открыть: Всенощное бдение · 5 сентября, 18:00');
    const person = detail('listing-waiting');
    expect(within(person).getByRole('button', { name: 'Отозвать просьбу' })).not.toBeNull();
    expect(within(person).queryByRole('button', { name: 'Снять объявление' })).toBeNull();
    press('Мои поездки');

    press('Открыть: Божественная литургия · 6 сентября, 9:00');
    expect(within(detail('listing-offered')).getByRole('button', { name: 'Отозвать предложение' }))
      .not.toBeNull();
  });

  it('gives states 34 and 37 different accounts of the same tab', () => {
    render(<CopyReviewPage />);
    openSample('34 · Мои объявления: разные состояния');
    const withInteractions = cardIds();

    openSample('37 · Мои объявления: без ожидающих действий');
    const published = cardIds();

    expect(published).toEqual(['listing-request', 'listing-offer', 'listing-series']);
    expect(withInteractions.some((id) => published.includes(id!))).toBe(false);
    /* The same two groups, and nothing here needs the person. */
    expect([...productScreen().querySelectorAll('[data-trips-group]')].map(
      (group) => (group as HTMLElement).dataset.tripsGroup,
    )).toEqual(['passenger', 'driver']);
    expect([...productScreen().querySelectorAll('[data-trip-card]')].map(
      (item) => (item as HTMLElement).dataset.tripPriority,
    )).toEqual(['active', 'active', 'active']);
  });

  it('keeps a listing card short and puts its conditions inside the opened listing', () => {
    render(<CopyReviewPage />);
    openSample('37 · Мои объявления: без ожидающих действий');

    /* One compact line on the card; the child seat and the return trip wait inside. */
    expect(facts(card('listing-request'))).toEqual(['2 пассажира, из них 1 ребёнок']);
    expect(card('listing-request').textContent).not.toContain('Нужно детское кресло');
    expect(card('listing-request').textContent).not.toContain('Нужна поездка обратно');

    press('Открыть: Божественная литургия · 6 сентября, 9:00');
    const opened = detail('listing-request');
    expect(opened.querySelector('[data-trip-group]')?.getAttribute('data-trip-group')).toBe('Поездка');
    expect(facts(opened)).toEqual([
      '2 пассажира, из них 1 ребёнок',
      'Нужно детское кресло',
      'Нужна поездка обратно',
    ]);
    expect(within(opened).getByRole('button', { name: 'Снять объявление' })).not.toBeNull();
  });

  it('keeps a regular trip compact in the list and its dates inside it', () => {
    render(<CopyReviewPage />);
    openSample('37 · Мои объявления: без ожидающих действий');
    const series = card('listing-series');

    expect(series.textContent).toContain('Регулярная поездка');
    expect(card('listing-offer').textContent).not.toContain('Регулярная поездка');
    /* The rhythm and how many dates — not a table of them (owner decision of 4 September 2026). */
    expect(facts(series)).toEqual(['По воскресеньям · до 13 сентября', '3 ближайшие даты']);
    expect(series.querySelectorAll('[data-trip-row]').length).toBe(0);
    expect(series.textContent).not.toContain('30 августа');

    press('Открыть: Регулярная поездка · Божественная литургия, 9:00');
    const opened = detail('listing-series');
    expect([...opened.querySelectorAll('[data-trip-row]')].map((row) => (row as HTMLElement).dataset.tripRow))
      .toEqual(['series-30', 'series-06', 'series-13']);
    expect(facts(opened.querySelector('[data-trip-row="series-30"]') as HTMLElement))
      .toEqual(['3 из 4 мест заняты', '1 свободное место']);
    expect(opened.textContent).toContain('Каждая дата остаётся отдельной поездкой с отдельными местами.');
    /* Internal vocabulary of the data model never reaches the screen (copy 3.4, 3.5). */
    ['серия', 'Серия', 'occurrence', 'экземпляр'].forEach((forbidden) => {
      expect(productScreen().textContent).not.toContain(forbidden);
    });
  });

  it('never says that the person must answer a proposed change', () => {
    render(<CopyReviewPage />);
    openSample('35 · Предстоящая: пассажир');
    press('Мои поездки');
    const change = card('upcoming-change');

    expect(plate(change)).toEqual(['Ожидает подтверждения изменений', 'attention']);
    expect(change.textContent).toContain('Условия поездки предложено изменить');
    /*
     * The read projection stores `change_pending` without saying whose answer it is, so neither
     * `change.pending.mine` nor `change.pending.theirs` may be shown, and the card must not join
     * the section that means «this is yours to answer».
     */
    expect(change.textContent).not.toContain('Вам предлагают изменить условия');
    expect(change.textContent).not.toContain('Ждём ответа на ваши изменения');
    expect(within(change).queryByRole('button', { name: 'Принять новые условия' })).toBeNull();

    openSample('32 · Ответ пассажира');
    expect(cardIds()).not.toContain('upcoming-change');
  });

  it('makes calling the confirmed driver the one accent action of the trip', () => {
    render(<CopyReviewPage />);
    openSample('35 · Предстоящая: пассажир');
    const opened = detail('upcoming-passenger');

    expect(plate(opened)).toEqual(['Подтверждено', 'confirmed']);
    const groups = [...opened.querySelectorAll('[data-trip-group]')];
    expect(groups.map((group) => (group as HTMLElement).dataset.tripGroup)).toEqual(['Встреча', 'Поездка']);
    expect(facts(groups[0] as HTMLElement)).toEqual(['Catanzaro Lido, у входа в библиотеку', '23 августа, 8:00']);
    expect(facts(groups[1] as HTMLElement)).toEqual([
      '2 подтверждённых пассажира',
      'Ещё 1 человеку нужно место',
      'Нужна поездка обратно',
    ]);

    /* Exactly one accent action on the screen, and it is the likeliest next thing to do. */
    const styleOf = (name: string) =>
      (within(opened).getByRole('button', { name }) as HTMLElement).className;
    const callClass = styleOf('Позвонить');
    expect(styleOf('Написать по email')).not.toBe(callClass);
    expect(styleOf('Изменить условия')).not.toBe(callClass);
    expect(styleOf('Отменить поездку')).not.toBe(callClass);
    expect(styleOf('Пожаловаться')).not.toBe(callClass);
    expect(styleOf('Пожаловаться')).not.toBe(styleOf('Отменить поездку'));
    expect([...opened.querySelectorAll('button')].filter((b) => b.className === callClass).length).toBe(1);

    /* No trip history before the trip has happened, and no notice about other details. */
    expect(within(opened).queryByRole('button', { name: 'История поездки' })).toBeNull();
    expect(within(opened).queryByRole('button', { name: 'Что происходило' })).toBeNull();
    expect(opened.textContent).not.toContain('О времени выезда');

    /* Contacting the driver and managing the trip are two blocks; the complaint sits under both. */
    const contacts = opened.querySelector('[data-trip-contacts]') as HTMLElement;
    const management = opened.querySelector('[data-trip-management]') as HTMLElement;
    expect(contacts.querySelector('p[class*=personLine]')?.textContent).toBe('Водитель: Алексей');
    expect(management.querySelector('h4')?.textContent).toBe('Управление поездкой');
    expect([...management.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Изменить условия', 'Отменить поездку']);
    expect(within(contacts).queryByRole('button', { name: 'Изменить условия' })).toBeNull();
    expect(within(management).queryByRole('button', { name: 'Пожаловаться' })).toBeNull();
    const report = within(opened).getByRole('button', { name: 'Пожаловаться' });
    expect(management.compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('separates confirmed passengers from an answer that is not the driver to give', () => {
    render(<CopyReviewPage />);
    openSample('36 · Предстоящая: водитель');
    const opened = detail('upcoming-driver');

    expect(plate(opened)).toEqual(['Подтверждено', 'confirmed']);
    expect(opened.textContent).toContain('Вы водитель');
    expect(opened.textContent).toContain('Дата регулярной поездки');
    expect(facts(opened)).toEqual(['30 августа, 8:00', '3 из 4 мест заняты', '1 свободное место']);

    const maria = opened.querySelector('[data-trip-row="maria"]') as HTMLElement;
    const igor = opened.querySelector('[data-trip-row="igor"]') as HTMLElement;
    expect(maria.dataset.rowKind).toBe('confirmed');
    expect(igor.dataset.rowKind).toBe('pending');
    expect(plate(maria)).toEqual(['Подтверждено', 'confirmed']);
    expect(facts(maria)).toEqual(['2 пассажира, из них 1 ребёнок', 'Нужно детское кресло']);

    /* The waiting row carries a plate and offers nothing, because the answer is his to give. */
    expect(plate(igor)).toEqual(['Ждём ответа', 'waiting']);
    expect(igor.querySelector('strong')?.textContent).toBe('Пассажир: Игорь');
    expect(within(igor).queryAllByRole('button')).toEqual([]);
    expect(within(opened).queryByRole('button', { name: 'История поездки' })).toBeNull();
    /* This task builds no route: the future multi-stop idea is not on the screen. */
    expect(opened.textContent).not.toContain('Построить маршрут');
  });

  it('keeps contacts and exact places out of every list', () => {
    render(<CopyReviewPage />);

    (['34 · Мои объявления: разные состояния', '37 · Мои объявления: без ожидающих действий', '38 · История'] as const)
      .forEach((label) => {
        openSample(label);
        ['+39', '@example.invalid', 'Место встречи:'].forEach((secret) => {
          expect(`${label}: ${productScreen().textContent?.includes(secret)}`).toBe(`${label}: false`);
        });
      });

    /* They exist only inside a confirmed trip, because it is confirmed (IA §6.5, §16.5). */
    openSample('35 · Предстоящая: пассажир');
    expect(detail('upcoming-passenger').textContent).toContain('Catanzaro Lido, у входа в библиотеку');
    expect(detail('upcoming-passenger').textContent).toContain('+39 000 000 00 00');
  });

  it('asks about the outcome only on a trip whose time has passed, and tells the three ends apart', () => {
    render(<CopyReviewPage />);
    openSample('38 · История');

    expect(cardIds()).toEqual(['history-completed', 'history-cancelled', 'history-expired']);
    /* Three different ends, three different tones; the words carry the meaning on their own. */
    expect([...productScreen().querySelectorAll('[data-tone]')].map((item) => [
      item.textContent,
      item.getAttribute('data-tone'),
    ])).toEqual([
      ['Завершено', 'completed'],
      ['Отменено', 'cancelled'],
      ['Время прошло', 'expired'],
    ]);

    const completed = card('history-completed');
    expect(completed.querySelector('[data-trip-outcome]')?.textContent).toContain('Поездка состоялась?');
    expect(within(completed).getByRole('button', { name: 'Да' })).not.toBeNull();
    expect(within(completed).getByRole('button', { name: 'Нет' })).not.toBeNull();
    expect(completed.textContent).toContain('Отвечать не обязательно, но так вы поможете работе сервиса.');
    expect(productScreen().querySelectorAll('[data-trip-outcome]').length).toBe(1);

    expect(card('history-cancelled').textContent).toContain('Водитель отменил поездку');
    /* The expired request says how it ended, not that a listing stopped working. */
    expect(card('history-expired').querySelector('[data-trip-sentence]')?.textContent)
      .toBe('До указанного времени договориться о поездке не удалось.');

    /* IA §16.4, §45.4: a future trip is never «Завершено» and is never asked. */
    openSample('35 · Предстоящая: пассажир');
    press('Мои поездки');
    expect(productScreen().querySelectorAll('[data-trip-outcome]').length).toBe(0);
    expect(productScreen().textContent).not.toContain('Завершено');
  });

  it('leaves one action on the empty account and none on a single empty section', () => {
    render(<CopyReviewPage />);
    openSample('39 · Пустые состояния');

    /* Nothing anywhere: one general screen with «Найти храм». */
    const all = productScreen().querySelector('[data-trips-empty="all"]') as HTMLElement;
    expect(all.textContent).toContain('Здесь появятся ваши поездки');
    expect(all.textContent).toContain('Найдите храм, чтобы попросить подвезти или предложить место в машине.');
    expect(within(all).getByRole('button', { name: 'Найти храм' })).not.toBeNull();

    /* Data elsewhere: the text belongs to the selected section, the four differ, and none has a CTA. */
    fireEvent.click(screen.getByRole('button', { name: 'Пуст только выбранный раздел' }));
    const texts: string[] = [];
    ([
      ['Требуют ответа', 'needs', 'Сейчас нет поездок, которые требуют вашего ответа.'],
      ['Предстоящие', 'upcoming', 'У вас нет предстоящих договорённостей'],
      ['Мои объявления', 'listings', 'У вас нет активных просьб и предложений'],
      ['История', 'history', 'Завершённых и отменённых поездок пока нет'],
    ] as const).forEach(([tab, key, expected]) => {
      fireEvent.click(within(productScreen()).getByRole('tab', { name: new RegExp(`^${tab}`) }));
      const empty = productScreen().querySelector(`[data-trips-empty="${key}"]`) as HTMLElement;
      expect(empty.textContent).toBe(expected);
      /* The tabs are the navigation; a partially empty section offers no action of its own. */
      expect(within(empty).queryAllByRole('button')).toEqual([]);
      expect(within(productScreen()).queryByRole('button', { name: 'Найти храм' })).toBeNull();
      texts.push(expected);
      expect(cardIds()).toEqual([]);
    });
    expect(new Set(texts).size).toBe(4);
  });

  it('collapses the repeated church name only while the list belongs to one church', () => {
    render(<CopyReviewPage />);
    openSample('32 · Ответ пассажира');
    /* IA §16: one church across the list leaves only the distinguishing context on the rows. */
    expect(productScreen().textContent).not.toContain('Покров Пресвятой Богородицы');
    expect(productScreen().textContent).toContain('Catanzaro');

    openSample('38 · История');
    expect(productScreen().textContent).toContain('Покров Пресвятой Богородицы · Catanzaro');
    expect(productScreen().textContent).toContain('Храм великомученика Георгия · Crotone');
  });

  it('carries the same hierarchy into the one desktop state', () => {
    render(<CopyReviewPage />);
    openSample('40 · Мои поездки на компьютере');

    /* IA §29.3: sections and the list on the left, the opened trip on the right. */
    const desktop = screen.getByRole('region', { name: 'Мои поездки на компьютере' });
    expect(desktop.querySelector('[data-trips-list]')).not.toBeNull();
    expect(desktop.querySelector('[data-trip-detail="upcoming-passenger"]')).not.toBeNull();
    expect(desktop.querySelector('[data-trip-selected="yes"]')?.getAttribute('data-trip-card'))
      .toBe('upcoming-passenger');
    expect(tabNames().length).toBe(4);

    /* The same groups as on the phone: «Встреча» and «Поездка», no repeated state sentence. */
    expect([...desktop.querySelectorAll('[data-trip-detail] [data-trip-group]')].map(
      (group) => (group as HTMLElement).dataset.tripGroup,
    )).toEqual(['Встреча', 'Поездка']);
    expect(desktop.textContent).not.toContain('Поездка подтверждена');
    expect(within(desktop).getByRole('button', { name: 'Позвонить' })).not.toBeNull();

    /* «Открыть» repeats on every card, so each one names its trip for assistive technology. */
    expect(within(desktop).getByRole('button', { name: 'Открыть: Божественная литургия · 30 августа, 9:00' }))
      .not.toBeNull();
    expect(within(desktop).queryByRole('button', { name: 'Открыть: Божественная литургия · 23 августа, 9:00' }))
      .toBeNull();

    /* The listings tab of the wide layout carries the same two groups and the same compact series. */
    fireEvent.click(within(desktop).getByRole('tab', { name: /^Мои объявления/ }));
    expect([...desktop.querySelectorAll('[data-trips-group]')].map(
      (group) => (group as HTMLElement).dataset.tripsGroup,
    )).toEqual(['passenger', 'driver']);
    expect(desktop.querySelector('[data-trip-card="listing-series"]')?.querySelectorAll('[data-trip-row]').length)
      .toBe(0);
    /* The phone frame is not the desktop one: only one state of the group is a computer state. */
    expect(document.querySelectorAll('[data-product-screen]').length).toBe(1);
  });

  it('marks every live string of the group as approved and keeps the removed ones on record', () => {
    render(<CopyReviewPage />);
    openSample('32 · Ответ пассажира');

    /* The key names the strings that are actually rendered, so the owner compares what he sees. */
    expect(sourceRows()).toContain('Мои поездки');
    tabLabels.forEach((tab) => expect(sourceRows()).toContain(tab));
    /* The removed sentences stay in the key so a later assembly does not quietly restore them. */
    expect(sourceRows()).toContain('Алексей предлагает подвезти вас');
    expect(sourceRows()).toContain('Требует подтверждения');

    openSample('34 · Мои объявления: разные состояния');
    expect(sourceRows()).toContain('Ищу поездку');
    expect(sourceRows()).toContain('Могу подвезти');
    expect(sourceRows()).toContain('Нужен ваш ответ');
    expect(sourceRows()).toContain('Ответить');
    expect(sourceRows()).toContain('Снять объявление');
    expect(sourceRows()).toContain('Нужно ответить');
    expect(sourceRows()).toContain('1 отклик требует ответа');

    openSample('39 · Пустые состояния');
    expect(sourceRows()).toContain('Сейчас нет поездок, которые требуют вашего ответа.');

    /* Owner approval of 18 September 2026: a live string is «Утверждено», a removed one keeps its decision. */
    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    const marks = [...panel.querySelectorAll('dd')].map((row) => row.textContent);
    expect(marks.filter((mark) => mark === 'Проект')).toEqual([]);
    expect(marks).toContain('Утверждено');
  });

  it('leaves groups 1-4 working and the route out of production', () => {
    render(<CopyReviewPage />);

    ([
      ['3 · Поездки храма', 'Поездки храма'],
      ['13 · Последние детали', 'Просьба пассажира: последние детали'],
      ['22 · Проверьте поездку', 'Предложение водителя: проверьте поездку'],
      ['25 · Карта: обычное состояние', 'Карта поездок группы'],
    ] as const).forEach(([label, region]) => {
      openSample(label);
      expect(screen.getByRole('region', { name: region })).not.toBeNull();
      expect(productScreen().querySelector('[data-trips-list]')).toBeNull();
    });

    const groupStrings = [
      'Здесь появятся ваши поездки',
      'Мои объявления',
      'Ищу поездку',
      'Управление объявлением',
      'Управление поездкой',
      'Снять объявление',
      'Каждая дата остаётся отдельной поездкой с отдельными местами.',
      'Условия поездки предложено изменить',
      'До указанного времени договориться о поездке не удалось.',
      'Отвечать не обязательно, но так вы поможете работе сервиса.',
    ];

    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(full.replace(/\\/g, '/'));
      }
    };
    ['src/app', 'src/components', 'src/lib'].forEach((root) => walk(resolve(process.cwd(), root)));

    const outside = files.filter((file) => !file.includes('/src/app/copy-review/'));
    expect(outside.length).toBeGreaterThan(20);
    outside.forEach((file) => {
      const content = readFileSync(file, 'utf8');
      groupStrings.forEach((needle) => {
        expect(`${file}: ${content.includes(needle)}`).toBe(`${file}: false`);
      });
    });
  });
});
