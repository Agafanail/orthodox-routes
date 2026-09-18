// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyReviewPage from './page';

afterEach(cleanup);

/*
 * Group 4 of the manual Russian copy review: the ride map of one board group (IA §9.3, DS §8.1–8.2,
 * DESIGN_DECISIONS 19–25 and 32), as the owner left it on 3 September 2026.
 *
 * That review took explanations off the screen: the subtitle, the two legend sentences, the privacy
 * paragraphs, the note about what a distance means and the visible reason of an unavailable filter
 * are all gone, and the custom-date state went with them. The tests guard both halves of that — the
 * removed text must not creep back, and what replaced it must still say enough: a heading precise
 * enough to stand alone, two compact keys that separate the roles without colour alone, one short
 * privacy sentence per case, a muted filter that assistive technology can still explain, and a card
 * that counts alternative meeting areas instead of naming one of them.
 *
 * The product rules underneath are unchanged and still guarded: public approximate geometry only,
 * no route, no exact point, location by explicit action alone.
 */

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

function sourceRows() {
  const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
  return [...panel.querySelectorAll('dd')].map((row) => row.textContent);
}

const press = (name: string) => fireEvent.click(within(productScreen()).getByRole('button', { name }));

const objectNames = () =>
  [...productScreen().querySelectorAll('[data-map-object]')].map((object) => object.getAttribute('aria-label'));

const shapeKinds = () =>
  [...productScreen().querySelectorAll('[data-map-shape]')].map(
    (shape) => (shape as HTMLElement).dataset.mapShape,
  );

/** Every entry point, in the order the review switch offers them, with its own address. */
const mapSamples = [
  ['25 · Карта: обычное состояние', 'map-base'],
  ['26 · Карта: выбран водитель', 'map-driver'],
  ['27 · Карта: выбран пассажир', 'map-passenger'],
  ['28 · Карта: пассажир, несколько мест', 'map-passenger-areas'],
  ['29 · Карта: показано, где я', 'map-located'],
  ['30 · Карта: недоступный фильтр', 'map-filter-empty'],
  ['31 · Карта на компьютере', 'map-desktop'],
] as const;

/** Every sentence the owner took off the map on 3 September 2026. None may come back anywhere. */
const removedCopy = [
  'Поездки этой службы · примерные области',
  'Поездки на эту дату · примерные области',
  'Пунктирный круг — примерная область пассажира',
  'Сплошной круг — примерная область отправления водителя',
  'Расстояния примерные: они считаются до публичной области, а не до точного места.',
  'Просьб пассажиров на эту службу пока нет — фильтр недоступен.',
  'Предложений водителей на эту службу пока нет — фильтр недоступен.',
  'Показана примерная область отправления радиусом 1 км.',
  'Показана примерная область радиусом 1 км.',
  'возможные места встречи одной просьбы',
  'маршрут поездки не публикуется',
];

