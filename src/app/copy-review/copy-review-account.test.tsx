// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import CopyReviewPage from './page';

afterEach(cleanup);

/*
 * Group 6 of the manual Russian copy review: the in-app notification history (IA §17.2–17.3, copy
 * 4.9) and the lightweight profile with its notification settings (IA §20–20.3, copy 4.11). The
 * owner reviewed the group on 4 and 15 October 2026 and approved the strings he saw and accepted,
 * so these tests guard the decisions he made, the product rules the fixture must keep, and the exact
 * line between what is approved and what is still a proposal:
 *
 * - notifications are a history, not settings: «Новые», «Ранее», an unread count, a way to the
 *   object, and an old notification that stays and shows the eventual result;
 * - the settings live on the profile, the last external channel cannot be switched off while the
 *   person has transport activity, and the refusal is never silent;
 * - every in-app notification string of copy 4.9 and every in-scope profile string is visible
 *   somewhere; only the strings the owner actually reviewed are marked approved, and the rest
 *   stay proposals;
 * - no later-phase block, no developer vocabulary, and no production file touched.
 */

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

function sourcePanel() {
  return screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
}

function sourceRows() {
  return [...sourcePanel().querySelectorAll('dt')].map((row) => row.firstChild?.textContent);
}

const rows = (section: 'new' | 'earlier') =>
  [...(productScreen().querySelector(`[data-notifications-section="${section}"]`)?.querySelectorAll('[data-notification]') ?? [])]
    .map((row) => (row as HTMLElement).dataset.notification);

const switchNamed = (name: string) => within(productScreen()).getByRole('switch', { name });

const rule = () => productScreen().querySelector('[data-channel-rule]') as HTMLElement;

const noRule = () => expect(productScreen().querySelector('[data-channel-rule]')).toBeNull();

const sampleId = () => (document.querySelector('[data-sample-id]') as HTMLElement).dataset.sampleId;

const openEvent = (id: string) =>
  fireEvent.click(
    within(productScreen().querySelector(`[data-notification="${id}"]`) as HTMLElement)
      .getByRole('button', { name: /^Открыть: / }),
  );

const backToNotifications = () => fireEvent.click(screen.getByRole('button', { name: '← Вернуться к уведомлениям' }));

/** Every entry point, in the order the review switch offers them, with its own address. */
const accountSamples = [
  ['41 · Уведомления', 'notifications'],
  ['42 · Уведомления: итог события', 'notifications-outcome'],
  ['43 · Уведомления: пусто', 'notifications-empty'],
  ['44 · Профиль', 'profile'],
  ['45 · Настройки уведомлений', 'profile-notifications'],
  ['46 · В браузере выключены, email включён', 'profile-push-off'],
  ['47 · Последний канал выключить нельзя', 'profile-last-channel'],
  ['48 · Оба канала выключены', 'profile-both-off'],
  ['49 · Уведомления на компьютере', 'notifications-desktop'],
] as const;

/** The fifteen in-app event texts of copy 4.9, as the screens fill them. */
const eventTexts = [
  'Водитель предлагает подвезти вас 23 августа',
  'Пассажир просит подвезти 30 августа',
  'Водитель предлагает 1 из 2 мест',
  'Поездка 22 августа подтверждена. Контакты открыты.',
  'Водитель отказался подвезти 16 августа',
  'Пассажир отказался от поездки 16 августа',
  'Вам предлагают изменить условия поездки 29 августа',
  'Новые условия приняты',
  'Поездка 23 августа отменена',
  'Водитель отменил поездку 9 августа',
  'Изменилось расписание службы «Божественная литургия 30 августа». Проверьте свою поездку.',
  'Служба «Всенощное бдение 29 августа» отменена. Проверьте свою поездку.',
  'Нашлось подходящее объявление на 30 августа',
  'Регулярная поездка заканчивается 13 сентября. Её можно продлить ещё на 8 недель.',
  'Поездка завтра, 18:00 по вашему времени',
  'Поездка состоялась?',
  'Вас приглашают управлять страницей храма «Покров Пресвятой Богородицы»',
  'Условия использования изменились. Их нужно принять перед следующим действием.',
];

/** The corpus templates the key must show verbatim, placeholders included. */
const eventTemplates = [
  'Водитель предлагает подвезти вас {date}',
  'Пассажир просит подвезти {date}',
  'Водитель предлагает {seats} из {needed} мест',
  'Поездка {date} подтверждена. Контакты открыты.',
  'Водитель отказался подвезти {date}',
  'Пассажир отказался от поездки {date}',
  'Вам предлагают изменить условия поездки {date}',
  'Новые условия приняты',
  'Поездка {date} отменена',
  'Водитель отменил поездку {date}',
  'Изменилось расписание службы «{service}». Проверьте свою поездку.',
  'Служба «{service}» отменена. Проверьте свою поездку.',
  'Нашлось подходящее объявление на {date}',
  'Регулярная поездка заканчивается {date}. Её можно продлить ещё на 8 недель.',
  'Поездка завтра, {time} по вашему времени',
  'Поездка состоялась?',
  'Вас приглашают управлять страницей храма «{church}»',
  'Условия использования изменились. Их нужно принять перед следующим действием.',
];

/** The profile strings of the lightweight Phase 6 profile that are on the screen all the time. */
const profileTexts = [
  'Профиль',
  'Имя',
  'Изменить имя',
  'Email',
  'Подтверждён',
  'Изменить email',
  'Телефон',
  'Изменить телефон',
  'Язык',
  'Настройки уведомлений',
  'Уведомления в браузере',
  'Уведомления по email',
  'Выйти на этом устройстве',
];

