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
  'Мобильная форма просьбы',
  'Каталог на компьютере',
  'Храм и доска на компьютере',
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

  it('exposes exactly ten V2 control screens and prevents indexing', () => {
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
    expect(within(board).getByRole('button', { name: 'Предложить подвезти' })).not.toBeNull();

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

  it('gives every icon-only control an accessible name on all ten screens', () => {
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
