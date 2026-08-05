// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DesignPreviewPage, { metadata } from './page';

const selectors = [
  'Мобильный каталог',
  'Мобильная страница храма',
  'Мобильная форма просьбы',
  'Каталог на компьютере',
  'Страница храма на компьютере',
  'Мои поездки на компьютере',
];

afterEach(cleanup);

function select(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('Initial Design System preview route', () => {
  it('renders the route, exposes all six screen selectors, and prevents indexing', () => {
    render(<DesignPreviewPage />);

    expect(screen.getByRole('heading', { name: 'Контрольные экраны Orthodox Routes' })).not.toBeNull();
    for (const label of selectors) expect(screen.getByRole('button', { name: label })).not.toBeNull();
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it('uses exactly the three approved mobile navigation labels', () => {
    render(<DesignPreviewPage />);
    const navigation = screen.getByRole('navigation', { name: 'Мобильная навигация' });
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Храмы', 'Поездки', 'Уведомления']);

    select('Мобильная страница храма');
    const churchNavigation = screen.getByRole('navigation', { name: 'Мобильная навигация' });
    expect(within(churchNavigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Храмы', 'Поездки', 'Уведомления']);
  });

  it('uses exactly the three approved desktop navigation labels', () => {
    render(<DesignPreviewPage />);
    select('Каталог на компьютере');
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Храмы', 'Мои поездки', 'Поддержать']);
  });

  it('uses distinct primary and secondary church-action variants in both church samples', () => {
    render(<DesignPreviewPage />);

    for (const sample of [
      { selector: 'Мобильная страница храма', region: 'Мобильная страница храма и транспортная доска' },
      { selector: 'Страница храма на компьютере', region: 'Страница храма и транспортная доска на компьютере' },
    ]) {
      select(sample.selector);
      const region = screen.getByRole('region', { name: sample.region });
      const primary = within(region).getByRole('button', { name: 'Нужна поездка' });
      const secondary = within(region).getByRole('button', { name: 'Могу подвезти' });

      expect(primary.getAttribute('data-variant')).toBe('primary');
      expect(secondary.getAttribute('data-variant')).toBe('secondary');
      expect(primary.tagName).toBe('BUTTON');
      expect(secondary.tagName).toBe('BUTTON');
    }
  });

  it('uses explicit ride type labels and preserves the exact ride actions', () => {
    render(<DesignPreviewPage />);

    for (const sample of [
      { selector: 'Мобильная страница храма', region: 'Мобильная страница храма и транспортная доска' },
      { selector: 'Страница храма на компьютере', region: 'Страница храма и транспортная доска на компьютере' },
    ]) {
      select(sample.selector);
      const region = screen.getByRole('region', { name: sample.region });

      expect(within(region).getByText('Предлагают места')).not.toBeNull();
      expect(within(region).getByText('Ищут места')).not.toBeNull();
      expect(within(region).getByRole('button', { name: 'Попросить подвезти' })).not.toBeNull();
      expect(within(region).getByRole('button', { name: 'Предложить подвезти' })).not.toBeNull();
    }
  });

  it('does not expose checkmark or down-chevron selection signals in church cards', () => {
    const { container } = render(<DesignPreviewPage />);
    const cards = container.querySelectorAll('[data-church-card]');

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.querySelector('[data-icon="check"], [data-icon="chevron"]')).toBeNull();
    }
  });

  it('keeps distinct textual My Trips statuses with restrained semantic roles', () => {
    render(<DesignPreviewPage />);
    select('Мои поездки на компьютере');

    for (const [status, tone] of [
      ['Подтверждено', 'confirmed'],
      ['Предстоит', 'planned'],
      ['Ожидает ответа', 'pending'],
      ['Завершено', 'completed'],
    ]) {
      const badge = screen.getAllByText(status)[0];
      expect(badge.getAttribute('data-status-tone')).toBe(tone);
    }
  });

  it('keeps prohibited labels absent from every preview screen', () => {
    render(<DesignPreviewPage />);
    for (const label of selectors) {
      select(label);
      for (const prohibited of ['Сообщения', 'Избранное', 'Предложить поездку', 'Связаться']) {
        expect(screen.queryByText(prohibited, { exact: true })).toBeNull();
      }
    }
  });

  it('gives every icon-only control an accessible name', () => {
    const { container } = render(<DesignPreviewPage />);
    for (const label of selectors) {
      select(label);
      for (const control of container.querySelectorAll('[data-icon-only]')) {
        expect(control.getAttribute('aria-label')).toBeTruthy();
      }
    }
  });

  it('exposes understandable state headings, actions, and validation semantics', () => {
    render(<DesignPreviewPage />);

    expect(screen.getByRole('heading', { name: 'Загрузка' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'У вас пока нет поездок' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Найти храм' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Поездок пока нет' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Не удалось загрузить данные' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Попробовать ещё раз' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Поездка больше недоступна' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Нет доступа' })).not.toBeNull();
    expect(screen.getByLabelText('Место встречи').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Просьба сохранена');
    expect((screen.getByRole('button', { name: 'Продолжить' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