/** The notification rule: on screen only after the person tried to switch off the last channel. */
const refusalText =
  'Выключить нельзя: вы ждёте ответа или у вас есть поездка. Так вы не пропустите ответ.';

/** What the owner took off these screens on 4 and 15 October 2026. None may come back. */
const removedCopy = [
  'Служба Божественная литургия 30 августа в храме изменена',
  'Проверьте время своей поездки',
  'Пока уведомления выключены, важные сообщения приходят по email.',
  'у вас есть активное объявление или предстоящая поездка',
  'Пока ничего не произошло. Здесь появятся ответы на ваши просьбы и предложения.',
  'Другие устройства останутся в аккаунте. Аккаунт не удаляется.',
  'Так вас видят другие участники. Фамилия и фотография не показываются.',
  'Новый номер начнёт действовать только после подтверждения по SMS. До этого действует прежний.',
  'Письма о входе, безопасности и изменениях документов отключить нельзя.',
  'одно из двух остаётся включённым',
  'Так вы вовремя узнаете',
  'должен остаться включённым хотя бы один канал',
  'канал',
];

/** Where «Открыть» leads: the state of group 5 that stands for the object of each event. */
const eventTargets: ReadonlyArray<readonly [string, string, string]> = [
  ['41 · Уведомления', 'response-to-request', 'trips-needs-passenger'],
  ['41 · Уведомления', 'accepted', 'trips-upcoming-passenger'],
  ['41 · Уведомления', 'service-changed', 'trips-upcoming-passenger'],
  ['41 · Уведомления', 'reminder', 'trips-upcoming-passenger'],
  ['41 · Уведомления', 'counter-offer', 'trips-needs-passenger'],
  ['41 · Уведомления', 'response-to-offer', 'trips-needs-driver'],
  ['41 · Уведомления', 'service-cancelled', 'trips-upcoming-passenger'],
  ['41 · Уведомления', 'match', 'board'],
  ['41 · Уведомления', 'series-ending', 'trips-listings'],
  ['42 · Уведомления: итог события', 'agreement-cancelled', 'trips-history'],
  ['42 · Уведомления: итог события', 'accepted-then-cancelled', 'trips-history'],
  ['42 · Уведомления: итог события', 'change-accepted', 'trips-upcoming-passenger'],
  ['42 · Уведомления: итог события', 'change-proposed', 'trips-upcoming-passenger'],
  ['42 · Уведомления: итог события', 'response-confirmed', 'trips-upcoming-passenger'],
  ['42 · Уведомления: итог события', 'request-declined', 'trips-listings'],
  ['42 · Уведомления: итог события', 'outcome-question', 'trips-history'],
  ['42 · Уведомления: итог события', 'driver-declined', 'trips-listings'],
  ['42 · Уведомления: итог события', 'passenger-declined', 'trips-waiting'],
  ['42 · Уведомления: итог события', 'counter-offer-expired', 'trips-history'],
  ['42 · Уведомления: итог события', 'trip-cancelled', 'trips-history'],
];

/** Blocks of IA §20 that belong to later phases, and fields the profile must not grow. */
const outOfScope = [
  'Заблокированные',
  'Разблокировать',
  'Скачать мои данные',
  'Удалить аккаунт',
  'Помощь',
  'Документы и приватность',
  'Включить уведомления',
  'Установить',
  'На экран «Домой»',
  'Фамилия:',
  'Фотография:',
  'Дата рождения',
  'Адрес',
  'Приход',
  'Автомобиль',
  'Машина',
  'Этот номер уже подтверждён в другом аккаунте',
];

/** Developer vocabulary that must never reach a simulated product screen (copy 3.5, AGENTS.md). */
const developerWords = [
  'mock',
  'localStorage',
  'ownership',
  'persisted',
  'internal status',
  'projection',
  'проекци',
  'RPC',
  'fixture',
  'фикстур',
  'Web Push',
  'push',
  'PWA',
  'статус',
];