describe('Ride map review states', () => {
  it('opens each of the seven states directly from its own address', () => {
    mapSamples.forEach(([label, anchor]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      expect(productScreen().querySelector('[data-ride-map]')).not.toBeNull();
      cleanup();
    });
    window.location.hash = '';
  }, 28000);

  it('no longer offers a dedicated custom-date review state', () => {
    render(<CopyReviewPage />);

    const selector = screen.getByRole('navigation', { name: 'Выбор экрана проверки' });
    expect(within(selector).queryByRole('button', { name: /собственная дата/i })).toBeNull();
    expect(selector.textContent).not.toContain('Карта: собственная дата');

    cleanup();
    window.location.hash = '#map-custom-date';
    render(<CopyReviewPage />);
    /* An address that names no state falls back to the first screen instead of inventing one. */
    expect((document.querySelector('[data-sample-id]') as HTMLElement).dataset.sampleId).toBe('catalog');
    window.location.hash = '';
  });

  it('heads the map with the group and nothing under it', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');
    const header = productScreen().querySelector('[class*="mapHeader"]') as HTMLElement;

    /* The heading carries the time itself, so no second line has to make it precise. */
    expect(header.textContent).toBe('Божественная литургия · 23 августа, 9:00');
    expect(header.querySelectorAll('small, p').length).toBe(0);

    openSample('30 · Карта: недоступный фильтр');
    expect((productScreen().querySelector('[class*="mapHeader"]') as HTMLElement).textContent)
      .toBe('Всенощное бдение · 22 августа, 18:00');
  });

  it('renders the plain map: filters, objects, two compact keys and one location action', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');
    const map = productScreen();

    expect(within(map).getByRole('button', { name: 'Назад к доске поездок' })).not.toBeNull();
    expect(within(map).getByRole('group', { name: 'Тип объявления' })).not.toBeNull();
    expect(within(map).getAllByRole('button', { name: 'Показать, где я' }).length).toBe(1);
    expect(objectNames()).toEqual([
      'Водитель · 23 августа, 08:00 · примерная область отправления',
      'Пассажир · 23 августа, 08:15 · примерная область, место 1 из 2',
      'Пассажир · 23 августа, 08:15 · примерная область, место 2 из 2',
      'Водитель · 23 августа, 07:40 · примерная область отправления',
      'Пассажир · 23 августа, 08:00 · примерная область',
    ]);
    expect(map.querySelector('[data-ride-detail]')).toBeNull();
  });

  it('keeps the map key in the bottom-left corner, above the card when one is open', () => {
    render(<CopyReviewPage />);

    openSample('25 · Карта: обычное состояние');
    const legend = () => productScreen().querySelector('[data-map-legend]') as HTMLElement;
    /* No card: the key sits its own inset from the bottom edge of the map. */
    expect(legend().style.bottom).toBe('16px');
    expect(legend().parentElement?.className).toContain('mapCanvas');
    /* It is not part of the action group at the top of the map any more. */
    expect(productScreen().querySelector('[class*="mapOverlay"]')!.contains(legend())).toBe(false);

    openSample('26 · Карта: выбран водитель');
    /* jsdom lays nothing out, so the card measures 0 and the inset stays where it started. */
    expect(legend().style.bottom).toMatch(/^\d+px$/);
    expect(legend().previousElementSibling?.className).toContain('mapOverlay');
  });

  it('reduces the map key to two role labels', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');
    const legend = within(productScreen()).getByRole('note', { name: 'Условные обозначения' });

    expect(legend.textContent).toBe('ВодительПассажир');
    expect([...legend.querySelectorAll('span[data-legend-key]')].map((key) => (key as HTMLElement).dataset.legendKey))
      .toEqual(['driver', 'passenger']);
    /* Two short keys, not a block of instructions: no sentence, so no full stop and no dash. */
    expect(legend.textContent).not.toMatch(/[.—]/);
  });

  it('separates the two map keys by outline and label, not by colour alone', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');
    const map = productScreen();
    const styles = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.module.css'), 'utf8');

    /* The visible label names the role; the shapes differ in outline; colour only repeats both. */
    const driverKey = map.querySelector('[data-legend-key="driver"]') as HTMLElement;
    const passengerKey = map.querySelector('[data-legend-key="passenger"]') as HTMLElement;
    expect(driverKey.textContent).toBe('Водитель');
    expect(passengerKey.textContent).toBe('Пассажир');
    expect(driverKey.querySelector('[class*="legendDepartureArea"]')).not.toBeNull();
    expect(passengerKey.querySelector('[class*="legendArea"]')).not.toBeNull();

    expect(styles).toMatch(/\.legendArea \{[^}]*border: 1px dashed/);
    expect(styles).toMatch(/\.legendDepartureArea \{[^}]*border: 1px solid/);
    expect(styles).toMatch(/\.areaShape \{[^}]*stroke-dasharray: 3 2\.4/);
    expect(styles).toMatch(/\.departureAreaShape \{[^}]*stroke: var\(--or-map-driver-border\)/);
    expect(styles).toMatch(/\.areaShape \{[^}]*stroke: var\(--or-map-passenger-border\)/);
  });

  it('says the driver privacy rule in one sentence, without repeating the route rule', () => {
    render(<CopyReviewPage />);
    openSample('26 · Карта: выбран водитель');
    const detail = productScreen().querySelector('[data-ride-detail]') as HTMLElement;

    expect(detail.textContent).toContain('Предложение водителя');
    expect(detail.querySelector('[data-map-privacy]')!.textContent).toBe(
      'Место отправления показано примерно; точное место откроется после договорённости.',
    );
    expect(within(detail).getByRole('button', { name: 'Закрыть карточку и вернуться к карте' })).not.toBeNull();
    /* The selected ride is the only one the person chose, so its action becomes primary. */
    expect(detail.querySelector('[data-ride-card] button')!.className).toContain('primaryButton');
    expect(detail.textContent).not.toContain('1 км');
    expect(detail.textContent).not.toContain('маршрут');
  });

  it('separates one meeting area from several alternatives of the same request', () => {
    render(<CopyReviewPage />);

    openSample('27 · Карта: выбран пассажир');
    const one = productScreen().querySelector('[data-ride-detail]') as HTMLElement;
    expect(one.textContent).toContain('Просьба пассажира');
    expect(one.querySelector('[data-map-privacy]')!.textContent).toBe(
      'Место встречи показано примерно; точное место откроется после договорённости.',
    );
    /* One public area, so the card may still name the place it stands for. */
    expect(one.querySelector('[data-ride-place]')!.textContent).toBe('Место встречи: Soverato');
    expect(productScreen().querySelectorAll('[data-map-shape="area"][data-selected="true"]').length).toBe(1);

    openSample('28 · Карта: пассажир, несколько мест');
    const many = productScreen().querySelector('[data-ride-detail]') as HTMLElement;
    expect(many.querySelector('[data-map-privacy]')!.textContent).toBe(
      'Показаны примерные места встречи; точное место откроется после договорённости.',
    );
    expect(productScreen().querySelectorAll('[data-ride-detail]').length).toBe(1);
    expect(productScreen().querySelectorAll('[data-map-shape="area"][data-selected="true"]').length).toBe(2);
  });

  it('counts the alternative meeting areas instead of naming one of them', () => {
    render(<CopyReviewPage />);
    openSample('28 · Карта: пассажир, несколько мест');
    const detail = productScreen().querySelector('[data-ride-detail]') as HTMLElement;

    expect(detail.querySelector('[data-ride-place]')!.textContent).toBe('2 возможных места встречи');
    /* Naming one of two alternatives would claim a meeting place had already been settled. */
    expect(detail.textContent).not.toContain('Место встречи: Catanzaro, центр');
    expect(detail.textContent).not.toContain('Catanzaro, центр');

    /* The board still names the primary place of the same request: group 1 is untouched. */
    openSample('3 · Поездки храма');
    expect(productScreen().textContent).toContain('Место встречи: Catanzaro, центр');
  });

  it('opens the same card from either alternative area of one request', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');

    press('Пассажир · 23 августа, 08:15 · примерная область, место 2 из 2');
    expect(productScreen().querySelectorAll('[data-ride-detail]').length).toBe(1);
    expect(productScreen().querySelector('[data-ride-place]')!.textContent).toBe('2 возможных места встречи');
    expect(productScreen().querySelectorAll('[data-map-shape="area"][data-selected="true"]').length).toBe(2);
    /* Alternatives, never stops: nothing joins the two areas of one request. */
    expect(productScreen().querySelectorAll('line, polyline, polygon').length).toBe(0);

    press('Закрыть карточку и вернуться к карте');
    expect(productScreen().querySelector('[data-ride-detail]')).toBeNull();
  });

  it('keeps the location off until the explicit action, and the distance out of sight until then', () => {
    render(<CopyReviewPage />);
    openSample('28 · Карта: пассажир, несколько мест');
    const map = () => productScreen();

    expect(map().querySelector('[data-map-shape="user"]')).toBeNull();
    expect(map().querySelector('[data-ride-distance]')).toBeNull();
    expect(map().textContent).not.toContain('км от вас');

    press('Показать, где я');
    expect(map().querySelector('[data-map-shape="user"]')).not.toBeNull();
    expect(map().querySelector('[data-ride-distance]')!.textContent).toBe('≈3 км от вас');

    press('Показать, где я');
    expect(map().querySelector('[data-map-shape="user"]')).toBeNull();
    expect(map().querySelector('[data-ride-distance]')).toBeNull();
  });

  it('lets the distance stand alone, with no line explaining what it means', () => {
    render(<CopyReviewPage />);
    openSample('29 · Карта: показано, где я');
    const map = productScreen();

    expect(within(map).getByRole('button', { name: 'Показать, где я' }).getAttribute('aria-pressed')).toBe('true');
    expect(map.querySelector('[data-map-shape="user"]')).not.toBeNull();
    expect(map.querySelector('[data-ride-distance]')!.textContent).toBe('≈23 км от вас');
    expect(map.querySelector('[data-location-note]')).toBeNull();
    expect(map.textContent).not.toContain('Расстояния примерные');
    expect(map.textContent).not.toContain('по прямой');
  });

  it('never asks the browser for a location: the review surface has no geolocation call at all', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.tsx'), 'utf8');

    expect(source).not.toContain('navigator.geolocation');
    expect(source).not.toContain('getCurrentPosition');
    expect(source).not.toContain('watchPosition');
  });

  it('mutes an unavailable role filter without writing a sentence about it', () => {
    render(<CopyReviewPage />);
    openSample('30 · Карта: недоступный фильтр');
    const map = productScreen();
    const passengers = within(map).getByRole('button', { name: 'Пассажиры' });

    expect(passengers.hasAttribute('disabled')).toBe(true);
    expect(within(map).getByRole('button', { name: 'Водители' }).hasAttribute('disabled')).toBe(false);
    expect(map.querySelector('[data-empty-filter-reason]')).toBeNull();
    expect(map.querySelector('[class*="noticeLine"]')).toBeNull();
    expect(map.textContent).not.toContain('фильтр недоступен');

    /*
     * Assistive technology still learns why, and the explanation never becomes a visible line. The
     * wording names only the filter, so a custom-date group would read exactly the same.
     */
    const reason = document.getElementById(passengers.getAttribute('aria-describedby')!) as HTMLElement;
    expect(reason.textContent).toBe('Пассажиры — поездок нет');
    expect(reason.textContent).not.toMatch(/служб|дат/);
    expect(reason.className).toContain('srOnly');
    expect(map.querySelectorAll('[data-map-shape="area"]').length).toBe(0);
    expect(map.querySelectorAll('[data-map-shape="departure-area"]').length).toBe(2);
  });

  it('changes the visible map objects when the filter changes, and drops the selection with them', () => {
    render(<CopyReviewPage />);
    openSample('26 · Карта: выбран водитель');

    expect(productScreen().querySelectorAll('[data-map-object]').length).toBe(5);

    press('Пассажиры');
    expect(productScreen().querySelector('[data-ride-detail]')).toBeNull();
    expect(objectNames()).toEqual([
      'Пассажир · 23 августа, 08:15 · примерная область, место 1 из 2',
      'Пассажир · 23 августа, 08:15 · примерная область, место 2 из 2',
      'Пассажир · 23 августа, 08:00 · примерная область',
    ]);

    press('Водители');
    expect(objectNames()).toEqual([
      'Водитель · 23 августа, 08:00 · примерная область отправления',
      'Водитель · 23 августа, 07:40 · примерная область отправления',
    ]);

    press('Все');
    expect(productScreen().querySelectorAll('[data-map-object]').length).toBe(5);
  });

  it('carries the board filter onto the map and back to the board of the same group', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');

    press('Водители');
    fireEvent.click(productScreen().querySelector('[data-map-entry]') as HTMLElement);

    const map = productScreen();
    expect(map.querySelector('[data-ride-map]')).not.toBeNull();
    expect(within(map).getByRole('button', { name: 'Водители' }).getAttribute('aria-pressed')).toBe('true');
    expect(map.querySelectorAll('[data-map-object]').length).toBe(2);

    press('Назад к доске поездок');
    const board = productScreen();
    expect(board.querySelector('[data-board-list]')).not.toBeNull();
    expect(within(board).getByRole('button', { name: 'Водители' }).getAttribute('aria-pressed')).toBe('true');
    expect([...board.querySelectorAll('[data-ride-card]')].map((card) => (card as HTMLElement).dataset.rideType))
      .toEqual(['Водитель', 'Водитель']);
  });

  it('falls back to «Все» when the carried filter has nothing in the group it opens', () => {
    render(<CopyReviewPage />);
    openSample('3 · Поездки храма');
    press('Пассажиры');

    openSample('30 · Карта: недоступный фильтр');
    const map = productScreen();

    expect(within(map).getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('true');
    expect(map.querySelectorAll('[data-map-object]').length).toBe(2);
  });

  it('puts the selected card in a panel beside the map on a computer, not in a bottom sheet', () => {
    render(<CopyReviewPage />);

    openSample('28 · Карта: пассажир, несколько мест');
    expect((productScreen().querySelector('[data-ride-detail]') as HTMLElement).className).toContain('detailSheet');

    openSample('31 · Карта на компьютере');
    const desktop = productScreen();
    expect(desktop.querySelector('[data-ride-map]')!.className).toContain('desktopMapScreen');
    expect((desktop.querySelector('[data-ride-detail]') as HTMLElement).className).toContain('detailPanel');
    expect(desktop.querySelector('[data-ride-place]')!.textContent).toBe('2 возможных места встречи');
  });

  it('represents no public route, corridor or exact point on any map state', () => {
    render(<CopyReviewPage />);

    mapSamples.forEach(([label]) => {
      openSample(label);
      const map = productScreen();

      shapeKinds().forEach((kind) => {
        expect(`${label}: ${kind}`).toMatch(/: (area|departure-area|church|user)$/);
      });
      expect(`${label}: ${map.querySelectorAll('line, polyline, polygon').length}`).toBe(`${label}: 0`);
      expect(`${label}: ${map.querySelector('[class*="routeLine"], [class*="routeOverlay"]') !== null}`)
        .toBe(`${label}: false`);
      expect(`${label}: ${/Маршрут|остановк|точный адрес|Проложить маршрут/.test(map.textContent ?? '')}`)
        .toBe(`${label}: false`);
      expect(`${label}: ${/\d+\s*%|балл|рейтинг|Подходит/.test(map.textContent ?? '')}`).toBe(`${label}: false`);
    });
  });

  it('leaves none of the removed explanations anywhere on the review surface', () => {
    render(<CopyReviewPage />);

    mapSamples.forEach(([label]) => {
      openSample(label);
      const page = document.body.textContent ?? '';
      removedCopy.forEach((removed) => {
        expect(`${label} · ${removed}: ${page.includes(removed)}`).toBe(`${label} · ${removed}: false`);
      });
    });
  });

  it('marks approved only what the owner decided, and leaves the rest a proposal', () => {
    render(<CopyReviewPage />);

    mapSamples.forEach(([label]) => {
      openSample(label);
      expect(`${label}: ${[...new Set(sourceRows())].sort().join(', ')}`)
        .toBe(`${label}: Проект, Решение, Утверждено`);
    });

    /* The back action and the accessible names were not part of the review and stay proposals. */
    openSample('25 · Карта: обычное состояние');
    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    const row = (text: string) => [...panel.querySelectorAll('div')]
      .find((entry) => entry.querySelector('dt')?.textContent?.startsWith(text));

    expect(row('Назад к доске поездок')?.querySelector('dd')?.textContent).toBe('Проект');
    expect(row('Условные обозначения')?.querySelector('dd')?.textContent).toBe('Проект');
    expect(row('Божественная литургия · 23 августа, 9:00')?.querySelector('dd')?.textContent).toBe('Утверждено');
    expect(row('Водитель')?.querySelector('dd')?.textContent).toBe('Утверждено');
    expect(panel.textContent).toContain('3 сентября 2026 года');
  });

  it('leaves the reviewed group 1–3 states untouched', () => {
    render(<CopyReviewPage />);

    openSample('3 · Поездки храма');
    expect(productScreen().textContent).toContain('Божественная литургия · 23 августа, 9:00');
    expect((productScreen().querySelector('[data-map-entry]') as HTMLElement).textContent).toBe('Поездки на карте');
    [...productScreen().querySelectorAll('[data-ride-card] button')].forEach((button) => {
      expect(button.className).toContain('secondaryButton');
    });

    openSample('13 · Последние детали');
    expect(productScreen().textContent).toContain('Последние детали');
    expect(sourceRows()).toContain('Утверждено');

    openSample('22 · Проверьте поездку');
    expect(productScreen().textContent).toContain('Проверьте поездку');
    expect(sourceRows()).toContain('Утверждено');
  });

  it('stays an isolated review surface with no production navigation behind the map', () => {
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');

    expect(document.querySelectorAll('a[href^="/"]').length).toBe(0);
    expect(productScreen().querySelectorAll('form, iframe, canvas').length).toBe(0);
  });
});

