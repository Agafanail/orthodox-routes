// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CopyReviewPage from './page';

afterEach(cleanup);

/*
 * Group 3 of the manual Russian copy review: the driver offer «Могу подвезти» — four semantic
 * screens (owner decision of 27 August 2026), simplified again on 28 August 2026.
 *
 * The tests guard what those decisions fixed: four screens and no more; a place screen that carries
 * only what a person decides about the place, in two modes of the same screen; every remaining
 * editable detail on screen 3; a screen 4 that only shows. They also guard what must not come back
 * — a departure-time field, a second privacy explanation, a public preview — and the honesty of the
 * surface: no driver string may be shown as approved, because none is.
 */

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

function offerStep() {
  return (productScreen().querySelector('[data-offer-step]') as HTMLElement | null)?.dataset.offerStep;
}

function sourceRows() {
  const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
  return [...panel.querySelectorAll('dd')].map((row) => row.textContent);
}

const press = (name: string) => fireEvent.click(within(productScreen()).getByRole('button', { name }));

/** The trip type and the service are radio groups, so choosing on them is not a button press. */
const pick = (name: string) => fireEvent.click(within(productScreen()).getByRole('radio', { name }));

/** Every entry point, in the order the review switch offers them, with its own address. */
const offerSamples = [
  ['15 · Когда: разовая, служба', 'offer-when', 'when'],
  ['16 · Когда: свои дата и время', 'offer-when-custom', 'when'],
  ['17 · Когда: регулярная поездка', 'offer-when-recurring', 'when'],
  ['18 · Откуда: выбор места', 'offer-where-empty', 'where'],
  ['19 · Откуда: место выбрано', 'offer-where', 'where'],
  ['20 · Детали поездки: без детей', 'offer-seats', 'details'],
  ['21 · Детали поездки: дети и примечание', 'offer-seats-children', 'details'],
  ['22 · Проверьте поездку', 'offer-final', 'review'],
  ['23 · Проверьте поездку: заполнено', 'offer-final-filled', 'review'],
  ['24 · Проверьте поездку: регулярная', 'offer-final-recurring', 'review'],
] as const;