describe('Notifications and profile review states', () => {
  it('opens each of the nine states directly from its own address', () => {
    accountSamples.forEach(([label, anchor]) => {
      window.location.hash = `#${anchor}`;
      render(<CopyReviewPage />);

      const stage = document.querySelector('[data-sample-id]') as HTMLElement;
      expect(stage.dataset.sampleId).toBe(anchor);
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
      expect(productScreen()).not.toBeNull();
      expect(document.querySelectorAll('[data-product-screen]').length).toBe(1);
      cleanup();
    });
    window.location.hash = '';
  }, 36000);

  it('keeps the history as a history: title, unread count, «Новые», «Ранее», a way to the object', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const page = productScreen();

    expect(within(page).getByRole('heading', { level: 1, name: 'Уведомления' })).not.toBeNull();
    expect(page.querySelector('[data-unread-count]')?.textContent).toBe('3 новых');
    expect([...page.querySelectorAll('h2')].map((heading) => heading.textContent)).toEqual(['Новые', 'Ранее']);
    expect(rows('new')).toEqual(['response-to-request', 'accepted', 'service-changed']);
    expect(rows('earlier').length).toBe(8);

    /* Every row leads to its object; the action is named for assistive technology. */
    page.querySelectorAll('[data-notification]').forEach((row) => {
      expect(within(row as HTMLElement).getByRole('button', { name: /^Открыть: / }).textContent).toBe('Открыть');
    });
    /* No settings on this page (IA §7.2): the switches live in the profile. */
    expect(within(page).queryByRole('switch')).toBeNull();
    expect(page.textContent).not.toContain('Настройки уведомлений');

    /* The bell of the bottom bar carries the count and is the active item. */
    const bell = within(page).getByRole('link', { name: 'Уведомления: 3 новых' });
    expect(bell.getAttribute('aria-current')).toBe('page');
  });

  it('opens the object of an event and finds it read when the person comes back', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');

    openEvent('accepted');

    /* The person lands on the trip itself, not on a copy of the notification. */
    expect(sampleId()).toBe('trips-upcoming-passenger');
    expect(productScreen().getAttribute('aria-label')).toBe('Мои поездки');
    expect(within(productScreen()).getByRole('button', { name: 'Изменить условия' })).not.toBeNull();
    expect(within(productScreen()).getByRole('button', { name: 'Отменить поездку' })).not.toBeNull();
    /* The way back belongs to the review page, never to the simulated screen. */
    expect(productScreen().contains(screen.getByRole('button', { name: '← Вернуться к уведомлениям' }))).toBe(false);

    backToNotifications();
    expect(sampleId()).toBe('notifications');
    expect(rows('new')).toEqual(['response-to-request', 'service-changed']);
    expect(rows('earlier')[0]).toBe('accepted');
    expect(productScreen().querySelector('[data-unread-count]')?.textContent).toBe('2 новых');
    expect(within(productScreen()).getByRole('link', { name: 'Уведомления: 2 новых' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '← Вернуться к уведомлениям' })).toBeNull();

    /* Reading everything removes the section and the count, never the events. */
    ['response-to-request', 'service-changed'].forEach((id) => {
      openEvent(id);
      backToNotifications();
    });
    expect(productScreen().querySelector('[data-notifications-section="new"]')).toBeNull();
    expect(productScreen().querySelector('[data-unread-count]')).toBeNull();
    expect(rows('earlier').length).toBe(11);

    /* Choosing the state again from the review switch starts it from its own beginning. */
    openSample('41 · Уведомления');
    expect(rows('new').length).toBe(3);
  });

  it('leads every event of the two populated states to the screen that owns its object', () => {
    eventTargets.forEach(([label, id, target]) => {
      render(<CopyReviewPage />);
      openSample(label);
      openEvent(id);
      expect(`${id}: ${sampleId()}`).toBe(`${id}: ${target}`);
      backToNotifications();
      expect(`${id}: ${sampleId()}`).toBe(`${id}: ${label.startsWith('41') ? 'notifications' : 'notifications-outcome'}`);
      cleanup();
    });
  }, 60000);

  it('says outside the screen that an event of a later phase has no screen to open yet', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');

    openEvent('admin-invite');
    expect(sampleId()).toBe('notifications');
    const note = document.querySelector('[data-review-note]') as HTMLElement;
    expect(note.textContent).toContain('управление страницей храма (этап 7)');
    expect(productScreen().contains(note)).toBe(false);
    expect(rows('earlier')).toContain('admin-invite');

    openEvent('terms-changed');
    expect((document.querySelector('[data-review-note]') as HTMLElement).textContent).toContain('Условий (этап 8)');

    /* Selecting another state clears the note. */
    openSample('44 · Профиль');
    expect(document.querySelector('[data-review-note]')).toBeNull();
  });

  it('draws the unread mark in the one approved blue, not in the text colour', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.module.css'), 'utf8');
    const dot = css.match(/\.notification\[data-unread='yes'\] \.notificationTime::before \{[^}]*\}/)?.[0] ?? '';
    expect(dot).toContain('background: var(--or-unread)');
    expect(dot).not.toContain('var(--or-text)');
    /* No new colour value: the token is the focus blue of DS §3.1 in a second role. */
    expect(css).toMatch(/--or-focus:\s*#1f6fb2;/);
    expect(css).toMatch(/--or-unread:\s*#1f6fb2;/);
  });

  it('keeps an old notification in the history and shows what became of its object', () => {
    render(<CopyReviewPage />);
    openSample('42 · Уведомления: итог события');
    const page = productScreen();

    /* The cancellation is new; the confirmation it overtook is still there, with its outcome. */
    expect(rows('new')).toEqual(['agreement-cancelled']);
    const confirmation = page.querySelector('[data-notification="accepted-then-cancelled"]') as HTMLElement;
    expect(confirmation.textContent).toContain('Поездка 23 августа подтверждена. Контакты открыты.');
    expect(confirmation.querySelector('[data-tone]')?.textContent).toBe('Отменено');
    expect((confirmation.querySelector('[data-tone]') as HTMLElement).dataset.tone).toBe('cancelled');

    const outcomes = [...page.querySelectorAll('[data-notification]')]
      .map((row) => [(row as HTMLElement).dataset.notification, row.querySelector('[data-tone]')?.textContent ?? null]);
    expect(outcomes).toEqual([
      ['agreement-cancelled', null],
      ['accepted-then-cancelled', 'Отменено'],
      ['change-accepted', null],
      ['change-proposed', 'Принято'],
      ['response-confirmed', 'Подтверждено'],
      ['request-declined', 'Отклонено'],
      ['outcome-question', 'Выполнено'],
      ['driver-declined', null],
      ['passenger-declined', null],
      ['counter-offer-expired', 'Время прошло'],
      ['trip-cancelled', null],
    ]);
    /*
     * Owner decision of 4 October 2026: two colours carry the result. Everything that went through
     * is green, everything that did not is red, and «Время прошло» keeps its own grey (his answer
     * of 15 October 2026).
     */
    const tone = (id: string) =>
      (page.querySelector(`[data-notification="${id}"] [data-tone]`) as HTMLElement | null)?.dataset.tone;
    expect(tone('response-confirmed')).toBe('confirmed');
    expect(tone('change-proposed')).toBe('confirmed');
    expect(tone('outcome-question')).toBe('completed');
    expect(tone('accepted-then-cancelled')).toBe('cancelled');
    expect(tone('request-declined')).toBe('cancelled');
    expect(tone('counter-offer-expired')).toBe('expired');
  });

  it('shows the proposed empty state alone, without sections', () => {
    render(<CopyReviewPage />);
    openSample('43 · Уведомления: пусто');
    const page = productScreen();

    expect(page.querySelector('[data-notifications-empty]')?.textContent)
      .toBe('Здесь пока нет уведомлений. Они появятся, когда вам ответят на просьбу или предложение, подтвердят или отменят поездку.');
    /* Removed on 4 October 2026: the state was named twice and the occasions never were. */
    expect(page.textContent).not.toContain('Пока ничего не произошло');
    expect(page.querySelectorAll('h2').length).toBe(0);
    expect(page.querySelectorAll('[data-notification]').length).toBe(0);
    expect(page.querySelector('[data-unread-count]')).toBeNull();
    expect(page.textContent).not.toContain('Нет данных');
  });

  it('shows every proposed in-app event text of copy 4.9 on the two populated states', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const live = productScreen().textContent ?? '';
    openSample('42 · Уведомления: итог события');
    const outcome = productScreen().textContent ?? '';

    eventTexts.forEach((text) => {
      expect(`${text}: ${live.includes(text) || outcome.includes(text)}`).toBe(`${text}: true`);
    });
    ['Уведомления', 'Новые', 'Ранее', 'Открыть'].forEach((text) => expect(live).toContain(text));
  });

  it('carries the same history to the computer layout in one reading column', () => {
    render(<CopyReviewPage />);
    openSample('49 · Уведомления на компьютере');
    const desktop = screen.getByRole('region', { name: 'Уведомления на компьютере' });

    expect(desktop.className).toContain('desktopFrame');
    expect(rows('new')).toEqual(['response-to-request', 'accepted', 'service-changed']);
    expect(desktop.querySelector('[data-unread-count]')?.textContent).toBe('3 новых');
    /* No bottom bar and no site header on a computer frame of this group. */
    expect(within(desktop).queryByRole('navigation')).toBeNull();
    expect(document.querySelectorAll('[data-product-screen]').length).toBe(1);
  });

  it('keeps the profile to the lightweight Phase 6 scope on one long screen', () => {
    render(<CopyReviewPage />);
    openSample('44 · Профиль');
    const page = productScreen();

    expect(within(page).getByRole('heading', { level: 1, name: 'Профиль' })).not.toBeNull();
    expect([...page.querySelectorAll('[data-profile-section]')].map((section) => (section as HTMLElement).dataset.profileSection))
      .toEqual(['name', 'email', 'phone', 'language', 'notifications', 'session']);

    profileTexts.forEach((text) => expect(`${text}: ${page.textContent?.includes(text)}`).toBe(`${text}: true`));
    outOfScope.forEach((text) => expect(`${text}: ${page.textContent?.includes(text)}`).toBe(`${text}: false`));

    /*
     * Owner review of 15 October 2026: an existing profile shows the name, it does not ask for it.
     * No text field at all — only the language list — and the name is changed by a quiet action.
     */
    expect(within(page).queryByRole('textbox')).toBeNull();
    expect(page.querySelector('input')).toBeNull();
    expect(page.querySelector('[data-profile-section="name"]')?.textContent).toContain('Мария');
    expect((within(page).getByLabelText('Язык') as HTMLSelectElement).value).toBe('ru');
    expect([...page.querySelectorAll('option')].map((option) => option.textContent))
      .toEqual(['Русский', 'English', 'Italiano', 'Română', 'Українська', 'Deutsch']);
    expect(within(page).getAllByText('Подтверждён').length).toBe(2);

    /* The three change actions are one kind: quiet, on the line of the value they change. */
    ['Изменить имя', 'Изменить email', 'Изменить телефон'].forEach((name) => {
      const action = within(page).getByRole('button', { name });
      expect(`${name}: ${action.className.includes('quietButton')}`).toBe(`${name}: true`);
      expect(`${name}: ${action.parentElement?.className.includes('profileValueRow')}`).toBe(`${name}: true`);
    });
    expect(page.querySelector('[data-profile-section="email"]')?.textContent).toContain('maria.k@example.com');
    expect(page.querySelector('[data-profile-section="phone"]')?.textContent).toContain('+39 345 678 45 67');

    /* The settings are a block of this page, headed as the menu names it (IA §20.2). */
    expect(within(page).getByRole('heading', { level: 2, name: 'Настройки уведомлений' })).not.toBeNull();
    expect(page.querySelector('#notifications')).not.toBeNull();

    /* Nothing is explained until it matters: no rule, no note about system letters. */
    noRule();
    expect(page.querySelector('[data-system-note]')).toBeNull();

    /* Sign-out is a secondary action standing alone; nothing in the bar is active. */
    const signOut = within(page).getByRole('button', { name: 'Выйти на этом устройстве' });
    expect(signOut.className).toContain('secondaryButton');
    expect(page.querySelector('[data-profile-section="session"]')?.textContent).toBe('Выйти на этом устройстве');
    expect(page.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('says nothing about the rule until the person tries to switch off the last way of being reached', () => {
    render(<CopyReviewPage />);
    openSample('45 · Настройки уведомлений');

    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('true');
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    noRule();
    expect(productScreen().querySelector('[data-push-note]')).toBeNull();
    expect(productScreen().textContent).not.toContain('Выключить нельзя');

    /*
     * Either may go off while the other stays; still nothing to explain. Owner decision of
     * 15 October 2026: during normal operation the area under the switches stays empty — no line
     * about important messages arriving by email.
     */
    fireEvent.click(switchNamed('Уведомления в браузере'));
    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('false');
    expect(productScreen().querySelector('[data-push-note]')).toBeNull();
    expect(productScreen().textContent).not.toContain('важные сообщения приходят по email');
    noRule();

    /* Now email is the last one of a person with activity: it stays, and the answer appears under it. */
    fireEvent.click(switchNamed('Уведомления по email'));
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    expect(rule().textContent).toBe(refusalText);
    expect(rule().dataset.refused).toBe('email');
    expect((rule().closest('[role="status"]') as HTMLElement).previousElementSibling?.getAttribute('data-switch')).toBe('email');
    expect(rule().closest('[role="status"]')?.textContent).toBe(refusalText);

    /* Switching the browser notifications back on lifts the refusal: the rule is gone again. */
    fireEvent.click(switchNamed('Уведомления в браузере'));
    noRule();
    fireEvent.click(switchNamed('Уведомления по email'));
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('false');
    noRule();
  });

  it('asks the same of the browser switch when email is already off', () => {
    render(<CopyReviewPage />);
    openSample('45 · Настройки уведомлений');

    fireEvent.click(switchNamed('Уведомления по email'));
    noRule();
    fireEvent.click(switchNamed('Уведомления в браузере'));
    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('true');
    expect(rule().textContent).toBe(refusalText);
    expect((rule().closest('[role="status"]') as HTMLElement).previousElementSibling?.getAttribute('data-switch')).toBe('push');
  });

  it('shows the browser channel off, blocked or unsupported as an ordinary state, not an error', () => {
    render(<CopyReviewPage />);
    openSample('46 · В браузере выключены, email включён');

    const variants = screen.getByRole('group', { name: 'Почему уведомлений в браузере нет' });
    expect(productScreen().contains(variants)).toBe(false);

    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('false');
    expect(switchNamed('Уведомления в браузере').getAttribute('aria-disabled')).toBeNull();
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    /* Switched off by the person: an ordinary state, and nothing is said about it. */
    expect(productScreen().querySelector('[data-push-note]')).toBeNull();
    expect(productScreen().textContent).not.toContain('важные сообщения приходят по email');

    fireEvent.click(within(variants).getByRole('button', { name: 'Запрещены в браузере' }));
    expect(switchNamed('Уведомления в браузере').getAttribute('aria-disabled')).toBe('true');
    const blocked = productScreen().querySelector('[data-push-note="blocked"]') as HTMLElement;
    expect(blocked.textContent).toContain('Уведомления запрещены в браузере');
    expect(blocked.textContent).toContain('Разрешить их можно в настройках браузера для этого сайта. Пока уведомления выключены, важные сообщения приходят по email.');
    /* A forbidden channel cannot be switched on from here, and nothing asks the browser. */
    fireEvent.click(switchNamed('Уведомления в браузере'));
    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(within(variants).getByRole('button', { name: 'Не поддерживаются' }));
    expect(productScreen().querySelector('[data-push-note="unsupported"]')?.textContent)
      .toBe('Этот браузер не поддерживает уведомления. Важные сообщения будут приходить по email.');
    expect(productScreen().querySelectorAll('[data-push-note]').length).toBe(1);
    /* Not an error surface: no error styling class on the note. */
    expect(productScreen().querySelector('[data-push-note]')?.className).not.toContain('error');
  });

  it('opens the refused state with the last switch still on and the reason announced once, briefly', () => {
    render(<CopyReviewPage />);
    openSample('47 · Последний канал выключить нельзя');
    const page = productScreen();

    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('false');
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    expect(rule().dataset.refused).toBe('email');
    expect(rule().textContent).toBe(refusalText);
    /* Two short sentences: the refusal first, the reason after it — and no office word. */
    expect(refusalText.split('. ').length).toBe(2);
    expect(refusalText.startsWith('Выключить нельзя:')).toBe(true);
    expect(refusalText).not.toContain('канал');
    /* Variant «Б»: one plain sentence for the three cases of IA §17.1, true for a person who only answered. */
    expect(refusalText).toContain('вы ждёте ответа');
    expect(refusalText).toContain('у вас есть поездка');
    expect(rule().closest('[role="status"]')).not.toBeNull();
    /* One sentence on screen, nothing else about the rule, and nothing about system letters. */
    expect(page.querySelectorAll('[data-channel-rule]').length).toBe(1);
    expect(page.textContent?.split('Выключить нельзя').length).toBe(2);
    expect(page.querySelector('[data-system-note]')).toBeNull();
    expect(page.textContent).not.toContain('Письма о входе');
    /* Pressing again changes nothing silently either. */
    fireEvent.click(switchNamed('Уведомления по email'));
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    expect(rule().dataset.refused).toBe('email');
  });

  it('allows both optional channels off when there is no transport activity', () => {
    render(<CopyReviewPage />);
    openSample('48 · Оба канала выключены');
    const page = productScreen();

    expect(switchNamed('Уведомления в браузере').getAttribute('aria-checked')).toBe('false');
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('false');
    noRule();
    /* «…важные сообщения приходят по email» would be untrue here, so it is not shown. */
    expect(page.querySelector('[data-push-note]')).toBeNull();
    expect(page.querySelector('[data-system-note]')).toBeNull();

    /* Either can be switched on and off again freely. */
    fireEvent.click(switchNamed('Уведомления по email'));
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('true');
    expect(page.querySelector('[data-push-note]')).toBeNull();
    fireEvent.click(switchNamed('Уведомления по email'));
    expect(switchNamed('Уведомления по email').getAttribute('aria-checked')).toBe('false');
    noRule();
  });

  it('keeps developer vocabulary and later-phase blocks off every simulated screen', () => {
    accountSamples.forEach(([label]) => {
      render(<CopyReviewPage />);
      openSample(label);
      const text = productScreen().textContent ?? '';
      developerWords.forEach((word) => {
        expect(`${label} / ${word}: ${text.toLowerCase().includes(word.toLowerCase())}`).toBe(`${label} / ${word}: false`);
      });
      outOfScope.forEach((word) => expect(`${label} / ${word}: ${text.includes(word)}`).toBe(`${label} / ${word}: false`));
      removedCopy.forEach((gone) => expect(`${label} / ${gone}: ${text.includes(gone)}`).toBe(`${label} / ${gone}: false`));
      cleanup();
    });
  }, 36000);

  it('lists every corpus template and profile string in the key and approves nothing', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const live = sourceRows();
    openSample('42 · Уведомления: итог события');
    const outcome = sourceRows();
    eventTemplates.forEach((template) => {
      expect(`${template}: ${live.includes(template) || outcome.includes(template)}`).toBe(`${template}: true`);
    });
    ['Подтверждено', 'Принято', 'Отклонено', 'Отменено', 'Время прошло', 'Выполнено']
      .forEach((plate) => expect(outcome).toContain(plate));

    openSample('43 · Уведомления: пусто');
    expect(sourceRows()).toContain('Пока ничего не произошло. Здесь появятся ответы на ваши просьбы и предложения.');

    openSample('46 · В браузере выключены, email включён');
    [...profileTexts, refusalText].forEach((text) => expect(sourceRows()).toContain(text));
    expect(sourceRows()).toContain('Уведомления запрещены в браузере');
    expect(sourceRows()).toContain('Этот браузер не поддерживает уведомления. Важные сообщения будут приходить по email.');

    /*
     * What the owner approved on 15 October 2026, string by string. The marks of the key are the
     * only place an approval is recorded, so they are asserted exactly: a string he did not review
     * must not drift into «Утверждено», and one he accepted must not stay a proposal.
     */
    const markOf = (text: string) => {
      const row = [...sourcePanel().querySelectorAll('dl > div')]
        .find((entry) => entry.querySelector('dt')?.firstChild?.textContent === text);
      return row?.querySelector('dd')?.textContent ?? `нет строки: ${text}`;
    };
    const expectMarks = (expected: ReadonlyArray<readonly [string, string]>) =>
      expected.forEach(([text, mark]) => expect(`${text}: ${markOf(text)}`).toBe(`${text}: ${mark}`));

    openSample('41 · Уведомления');
    expectMarks([
      ['Открыть', 'Утверждено'],
      ['{count} новое / новых', 'Утверждено'],
      ['Водитель предлагает подвезти вас {date}', 'Утверждено'],
      ['Пассажир просит подвезти {date}', 'Утверждено'],
      ['Водитель предлагает {seats} из {needed} мест', 'Утверждено'],
      ['Поездка {date} подтверждена. Контакты открыты.', 'Утверждено'],
      ['Поездка завтра, {time} по вашему времени', 'Утверждено'],
      /* Worded by the owner on 15 October 2026: a changed schedule and a cancelled service are two events. */
      ['Изменилось расписание службы «{service}». Проверьте свою поездку.', 'Утверждено'],
      ['Служба «{service}» отменена. Проверьте свою поездку.', 'Утверждено'],
      ['Служба {service} в храме изменена. Проверьте время своей поездки.', 'Решение'],
      /* The pattern of the line under an event of a particular church is approved. */
      ['Покров Пресвятой Богородицы · Catanzaro', 'Утверждено'],
      /* Deferred to the group that owns the object, or new and waiting for the final review of the group. */
      ['Вас приглашают управлять страницей храма «{church}»', 'Проект'],
      ['Условия использования изменились. Их нужно принять перед следующим действием.', 'Проект'],
      ['Нашлось подходящее объявление на {date}', 'Проект'],
      ['Регулярная поездка заканчивается {date}. Её можно продлить ещё на 8 недель.', 'Проект'],
      /* Fixed by an approved document: the source, not an approval of the owner. */
      ['Уведомления', 'IA'],
      ['Новые', 'IA'],
      ['Ранее', 'IA'],
    ]);

    openSample('42 · Уведомления: итог события');
    expectMarks([
      ['Поездка {date} отменена', 'Утверждено'],
      ['Водитель отменил поездку {date}', 'Утверждено'],
      ['Вам предлагают изменить условия поездки {date}', 'Утверждено'],
      ['Новые условия приняты', 'Утверждено'],
      ['Водитель отказался подвезти {date}', 'Утверждено'],
      ['Пассажир отказался от поездки {date}', 'Утверждено'],
      ['Принято', 'Утверждено'],
      ['Выполнено', 'Утверждено'],
      /* The four plates that are state names of copy 3.3 keep their approved source. */
      ['Подтверждено', 'IA'],
      ['Отклонено', 'IA'],
      ['Отменено', 'IA'],
      ['Время прошло', 'IA'],
      ['Поездка состоялась?', 'IA'],
    ]);

    openSample('43 · Уведомления: пусто');
    expectMarks([
      ['Здесь пока нет уведомлений. Они появятся, когда вам ответят на просьбу или предложение, подтвердят или отменят поездку.', 'Утверждено'],
      ['Пока ничего не произошло. Здесь появятся ответы на ваши просьбы и предложения.', 'Решение'],
    ]);

    openSample('44 · Профиль');
    expectMarks([
      ['Подтверждён', 'Утверждено'],
      ['Выключить нельзя: вы ждёте ответа или у вас есть поездка. Так вы не пропустите ответ.', 'Утверждено'],
      /* Approved by the owner on 15 October 2026 as the quiet action beside the displayed name. */
      ['Изменить имя', 'Утверждено'],
      /* The texts he took off the screen stay in the key as decisions, so they do not come back. */
      ['Другие устройства останутся в аккаунте. Аккаунт не удаляется.', 'Решение'],
      ['Так вас видят другие участники. Фамилия и фотография не показываются.', 'Решение'],
      ['Новый номер начнёт действовать только после подтверждения по SMS. До этого действует прежний.', 'Решение'],
      ['Письма о входе, безопасности и изменениях документов отключить нельзя.', 'Решение'],
      ['Выключить нельзя: у вас есть активное объявление или предстоящая поездка. Так вы не пропустите ответ.', 'Решение'],
    ]);

    openSample('46 · В браузере выключены, email включён');
    expectMarks([
      ['Пока уведомления выключены, важные сообщения приходят по email.', 'Решение'],
      ['Уведомления запрещены в браузере', 'IA'],
      ['Этот браузер не поддерживает уведомления. Важные сообщения будут приходить по email.', 'IA'],
    ]);

    /* Every state of the group carries the explanation of the review, and none claims to be unreviewed. */
    accountSamples.forEach(([label]) => {
      openSample(label);
      expect(sourcePanel().textContent).toContain('4 и 15 октября 2026');
      expect(sourcePanel().textContent).not.toContain('ещё не просмотрен');
    });
    openSample('44 · Профиль');
    expect(sourcePanel().textContent).toContain('утверждены 15 октября 2026 года');
    expect(sourcePanel().textContent).toContain('Остаются «Проект»');
  });

  it('shows a church and a city under the events of a church, and nothing under a global one', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const page = productScreen();
    const context = (id: string) =>
      page.querySelector(`[data-notification="${id}"] p[class*="secondary"]`)?.textContent ?? null;

    ['response-to-request', 'accepted', 'service-changed', 'reminder', 'counter-offer', 'match', 'service-cancelled', 'response-to-offer', 'series-ending']
      .forEach((id) => {
        const line = context(id);
        expect(`${id}: ${line}`).toMatch(/: .+ · [A-Za-z ]+$/);
        /* Public names only: no street, no number, no meeting place. */
        expect(line).not.toMatch(/\d|Via |ул\.|улица|место встречи/i);
      });
    /* A global event has no church; the invitation already names the church in its own sentence. */
    expect(context('terms-changed')).toBeNull();
    expect(context('admin-invite')).toBeNull();
    /* The line is the second-level text of the card, under the event and above the action. */
    const row = page.querySelector('[data-notification="service-changed"]') as HTMLElement;
    const order = [...row.children].map((child) => child.className.replace(/_[a-z0-9]+$/i, ''));
    expect(order.findIndex((name) => name.includes('notificationText')))
      .toBeLessThan(order.findIndex((name) => name.includes('secondary')));
    expect(order.findIndex((name) => name.includes('secondary')))
      .toBeLessThan(order.findIndex((name) => name.includes('cardAction')));
  });

  it('keeps the two service events apart, the quotation marks right and no placeholder unfilled', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const changed = productScreen().querySelector('[data-notification="service-changed"] p[class*="notificationText"]');
    const cancelled = productScreen().querySelector('[data-notification="service-cancelled"] p[class*="notificationText"]');

    expect(changed?.textContent).toBe('Изменилось расписание службы «Божественная литургия 30 августа». Проверьте свою поездку.');
    expect(cancelled?.textContent).toBe('Служба «Всенощное бдение 29 августа» отменена. Проверьте свою поездку.');
    /* Guillemets, not straight or doubled quotes, and the name is not inflected. */
    [changed?.textContent ?? '', cancelled?.textContent ?? ''].forEach((text) => {
      expect(text).not.toMatch(/"|“|”|„/);
      expect((text.match(/«/g) ?? []).length).toBe(1);
      expect((text.match(/»/g) ?? []).length).toBe(1);
    });

    ['41 · Уведомления', '42 · Уведомления: итог события', '43 · Уведомления: пусто', '49 · Уведомления на компьютере']
      .forEach((label) => {
        openSample(label);
        expect(`${label}: ${/[{}]/.test(productScreen().textContent ?? '')}`).toBe(`${label}: false`);
      });
  });

  it('adds the two events of PS §21.2 to the populated screen as proposals, without a new page', () => {
    render(<CopyReviewPage />);
    openSample('41 · Уведомления');
    const page = productScreen();

    expect(rows('earlier')).toEqual([
      'reminder', 'counter-offer', 'match', 'service-cancelled', 'response-to-offer', 'series-ending', 'admin-invite', 'terms-changed',
    ]);
    expect(page.querySelector('[data-notification="match"]')?.textContent).toContain('Нашлось подходящее объявление на 30 августа');
    expect(page.querySelector('[data-notification="series-ending"]')?.textContent)
      .toContain('Регулярная поездка заканчивается 13 сентября. Её можно продлить ещё на 8 недель.');
    /* No internal word, no «серия» (copy 3.4), and no second page: the states stay 41–49. */
    expect(page.textContent).not.toMatch(/[Сс]ери[яи]/);
    expect([...document.querySelectorAll('nav[aria-label="Выбор экрана проверки"] button')]
      .filter((button) => /^4[1-9] · /.test(button.textContent ?? '')).length).toBe(9);

    /* «Открыть» leads to the board for a match and to the listings for an ending regular trip. */
    openEvent('match');
    expect(sampleId()).toBe('board');
    expect(document.querySelector('[data-return-bar]')?.textContent).toContain('группе 1');
    backToNotifications();
    openEvent('series-ending');
    expect(sampleId()).toBe('trips-listings');
    expect(document.querySelector('[data-return-bar]')?.textContent).toContain('группе 5');
  });

  it('records the pending reviews and the publishing rule in the documents, and approves none of them', () => {
    const copy = readFileSync(resolve(process.cwd(), 'docs/ORTHODOX_ROUTES_UX_COPY_LOCALIZATION_V1.md'), 'utf8');
    const architecture = readFileSync(resolve(process.cwd(), 'docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md'), 'utf8');

    /* The checklist of 9.7 names every deferred review and where it happens. */
    const checklist = copy.slice(copy.indexOf('**Чек-лист отложенных проверок группы 6.**'), copy.indexOf('**Что в группу 6 не входило.**'));
    expect(checklist.length).toBeGreaterThan(200);
    [
      ['Текст события «Приглашение администратора» (4.9)', 'Экраны управления храмом (4.12)'],
      ['Текст события «Изменение Условий» (4.9)', 'Юридические экраны (4.15)'],
      ['Столбец «Текст push» (4.9)', 'Экраны PWA и Web Push'],
      ['включите email или Web Push', 'Регистрация и публикация (4.5, 4.6, 4.10)'],
      ['«Подходящее объявление» и «Скорое окончание регулярной поездки»', 'Итоговый ручной просмотр группы 6'],
    ].forEach(([item, place]) => {
      expect(`${item}: ${checklist.includes(item)}`).toBe(`${item}: true`);
      expect(`${place}: ${checklist.includes(place)}`).toBe(`${place}: true`);
    });

    /* Deferred and new strings stay proposals in the corpus. */
    expect(copy).toContain('| Приглашение администратора | Вас приглашают управлять страницей храма «{church}» | Приглашение управлять страницей храма |');
    expect(copy).not.toMatch(/Нашлось подходящее объявление на \{date\} \| [^|]*Утверждено/);

    /* The owner-approved product rule lives in IA §17.1 and keeps the earlier rule beside it. */
    const section = architecture.slice(architecture.indexOf('### 17.1.'), architecture.indexOf('### 17.2.'));
    expect(section).toContain('должен оставаться включён хотя бы один внешний канал');
    expect(section).toContain('Системные письма для входа, восстановления, безопасности и обязательных юридических сообщений отключить нельзя.');
    expect(section).toContain('сначала просит включить email или Web Push');
    ['настройки уведомлений не меняются молча', 'не публикуется', 'заполненная форма сохраняется', 'практичной альтернативой предлагается email']
      .forEach((rule) => expect(`${rule}: ${section.includes(rule)}`).toBe(`${rule}: true`));

    /* Decisions 81-86 and their approval record are kept. */
    [81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93].forEach((n) => expect(`${n}: ${copy.includes(`| ${n} | **`)}`).toBe(`${n}: true`));
  });

  it('leaves groups 1-5 working and the route out of production', () => {
    render(<CopyReviewPage />);

    ([
      ['3 · Поездки храма', 'Поездки храма'],
      ['13 · Последние детали', 'Просьба пассажира: последние детали'],
      ['22 · Проверьте поездку', 'Предложение водителя: проверьте поездку'],
      ['25 · Карта: обычное состояние', 'Карта поездок группы'],
      ['32 · Ответ пассажира', 'Мои поездки'],
    ] as const).forEach(([label, region]) => {
      openSample(label);
      expect(screen.getByRole('region', { name: region })).not.toBeNull();
      expect(productScreen().querySelector('[data-notification]')).toBeNull();
      expect(productScreen().querySelector('[data-profile-section]')).toBeNull();
      expect(within(productScreen()).queryByRole('switch')).toBeNull();
    });

    const groupStrings = [
      'Здесь пока нет уведомлений. Они появятся, когда вам ответят',
      'Водитель предлагает подвезти вас',
      'Изменилось расписание службы',
      'Нашлось подходящее объявление',
      'Так вас видят другие участники. Фамилия и фотография не показываются.',
      'Выключить нельзя: вы ждёте ответа или у вас есть поездка.',
      'Письма о входе, безопасности и изменениях документов отключить нельзя.',
      'Уведомления запрещены в браузере',
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