/*
 * The card is what hides the map, so its height is what the map has to answer. jsdom lays nothing
 * out, so the sizes below stand in for a real phone and a real computer: a 390 × 844 frame whose
 * card takes the lower third, and a 1180 × 720 frame whose panel takes the right edge. The
 * assertion is the invariant itself — after the map moves, every area of the selected ride sits
 * inside the part of the canvas that neither the card nor the floating controls cover.
 */
describe('Selected geography stays visible under an open card', () => {
  const phone = { canvas: { x: 0, y: 116, width: 390, height: 728 }, detail: { x: 0, y: 560, width: 390, height: 284 } };
  const computer = { canvas: { x: 0, y: 120, width: 1180, height: 600 }, detail: { x: 776, y: 144, width: 380, height: 300 } };
  const overlay = { width: 300, height: 48 };
  const legend = { width: 200, height: 34 };
  const inset = { phone: 16, computer: 24 };

  function layout({ canvas, detail }: typeof phone) {
    const rect = (x: number, y: number, width: number, height: number) => ({
      x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}),
    }) as DOMRect;

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.className?.toString().includes('mapCanvas')) return rect(canvas.x, canvas.y, canvas.width, canvas.height);
      if (this.hasAttribute('data-ride-detail')) return rect(detail.x, detail.y, detail.width, detail.height);
      if (this.hasAttribute('data-map-legend')) return rect(canvas.x + 16, 0, legend.width, legend.height);
      if (this.className?.toString().includes('mapOverlay')) {
        return rect(canvas.x + 16, canvas.y + 12, overlay.width, overlay.height);
      }
      return rect(0, 0, 0, 0);
    });
  }

  /** The map moves as one layer, so a shape's place after the move is pure arithmetic. */
  function movedAreas(frame: typeof phone, desktop: boolean) {
    const focus = document.querySelector('[data-map-focus="on"]') as HTMLElement;
    expect(focus).not.toBeNull();

    const [, dx, dy] = /translate\((-?\d+)px, (-?\d+)px\)/.exec(focus.style.transform)!.map(Number);
    const [, scale] = /scale\(([\d.]+)\)/.exec(focus.style.transform)!.map(Number);
    const [originX, originY] = focus.style.transformOrigin.split(' ').map(parseFloat);

    const { canvas } = frame;
    const size = desktop ? canvas.height : canvas.width;
    const fieldLeft = canvas.x + (canvas.width - size) / 2;
    const fieldTop = canvas.y + (canvas.height - size) / 2;
    const pivotX = canvas.x + (originX / 100) * canvas.width;
    const pivotY = canvas.y + (originY / 100) * canvas.height;

    return [...document.querySelectorAll('[data-map-object]')].map((object) => {
      const style = (object as HTMLElement).style;
      const cx = fieldLeft + (parseFloat(style.left) / 100) * size;
      const cy = fieldTop + (parseFloat(style.top) / 100) * size;
      const radius = (7 / 100) * size * scale;
      return {
        name: object.getAttribute('aria-label') ?? '',
        selected: object.getAttribute('aria-pressed') === 'true',
        left: pivotX + (cx - pivotX) * scale + dx - radius,
        right: pivotX + (cx - pivotX) * scale + dx + radius,
        top: pivotY + (cy - pivotY) * scale + dy - radius,
        bottom: pivotY + (cy - pivotY) * scale + dy + radius,
      };
    });
  }

  function expectSelectedInsideFreeMap(frame: typeof phone, desktop: boolean) {
    /* The key rides its own inset above the card on a phone, and above the map edge on a computer. */
    const legendBottom = (desktop ? inset.computer : inset.phone) + (desktop ? 0 : frame.detail.height);
    const free = {
      left: frame.canvas.x,
      right: desktop ? frame.detail.x : frame.canvas.x + frame.canvas.width,
      top: frame.canvas.y + 12 + overlay.height,
      bottom: frame.canvas.y + frame.canvas.height - legendBottom - legend.height,
    };

    const selected = movedAreas(frame, desktop).filter((area) => area.selected);
    expect(selected.length).toBeGreaterThan(0);
    selected.forEach((area) => {
      expect(`${area.name}: left ${area.left >= free.left}`).toBe(`${area.name}: left true`);
      expect(`${area.name}: right ${area.right <= free.right}`).toBe(`${area.name}: right true`);
      expect(`${area.name}: top ${area.top >= free.top}`).toBe(`${area.name}: top true`);
      expect(`${area.name}: bottom ${area.bottom <= free.bottom}`).toBe(`${area.name}: bottom true`);
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a selected driver departure area clear of the card on a phone', () => {
    layout(phone);
    render(<CopyReviewPage />);
    openSample('26 · Карта: выбран водитель');

    expectSelectedInsideFreeMap(phone, false);
  });

  it('keeps a single meeting area clear of the card on a phone', () => {
    layout(phone);
    render(<CopyReviewPage />);
    openSample('27 · Карта: выбран пассажир');

    expectSelectedInsideFreeMap(phone, false);
  });

  it('keeps every alternative area of one request clear of the card on a phone', () => {
    layout(phone);
    render(<CopyReviewPage />);
    openSample('28 · Карта: пассажир, несколько мест');

    expect(document.querySelectorAll('[data-map-shape="area"][data-selected="true"]').length).toBe(2);
    expectSelectedInsideFreeMap(phone, false);
  });

  it('keeps the selected areas clear of the side panel on a computer', () => {
    layout(computer);
    render(<CopyReviewPage />);
    openSample('31 · Карта на компьютере');

    expectSelectedInsideFreeMap(computer, true);
  });

  it('leaves the map where it stands while no ride is selected', () => {
    layout(phone);
    render(<CopyReviewPage />);
    openSample('25 · Карта: обычное состояние');

    const focus = document.querySelector('[data-map-focus]') as HTMLElement;
    expect(focus.dataset.mapFocus).toBe('off');
    expect(focus.style.transform).toBe('');
  });
});