describe('Driver offer review states', () => {
  it('opens each of the ten states directly from its own address', () => {
    offerSamples.forEach(([label, anchor, step]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      expect(`${anchor}: ${offerStep()}`).toBe(`${anchor}: ${step}`);
      cleanup();
    });
    window.location.hash = '';
  });

  /* ------------------------------------------- four semantic screens, and no more than four */

  it('walks the four semantic screens forwards and back, in order and without a stepper', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');

    expect(offerStep()).toBe('when');
    press('Далее');
    expect(offerStep()).toBe('where');
    press('Подтвердить место');
    press('Далее');
    expect(offerStep()).toBe('details');
    press('Далее');
    expect(offerStep()).toBe('review');

    press('Назад');
    expect(offerStep()).toBe('details');
    press('Назад');
    expect(offerStep()).toBe('where');
    press('Назад');
    expect(offerStep()).toBe('when');
  });

  it('has no separate trip-type, route or place-confirmation screen anywhere in the form', () => {
    render(<CopyReviewPage />);

    offerSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      ['Как часто вы ездите', 'Ваш маршрут до храма', 'Откуда вы поедете', 'Сколько мест вы можете предложить']
        .forEach((gone) => expect(`${label}: ${text.includes(gone)}`).toBe(`${label}: false`));
    });
  });

  it('asks how often on the same screen as when, at the top of it', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Когда вы едете?' })).not.toBeNull();
    const kind = form.querySelector('[data-offer-kind]') as HTMLElement;
    const when = form.querySelector('[data-offer-when]') as HTMLElement;
    expect(kind.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(form).getByRole('radio', { name: 'Разовая поездка' })).not.toBeNull();
    expect(within(form).getByRole('radio', { name: 'Регулярная поездка' })).not.toBeNull();
  });

  it('reveals weekdays, the period and the eight-week rule on the same screen for a series', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');

    expect(productScreen().querySelector('[data-offer-series]')).toBeNull();
    pick('Регулярная поездка');

    const form = productScreen();
    expect(form.querySelector('[data-offer-kind-hint]')?.textContent).toContain('не больше чем на 8 недель');
    expect(form.querySelector('[data-offer-days]')).not.toBeNull();
    expect(form.querySelector('[data-offer-period]')?.textContent).toBe('С 30 августа по 25 октября');
    expect(offerStep()).toBe('when');
  });

  it('names a service by its weekly slot for a series and by its date for one trip', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');

    expect(productScreen().textContent).toContain('воскресенье, 23 августа, 9:00');
    pick('Регулярная поездка');
    expect(productScreen().textContent).toContain('по воскресеньям, 9:00');
    expect(productScreen().textContent).not.toContain('23 августа');
  });

  /* ---------------------------------- screen 2: two modes of one screen, and nothing else on it */

  it('carries only the place, the instruction and one quiet privacy line while choosing', () => {
    render(<CopyReviewPage />);
    openSample('18 · Откуда: выбор места');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Откуда вы едете?' })).not.toBeNull();
    expect(within(form).getByPlaceholderText('Адрес')).not.toBeNull();
    expect(form.textContent).toContain('Введите адрес или передвиньте маркер на карте.');
    expect(form.querySelector('[data-offer-privacy]')?.textContent)
      .toBe('Всем будет видна только примерная область отправления — точный адрес откроется после договорённости.');

    // Nothing that depends on the place is on the screen yet.
    expect(form.querySelector('[data-offer-detour]')).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Далее' })).toBeNull();
  });

  it('hides the address field and the instruction once the place is chosen', () => {
    render(<CopyReviewPage />);
    openSample('19 · Откуда: место выбрано');
    const form = productScreen();

    expect(within(form).queryByPlaceholderText('Адрес')).toBeNull();
    expect(form.textContent).not.toContain('Введите адрес или передвиньте маркер на карте.');
    expect(form.querySelector('[data-offer-privacy]')).toBeNull();
    expect(form.querySelector('[data-offer-detour]')).not.toBeNull();
    // The line about the length of the drive is gone: nothing on the form depends on it.
    expect(form.textContent).not.toContain('До храма');
    expect(within(form).getByRole('button', { name: 'Далее' })).not.toBeNull();
  });

  it('shows the chosen address exactly once', () => {
    render(<CopyReviewPage />);
    openSample('19 · Откуда: место выбрано');
    const form = productScreen();
    const address = form.querySelector('[data-offer-address]')!.textContent!;

    expect(address).toBe('Via Milano, 8, 88100 Catanzaro CZ');
    expect((form.textContent ?? '').split(address).length - 1).toBe(1);
  });

  it('returns the same screen to place selection with a quiet «Изменить место»', () => {
    render(<CopyReviewPage />);
    openSample('19 · Откуда: место выбрано');

    const change = within(productScreen()).getByRole('button', { name: 'Изменить место' });
    expect(change.className).toContain('quietButton');
    fireEvent.click(change);

    // Same screen, choosing mode again.
    expect(offerStep()).toBe('where');
    expect(within(productScreen()).getByPlaceholderText('Адрес')).not.toBeNull();
    expect(productScreen().querySelector('[data-offer-privacy]')).not.toBeNull();
    expect(within(productScreen()).getByRole('button', { name: 'Подтвердить место' })).not.toBeNull();
  });

  it('offers the detour as a compact list of six distances', () => {
    render(<CopyReviewPage />);
    openSample('19 · Откуда: место выбрано');

    const select = productScreen().querySelector('[data-offer-detour] select') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Только по маршруту', 'До 2 км', 'До 5 км', 'До 10 км', 'До 15 км', 'До 20 км',
    ]);
    expect(select.value).toBe('5');

    fireEvent.change(select, { target: { value: '20' } });
    press('Далее');
    press('Далее');
    expect(productScreen().querySelector('[data-offer-summary]')?.textContent).toContain('До 20 км');
  });

  it('never asks for a departure time and never explains one', () => {
    render(<CopyReviewPage />);

    offerSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      ['Во сколько выезжаете', 'Выезд в', 'выезжайте около', 'Дорога занимает', 'Мы предложим']
        .forEach((gone) => expect(`${label}: ${text.includes(gone)}`).toBe(`${label}: false`));
    });

    // The only time a person enters is the time at the church, and only on screen 1.
    openSample('19 · Откуда: место выбрано');
    expect(productScreen().querySelectorAll('input[type="time"]').length).toBe(0);
    openSample('16 · Когда: свои дата и время');
    pick('Регулярная поездка');
    pick('Указать своё время');
    expect(productScreen().querySelector('[data-offer-arrival]')?.textContent).toContain('Время у храма');
  });

  /* ---------------------------------------------- privacy: one quiet sentence, on screen 2 only */

  it('explains what becomes public only where the place is chosen', () => {
    render(<CopyReviewPage />);

    offerSamples
      .filter(([, anchor]) => anchor !== 'offer-where-empty')
      .forEach(([label]) => {
        openSample(label);
        expect(`${label}: ${productScreen().querySelector('[data-offer-privacy]') !== null}`)
          .toBe(`${label}: false`);
      });

    openSample('18 · Откуда: выбор места');
    const note = productScreen().querySelector('[data-offer-privacy]')!;
    // A quiet sentence, not a highlighted panel.
    expect(note.className).toContain('fieldHint');
    expect(note.className).not.toContain('privacyNote');
  });

  it('never repeats a privacy warning or shows a public preview of the trip', () => {
    render(<CopyReviewPage />);

    offerSamples.forEach(([label]) => {
      openSample(label);
      const text = productScreen().textContent ?? '';

      expect(`${label}: ${text.split('Всем будет видна').length - 1}`)
        .toBe(`${label}: ${label.includes('выбор места') ? 1 : 0}`);
      ['Так вашу поездку увидят все', 'Публично будут видны', 'Все посетители увидят']
        .forEach((gone) => expect(`${label}: ${text.includes(gone)}`).toBe(`${label}: false`));
      expect(`${label}: ${productScreen().querySelector('[data-offer-public]') !== null}`)
        .toBe(`${label}: false`);
    });
  });

  /* -------------------------------------------- screen 3: every remaining detail in one place */

  it('collects seats, children, the child seat, the return ride and the note on one screen', () => {
    render(<CopyReviewPage />);
    openSample('21 · Детали поездки: дети и примечание');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Детали поездки' })).not.toBeNull();
    expect(form.querySelector('[data-stepper]')).not.toBeNull();
    expect(form.querySelector('[data-offer-children]')).not.toBeNull();
    expect(form.querySelector('[data-offer-child-seat]')?.textContent)
      .toContain('У меня есть подходящее детское кресло');
    expect(within(form).getByRole('checkbox', { name: 'Могу подвезти обратно' })).not.toBeNull();
    expect(form.querySelector('[data-offer-note] textarea')).not.toBeNull();
  });

  it('puts the note warning inside the field and nowhere under it', () => {
    render(<CopyReviewPage />);
    openSample('20 · Детали поездки: без детей');
    const note = productScreen().querySelector('[data-offer-note] textarea') as HTMLTextAreaElement;

    expect(note.placeholder).toBe('Не указывайте цену, телефон, email, ссылки и точный адрес');
    // The former paragraph under the field is gone, so the sentence appears once, as a placeholder.
    expect(productScreen().textContent).not.toContain('Не указывайте цену');
    expect(productScreen().textContent).not.toContain('Короткое уточнение для пассажиров');
  });

  it('asks nothing about a child seat when the driver cannot take children', () => {
    render(<CopyReviewPage />);
    openSample('20 · Детали поездки: без детей');

    expect(productScreen().querySelector('[data-offer-child-seat]')).toBeNull();
    expect(productScreen().textContent).not.toContain('детское кресло');

    pick('Могу везти детей');
    expect(productScreen().querySelector('[data-offer-child-seat]')).not.toBeNull();
  });

  /* ------------------------------------------------------- screen 4: a screen that only shows */

  it('asks no question on the review screen and offers one primary action', () => {
    render(<CopyReviewPage />);
    openSample('23 · Проверьте поездку: заполнено');
    const form = productScreen();

    expect(within(form).getByRole('heading', { level: 1, name: 'Проверьте поездку' })).not.toBeNull();
    expect(form.querySelectorAll('input, textarea, select').length).toBe(0);
    expect([...form.querySelectorAll('button')].filter((b) => b.className.includes('primaryButton'))
      .map((b) => b.textContent)).toEqual(['Опубликовать']);
  });

  it('shows five editable summary rows, each returning to the screen that owns the answer', () => {
    render(<CopyReviewPage />);
    openSample('23 · Проверьте поездку: заполнено');
    const summary = productScreen().querySelector('[data-offer-summary]') as HTMLElement;

    expect([...summary.querySelectorAll('[data-summary-section]')].map((row) =>
      (row as HTMLElement).dataset.summarySection))
      .toEqual(['Когда', 'Откуда', 'Места и дети', 'Обратно', 'Примечание']);
    expect(summary.textContent).toContain('Божественная литургия');
    expect(summary.textContent).toContain('Via Milano');
    expect(summary.textContent).toContain('До 5 км');
    expect(summary.textContent).toContain('3 свободных места');
    expect(summary.textContent).toContain('Могу везти детей');
    expect(summary.textContent).toContain('Могу подвезти обратно');
    expect(summary.textContent).toContain('Выезжаю от площади');

    /*
     * A fresh render per row: pressing the review switch for the state already open changes
     * nothing, so the form would still be standing on the screen the previous row jumped to.
     */
    cleanup();
    ([
      ['Изменить: Когда', 'when'],
      ['Изменить: Откуда', 'where'],
      ['Изменить: Места и дети', 'details'],
      ['Изменить: Обратно', 'details'],
      ['Изменить: Примечание', 'details'],
    ] as const).forEach(([name, step]) => {
      render(<CopyReviewPage />);
      openSample('23 · Проверьте поездку: заполнено');
      press(name);
      expect(`${name}: ${offerStep()}`).toBe(`${name}: ${step}`);
      cleanup();
    });
  });

  it('states an empty optional note as an ordinary empty answer', () => {
    render(<CopyReviewPage />);
    openSample('22 · Проверьте поездку');

    expect(productScreen().querySelector('[data-offer-summary-note]')?.textContent).toBe('—');
    expect(productScreen().querySelector('[data-offer-summary]')?.textContent)
      .toContain('Не могу подвезти обратно');
  });

  it('states the weekdays, the period and the rule about a series in the summary of a series', () => {
    render(<CopyReviewPage />);
    openSample('24 · Проверьте поездку: регулярная');
    const summary = productScreen().querySelector('[data-offer-summary]') as HTMLElement;

    expect(summary.textContent).toContain('по воскресеньям, 9:00');
    expect(summary.textContent).toContain('суббота, воскресенье');
    expect(summary.textContent).toContain('С 30 августа по 25 октября');
    // The rule about a series is said on screen 1 and never repeated in the review.
    expect(summary.textContent).not.toContain('Каждая дата остаётся отдельной поездкой');
    expect(summary.querySelector('[data-offer-series-note]')).toBeNull();
  });

  /* ------------------------------------------------------------- one form, not ten mock-ups */

  it('keeps every answer while the person walks the whole form', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');

    pick('Регулярная поездка');
    press('среда');
    press('Далее');
    press('Подтвердить место');
    fireEvent.change(productScreen().querySelector('[data-offer-detour] select')!, {
      target: { value: '10' },
    });
    press('Далее');
    press('Свободные места: больше');
    pick('Не могу везти детей');
    fireEvent.click(within(productScreen()).getByRole('checkbox', { name: 'Могу подвезти обратно' }));
    fireEvent.change(productScreen().querySelector('textarea')!, { target: { value: 'Подожду у входа.' } });
    press('Далее');

    const summary = productScreen().querySelector('[data-offer-summary]')?.textContent ?? '';
    expect(offerStep()).toBe('review');
    expect(summary).toContain('среда, воскресенье');
    expect(summary).toContain('До 10 км');
    expect(summary).toContain('4 свободных места');
    expect(summary).toContain('Не могу везти детей');
    expect(summary).toContain('Могу подвезти обратно');
    expect(summary).toContain('Подожду у входа.');
    expect(summary).not.toContain('детское кресло');

    // Walking back to the first question finds every answer where it was left.
    press('Назад');
    expect((productScreen().querySelector('textarea') as HTMLTextAreaElement).value).toBe('Подожду у входа.');
    press('Назад');
    expect(productScreen().querySelector('[data-offer-address]')?.textContent).toContain('Via Milano');
    press('Назад');
    expect(offerStep()).toBe('when');
    expect((within(productScreen()).getByRole('radio', { name: 'Регулярная поездка' }) as HTMLInputElement).checked)
      .toBe(true);
    expect(productScreen().querySelectorAll('[data-offer-days] [aria-pressed="true"]').length).toBe(2);
  });

  /* ------------------------------------------------------- what the surface must not claim */

  it('marks every string of the driver form as approved by the owner', () => {
    render(<CopyReviewPage />);

    // The owner reviewed the assembled screens on 2 September 2026; nothing is left pending.
    offerSamples.forEach(([label]) => {
      openSample(label);
      const marks = sourceRows();

      expect(marks.length).toBeGreaterThan(0);
      expect(`${label}: ${marks.includes('Проект')}`).toBe(`${label}: false`);
      expect(`${label}: ${marks.includes('Решение')}`).toBe(`${label}: false`);
      expect(`${label}: ${marks.includes('Утверждено')}`).toBe(`${label}: true`);
    });
  });

  it('names the review date and keeps the unseen publication messages out of it', () => {
    render(<CopyReviewPage />);
    openSample('15 · Когда: разовая, служба');

    const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
    expect(panel.textContent).toContain('утверждены владельцем 2 сентября 2026 года');
    expect(panel.textContent).toContain('остаются «Проект»');
    expect(panel.textContent).not.toContain('Ни одна строка водителя не утверждена');
  });

  it('never exposes implementation or approval terminology inside a driver screen', () => {
    render(<CopyReviewPage />);

    offerSamples.forEach(([label]) => {
      openSample(label);
      const text = (productScreen().textContent ?? '').toLowerCase();

      ['localstorage', 'mock', 'состояние', 'объект', 'design system', 'проект', 'утверждено', 'нет данных']
        .forEach((forbidden) => {
          expect(`${label}/${forbidden}: ${text.includes(forbidden)}`).toBe(`${label}/${forbidden}: false`);
        });
    });
  });

  it('offers publication only on the last screen and publishes nothing', () => {
    render(<CopyReviewPage />);

    offerSamples
      .filter(([, anchor]) => !anchor.startsWith('offer-final'))
      .forEach(([label]) => {
        openSample(label);
        expect(`${label}: ${productScreen().textContent?.includes('Опубликовать')}`).toBe(`${label}: false`);
      });

    openSample('22 · Проверьте поездку');
    const publish = within(productScreen()).getByRole('button', { name: 'Опубликовать' });
    fireEvent.click(publish);
    expect(offerStep()).toBe('review');
    expect(productScreen().textContent).not.toContain('Предложение опубликовано');
  });

  it('shows one primary intent per driver screen and no stepper or progress bar', () => {
    render(<CopyReviewPage />);

    offerSamples.forEach(([label]) => {
      openSample(label);
      const form = productScreen();
      const primary = [...form.querySelectorAll('button')].filter((button) =>
        button.className.includes('primaryButton'));

      expect(`${label}: ${primary.length}`).toBe(`${label}: 1`);
      expect(form.querySelectorAll('progress, [role="progressbar"], [aria-valuenow]').length).toBe(0);
      expect(form.textContent).not.toMatch(/Шаг \d|\d\s*из\s*4\b/);
    });
  });

  it('changes no production driver route or component', () => {
    render(<CopyReviewPage />);
    openSample('23 · Проверьте поездку: заполнено');

    expect(document.querySelectorAll('a[href^="/"]').length).toBe(0);
    expect(productScreen().querySelectorAll('form').length).toBe(0);
  });
});
