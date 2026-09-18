// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import CopyReviewPage, { metadata } from './page';

afterEach(cleanup);

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

describe('Russian copy review surface', () => {
  it('stays an unlinked, non-indexed review route', () => {
    expect(metadata).toMatchObject({
      title: 'Russian UX copy review | Orthodox Routes',
      robots: { index: false, follow: false },
    });
  });

  it('reuses the approved Onest file instead of duplicating it', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/app/copy-review/layout.tsx'), 'utf8');

    expect(layout).toContain("src: '../design-preview/fonts/Onest-Variable.ttf'");
    expect(existsSync(resolve(process.cwd(), 'src/app/design-preview/fonts/Onest-Variable.ttf'))).toBe(true);
  });

  it('offers the reviewed screens, the request, offer, map and trips states, with the switch outside them', () => {
    render(<CopyReviewPage />);

    const selector = screen.getByRole('navigation', { name: 'Выбор экрана проверки' });
    expect(within(selector).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '1 · Каталог храмов',
      '2 · Страница храма',
      '3 · Поездки храма',
      '4 · Пустой храм',
      '5 · Когда: выбрана служба',
      '6 · Когда: свои дата и время',
      '7 · Где забрать: место не выбрано',
      '8 · Где забрать: изменение места',
      '9 · Где забрать: одно место',
      '10 · Где забрать: три места',
      '11 · Сколько вас: без детей',
      '12 · Сколько вас: дети и кресло',
      '13 · Последние детали',
      '14 · Последние детали: заполнено',
      '15 · Когда: разовая, служба',
      '16 · Когда: свои дата и время',
      '17 · Когда: регулярная поездка',
      '18 · Откуда: выбор места',
      '19 · Откуда: место выбрано',
      '20 · Детали поездки: без детей',
      '21 · Детали поездки: дети и примечание',
      '22 · Проверьте поездку',
      '23 · Проверьте поездку: заполнено',
      '24 · Проверьте поездку: регулярная',
      '25 · Карта: обычное состояние',
      '26 · Карта: выбран водитель',
      '27 · Карта: выбран пассажир',
      '28 · Карта: пассажир, несколько мест',
      '29 · Карта: показано, где я',
      '30 · Карта: недоступный фильтр',
      '31 · Карта на компьютере',
      '32 · Ответ пассажира',
      '33 · Ответ водителя',
      '34 · Мои объявления: разные состояния',
      '35 · Предстоящая: пассажир',
      '36 · Предстоящая: водитель',
      '37 · Мои объявления: без ожидающих действий',
      '38 · История',
      '39 · Пустые состояния',
      '40 · Мои поездки на компьютере',
      'Текст 200 %',
    ]);
    expect(productScreen().contains(selector)).toBe(false);
  });

  it('gives the catalog one universal search and no country or locality selector', () => {
    render(<CopyReviewPage />);
    openSample('1 · Каталог храмов');
    const catalog = productScreen();

    expect(within(catalog).getByRole('heading', { level: 1, name: 'Храмы' })).not.toBeNull();
    expect(within(catalog).getAllByPlaceholderText('Храм, город или страна').length).toBe(1);
    expect(within(catalog).getByRole('button', { name: 'Рядом со мной' })).not.toBeNull();
    expect(within(catalog).queryByRole('button', { name: 'Страна' })).toBeNull();
    expect(within(catalog).queryByRole('button', { name: 'Населённый пункт' })).toBeNull();
    expect(catalog.textContent).not.toContain('Населённый пункт');
    expect(catalog.querySelectorAll('input').length).toBe(1);
  });

  it('searches by localized name, official name, locality and country', () => {
    render(<CopyReviewPage />);
    openSample('1 · Каталог храмов');
    const field = () => within(productScreen()).getByPlaceholderText('Храм, город или страна');
    const cards = () => productScreen().querySelectorAll('[data-church-card]');

    expect(cards().length).toBe(3);

    fireEvent.change(field(), { target: { value: 'Никольский' } });
    expect(cards().length).toBe(1);

    fireEvent.change(field(), { target: { value: 'San Giorgio' } });
    expect(cards().length).toBe(1);

    fireEvent.change(field(), { target: { value: 'crotone' } });
    expect(cards().length).toBe(1);

    fireEvent.change(field(), { target: { value: 'Италия' } });
    expect(cards().length).toBe(3);

    fireEvent.change(field(), { target: { value: 'Германия' } });
    expect(cards().length).toBe(0);
    expect(productScreen().textContent).toContain('Ничего не нашлось. Попробуйте другое название, город или страну.');
  });

  it('keeps the reviewed catalog card copy, including the full activity phrases and no images', () => {
    render(<CopyReviewPage />);
    openSample('1 · Каталог храмов');
    const catalog = productScreen();

    expect(catalog.textContent).toContain('Ближайшая служба');
    expect(catalog.textContent).toContain('Расписание пока не добавлено');
    expect(within(catalog).getByText('2 предложения подвезти')).not.toBeNull();
    expect(within(catalog).getByText('1 просьба о поездке')).not.toBeNull();
    expect(within(catalog).getByText('1 предложение подвезти')).not.toBeNull();
    expect(catalog.textContent).not.toContain('Есть места · 2');

    const cards = catalog.querySelectorAll('[data-church-card]');
    expect(cards.length).toBe(3);
    cards.forEach((card) => {
      expect(card.querySelectorAll('img, picture, svg, [role="img"]').length).toBe(0);
    });
  });

  it('makes the church address the row itself, without a visible action label or embedded map', () => {
    render(<CopyReviewPage />);
    openSample('2 · Страница храма');
    const page = productScreen();
    const addressRow = within(page).getByRole('link', { name: /Via XX Settembre/ });

    expect(page.textContent).not.toContain('Карта и маршрут');
    expect(page.querySelectorAll('[class*="mapArtwork"]').length).toBe(0);
    expect(addressRow.textContent).toContain('Открыть карту');
    expect(addressRow.querySelector('[class*="srOnly"]')?.textContent).toBe('Открыть карту');
  });

  it('puts a collapsed «О храме» above the schedule', () => {
    render(<CopyReviewPage />);
    openSample('2 · Страница храма');
    const page = productScreen();
    const about = page.querySelector('details') as HTMLDetailsElement;
    const schedule = within(page).getByRole('heading', { name: 'Расписание' });

    expect(about.open).toBe(false);
    expect(about.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(about).getByText('О храме')).not.toBeNull();

    fireEvent.click(about.querySelector('summary')!);
    expect(page.textContent).toContain('Официальное название');
    expect(page.textContent).toContain('Связаться с храмом');
  });

  it('shows one chronological schedule of three services and reveals the rest on demand', () => {
    render(<CopyReviewPage />);
    openSample('2 · Страница храма');

    expect(productScreen().querySelectorAll('[data-service-row]').length).toBe(3);
    expect(productScreen().textContent).not.toContain('Другие службы');
    expect(productScreen().textContent).not.toContain('Регулярное расписание');
    expect(productScreen().textContent).not.toContain('Ближайшая служба');
    expect(productScreen().textContent).not.toMatch(/через \d+ (день|дня|дней)/);

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Показать всё расписание' }));
    expect(productScreen().querySelectorAll('[data-service-row]').length).toBe(7);
    expect(productScreen().textContent).toContain('Время изменено');
    expect(within(productScreen()).queryByRole('button', { name: 'Показать всё расписание' })).toBeNull();
  });

  it('keeps the approved schedule warning and the update date', () => {
    render(<CopyReviewPage />);
    openSample('2 · Страница храма');
    const page = productScreen();

    expect(page.textContent).toContain(
      'Расписание могло измениться. Если нужной службы здесь нет, но вы знаете, что она состоится, создайте поездку на собственные дату и время.',
    );
    expect(page.textContent).toContain('Расписание обновлено 12 августа');
  });

  it('keeps the page action hierarchy: one primary intent and one secondary intent', () => {
    render(<CopyReviewPage />);
    openSample('2 · Страница храма');
    const page = productScreen();
    const needRide = within(page).getByRole('button', { name: 'Нужна поездка' });
    const canDrive = within(page).getByRole('button', { name: 'Могу подвезти' });

    expect(needRide.className).toContain('primaryButton');
    expect(canDrive.className).toContain('secondaryButton');
    expect([...page.querySelectorAll('button')].filter((button) => button.className.includes('primaryButton')).length).toBe(1);
  });

  it('uses role filters and role badges on the board, with no subtitle', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    const board = productScreen();

    expect(within(board).getByRole('heading', { name: 'Поездки' })).not.toBeNull();
    expect(board.textContent).not.toContain('Предложения водителей и просьбы пассажиров этого храма');
    expect(board.textContent).not.toContain('Есть места');
    expect(board.textContent).not.toContain('Ищут место');
    expect(within(board).getAllByRole('button').map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['Все', 'Водители', 'Пассажиры']),
    );
    expect([...board.querySelectorAll('[data-ride-card]')].map((card) => (card as HTMLElement).dataset.rideType)).toEqual([
      'Водитель',
      'Пассажир',
      'Водитель',
      'Пассажир',
    ]);
  });

  it('filters the single mobile card stream by role', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');

    expect(productScreen().querySelectorAll('[data-board-list]').length).toBe(1);

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Водители' }));
    expect([...productScreen().querySelectorAll('[data-ride-card]')].map((card) => (card as HTMLElement).dataset.rideType)).toEqual(['Водитель', 'Водитель']);

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Пассажиры' }));
    expect([...productScreen().querySelectorAll('[data-ride-card]')].map((card) => (card as HTMLElement).dataset.rideType)).toEqual(['Пассажир', 'Пассажир']);

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Все' }));
    expect(productScreen().querySelectorAll('[data-ride-card]').length).toBe(4);
  });

  it('states seats, passengers, children and return trips grammatically', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    const board = productScreen();

    expect(board.textContent).toContain('2 свободных места');
    expect(board.textContent).toContain('1 свободное место');
    expect(board.textContent).toContain('1 из 3 мест занято');
    expect(board.textContent).not.toContain('1 из 3 мест заняты');
    expect(board.textContent).toContain('2 пассажира');
    expect(board.textContent).toContain('из них 1 ребёнок');
    expect(board.textContent).toContain('Нужно детское кресло');
    expect(board.textContent).toContain('Детское кресло есть у водителя');
    expect(board.textContent).toContain('Не может везти детей');
    expect(board.textContent).toContain('Обратная поездка — нужна');
    expect(board.textContent).toContain('Обратная поездка — не нужна');
    expect(board.textContent).toContain('Может подвезти обратно');
    expect(board.textContent).toContain('Уже договорились: 3 впереди · 12 за последние 30 дней');
  });

  it('names places with a label and value so a stored name never needs a case ending', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    const places = [...productScreen().querySelectorAll('[data-ride-place]')].map((row) => row.textContent);

    expect(places).toEqual([
      'Место отправления: Catanzaro Lido',
      'Место встречи: Catanzaro, центр',
      'Место отправления: Siano',
      'Место встречи: Soverato',
    ]);
    expect(productScreen().textContent).not.toMatch(/\bИз [A-ZА-Я]/);
  });

  it('keeps public trip cards to a first name, with no contacts and no exact private place', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');

    [...productScreen().querySelectorAll('[data-ride-card]')].forEach((card) => {
      const text = card.textContent ?? '';
      expect(text).not.toMatch(/@|\+\d|телефон|Telefon/i);
      expect(text).not.toMatch(/\d+\s*,\s*\d{5}|via |ул\.|дом /i);
    });
    ['Алексей', 'Мария', 'Игорь', 'Ольга'].forEach((name) => {
      expect(within(productScreen()).getByText(name)).not.toBeNull();
    });
  });

  it('distinguishes the two role badges by their own quiet, non-green tokens', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    const badges = [...productScreen().querySelectorAll('[data-ride-card] [data-role]')];

    expect(badges.map((badge) => [badge.getAttribute('data-role'), badge.textContent?.trim()])).toEqual([
      ['driver', 'Водитель'],
      ['passenger', 'Пассажир'],
      ['driver', 'Водитель'],
      ['passenger', 'Пассажир'],
    ]);

    const styles = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.module.css'), 'utf8');
    const roleBlock = styles.slice(styles.indexOf('--or-role-driver-bg'), styles.indexOf('--or-role-passenger:') + 40);
    expect(roleBlock).toContain('--or-role-driver-bg: #e7ecf7');
    expect(roleBlock).toContain('--or-role-driver: #3a4e7a');
    expect(roleBlock).toContain('--or-role-passenger-bg: #f4eee5');
    expect(roleBlock).toContain('--or-role-passenger: #6b573e');
    // The role badges never borrow the primary green, the map surface or the error semantics.
    ['#2e6a57', '#ecf4f0', '#eef3eb', '#a33a32', '#faeeee'].forEach((forbidden) => {
      expect(roleBlock.toLowerCase()).not.toContain(forbidden);
    });
    expect(styles).toContain(".typeTag[data-role='driver']");
    expect(styles).toContain(".typeTag[data-role='passenger']");
  });

  it('keeps card actions secondary and the map entry outside the filter group', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    const board = productScreen();

    [...board.querySelectorAll('[data-ride-card] button')].forEach((button) => {
      expect(button.className).toContain('secondaryButton');
    });
    const mapEntry = board.querySelector('[data-map-entry]')!;
    expect(mapEntry.textContent).toBe('Поездки на карте');
    expect(board.querySelector('[role="group"]')!.contains(mapEntry)).toBe(false);
  });

  it('gives the empty church the same block order as the populated church page', () => {
    render(<CopyReviewPage />);
    openSample('4 · Пустой храм');
    const page = productScreen();
    const order = [...page.querySelectorAll('h1, details, h2, [data-empty-schedule], [class*="churchActions"], [data-empty-board]')]
      .map((node) => node.tagName.toLowerCase() + (node.textContent ?? '').slice(0, 12));

    expect(page.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Фотографии храма пока нет');
    expect(order[0]).toContain('h1');
    expect(order[1]).toContain('details');
    expect(page.textContent).toContain('Расписание пока не добавлено. Вы всё равно можете создать поездку на собственные дату и время.');
    expect(page.textContent).toContain('Поездок пока никто не предлагал. Вы можете попросить о поездке или предложить свободные места.');
    expect(page.textContent).not.toContain('Поездок к этому храму пока нет');
    expect(page.textContent).not.toContain('Предложения водителей и просьбы пассажиров этого храма');
    expect(page.textContent).not.toContain('Карта и маршрут');
    expect(within(page).getByRole('button', { name: 'Нужна поездка' })).not.toBeNull();
    expect(within(page).getByRole('button', { name: 'Могу подвезти' })).not.toBeNull();
    expect(page.querySelectorAll('[data-map-entry]').length).toBe(0);
    expect(page.querySelectorAll('[role="group"]').length).toBe(0);
  });

  it('never exposes implementation or approval terminology inside a product screen', () => {
    render(<CopyReviewPage />);

    [
      '1 · Каталог храмов',
      '2 · Страница храма',
      '3 · Поездки храма',
      '4 · Пустой храм',
      '5 · Когда: выбрана служба',
      '6 · Когда: свои дата и время',
      '7 · Где забрать: место не выбрано',
      '8 · Где забрать: изменение места',
      '9 · Где забрать: одно место',
      '10 · Где забрать: три места',
      '11 · Сколько вас: без детей',
      '12 · Сколько вас: дети и кресло',
      '13 · Последние детали',
      '14 · Последние детали: заполнено',
    ].forEach((label) => {
      openSample(label);
      const text = productScreen().textContent ?? '';
      [
        'localStorage',
        'mock',
        'состояние',
        'объект',
        'Design System',
        'Проект',
        'Утверждено',
        'нет данных',
      ].forEach((forbidden) => {
        expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      });
    });
  });
});
/*
 * The passenger request form after the owner decision of 22 August 2026 (Foundation 1.9, IA §10.1).
 * The tests guard the structure that decision fixed — four screens, no review step, alternatives
 * instead of stops — and the wording actually rendered.
 *
 * The ten states are entry points into one interactive form, not ten steps, so the tests also guard
 * what makes them one form: navigation forwards and backwards, and answers that survive both.
 */
