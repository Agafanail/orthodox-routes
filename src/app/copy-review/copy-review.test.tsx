// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('offers exactly the four approved review screens and keeps the switch outside the screen', () => {
    render(<CopyReviewPage />);

    const selector = screen.getByRole('navigation', { name: 'Выбор экрана проверки' });
    expect(within(selector).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '1 · Каталог храмов',
      '2 · Страница храма',
      '3 · Поездки храма',
      '4 · Пустой храм',
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

    ['1 · Каталог храмов', '2 · Страница храма', '3 · Поездки храма', '4 · Пустой храм'].forEach((label) => {
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
