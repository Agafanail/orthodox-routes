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

  it('offers the four reviewed screens plus the four request screens, with the switch outside them', () => {
    render(<CopyReviewPage />);

    const selector = screen.getByRole('navigation', { name: 'Выбор экрана проверки' });
    expect(within(selector).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '1 · Каталог храмов',
      '2 · Страница храма',
      '3 · Поездки храма',
      '4 · Пустой храм',
      '5 · Просьба: когда',
      '6 · Где вас забрать: карта',
      '7 · Где вас забрать: места',
      '8 · Просьба: сколько вас',
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
      '5 · Просьба: когда',
      '6 · Где вас забрать: карта',
      '7 · Где вас забрать: места',
      '8 · Просьба: сколько вас',
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
 * Group 2A: the first four semantic screens of the passenger request form after the owner decision
 * of 22 August 2026 (Foundation 1.9, IA §10.1). The tests guard the structure that decision fixed —
 * four screens, no review step, alternatives instead of stops — and the wording actually rendered.
 */
describe('Passenger request review states', () => {
  const requestSamples = [
    ['5 · Просьба: когда', 'request-when'],
    ['6 · Где вас забрать: карта', 'request-map'],
    ['7 · Где вас забрать: места', 'request-place'],
    ['8 · Просьба: сколько вас', 'request-people'],
  ] as const;

  function sourceRows() {
    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    return [...panel.querySelectorAll('dd')].map((row) => row.textContent);
  }

  it('opens each of the four states directly from its own address', () => {
    requestSamples.forEach(([label, anchor]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      cleanup();
    });
    window.location.hash = '';
  });

  it('asks when the passenger wants to arrive with the service and an own date in one group', () => {
    render(<CopyReviewPage />);
    openSample('5 · Просьба: когда');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Когда вам нужна поездка?' })).not.toBeNull();
    expect(form.textContent).toContain('Храм Покрова Пресвятой Богородицы в Catanzaro');
    expect(form.textContent).toContain('Всенощное бдение');
    expect(form.textContent).toContain('Указать свои дату и время');
    expect(form.textContent).toContain('Просьбу можно создать не больше чем на 8 недель вперёд.');

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
    expect(form.querySelector('[data-custom-arrival]')!.textContent).toContain('Хочу приехать к');
    expect(form.textContent).toContain(
      'Если нужной службы нет в расписании, укажите дату и время, к которому нужно приехать.',
    );
  });

  it('explains what becomes public while the place is still being chosen, not after publication', () => {
    render(<CopyReviewPage />);
    openSample('6 · Где вас забрать: карта');
    const map = productScreen();

    expect(within(map).getAllByPlaceholderText('Найти адрес').length).toBe(1);
    expect(map.textContent).toContain('Введите адрес или передвиньте маркер на карте.');
    expect(map.textContent).toContain('Выбрано: Via Milano, 8, 88100 Catanzaro CZ');

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

    ['6 · Где вас забрать: карта', '7 · Где вас забрать: места'].forEach((label) => {
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

    ['6 · Где вас забрать: карта', '7 · Где вас забрать: места'].forEach((label) => {
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

    ['6 · Где вас забрать: карта', '7 · Где вас забрать: места'].forEach((label) => {
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

  it('treats the map as a nested screen of «Где вас забрать?», not a third step', () => {
    render(<CopyReviewPage />);

    openSample('6 · Где вас забрать: карта');
    const mapHeading = within(productScreen()).getByRole('heading', { name: 'Где вас забрать?' });
    expect(mapHeading).not.toBeNull();
    // Leaving the nested screen is a confirming action, not a «Далее» of its own step.
    expect(within(productScreen()).getByRole('button', { name: 'Подтвердить место' })).not.toBeNull();
    expect(within(productScreen()).queryByRole('button', { name: 'Далее' })).toBeNull();

    openSample('7 · Где вас забрать: места');
    // The state after returning carries the same question, so both are one semantic screen.
    expect(within(productScreen()).getByRole('heading', { level: 1, name: 'Где вас забрать?' })).not.toBeNull();
    expect(within(productScreen()).getByRole('button', { name: 'Далее' })).not.toBeNull();
  });

  it('shows the chosen address exactly once in each state of the place step', () => {
    render(<CopyReviewPage />);
    const address = 'Via Milano, 8, 88100 Catanzaro CZ';

    ['6 · Где вас забрать: карта', '7 · Где вас забрать: места'].forEach((label) => {
      openSample(label);
      const text = productScreen().textContent ?? '';
      expect(text.split(address).length - 1).toBe(1);
    });

    // Adding alternatives never repeats an address already shown.
    openSample('7 · Где вас забрать: места');
    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Добавить место' }));
    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Добавить место' }));
    const shown = [...productScreen().querySelectorAll('[data-place-card]')]
      .map((card) => card.querySelector('[class*="data"]')!.textContent);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(3);
  });

  it('keeps one required place and up to two alternatives, with a reason when the limit is reached', () => {
    render(<CopyReviewPage />);
    openSample('7 · Где вас забрать: места');
    const cards = () => [...productScreen().querySelectorAll('[data-place-card]')];
    const add = () => within(productScreen()).queryByRole('button', { name: 'Добавить место' });

    expect(cards().length).toBe(1);
    expect(cards()[0].textContent).toContain('Основное место встречи');
    // The one required place cannot be removed; the alternatives can.
    expect(within(cards()[0] as HTMLElement).queryByRole('button', { name: 'Убрать это место' })).toBeNull();
    expect(within(cards()[0] as HTMLElement).getByRole('button', { name: 'Изменить это место' })).not.toBeNull();

    fireEvent.click(add()!);
    expect(cards().length).toBe(2);
    expect(cards()[1].textContent).toContain('Ещё одно место встречи');

    fireEvent.click(add()!);
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
    openSample('7 · Где вас забрать: места');
    const list = () => productScreen().querySelector('[data-place-list]')!;

    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Добавить место' }));
    fireEvent.click(within(productScreen()).getByRole('button', { name: 'Добавить место' }));

    // «или» between the cards, one separator fewer than the number of places.
    expect([...list().querySelectorAll('[data-place-or]')].map((node) => node.textContent)).toEqual([
      'или',
      'или',
    ]);
    expect(productScreen().textContent).toContain(
      'Можно указать до трёх мест. Водитель выберет одно из них — это не остановки по пути.',
    );

    // Nothing numbers or orders the places: no ordered list, no route vocabulary.
    expect(list().querySelectorAll('ol').length).toBe(0);
    const text = productScreen().textContent ?? '';
    ['остановк', 'по пути заберёт', 'маршрут', 'сначала', 'затем', 'потом'].forEach((word) => {
      const allowed = word === 'остановк' ? 1 : 0;
      const found = text.toLowerCase().split(word).length - 1;
      expect(found).toBe(allowed);
    });
  });

  it('groups passengers, children and the child seat on one screen', () => {
    render(<CopyReviewPage />);
    openSample('8 · Просьба: сколько вас');
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

  it('has no review step and no public-versus-private screen anywhere in the subgroup', () => {
    render(<CopyReviewPage />);

    requestSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      ['Проверьте просьбу', 'Что увидят все', 'Что увидит', 'Проверьте сведения', 'Проверить'].forEach(
        (forbidden) => expect(text).not.toContain(forbidden),
      );
      // Publication belongs to the next subgroup: no screen here offers it.
      expect(within(productScreen()).queryByRole('button', { name: 'Опубликовать' })).toBeNull();
      expect(text).not.toContain('Опубликовать');
    });
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

  it('marks every reviewed string of the group as approved by the owner', () => {
    render(<CopyReviewPage />);

    requestSamples.forEach(([label]) => {
      openSample(label);
      const marks = sourceRows();

      expect(marks.length).toBeGreaterThan(0);
      expect(new Set(marks)).toEqual(new Set(['Утверждено']));
    });
  });

  it('carries no pending-review wording for a group the owner has already seen', () => {
    render(<CopyReviewPage />);
    openSample('5 · Просьба: когда');

    // The shared legend still explains `Проект` for the group 1 rows that keep it; what must be
    // gone is any claim that this group is still waiting to be seen.
    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    expect(panel.textContent).toContain('24 августа 2026');
    expect(panel.textContent).not.toContain('ждёт просмотра');
    expect(panel.textContent).not.toContain('ничего не утверждает');

    // The simulated product screen has its own header, so pick the review chrome one.
    const header = screen.getAllByRole('banner').find((node) => !node.closest('[data-product-screen]'))!;
    expect(header.textContent).not.toContain('ждёт просмотра');
    expect(header.textContent).toContain('просмотрены');
  });

  it('keeps the reviewed group 1 wording and marks untouched', () => {
    render(<CopyReviewPage />);
    openSample('1 · Каталог храмов');

    expect(sourceRows()).toContain('Утверждено');
    expect(productScreen().textContent).toContain('Расписание пока не добавлено');
    expect(productScreen().textContent).toContain('2 предложения подвезти');
  });

  it('changes no production passenger-flow route or component', () => {
    const groupStrings = [
      'Когда вам нужна поездка?',
      'Сколько вас будет?',
      'Для вашей безопасности всем будет видна только примерная область',
      'Ещё одно место встречи',
      'Подтвердить место',
      'Больше трёх мест указать нельзя.',
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
