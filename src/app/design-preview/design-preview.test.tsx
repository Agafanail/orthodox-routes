// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChurchPlaceholder } from './church-placeholder';
import DesignPreviewPage, { metadata } from './page';

const selectors = [
  'Мобильный каталог',
  'Мобильная шапка храма',
  'Мобильная транспортная доска',
  'Мобильная карта поездок',
  'Мобильная форма просьбы',
  'Каталог на компьютере',
  'Храм и доска на компьютере',
  'Карта поездок на компьютере',
  'Мои поездки на компьютере',
  'Полная страница храма',
  'Каталог из 12 храмов',
  'Пустая страница храма',
];

afterEach(cleanup);

function select(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('Design System V2 preview route', () => {
  it('uses exactly one local preview font file and references its actual filename', () => {
    const previewDirectory = resolve(process.cwd(), 'src/app/design-preview');
    const fontFiles = readdirSync(resolve(previewDirectory, 'fonts')).filter((file) => /\.(ttf|woff2?)$/i.test(file));
    const layout = readFileSync(resolve(previewDirectory, 'layout.tsx'), 'utf8');

    expect(fontFiles).toEqual(['Onest-Variable.ttf']);
    expect(layout).toContain(`./fonts/${fontFiles[0]}`);
  });

  it('exposes exactly twelve V2 control screens and prevents indexing', () => {
    const { container } = render(<DesignPreviewPage />);

    expect(screen.getByRole('heading', { name: 'Контрольные экраны Orthodox Routes' })).not.toBeNull();
    const selector = screen.getByRole('navigation', { name: 'Выбор контрольного экрана' });
    expect(within(selector).getAllByRole('button').map((button) => button.textContent)).toEqual(selectors);
    expect(container.querySelector('[data-screen-id="mobile-directory"]')).not.toBeNull();
    expect(metadata).toMatchObject({
      title: 'Design System V2 Preview | Orthodox Routes',
      icons: { icon: expect.stringMatching(/^data:image\/svg\+xml,/) },
      robots: { index: false, follow: false },
    });
  });

  it('keeps the mobile church header and mobile transport board as separate reference screens', () => {
    render(<DesignPreviewPage />);

    select('Мобильная шапка храма');
    expect(screen.getByRole('region', { name: 'Мобильная шапка храма' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Поездки' })).toBeNull();

    select('Мобильная транспортная доска');
    expect(screen.getByRole('region', { name: 'Мобильная транспортная доска' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Поездки' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Покров Пресвятой Богородицы' })).toBeNull();
  });

  it('uses exactly the approved mobile and desktop navigation labels', () => {
    render(<DesignPreviewPage />);

    const mobile = screen.getByRole('navigation', { name: 'Мобильная навигация' });
    expect(within(mobile).getAllByRole('link').map((link) => link.textContent)).toEqual(['Храмы', 'Поездки', 'Уведомления']);

    select('Каталог на компьютере');
    const desktop = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(desktop).getAllByRole('link').map((link) => link.textContent)).toEqual(['Храмы', 'Мои поездки', 'Поддержать']);
  });

  it('renders the directory as cards without thumbnails and gives every card ride-decision data', () => {
    const { container } = render(<DesignPreviewPage />);

    const cards = container.querySelectorAll('[data-church-card]');
    expect(cards).toHaveLength(4);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('/images/church-fallback.png');
    for (const card of cards) {
      expect(card.textContent).toMatch(/предлож|Поездок пока/);
    }
  });

  it('uses a primary selected-state border signal with no checkmark or chevron signal', () => {
    const { container } = render(<DesignPreviewPage />);

    const selectedCard = container.querySelector('[data-church-card][data-selected="true"]');
    expect(selectedCard).not.toBeNull();
    expect(selectedCard?.querySelector('[data-icon="check"], [data-icon="chevron"]')).toBeNull();
  });

  it('keeps stable type/filter wording and approved page and card actions', () => {
    render(<DesignPreviewPage />);

    select('Мобильная транспортная доска');
    const board = screen.getByRole('region', { name: 'Мобильная транспортная доска' });
    expect(within(board).getAllByText('Есть места').length).toBeGreaterThan(0);
    expect(within(board).getAllByText('Ищут место').length).toBeGreaterThan(0);
    expect(within(board).getAllByRole('button', { name: 'Попросить подвезти' }).length).toBeGreaterThan(0);
    expect(within(board).getAllByRole('button', { name: 'Предложить подвезти' }).length).toBeGreaterThan(0);

    select('Мобильная шапка храма');
    expect(screen.getByRole('button', { name: 'Нужна поездка' }).getAttribute('data-variant')).toBe('primary');
    expect(screen.getByRole('button', { name: 'Могу подвезти' }).getAttribute('data-variant')).toBe('secondary');
    expect(screen.getByRole('link', { name: /Карта и маршрут/ })).not.toBeNull();
  });

  it('prescribes the two desktop board columns and omits duplicate type labels from their cards', () => {
    render(<DesignPreviewPage />);
    select('Храм и доска на компьютере');

    const offers = screen.getByRole('heading', { name: 'Есть места · 2' }).closest('section');
    const requests = screen.getByRole('heading', { name: 'Ищут место · 2' }).closest('section');
    expect(offers).not.toBeNull();
    expect(requests).not.toBeNull();
    expect(offers?.querySelectorAll('[data-ride-type="Есть места"]')).toHaveLength(2);
    expect(requests?.querySelectorAll('[data-ride-type="Ищут место"]')).toHaveLength(2);
    expect(within(offers as HTMLElement).queryByText('Есть места', { exact: true })).toBeNull();
    expect(within(requests as HTMLElement).queryByText('Ищут место', { exact: true })).toBeNull();
  });

  it('keeps the mobile passenger form at step 2 of 6 with one add-place action', () => {
    render(<DesignPreviewPage />);
    select('Мобильная форма просьбы');

    expect(screen.getByText('Шаг 2')).not.toBeNull();
    expect(screen.getByLabelText('Выполнено 2 из 6 шагов').children).toHaveLength(6);
    expect(screen.getAllByRole('button', { name: 'Добавить место' })).toHaveLength(1);
    expect(screen.getByText(/примерная область радиусом 1 км/)).not.toBeNull();
  });

  it('shows only valid upcoming My Trips states, roles, and required-action text', () => {
    render(<DesignPreviewPage />);
    select('Мои поездки на компьютере');

    expect(screen.getByRole('button', { name: 'Предстоящие' })).not.toBeNull();
    expect(screen.getAllByText('Вы пассажир · действий не требуется')).toHaveLength(1);
    expect(screen.getAllByText('Вы водитель · действий не требуется')).toHaveLength(1);
    expect(screen.getAllByText('Вы пассажир · ожидается ответ водителя')).toHaveLength(1);
    expect(screen.getByText('Ожидает подтверждения изменений').getAttribute('data-status-tone')).toBe('pending');
    expect(screen.queryByText('Завершено')).toBeNull();
    expect(screen.queryByText('Поездка состоялась?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Отменить поездку' }).getAttribute('data-variant')).toBe('destructive');
    expect(screen.getByRole('button', { name: 'Позвонить' }).querySelector('[data-icon="phone"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Позвонить' }).querySelector('[data-icon="profile"]')).toBeNull();
  });

  it('renders the full-density church page as one complete responsive composition', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Полная страница храма');

    const page = container.querySelector('[data-stress-screen="full-density-church"]');
    expect(page).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('heading', { name: 'Ближайшие службы' })).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('heading', { name: 'Регулярное расписание' })).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('heading', { name: 'О храме' })).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('heading', { name: 'Поездки на литургию 10 августа' })).not.toBeNull();
    expect(page?.querySelectorAll('[data-ride-type]')).toHaveLength(4);
    expect(page?.textContent).toContain('Українська · Deutsch');
    expect(within(page as HTMLElement).getByRole('link', { name: /Карта и маршрут/ })).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('button', { name: 'Нужна поездка' })).not.toBeNull();
  });

  it('renders twelve image-free catalog cards with synchronized selected state', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Каталог из 12 храмов');

    const catalog = container.querySelector('[data-stress-screen="twelve-church-catalog"]');
    const list = catalog?.querySelector('[data-catalog-list]');
    const cards = list?.querySelectorAll('[data-church-card]');
    expect(catalog?.getAttribute('data-selected-church-id')).toBe('catanzaro-pokrov');
    expect(cards).toHaveLength(12);
    expect(list?.querySelector('img, [data-placeholder-palette]')).toBeNull();
    expect(list?.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    expect(catalog?.textContent).toContain('Парафія Покрову Пресвятої Богородиці');
    expect(catalog?.textContent).toContain('Russisch-Orthodoxe Kirchengemeinde');
    expect(within(catalog as HTMLElement).getByRole('region', { name: 'Карта двенадцати храмов' })).not.toBeNull();
  });

  it('keeps schedule, information, and transport empty states specific and actionable', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Пустая страница храма');

    const page = container.querySelector('[data-stress-screen="empty-church"]');
    expect(page?.querySelector('[data-empty-schedule]')?.textContent).toContain('собственные дату и время');
    expect(page?.querySelector('[data-empty-information]')?.textContent).toContain('Описание, контакты и языки богослужений');
    expect(page?.querySelector('[data-empty-transport]')?.textContent).toContain('предложения водителей и просьбы пассажиров');
    expect(page?.querySelector('[data-ride-type]')).toBeNull();
    expect(within(page as HTMLElement).getByRole('button', { name: 'Нужна поездка' })).not.toBeNull();
    expect(within(page as HTMLElement).getByRole('button', { name: 'Могу подвезти' })).not.toBeNull();
  });

  it('keeps the accepted directory filter pattern and responsive target rules', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Каталог из 12 храмов');

    const catalog = container.querySelector('[data-stress-screen="twelve-church-catalog"]') as HTMLElement;
    const filterButtons = within(catalog).getAllByRole('button');
    expect(filterButtons.find((button) => button.getAttribute('aria-label') === 'Фильтры')).not.toBeUndefined();
    expect(filterButtons.find((button) => button.textContent?.includes('Италия'))).not.toBeUndefined();
    expect(filterButtons.find((button) => button.textContent?.includes('Catanzaro'))).not.toBeUndefined();

    const css = readFileSync(resolve(process.cwd(), 'src/app/design-preview/design-preview.module.css'), 'utf8');
    expect(css).toContain('--or-target-min: 44px');
    expect(css).toContain('--or-height-directory-filter-desktop: 24px');
    expect(css).toContain('@media (max-width: 800px)');
    expect(css).toContain('height: 300px');
  });

  it('gives every icon-only control an accessible name on all twelve screens', () => {
    const { container } = render(<DesignPreviewPage />);
    for (const label of selectors) {
      select(label);
      for (const control of container.querySelectorAll('[data-icon-only]')) {
        expect(control.getAttribute('aria-label')).toBeTruthy();
      }
    }
  });

  it('keeps prohibited labels absent from every V2 control screen', () => {
    render(<DesignPreviewPage />);
    for (const label of selectors) {
      select(label);
      for (const prohibited of ['Сообщения', 'Избранное', 'Предложить поездку', 'Связаться', 'Предлагают места', 'Ищут места']) {
        expect(screen.queryByText(prohibited, { exact: true })).toBeNull();
      }
    }
  });

  it('offers map entry in the approved board places, outside the filter group and below primary', () => {
    const { container } = render(<DesignPreviewPage />);

    select('Мобильная транспортная доска');
    const board = screen.getByRole('region', { name: 'Мобильная транспортная доска' });
    const mobileEntry = within(board).getByRole('button', { name: 'Поездки на карте' });
    expect(mobileEntry.getAttribute('data-map-entry')).toBe('mobile');
    // outside the card flow, and the content reserves room so it covers nothing
    expect(mobileEntry.closest('[data-ride-type]')).toBeNull();
    expect(board.querySelector('main')?.className).toContain('boardReserve');

    select('Храм и доска на компьютере');
    const groupTitle = screen.getByRole('heading', { name: 'Поездки на литургию 10 августа' });
    const groupHeading = groupTitle.closest('div')?.parentElement;
    expect(within(groupHeading as HTMLElement).getByRole('button', { name: 'На карте' })).not.toBeNull();

    // exactly two canonical entry points: the mobile board and the desktop church board
    const withEntry = selectors.filter((label) => {
      select(label);
      return container.querySelectorAll('[data-map-entry]').length > 0;
    });
    expect(withEntry).toEqual(['Мобильная транспортная доска', 'Храм и доска на компьютере']);

    // never inside the filter group, never a primary CTA
    for (const label of selectors) {
      select(label);
      for (const group of container.querySelectorAll('[data-ride-filters]')) {
        expect(group.querySelector('[data-map-entry]')).toBeNull();
      }
      for (const entry of container.querySelectorAll('[data-map-entry]')) {
        expect(entry.getAttribute('data-variant')).toBeNull();
      }
    }
  });

  it('gives no map entry to a group without active rides', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Пустая страница храма');

    const page = container.querySelector('[data-stress-screen="empty-church"]');
    expect(page?.querySelector('[data-map-entry]')).toBeNull();
    expect(page?.querySelector('[data-ride-type]')).toBeNull();
  });

  it('keeps board card actions secondary and on the left content edge', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Мобильная транспортная доска');

    for (const card of container.querySelectorAll('[data-ride-type]')) {
      const action = card.querySelector('[data-variant]');
      expect(action?.getAttribute('data-variant')).toBe('secondary');
      // action is the last block, after type, title and details
      expect(card.lastElementChild?.contains(action as Node)).toBe(true);
    }

    const css = readFileSync(resolve(process.cwd(), 'src/app/design-preview/design-preview.module.css'), 'utf8');
    expect(/\.cardAction \{[^}]*justify-content: flex-start/.test(css)).toBe(true);
  });

  it('carries the board filter into the ride map and back again', () => {
    render(<DesignPreviewPage />);
    select('Мобильная транспортная доска');
    const board = () => screen.getByRole('region', { name: 'Мобильная транспортная доска' });

    fireEvent.click(within(board()).getByRole('button', { name: 'Есть места' }));
    fireEvent.click(within(board()).getByRole('button', { name: 'Поездки на карте' }));

    const map = screen.getByRole('region', { name: 'Мобильная карта поездок' });
    expect(within(map).getByRole('button', { name: 'Есть места' }).getAttribute('aria-pressed')).toBe('true');
    expect(map.querySelectorAll('[data-map-object="corridor"]')).toHaveLength(2);
    expect(map.querySelectorAll('[data-map-object="area"]')).toHaveLength(0);

    fireEvent.click(within(map).getByRole('button', { name: 'Назад к доске поездок' }));
    expect(within(board()).getByRole('button', { name: 'Есть места' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the density stress screen free of map entry and of the board flows', () => {
    const { container } = render(<DesignPreviewPage />);

    // a filter chosen in the mobile flow must not leak into an unrelated screen
    select('Мобильная транспортная доска');
    fireEvent.click(within(screen.getByRole('region', { name: 'Мобильная транспортная доска' })).getByRole('button', { name: 'Есть места' }));

    select('Полная страница храма');
    const page = container.querySelector('[data-stress-screen="full-density-church"]') as HTMLElement;
    expect(page.querySelector('[data-map-entry]')).toBeNull();
    const filters = page.querySelector('[data-ride-filters]') as HTMLElement;
    expect(within(filters).getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('true');
    expect(page.querySelectorAll('[data-ride-type]')).toHaveLength(4);
  });

  it('isolates the mobile and desktop filter flows from each other', () => {
    render(<DesignPreviewPage />);

    select('Мобильная транспортная доска');
    fireEvent.click(within(screen.getByRole('region', { name: 'Мобильная транспортная доска' })).getByRole('button', { name: 'Есть места' }));

    // the desktop map is a different flow and starts from its own default
    select('Карта поездок на компьютере');
    const desktopMap = () => screen.getByRole('region', { name: 'Карта поездок на компьютере' });
    expect(within(desktopMap()).getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('true');

    // changing it back does not disturb the mobile flow
    fireEvent.click(within(desktopMap()).getByRole('button', { name: 'Ищут место' }));
    select('Мобильная карта поездок');
    expect(within(screen.getByRole('region', { name: 'Мобильная карта поездок' })).getByRole('button', { name: 'Есть места' }).getAttribute('aria-pressed')).toBe('true');

    select('Карта поездок на компьютере');
    expect(within(desktopMap()).getByRole('button', { name: 'Ищут место' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows only approximate passenger areas and driver corridors for one service group', () => {
    const { container } = render(<DesignPreviewPage />);
    select('Мобильная карта поездок');
    const map = screen.getByRole('region', { name: 'Мобильная карта поездок' });

    expect(map.querySelectorAll('[data-map-object="area"]')).toHaveLength(3);
    expect(map.querySelectorAll('[data-map-object="corridor"]')).toHaveLength(2);
    expect(map.textContent).toContain('Литургия · 10 августа');
    // the public area circle carries no centre marker that could imply the exact place
    const shapes = map.querySelector('svg[preserveAspectRatio="xMidYMid meet"]') as SVGElement;
    expect(shapes.querySelectorAll('[data-map-shape="area"]')).toHaveLength(3);
    expect(shapes.querySelectorAll('[data-map-shape="corridor"]')).toHaveLength(2);
    expect(container.textContent).not.toContain('Via XX Settembre, 45, 88100');
  });

  it('opens one shared request card from either public area of the same request', () => {
    render(<DesignPreviewPage />);
    select('Мобильная карта поездок');
    const map = screen.getByRole('region', { name: 'Мобильная карта поездок' });
    const places = within(map).getAllByRole('button', { name: /примерная область, место/ });

    expect(places).toHaveLength(2);
    fireEvent.click(places[0]);
    const detail = map.querySelector('[data-ride-detail]') as HTMLElement;
    expect(detail.textContent).toContain('примерные области радиусом 1 км');
    const first = detail.textContent;
    expect(map.querySelectorAll('[data-map-shape="area"][data-selected="true"]')).toHaveLength(2);

    fireEvent.click(within(map).getByRole('button', { name: /Закрыть карточку/ }));
    expect(map.querySelector('[data-ride-detail]')).toBeNull();

    fireEvent.click(places[1]);
    expect(map.querySelector('[data-ride-detail]')?.textContent).toBe(first);
  });

  it('promotes the selected map ride to exactly one primary action', () => {
    render(<DesignPreviewPage />);

    for (const [label, objectName, action] of [
      ['Мобильная карта поездок', /примерное направление/, 'Попросить подвезти'],
      ['Карта поездок на компьютере', /примерная область/, 'Предложить подвезти'],
    ] as const) {
      select(label);
      const map = screen.getByRole('region', { name: label });
      fireEvent.click(within(map).getAllByRole('button', { name: objectName })[0]);

      const detail = map.querySelector('[data-ride-detail]') as HTMLElement;
      expect(within(detail).getByRole('button', { name: action }).getAttribute('data-variant')).toBe('primary');
      expect(detail.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
      // supporting controls stay below primary
      expect(within(map).getByRole('button', { name: 'Показать, где я' }).getAttribute('data-variant')).toBeNull();
      expect(within(map).getByRole('button', { name: 'Назад к доске поездок' }).getAttribute('data-variant')).toBeNull();
    }
  });

  it('reveals user location and its approximate distance only after the explicit action', () => {
    render(<DesignPreviewPage />);
    select('Мобильная карта поездок');
    const map = screen.getByRole('region', { name: 'Мобильная карта поездок' });

    expect(map.querySelector('[data-map-shape="user"]')).toBeNull();
    expect(map.querySelector('[data-location-note]')).toBeNull();

    fireEvent.click(within(map).getAllByRole('button', { name: /примерное направление/ })[0]);
    expect(map.querySelector('[data-ride-distance]')).toBeNull();

    fireEvent.click(within(map).getByRole('button', { name: 'Показать, где я' }));
    expect(map.querySelector('[data-map-shape="user"]')).not.toBeNull();
    expect(map.querySelector('[data-ride-distance]')?.textContent).toMatch(/^≈\d+ км от вас$/);
    expect(map.querySelector('[data-location-note]')?.textContent)
      .toContain('до публичной области или направления, а не до точного места');
  });

  it('scales map markers down on desktop while keeping the accepted mobile field', () => {
    const { container } = render(<DesignPreviewPage />);
    const shapes = (label: string) => {
      select(label);
      return container.querySelector('svg[preserveAspectRatio="xMidYMid meet"]') as SVGElement;
    };
    const churchScale = (svg: SVGElement) =>
      Number(svg.querySelector('[data-map-shape="church"]')?.getAttribute('transform')?.match(/scale\(([\d.]+)\)/)?.[1]);

    expect(churchScale(shapes('Мобильная карта поездок'))).toBe(1);
    const desktop = churchScale(shapes('Карта поездок на компьютере'));
    expect(desktop).toBeGreaterThanOrEqual(0.7);
    expect(desktop).toBeLessThanOrEqual(0.75);
  });

  it('uses approved placeholder geometry and deterministic palette variation by church id', () => {
    const { container, rerender } = render(<ChurchPlaceholder churchId="church-a" />);
    const firstPalette = container.firstElementChild?.getAttribute('data-placeholder-palette');
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 240 200');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');

    rerender(<ChurchPlaceholder churchId="church-b" compact />);
    expect(container.firstElementChild?.getAttribute('data-placeholder-palette')).not.toBe(firstPalette);
    expect(container.querySelectorAll('svg g')).toHaveLength(1);
  });
});