describe('Passenger request review states', () => {
  /** Every entry point, in the order the review switch offers them. */
  const requestSamples = [
    ['5 · Когда: выбрана служба', 'request-when'],
    ['6 · Когда: свои дата и время', 'request-when-custom'],
    ['7 · Где забрать: место не выбрано', 'request-place-empty'],
    ['8 · Где забрать: изменение места', 'request-map'],
    ['9 · Где забрать: одно место', 'request-place'],
    ['10 · Где забрать: три места', 'request-place-three'],
    ['11 · Сколько вас: без детей', 'request-people'],
    ['12 · Сколько вас: дети и кресло', 'request-people-children'],
    ['13 · Последние детали', 'request-final'],
    ['14 · Последние детали: заполнено', 'request-final-filled'],
  ] as const;

  /** The four states of group 2A keep the anchors the canonical documents already name. */
  const groupTwoASamples = requestSamples.filter(([, anchor]) =>
    ['request-when', 'request-map', 'request-place', 'request-people'].includes(anchor));

  function sourceRows() {
    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    return [...panel.querySelectorAll('dd')].map((row) => row.textContent);
  }

  function step() {
    return (productScreen().querySelector('[data-request-step]') as HTMLElement | null)?.dataset.requestStep;
  }

  const press = (name: string) => fireEvent.click(within(productScreen()).getByRole('button', { name }));

  /**
   * The map is on the place screen itself, so saving a place is one press and never leaves the
   * screen. Before the first place the single action confirms the marked point; afterwards the
   * smaller secondary adds another alternative. Either way the marker moves on to a free address.
   */
  function addPlaceViaMap() {
    const sheet = productScreen().querySelector('[data-place-add]') as HTMLButtonElement;
    fireEvent.click(sheet);
  }

  it('opens each of the ten states directly from its own address', () => {
    requestSamples.forEach(([label, anchor]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      cleanup();
    });
    window.location.hash = '';
  }, 40000);

  it('keeps the four anchors the canonical documents name for group 2A', () => {
    expect(groupTwoASamples.map(([, anchor]) => anchor)).toEqual([
      'request-when',
      'request-map',
      'request-place',
      'request-people',
    ]);
  });

  it('asks when the passenger wants to arrive with the service and an own date in one group', () => {
    render(<CopyReviewPage />);
    openSample('5 · Когда: выбрана служба');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Когда вам нужна поездка?' })).not.toBeNull();
    expect(form.textContent).toContain('Храм Покрова Пресвятой Богородицы в Catanzaro');
    expect(form.textContent).toContain('Всенощное бдение');
    expect(form.textContent).toContain('Указать свои дату и время');
    expect(form.textContent).toContain(
      'Если нужной службы нет в расписании, укажите дату и время, к которому нужно приехать.',
    );

    // The heading is the only visible label of the group: no second heading over the services.
    expect(form.textContent).not.toContain('Выберите службу');
    expect(form.querySelectorAll('[class*="fieldLabel"]').length).toBe(0);

    // One question, one radio group: the own date is an answer, not a separate step.
    const group = form.querySelector('[data-when-choice]')!;
    const radios = [...group.querySelectorAll('input[type="radio"]')];
    expect(radios.length).toBe(5);
    expect(new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size).toBe(1);
    expect(form.querySelectorAll('[data-custom-arrival]').length).toBe(0);

    // A quiet «или» separates the two ways to answer, right before the own-date option.
    const separators = [...group.querySelectorAll('[data-when-or]')];
    expect(separators.map((node) => node.textContent)).toEqual(['или']);
    const customChoice = group.querySelector('[data-custom-choice]')!;
    expect(separators[0].compareDocumentPosition(customChoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.querySelector('[data-choice-selected]')).not.toBeNull();

    fireEvent.click(form.querySelector('[data-custom-choice] input')!);
    expect(form.querySelector('[data-custom-arrival]')!.textContent).toContain('Дата и время');
    expect(form.textContent).not.toContain('Хочу приехать к');
  });

  it('answers the question the person has, one hint at a time', () => {
    render(<CopyReviewPage />);
    openSample('5 · Когда: выбрана служба');
    const hint = () => productScreen().querySelector('[data-when-hint]')!.textContent;
    const hints = () => productScreen().querySelectorAll('[data-when-hint]').length;

    // Before the own date is chosen: how to act when the service is not in the list.
    expect(hints()).toBe(1);
    expect(hint()).toBe(
      'Если нужной службы нет в расписании, укажите дату и время, к которому нужно приехать.',
    );
    expect(productScreen().textContent).not.toContain('не больше чем на 8 недель вперёд');

    // After it: how far ahead the date may be. The first hint has done its job and goes.
    fireEvent.click(productScreen().querySelector('[data-custom-choice] input')!);
    expect(hints()).toBe(1);
    expect(hint()).toBe('Просьбу можно создать не больше чем на 8 недель вперёд.');
    expect(productScreen().textContent).not.toContain('Если нужной службы нет в расписании');

    // The state that opens on the own date shows the horizon straight away.
    openSample('6 · Когда: свои дата и время');
    expect(productScreen().querySelector('[data-when-hint]')!.textContent)
      .toBe('Просьбу можно создать не больше чем на 8 недель вперёд.');
  });

  it('explains what becomes public while the place is still being chosen, not after publication', () => {
    render(<CopyReviewPage />);
    openSample('8 · Где забрать: изменение места');
    const map = productScreen();

    expect(within(map).getAllByPlaceholderText('Адрес').length).toBe(1);
    expect(map.textContent).toContain('Введите адрес или передвиньте маркер на карте.');
    expect(map.textContent).toContain('Выбрано: Piazza Matteotti, 88100 Catanzaro CZ');

    const privacy = map.querySelector('[data-place-privacy]')!;
    const confirm = within(map).getByRole('button', { name: 'Подтвердить место' });
    expect(privacy.textContent).toBe(
      'Для вашей безопасности всем будет видна только примерная область. Точное место и контакты откроются только после договорённости.',
    );
    // The warning stands before the action it warns about (Foundation 6.1 (4), IA §10.4).
    expect(privacy.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never claims that the exact place or the contacts are public', () => {
    render(<CopyReviewPage />);

    ['8 · Где забрать: изменение места', '9 · Где забрать: одно место'].forEach((label) => {
      openSample(label);
      const text = productScreen().querySelector('[data-place-privacy]')!.textContent ?? '';

      expect(text).toContain('примерная область');
      expect(text).toContain('после договорённости');
      expect(text).not.toMatch(/точн\w* (адрес|мест\w*|координат\w*)[^.]{0,40}(увид|видн|показыва|публичн)/i);
      expect(text).not.toMatch(/все[^.]{0,30}точное место/i);
      expect(text).not.toContain('домашний адрес');
    });
  });

  it('states the privacy rule once per screen, in one wording', () => {
    render(<CopyReviewPage />);

    ['8 · Где забрать: изменение места', '9 · Где забрать: одно место'].forEach((label) => {
      openSample(label);
      const screenText = productScreen().textContent ?? '';

      expect(productScreen().querySelectorAll('[data-place-privacy]').length).toBe(1);
      expect(screenText.split('Для вашей безопасности всем будет видна только примерная область').length - 1).toBe(1);
      // The second wording of the same rule (`map.area.explain`) never stands next to the first.
      expect(screenText).not.toContain('радиусом 1 км');
      expect(screenText).not.toContain('внутри неё');
      expect(screenText).not.toContain('но не в центре');
    });
  });

  it('offers no place-name field: a landmark belongs in the ordinary note', () => {
    render(<CopyReviewPage />);

    ['8 · Где забрать: изменение места', '9 · Где забрать: одно место'].forEach((label) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      expect(text).not.toContain('Как назвать это место');
      expect(text).not.toContain('у входа в библиотеку');
      expect(text).not.toContain('Подпись места');
      // The map sheet keeps one text field at most: the address search, never a second one.
      expect([...productScreen().querySelectorAll('input')].filter((field) => {
        const type = (field as HTMLInputElement).type;
        return type === 'text' || type === '';
      }).length).toBeLessThanOrEqual(1);
    });
  });

  it('keeps «Где вас забрать?» one screen with the map always on it', () => {
    render(<CopyReviewPage />);

    // Every state of the question is the same screen: same heading, same form chrome, same map.
    ['7 · Где забрать: место не выбрано', '8 · Где забрать: изменение места',
      '9 · Где забрать: одно место', '10 · Где забрать: три места'].forEach((label) => {
      openSample(label);
      const place = productScreen();

      expect(within(place).getByRole('heading', { level: 1, name: 'Где вас забрать?' })).not.toBeNull();
      expect(step()).toBe('place');
      // A map screen: the map runs to the top, the working sheet rides over its lower edge.
      expect(place.querySelectorAll('[class*="pickMapArea"]').length).toBe(1);
      expect(place.querySelectorAll('[class*="pickSheet"]').length).toBe(1);
      expect(place.querySelector('[data-picked-address]')).not.toBeNull();
      expect(within(place).getAllByPlaceholderText('Адрес').length).toBe(1);
      // The quiet way back sits over the map instead of a header bar, and still leads back.
      expect(place.querySelector('[data-form-header]')).toBeNull();
      expect(within(place).getByRole('button', { name: 'Назад' })).not.toBeNull();
      // The address and the rule live in the sheet, in that order.
      const sheet = place.querySelector('[class*="pickSheet"]')!;
      const address = sheet.querySelector('[data-picked-address]')!;
      const privacy = sheet.querySelector('[data-place-privacy]')!;
      expect(address.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('gives the map the upper part of the screen and the sheet its lower edge', () => {
    render(<CopyReviewPage />);
    openSample('9 · Где забрать: одно место');
    const place = productScreen();

    const map = place.querySelector('[class*="pickMapArea"]')!;
    const sheet = place.querySelector('[class*="pickSheet"]')!;
    // The map comes first and the search floats on top of it, not above it in the flow.
    expect(map.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.querySelector('[class*="pickControls"]')).not.toBeNull();
    expect(map.querySelector('[class*="pickHint"]')!.textContent)
      .toBe('Введите адрес или передвиньте маркер на карте.');
    expect(map.querySelectorAll('button[class*="pickPoint"]').length).toBe(3);
    // Nothing about the choice sits outside those two blocks.
    expect(sheet.contains(place.querySelector('[data-place-list]')!)).toBe(true);
    expect(sheet.contains(place.querySelector('[data-place-add]')!)).toBe(true);
  });

  it('never navigates away to choose a place: adding one keeps the same screen', () => {
    render(<CopyReviewPage />);
    openSample('7 · Где забрать: место не выбрано');

    expect(step()).toBe('place');
    expect(productScreen().querySelectorAll('[data-place-card]').length).toBe(0);
    // No «Далее» before the required place, and no step change on the way to getting one.
    expect(within(productScreen()).queryByRole('button', { name: 'Далее' })).toBeNull();

    press('Piazza Matteotti, 88100 Catanzaro CZ');
    expect(step()).toBe('place');
    press('Подтвердить место');
    expect(step()).toBe('place');
    expect(productScreen().querySelectorAll('[data-place-card]').length).toBe(1);
    expect(within(productScreen()).getByRole('button', { name: 'Далее' })).not.toBeNull();

    // Adding a second alternative also stays here: no screen change, one more card.
    press('Добавить место');
    expect(step()).toBe('place');
    expect(productScreen().querySelectorAll('[data-place-card]').length).toBe(2);
    expect(productScreen().querySelectorAll('[class*="pickMapArea"]').length).toBe(1);
  });

  it('shows the chosen address exactly once in each state of the place screen', () => {
    render(<CopyReviewPage />);

    // The marked address and the saved cards never repeat the same address twice.
    ['7 · Где забрать: место не выбрано', '8 · Где забрать: изменение места',
      '9 · Где забрать: одно место'].forEach((label) => {
      openSample(label);
      const text = productScreen().textContent ?? '';
      [...productScreen().querySelectorAll('[data-place-card] [class*="data"]')].forEach((card) => {
        expect(text.split(card.textContent!).length - 1).toBe(1);
      });
    });

    // Adding alternatives never repeats an address already shown.
    openSample('9 · Где забрать: одно место');
    addPlaceViaMap();
    addPlaceViaMap();
    const shown = [...productScreen().querySelectorAll('[data-place-card]')]
      .map((card) => card.querySelector('[class*="data"]')!.textContent);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(3);
  });

  it('keeps one required place and up to two alternatives, with a reason when the limit is reached', () => {
    render(<CopyReviewPage />);
    openSample('9 · Где забрать: одно место');
    const cards = () => [...productScreen().querySelectorAll('[data-place-card]')];
    const add = () => within(productScreen()).queryByRole('button', { name: 'Добавить место' });

    expect(cards().length).toBe(1);
    expect(cards()[0].textContent).toContain('Основное место встречи');
    // The one required place cannot be removed; the alternatives can.
    expect(within(cards()[0] as HTMLElement).queryByRole('button', { name: 'Убрать это место' })).toBeNull();
    expect(within(cards()[0] as HTMLElement).getByRole('button', { name: 'Изменить это место' })).not.toBeNull();

    addPlaceViaMap();
    expect(cards().length).toBe(2);
    expect(cards()[1].textContent).toContain('Ещё одно место встречи');

    addPlaceViaMap();
    expect(cards().length).toBe(3);
    expect(add()).toBeNull();
    expect(productScreen().querySelector('[data-place-limit]')!.textContent).toBe(
      'Больше трёх мест указать нельзя.',
    );

    fireEvent.click(within(cards()[2] as HTMLElement).getByRole('button', { name: 'Убрать это место' }));
    expect(cards().length).toBe(2);
    expect(add()).not.toBeNull();
  });

  it('presents the places as alternatives and never as stops along a route', () => {
    render(<CopyReviewPage />);
    openSample('9 · Где забрать: одно место');
    const list = () => productScreen().querySelector('[data-place-list]')!;

    addPlaceViaMap();
    addPlaceViaMap();

    // «или» between the cards, one separator fewer than the number of places.
    expect([...list().querySelectorAll('[data-place-or]')].map((node) => node.textContent)).toEqual([
      'или',
      'или',
    ]);
    // The labels and the «или» carry the meaning; the long explanation is gone and not replaced.
    expect(list().textContent).toContain('Основное место встречи');
    expect(list().textContent).toContain('Ещё одно место встречи');

    // Nothing numbers or orders the places: no ordered list, no route vocabulary.
    expect(list().querySelectorAll('ol').length).toBe(0);
    const text = productScreen().textContent ?? '';
    ['остановк', 'по пути заберёт', 'маршрут', 'сначала', 'затем', 'потом'].forEach((word) => {
      expect(text.toLowerCase().split(word).length - 1).toBe(0);
    });
  });

  it('says the three-place limit once, with no second explanation beside it', () => {
    render(<CopyReviewPage />);
    openSample('10 · Где забрать: три места');
    const place = productScreen();

    expect(place.querySelectorAll('[data-place-card]').length).toBe(3);
    expect(place.querySelector('[data-place-limit]')!.textContent)
      .toBe('Больше трёх мест указать нельзя.');
    expect(place.querySelectorAll('[data-place-limit]').length).toBe(1);
    // The longer duplicate is removed and nothing explanatory takes its place.
    expect(place.textContent).not.toContain('Можно указать до трёх мест');
    expect(place.textContent).not.toContain('Водитель выберет одно из них');
    expect(place.textContent).not.toContain('не остановки по пути');
    // At the limit the saving action is gone, replaced by the reason — never left disabled.
    expect(within(place).queryByRole('button', { name: 'Добавить место' })).toBeNull();
    expect([...place.querySelectorAll('button:disabled')].length).toBe(0);
  });

  it('groups passengers, children and the child seat on one screen', () => {
    render(<CopyReviewPage />);
    openSample('12 · Сколько вас: дети и кресло');
    const people = productScreen();

    expect(within(people).getByRole('heading', { level: 1, name: 'Сколько вас будет?' })).not.toBeNull();
    expect(people.querySelectorAll('[data-stepper]').length).toBe(2);
    expect(people.textContent).toContain('Всего пассажиров, включая детей');
    expect(people.textContent).toContain('Из них детей');
    expect(people.textContent).toContain('Нужно детское кресло');
    expect(people.textContent).toContain(
      'По умолчанию кресло обеспечивает взрослый, который едет с ребёнком. Водитель отдельно указывает, есть ли кресло у него.',
    );

    // The child seat is a question only while the group has children (IA §47.6, §2.3).
    fireEvent.click(within(people).getByRole('button', { name: 'Из них детей: меньше' }));
    expect(people.querySelectorAll('[data-child-seat]').length).toBe(0);
    fireEvent.click(within(people).getByRole('button', { name: 'Из них детей: больше' }));
    expect(people.querySelectorAll('[data-child-seat]').length).toBe(1);
  });

  it('has no review step and no public-versus-private screen anywhere in the form', () => {
    render(<CopyReviewPage />);

    requestSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      ['Проверьте просьбу', 'Что увидят все', 'Что увидит', 'Проверьте сведения', 'Проверить'].forEach(
        (forbidden) => expect(text).not.toContain(forbidden),
      );
    });
  });

  it('offers publication only on the last screen, never on one of the first three questions', () => {
    render(<CopyReviewPage />);

    requestSamples
      .filter(([, anchor]) => !anchor.startsWith('request-final'))
      .forEach(([label]) => {
        openSample(label);
        expect(within(productScreen()).queryByRole('button', { name: 'Опубликовать' })).toBeNull();
        expect(productScreen().textContent).not.toContain('Опубликовать');
      });

    openSample('13 · Последние детали');
    expect(within(productScreen()).getByRole('button', { name: 'Опубликовать' }).className)
      .toContain('primaryButton');
  });

  it('shows one primary intent per request screen and no stepper or progress bar', () => {
    render(<CopyReviewPage />);

    requestSamples.forEach(([label]) => {
      openSample(label);
      const form = productScreen();

      expect(
        [...form.querySelectorAll('button')].filter((button) => button.className.includes('primaryButton')).length,
      ).toBe(1);
      expect(form.querySelectorAll('progress, [role="progressbar"], [aria-valuenow]').length).toBe(0);
      expect(form.textContent).not.toMatch(/Шаг \d|\d\s*из\s*4/);
    });
  });

  it('marks every string of the whole passenger form as approved by the owner', () => {
    render(<CopyReviewPage />);

    // Groups 2A (24 August) and 2B (26 August) together cover every string the form renders.
    requestSamples.forEach(([label]) => {
      openSample(label);
      const marks = sourceRows();

      expect(marks.length).toBeGreaterThan(0);
      expect(`${label}: ${[...new Set(marks)].join('/')}`).toBe(`${label}: Утверждено`);
    });
  });

  it('never leaves a removed string on a screen', () => {
    render(<CopyReviewPage />);

    requestSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      ['Хочу приехать к', 'Найти адрес', 'Можно указать до трёх мест'].forEach((gone) => {
        expect(`${label}: ${text.includes(gone)}`).toBe(`${label}: false`);
      });
    });
  });

  it('marks the strings of «Последние детали» as approved on 26 August 2026', () => {
    render(<CopyReviewPage />);

    ['13 · Последние детали', '14 · Последние детали: заполнено'].forEach((label) => {
      openSample(label);
      const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
      const rows = [...panel.querySelectorAll('dt')].map((row) => row.firstChild?.textContent);
      const marks = sourceRows();

      [
        'Последние детали',
        'Нужна поездка обратно',
        'Примечание (необязательно)',
        'Короткое уточнение для водителя. Не пишите домашний адрес, телефон, email и ссылки.',
        'Опубликовать',
        'Изменить',
        'Когда',
        'Где вас забрать',
        'Сколько вас',
      ].forEach((text) => {
        const at = rows.indexOf(text);
        expect(`${text}: ${at >= 0 && marks[at] === 'Утверждено'}`).toBe(`${text}: true`);
      });
    });
  });

  it('names both review dates and claims nothing is still pending', () => {
    render(<CopyReviewPage />);
    openSample('5 · Когда: выбрана служба');

    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    expect(panel.textContent).toContain('24 августа 2026');
    expect(panel.textContent).toContain('26 августа 2026');
    expect(panel.textContent).toContain('утверждены');
    expect(panel.textContent).not.toContain('ничего не утверждает');
    expect(panel.textContent).not.toContain('ждут просмотра');

    // The simulated product screen has its own header, so pick the review chrome one.
    const header = screen.getAllByRole('banner').find((node) => !node.closest('[data-product-screen]'))!;
    expect(header.textContent).toContain('группы 1, 2A, 2B, 3, 4 и 5 просмотрены');
    expect(header.textContent).toContain('Последние детали');
    expect(header.textContent).not.toContain('ждёт просмотра');
    expect(header.textContent).not.toContain('ждут просмотра');
  });

  it('keeps the reviewed group 1 wording and marks untouched', () => {
    render(<CopyReviewPage />);
    openSample('1 · Каталог храмов');

    expect(sourceRows()).toContain('Утверждено');
    expect(productScreen().textContent).toContain('Расписание пока не добавлено');
    expect(productScreen().textContent).toContain('2 предложения подвезти');
  });

  /* ------------------------------------------------- one form, not ten static screens */

  it('walks the four semantic screens forwards and back, in order and without a stepper', () => {
    render(<CopyReviewPage />);
    openSample('5 · Когда: выбрана служба');

    expect(step()).toBe('when');
    press('Далее');
    expect(step()).toBe('place');
    // The second question needs its one required answer before it offers to move on.
    addPlaceViaMap();
    press('Далее');
    expect(step()).toBe('people');
    press('Далее');
    expect(step()).toBe('final');

    press('Назад');
    expect(step()).toBe('people');
    press('Назад');
    expect(step()).toBe('place');
    press('Назад');
    expect(step()).toBe('when');

    // The first question has nothing before it, and no numbered wizard chrome appears anywhere.
    press('Назад');
    expect(step()).toBe('when');
  });

  it('keeps every answer while the person moves between the screens', () => {
    render(<CopyReviewPage />);
    openSample('5 · Когда: выбрана служба');

    // An own date and time given on the first screen.
    fireEvent.click(productScreen().querySelector('[data-custom-choice] input')!);
    fireEvent.change(productScreen().querySelector('[data-custom-arrival] input')!, {
      target: { value: '2026-08-29T18:30' },
    });

    press('Далее');
    addPlaceViaMap();
    press('Далее');
    press('Всего пассажиров, включая детей: больше');
    press('Из них детей: больше');
    press('Далее');

    // A note typed on the last screen.
    fireEvent.change(productScreen().querySelector('[data-note-field] textarea')!, {
      target: { value: 'у входа в библиотеку' },
    });
    fireEvent.click(within(productScreen()).getByRole('checkbox', { name: 'Нужна поездка обратно' }));

    // Everything is still there after walking all the way back to the first question.
    press('Назад');
    press('Назад');
    press('Назад');
    expect(step()).toBe('when');
    expect((productScreen().querySelector('[data-custom-arrival] input') as HTMLInputElement).value)
      .toBe('2026-08-29T18:30');

    press('Далее');
    expect(productScreen().querySelectorAll('[data-place-card]').length).toBe(1);
    press('Далее');
    expect([...productScreen().querySelectorAll('output')].map((node) => node.textContent)).toEqual(['2', '1']);
    press('Далее');
    expect((productScreen().querySelector('[data-note-field] textarea') as HTMLTextAreaElement).value)
      .toBe('у входа в библиотеку');
    expect((productScreen().querySelector('[data-return-ride] input') as HTMLInputElement).checked).toBe(true);
  });

  it('asks for the first place before it offers to move on', () => {
    render(<CopyReviewPage />);
    openSample('7 · Где забрать: место не выбрано');
    const empty = productScreen();

    expect(within(empty).getByRole('heading', { level: 1, name: 'Где вас забрать?' })).not.toBeNull();
    expect(empty.querySelectorAll('[data-place-card]').length).toBe(0);
    expect(empty.querySelector('[data-place-privacy]')).not.toBeNull();

    // No «Далее» sits disabled without a reason: the one intent is keeping the marked point.
    expect(within(empty).queryByRole('button', { name: 'Далее' })).toBeNull();
    expect(within(empty).queryByRole('button', { name: 'Добавить место' })).toBeNull();
    const confirm = within(empty).getByRole('button', { name: 'Подтвердить место' });
    expect(confirm.className).toContain('primaryButton');
    expect([...empty.querySelectorAll('button:disabled')].length).toBe(0);

    // With a place saved: «Далее» is the one large action, and adding an alternative moves into
    // the main place card, under «Изменить это место».
    press('Подтвердить место');
    const actions = productScreen().querySelector('[class*="sheetActions"]') as HTMLElement;
    const next = within(actions).getByRole('button', { name: 'Далее' });
    expect(next.className).toContain('primaryButton');
    expect(within(actions).queryByRole('button', { name: 'Добавить место' })).toBeNull();
    expect(actions.querySelectorAll('button').length).toBe(1);

    const card = productScreen().querySelector('[data-place-card]') as HTMLElement;
    const change = within(card).getByRole('button', { name: 'Изменить это место' });
    const add = within(card).getByRole('button', { name: 'Добавить место' });
    expect(add.className).not.toContain('primaryButton');
    expect(change.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moves the marker on after a place is saved, so the next alternative is a new address', () => {
    render(<CopyReviewPage />);
    openSample('7 · Где забрать: место не выбрано');

    expect(productScreen().querySelector('[data-picked-address]')!.textContent)
      .toBe('Выбрано: Via Milano, 8, 88100 Catanzaro CZ');

    press('Подтвердить место');
    expect(productScreen().querySelector('[data-place-card]')!.textContent)
      .toContain('Via Milano, 8, 88100 Catanzaro CZ');
    // The marker no longer stands on an address the list already holds.
    expect(productScreen().querySelector('[data-picked-address]')!.textContent)
      .toBe('Выбрано: Piazza Matteotti, 88100 Catanzaro CZ');
  });

  it('changes a saved place on the same screen: «Изменить это место» → «Подтвердить место»', () => {
    render(<CopyReviewPage />);
    openSample('9 · Где забрать: одно место');

    // Before: the action saves a new place, and no card is marked as being changed.
    expect(within(productScreen()).getByRole('button', { name: 'Добавить место' })).not.toBeNull();
    expect(productScreen().querySelectorAll('[data-place-editing]').length).toBe(0);

    press('Изменить это место');
    expect(step()).toBe('place');
    // The card is marked, the marker moves onto it, and the action becomes the confirming one.
    expect(productScreen().querySelectorAll('[data-place-editing]').length).toBe(1);
    expect(within(productScreen()).queryByRole('button', { name: 'Добавить место' })).toBeNull();
    expect(within(productScreen()).getByRole('button', { name: 'Подтвердить место' })).not.toBeNull();
    expect(productScreen().querySelector('[data-picked-address]')!.textContent)
      .toBe('Выбрано: Via Milano, 8, 88100 Catanzaro CZ');

    press('Via Indipendenza, 21, 88100 Catanzaro CZ');
    press('Подтвердить место');

    // The place is replaced where it stood; nothing was added and no screen was left.
    const cards = [...productScreen().querySelectorAll('[data-place-card]')];
    expect(step()).toBe('place');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Via Indipendenza, 21, 88100 Catanzaro CZ');
    expect(cards[0].textContent).toContain('Основное место встречи');
    expect(productScreen().querySelectorAll('[data-place-editing]').length).toBe(0);
    expect(within(productScreen()).getByRole('button', { name: 'Добавить место' })).not.toBeNull();
  });

  it('lets the address search move the marker, as the hint under the map promises', () => {
    render(<CopyReviewPage />);
    openSample('9 · Где забрать: одно место');

    fireEvent.change(within(productScreen()).getByPlaceholderText('Адрес'), {
      target: { value: 'indipendenza' },
    });
    expect(step()).toBe('place');
    expect(productScreen().querySelector('[data-picked-address]')!.textContent)
      .toBe('Выбрано: Via Indipendenza, 21, 88100 Catanzaro CZ');
  });

  it('asks nothing about a child seat when the group has no children', () => {
    render(<CopyReviewPage />);
    openSample('11 · Сколько вас: без детей');
    const people = productScreen();

    expect([...people.querySelectorAll('output')].map((node) => node.textContent)).toEqual(['2', '0']);
    expect(people.querySelectorAll('[data-child-seat]').length).toBe(0);
    expect(people.textContent).not.toContain('Нужно детское кресло');
  });

  /* --------------------------------------------------- screen 4: «Последние детали» */

  it('carries the return ride, the optional note and its warning on the last screen', () => {
    render(<CopyReviewPage />);
    openSample('13 · Последние детали');
    const final = productScreen();

    expect(within(final).getByRole('heading', { level: 1, name: 'Последние детали' })).not.toBeNull();
    expect(within(final).getByRole('checkbox', { name: 'Нужна поездка обратно' })).not.toBeNull();
    expect(final.querySelector('[data-note-field] span')!.textContent).toBe('Примечание (необязательно)');
    expect(final.textContent).toContain(
      'Короткое уточнение для водителя. Не пишите домашний адрес, телефон, email и ссылки.',
    );

    // The note is a place to write, not a one-line answer: it is the only multi-line field.
    expect(final.querySelectorAll('textarea').length).toBe(1);
  });

  it('keeps the landmark in the ordinary note instead of a second address-like field', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');
    const final = productScreen();

    expect((final.querySelector('[data-note-field] textarea') as HTMLTextAreaElement).value)
      .toBe('у входа в библиотеку');
    expect(final.textContent).not.toContain('Как назвать это место');
    expect(final.textContent).not.toContain('Подпись места');
    expect((final.querySelector('[data-return-ride] input') as HTMLInputElement).checked).toBe(true);
  });

  it('summarises the answers compactly, without turning into a review screen', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');
    const summary = productScreen().querySelector('[data-request-summary]') as HTMLElement;
    const rows = [...summary.querySelectorAll('[data-summary-row]')];

    expect(rows.map((row) => (row as HTMLElement).dataset.summarySection)).toEqual([
      'Когда',
      'Где вас забрать',
      'Сколько вас',
    ]);
    expect(rows[0].textContent).toContain('Божественная литургия · воскресенье, 23 августа, 9:00');
    expect(rows[1].textContent).toContain('Via Milano, 8, 88100 Catanzaro CZ');
    expect(rows[1].textContent).toContain('Piazza Matteotti, 88100 Catanzaro CZ');
    // Several places stay alternatives here too, exactly as on the place screen.
    expect(rows[1].textContent).toContain('или');
    expect(rows[2].textContent).toContain('3 пассажира, из них 1 ребёнок');
    expect(rows[2].querySelector('[data-summary-child-seat]')!.textContent).toBe('Нужно детское кресло');

    // A few quiet lines above the one primary action, never a screen of its own.
    const publish = within(productScreen()).getByRole('button', { name: 'Опубликовать' });
    expect(summary.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(summary).getAllByRole('button').every((button) => button.className.includes('quietButton')))
      .toBe(true);
    expect(summary.querySelectorAll('h1, h2, h3, h4').length).toBe(0);
  });

  it('drops the child seat from the summary as soon as the group has no children', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Изменить: Сколько вас' }));
    expect(step()).toBe('people');
    press('Из них детей: меньше');
    press('Далее');

    const rows = [...productScreen().querySelectorAll('[data-summary-row]')];
    expect(rows[2].textContent).toContain('3 пассажира');
    expect(rows[2].textContent).not.toContain('из них');
    expect(rows[2].querySelector('[data-summary-child-seat]')).toBeNull();
  });

  it('sends every quiet «Изменить» to the screen that owns the answer, and keeps the rest', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');

    const jump = (name: string) =>
      fireEvent.click(within(productScreen()).getByRole('button', { name }));

    jump('Изменить: Когда');
    expect(step()).toBe('when');
    fireEvent.click(productScreen().querySelector('[data-custom-choice] input')!);
    fireEvent.change(productScreen().querySelector('[data-custom-arrival] input')!, {
      target: { value: '2026-08-26T18:00' },
    });
    press('Далее');
    press('Далее');
    press('Далее');

    expect(step()).toBe('final');
    const rows = [...productScreen().querySelectorAll('[data-summary-row]')];
    expect(rows[0].textContent).toContain('среда, 26 августа, 18:00');
    // Nothing else moved: the note, the return ride and the places are as they were.
    expect((productScreen().querySelector('[data-note-field] textarea') as HTMLTextAreaElement).value)
      .toBe('у входа в библиотеку');
    expect(rows[1].textContent).toContain('Piazza Matteotti, 88100 Catanzaro CZ');
    expect(rows[2].textContent).toContain('3 пассажира, из них 1 ребёнок');

    jump('Изменить: Где вас забрать');
    expect(step()).toBe('place');
    expect(productScreen().querySelectorAll('[data-place-card]').length).toBe(2);
  });

  it('never builds a success or sign-in flow behind «Опубликовать»', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');

    press('Опубликовать');
    // Publication stays a condition outside this subgroup: the screen does not change and no
    // account, contact check or confirmation appears in its place.
    expect(step()).toBe('final');
    const text = productScreen().textContent ?? '';
    ['Опубликовано', 'Просьба опубликована', 'Войти', 'Создать аккаунт', 'Подтвердите телефон', 'Код'].forEach(
      (forbidden) => expect(text).not.toContain(forbidden),
    );
  });

  it('changes no production passenger-flow route or component', () => {
    const groupStrings = [
      'Когда вам нужна поездка?',
      'Сколько вас будет?',
      'Для вашей безопасности всем будет видна только примерная область',
      'Ещё одно место встречи',
      'Подтвердить место',
      'Больше трёх мест указать нельзя.',
      'Последние детали',
      'Короткое уточнение для водителя. Не пишите домашний адрес, телефон, email и ссылки.',
      'Кратко о вашей просьбе',
    ];

    const roots = ['src/app', 'src/components', 'src/lib'];
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(full.replace(/\\/g, '/'));
      }
    };
    roots.forEach((root) => walk(resolve(process.cwd(), root)));

    const outside = files.filter((file) => !file.includes('/src/app/copy-review/'));
    expect(outside.length).toBeGreaterThan(20);

    outside.forEach((file) => {
      const content = readFileSync(file, 'utf8');
      groupStrings.forEach((needle) => {
        expect(`${file}: ${content.includes(needle)}`).toBe(`${file}: false`);
      });
      expect(content).not.toContain('copy-review');
    });
  });
});
