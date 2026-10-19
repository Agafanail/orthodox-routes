// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import CopyReviewPage from './page';

afterEach(cleanup);

/*
 * Group 7 of the manual Russian copy review: registration, sign-in and contact checks in the context
 * of publishing (IA §19, §17.1, decisions 1.17 (92) and 1.18 (94–109); copy 4.10). Approved by the
 * owner on 19 October 2026 after the reviews of 17 and 19 October and the independent audit. These
 * tests guard the product rules and the approval record:
 *
 * - one rule before any publication: contacts, a date still ahead, an external notification;
 * - publication only on a press whose label says so, never twice, never on opening a link;
 * - decision 92 cannot be bypassed through the SMS code, a sign-in link, an existing account, the
 *   recovery or the other device;
 * - the three edge states: a passed date, an existing email, SMS unavailable during recovery;
 * - a new account has email notifications on without a separate registration line (decision 109);
 * - every string of the group is approved, and nothing outside the review route changes.
 */

function openSample(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function productScreen() {
  return document.querySelector('[data-product-screen]') as HTMLElement;
}

const inScreen = () => within(productScreen());
const press = (name: string) => fireEvent.click(inScreen().getByRole('button', { name }));
const review = (name: string) =>
  fireEvent.click(within(document.querySelector('[data-auth-review]') as HTMLElement).getByRole('button', { name }));
const authScreen = () => productScreen().querySelector('[data-auth-screen]')?.getAttribute('data-auth-screen') ?? 'form';
const type = (label: string | RegExp, value: string) => fireEvent.change(inScreen().getByLabelText(label), { target: { value } });
const text = () => productScreen().textContent ?? '';
const h1 = () => inScreen().getByRole('heading', { level: 1 }).textContent;
const error = (id: string) => productScreen().querySelector(`[data-field-error="${id}"]`)?.textContent;
const resultBody = () => productScreen().querySelector('[data-result-body]')?.textContent;
const buttons = () => inScreen().queryAllByRole('button').map((button) => button.textContent ?? '');
const reviewNote = () => document.querySelector('[data-review-note]')?.textContent ?? '';

const successTitles = ['Просьба опубликована', 'Предложение опубликовано', 'Регулярная поездка опубликована'];
const notPublished = () => {
  expect(authScreen()).not.toBe('published');
  expect(productScreen().querySelector('[data-result-mark="success"]')).toBeNull();
  successTitles.forEach((title) => expect(h1()).not.toBe(title));
};

function sourceRows() {
  const panel = screen.getByRole('complementary', { name: 'Источники формулировок на экране' });
  return [...panel.querySelectorAll('dt')].map((row) => [row.firstChild?.textContent, row.nextElementSibling?.textContent]);
}

/** Every entry point, in the order the review switch offers them, with its own address. */
const authSamples = [
  ['50 · Старт: заполненная просьба', 'auth-new'],
  ['51 · Имя и контакты', 'auth-register'],
  ['52 · Проверьте почту', 'auth-email-sent'],
  ['53 · Ссылка из письма', 'auth-email-link'],
  ['54 · Срок ссылки истёк', 'auth-link-expired'],
  ['55 · Код из SMS', 'auth-phone'],
  ['56 · SMS не отправляется', 'auth-phone-unavailable'],
  ['57 · Опубликовано', 'auth-published'],
  ['58 · Вход в аккаунт', 'auth-sign-in'],
  ['59 · Нет доступа к почте', 'auth-lost-email'],
  ['60 · Ссылка на другом устройстве', 'auth-other-device'],
  ['61 · Уведомления выключены', 'auth-notifications-off'],
  ['62 · Дата прошла во время проверок', 'auth-date-passed'],
  ['63 · Email уже есть в аккаунте', 'auth-existing-email'],
  ['64 · Восстановление: SMS недоступно', 'auth-lost-email-sms'],
] as const;

/** Name, email, phone and both ticks, through the screen, as a person would. */
function fillRegistration() {
  type('Имя', 'Мария');
  type('Email', 'maria.k@example.com');
  type(/^Телефон/, '39 345 678 45 67');
  fireEvent.click(inScreen().getByRole('checkbox', { name: 'Мне есть 18 лет' }));
  fireEvent.click(inScreen().getByRole('checkbox', { name: 'Я принимаю Условия использования' }));
}

/** From the completed form to the SMS code of a new person. */
function walkToCode() {
  openSample('50 · Старт: заполненная просьба');
  press('Опубликовать');
  fillRegistration();
  press('Продолжить');
  review('Открыть ссылку из письма');
  press('Подтвердить email и получить код');
  review('Ввести код из SMS');
}

/* Each test walks many states of one journey; under a full parallel run that takes longer than the default. */
describe('Group 7: registration and publication journey', { timeout: 20000 }, () => {
  it('offers fifteen entry points, each with a stable address', () => {
    render(<CopyReviewPage />);
    const nav = screen.getByRole('navigation', { name: 'Выбор экрана проверки' });
    const labels = within(nav).getAllByRole('button').map((button) => button.textContent);
    expect(labels.filter((label) => /^(5\d|6\d) · /.test(label ?? ''))).toEqual(authSamples.map(([label]) => label));

    authSamples.forEach(([label, id]) => {
      openSample(label);
      expect((document.querySelector('[data-sample-id]') as HTMLElement).dataset.sampleId).toBe(id);
    });
  });

  it('opens a state directly from its address', () => {
    window.location.hash = '#auth-lost-email-sms';
    render(<CopyReviewPage />);
    expect(productScreen().querySelector('[data-recovery-blocked]')).not.toBeNull();
    window.location.hash = '';
  });

  /* ------------------------------------------------------------------ path A */

  it('walks a new passenger to a publication that only the labelled press performs', () => {
    render(<CopyReviewPage />);
    openSample('50 · Старт: заполненная просьба');

    expect(h1()).toBe('Последние детали');
    expect(text()).toContain('Не сообщайте домашний адрес, телефон, email и ссылки.');
    // Future dates in every successful scenario of the group.
    expect(text()).toContain('воскресенье, 1 ноября, 9:00');
    expect(text()).not.toContain('августа');
    press('Опубликовать');

    expect(authScreen()).toBe('register');
    fillRegistration();
    press('Продолжить');
    expect(productScreen().querySelector('[data-email-sent-body]')?.textContent)
      .toBe('Мы отправили ссылку на maria.k@example.com. Перейдите по ней, чтобы подтвердить email.');

    // Opening the link confirms nothing: the page waits for the person's own press.
    review('Открыть ссылку из письма');
    expect(h1()).toBe('Подтвердите email и телефон');
    expect(productScreen().querySelector('[data-done-plate]')).toBeNull();
    expect(text()).toContain('Пришлём код в SMS на номер +39 …45 67.');
    expect(text()).not.toContain('Мы отправили код');
    notPublished();

    press('Подтвердить email и получить код');
    expect(h1()).toBe('Введите код из SMS');
    expect(productScreen().querySelector('[data-done-plate]')?.textContent).toBe('Email подтверждён');
    notPublished();

    // The code is the last missing condition, so the press publishes — and says so.
    review('Ввести код из SMS');
    expect(buttons()).toContain('Подтвердить и опубликовать');
    press('Подтвердить и опубликовать');
    expect(authScreen()).toBe('published');
    expect(h1()).toBe('Просьба опубликована');
    expect(productScreen().querySelector('[data-result-mark="success"]')).not.toBeNull();
    expect(resultBody()).toBe('Email и телефон подтверждены. Когда водитель предложит подвезти, мы пришлём уведомление.');
  });

  it('keeps the form answers for the way back from the registration', () => {
    render(<CopyReviewPage />);
    openSample('50 · Старт: заполненная просьба');
    fireEvent.change(productScreen().querySelector('[data-note-field] textarea')!, { target: { value: 'у часовни' } });
    press('Опубликовать');
    press('Назад');

    expect(authScreen()).toBe('form');
    expect((productScreen().querySelector('[data-note-field] textarea') as HTMLTextAreaElement).value).toBe('у часовни');
  });

  it('asks for name, email and phone with a phone field that shows its format', () => {
    render(<CopyReviewPage />);
    openSample('51 · Имя и контакты');

    expect(text()).toContain('Ваша просьба сохранена. Укажите контакты — по ним с вами свяжется водитель, и вы узнаете, когда вам предложат поездку.');
    expect(text()).not.toContain('Публично видно только имя');
    // Decision 1.18 (109) as refined by the owner: email is on by default, and the form does not say so.
    expect(text()).not.toContain('Об ответах на поездку сообщим по email');
    expect(document.getElementById('auth-email-hint')).toBeNull();
    const phone = inScreen().getByLabelText(/^Телефон/) as HTMLInputElement;
    expect(phone.getAttribute('type')).toBe('tel');
    expect(phone.getAttribute('placeholder')).toBe('39 000 000 00 00');
    const css = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.module.css'), 'utf8');
    expect(css).toMatch(/\.textField > \.phoneInput \{[^}]*display: flex/);
    fireEvent.change(phone, { target: { value: '39 abc 345' } });
    expect((inScreen().getByLabelText(/^Телефон/) as HTMLInputElement).value).toBe('39  345');
  });

  it('validates the registration next to each field and keeps what was typed', () => {
    render(<CopyReviewPage />);
    openSample('51 · Имя и контакты');
    type('Email', 'maria.k@');
    press('Продолжить');

    const errors = [...productScreen().querySelectorAll('[data-field-error]')].map((node) => node.textContent);
    expect(errors).toEqual([
      'Укажите имя, которое увидят другие участники',
      'Введите email в формате name@example.org',
      'Введите номер с кодом страны, например +39 000 000 00 00',
      'Аккаунт для поездок доступен с 18 лет',
      'Чтобы продолжить, примите Условия использования',
    ]);
    const name = inScreen().getByLabelText('Имя');
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-describedby')).toBe('auth-name-error');
    expect(inScreen().getByLabelText('Email').getAttribute('aria-describedby')).toBe('auth-email-error');
    expect((inScreen().getByLabelText('Email') as HTMLInputElement).value).toBe('maria.k@');
  });

  it('asks for 18+ and the Terms separately and links the policy without a tick of its own', () => {
    render(<CopyReviewPage />);
    openSample('51 · Имя и контакты');

    expect(inScreen().getAllByRole('checkbox').map((box) => box.closest('label')?.textContent))
      .toEqual(['Мне есть 18 лет', 'Я принимаю Условия использования']);
    const terms = inScreen().getByRole('link', { name: 'Условия использования' });
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(inScreen().getByRole('link', { name: 'Как мы обращаемся с данными' }).getAttribute('target')).toBe('_blank');
    expect(text()).not.toMatch(/[Пп]ароль/);
  });

  it('resends the letter with a counting outlined action, and corrects the email in place', () => {
    render(<CopyReviewPage />);
    openSample('52 · Проверьте почту');

    const resend = productScreen().querySelector('[data-resend="email"]') as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toMatch(/^Отправить ещё раз через \d+ с$/);
    review('Пропустить ожидание');
    press('Отправить письмо ещё раз');
    expect(productScreen().querySelector('[data-email-resent]')?.textContent).toBe('Письмо отправлено ещё раз.');

    press('Изменить email');
    const email = inScreen().getByLabelText('Email') as HTMLInputElement;
    expect(email.value).toBe('maria.k@example.com');
    expect(document.activeElement).toBe(email);
  });

  it('says plainly that the link expired', () => {
    render(<CopyReviewPage />);
    openSample('54 · Срок ссылки истёк');
    expect(h1()).toBe('Срок действия ссылки истёк');
    expect(text()).toContain('Запросите новую ссылку.');
    press('Получить новую ссылку');
    expect(authScreen()).toBe('email-sent');
  });

  it('explains every code error next to the field', () => {
    render(<CopyReviewPage />);
    openSample('55 · Код из SMS');
    const code = inScreen().getByLabelText('Код');

    fireEvent.change(code, { target: { value: '12' } });
    press('Подтвердить и опубликовать');
    expect(error('auth-code')).toBe('Код состоит из 6 цифр');
    fireEvent.change(code, { target: { value: '111111' } });
    press('Подтвердить и опубликовать');
    expect(error('auth-code')).toBe('Код не подошёл. Проверьте цифры или запросите новый.');
    review('Срок кода истёк');
    expect(error('auth-code')).toBe('Срок действия кода истёк. Запросите новый.');
    review('Слишком много попыток');
    expect(error('auth-code')).toBe('Слишком много попыток. Запросите новый код.');
    expect(inScreen().queryByRole('button', { name: /^Подтвердить/ })).toBeNull();
    notPublished();
  });

  it('shows a failed SMS at once, says what cannot be published and that it is kept', () => {
    render(<CopyReviewPage />);
    openSample('55 · Код из SMS');

    review('SMS временно недоступны');
    expect(productScreen().querySelector('[data-phone-consequence]')?.textContent)
      .toBe('Без подтверждённого телефона просьбу опубликовать нельзя. Она сохранена и не пропадёт.');
    review('Страна не поддерживается');
    expect(productScreen().querySelector('[data-phone-blocked]')?.textContent)
      .toBe('Мы пока не можем отправить SMS на номера этой страны');
    notPublished();
  });

  it('names the published object in each outcome', () => {
    render(<CopyReviewPage />);
    openSample('57 · Опубликовано');
    ([
      ['Просьба пассажира', 'Просьба опубликована', 'Посмотреть просьбу'],
      ['Разовая поездка водителя', 'Предложение опубликовано', 'Посмотреть предложение'],
      ['Регулярная поездка водителя', 'Регулярная поездка опубликована', 'Посмотреть поездку'],
    ] as const).forEach(([role, title, view]) => {
      review(role);
      expect(h1()).toBe(title);
      expect(inScreen().getByRole('button', { name: view })).not.toBeNull();
    });
  });

  it('starts a driver from the approved «Проверьте поездку» with future dates', () => {
    render(<CopyReviewPage />);
    openSample('50 · Старт: заполненная просьба');
    review('Регулярная поездка водителя');
    expect(h1()).toBe('Проверьте поездку');
    expect(text()).toContain('С 1 ноября по 27 декабря');
    expect(text()).not.toContain('августа');
  });

  /* ------------------------------------------------- decision 92 cannot be bypassed (1.18 (105)) */

  it('does not let the SMS code publish past decision 92', () => {
    render(<CopyReviewPage />);
    walkToCode();
    review('Оба выключены');

    // The code is no longer the last missing condition: the label does not promise publication.
    expect(buttons()).toContain('Подтвердить');
    expect(buttons()).not.toContain('Подтвердить и опубликовать');
    press('Подтвердить');
    notPublished();
    expect(h1()).toBe('Последние детали');
    expect(productScreen().querySelector('[data-notification-step]')).not.toBeNull();
    // Nothing changed silently: the person picks a channel, and only the labelled press publishes.
    expect(within(productScreen().querySelector('[data-notify-choice]') as HTMLElement).getAllByRole('radio').length).toBe(2);
    press('Включить уведомления и опубликовать');
    expect(h1()).toBe('Просьба опубликована');
    expect(resultBody()).toMatch(/^Уведомления по email включены\. /);
  });

  it('does not let a sign-in link publish past decision 92', () => {
    render(<CopyReviewPage />);
    openSample('58 · Вход в аккаунт');
    review('Оба выключены');
    type('Email', 'maria.k@example.com');
    press('Получить ссылку для входа');
    review('Открыть ссылку из письма');

    expect(h1()).toBe('Вход в аккаунт');
    expect(buttons()).toContain('Войти');
    expect(buttons()).not.toContain('Войти и опубликовать');
    press('Войти');
    notPublished();
    expect(productScreen().querySelector('[data-notification-step]')).not.toBeNull();
  });

  it('publishes on a sign-in link only through «Войти и опубликовать» when nothing else is missing', () => {
    render(<CopyReviewPage />);
    openSample('58 · Вход в аккаунт');
    expect(text()).toContain('Мы пришлём ссылку для входа на ваш email.');
    type('Email', 'maria.k@example.com');
    press('Получить ссылку для входа');
    expect(productScreen().querySelector('[data-email-sent-body]')?.textContent)
      .toBe('Если с адресом maria.k@example.com есть аккаунт, мы отправили на него ссылку для входа.');
    review('Открыть ссылку из письма');
    notPublished();
    press('Войти и опубликовать');
    expect(h1()).toBe('Просьба опубликована');
    expect(resultBody()).toMatch(/^Вы вошли\. /);
  });

  it('does not let an existing account or the recovery publish past decision 92', () => {
    render(<CopyReviewPage />);
    openSample('63 · Email уже есть в аккаунте');
    review('Оба выключены');
    press('Войти');
    notPublished();
    expect(productScreen().querySelector('[data-notification-step]')).not.toBeNull();

    openSample('59 · Нет доступа к почте');
    review('Оба выключены');
    type(/^Телефон/, '39 345 678 45 67');
    press('Получить код');
    review('Ввести код из SMS');
    press('Подтвердить');
    type('Email', 'maria.new@example.com');
    press('Получить ссылку');
    review('Открыть ссылку из письма');
    expect(h1()).toBe('Подтвердите новый email');
    expect(buttons()).toContain('Подтвердить email');
    press('Подтвердить email');
    notPublished();
    expect(productScreen().querySelector('[data-notification-step]')).not.toBeNull();
  });

  it('does not let the other device publish past decision 92, and never twice', () => {
    render(<CopyReviewPage />);
    openSample('60 · Ссылка на другом устройстве');
    review('Оба выключены');
    review('На телефоне: подтвердить email, телефон и опубликовать');
    expect(reviewNote()).toContain('остановилась на шаге «Включите уведомления»');
    expect(authScreen()).toBe('email-sent');
    notPublished();

    review('Email включён');
    review('На телефоне: подтвердить email, телефон и опубликовать');
    expect(authScreen()).toBe('already-published');
  });

  it('offers the browser only where it can work, and email always', () => {
    render(<CopyReviewPage />);
    ([
      ['Запрещены', 'Уведомления запрещены в браузере'],
      ['Не поддерживаются', 'Этот браузер не поддерживает уведомления.'],
      ['Нужна установка', 'В этом браузере уведомления появятся только после установки приложения.'],
    ] as const).forEach(([variant, reason]) => {
      openSample('57 · Опубликовано');
      openSample('61 · Уведомления выключены');
      press('Опубликовать');
      review(variant);
      const [email, push] = within(productScreen().querySelector('[data-notify-choice]') as HTMLElement).getAllByRole('radio') as HTMLInputElement[];
      expect(email.checked).toBe(true);
      expect(push.disabled).toBe(true);
      expect(productScreen().querySelector('[data-push-reason]')?.textContent).toBe(reason);
    });

    openSample('57 · Опубликовано');
    openSample('61 · Уведомления выключены');
    press('Опубликовать');
    expect(text()).toContain('Без них вы не узнаете, что водитель предложил подвезти.');
    fireEvent.click(inScreen().getByRole('radio', { name: 'Уведомления в браузере' }));
    notPublished();
    press('Включить уведомления и опубликовать');
    expect(resultBody()).toMatch(/^Уведомления в браузере включены\. /);
  });

  /* ------------------------------------------------------------------ the edge states */

  it('stops on a date that passed, publishes nothing, and keeps every other answer', () => {
    render(<CopyReviewPage />);
    openSample('62 · Дата прошла во время проверок');

    review('Ввести код из SMS');
    expect(buttons()).toContain('Подтвердить');
    expect(buttons()).not.toContain('Подтвердить и опубликовать');
    press('Подтвердить');
    notPublished();
    expect(h1()).toBe('Последние детали');
    const step = productScreen().querySelector('[data-outdated-step]') as HTMLElement;
    expect(within(step).getByRole('heading', { level: 2, name: 'Дата поездки уже прошла' })).not.toBeNull();
    expect(text()).toContain('воскресенье, 18 октября, 9:00');
    expect(inScreen().queryByRole('button', { name: 'Опубликовать' })).toBeNull();

    press('Изменить дату');
    expect(productScreen().querySelector('[data-request-step]')?.getAttribute('data-request-step')).toBe('when');
    fireEvent.click(inScreen().getByRole('radio', { name: /Божественная литургия/ }));
    press('Далее');
    press('Далее');
    press('Далее');
    expect(text()).toContain('у входа в библиотеку');
    expect(text()).toContain('воскресенье, 1 ноября, 9:00');
    press('Опубликовать');
    expect(h1()).toBe('Просьба опубликована');
  });

  it('turns an existing email into a sign-in without revealing it on the check-email screen', () => {
    render(<CopyReviewPage />);
    openSample('52 · Проверьте почту');
    const sameScreen = productScreen().querySelector('[data-email-sent-body]')?.textContent;
    expect(sameScreen).toBe('Мы отправили ссылку на maria.k@example.com. Перейдите по ней, чтобы подтвердить email.');

    review('Открыть ссылку: этот email уже есть в аккаунте');
    expect(h1()).toBe('У вас уже есть аккаунт');
    expect(text()).toContain('Этот email уже привязан к аккаунту. Войдите в него — заполнять контакты заново не нужно.');
    expect(inScreen().queryByLabelText('Имя')).toBeNull();
    notPublished();
    press('Войти и опубликовать');
    expect(h1()).toBe('Просьба опубликована');
  });

  it('explains SMS unavailable during recovery without promising it and shows the real options', () => {
    render(<CopyReviewPage />);
    openSample('64 · Восстановление: SMS недоступно');

    expect(productScreen().querySelector('[data-recovery-blocked]')?.textContent).toBe('Не удалось отправить SMS на этот номер.');
    expect(productScreen().querySelector('[data-recovery-consequence]')?.textContent)
      .toBe('Без кода нельзя убедиться, что аккаунт ваш, поэтому сменить email сейчас нельзя. Попробуйте позже или укажите новые контакты — ваша просьба сохранена.');
    expect(buttons()).toEqual(expect.arrayContaining(['Попробовать ещё раз', 'Указать новые контакты', 'Написать нам']));
    expect(text()).not.toMatch(/восстановим|восстановление возможно/i);
    press('Написать нам');
    expect(reviewNote()).toContain('без подтверждения телефона нельзя');

    review('Код отправлен');
    press('Попробовать ещё раз');
    expect(h1()).toBe('Введите код из SMS');
  });

  /* ------------------------------------------------------------------ screen 60 */

  it('shows the computer a neutral notice, not a second success, and signs in without publishing', () => {
    render(<CopyReviewPage />);
    openSample('60 · Ссылка на другом устройстве');
    review('На телефоне: подтвердить email, телефон и опубликовать');

    expect(h1()).toBe('Просьба опубликована на другом устройстве');
    expect(resultBody()).toBe('Повторно публиковать её не нужно.');
    expect(productScreen().querySelector('[data-result-mark="notice"]')).not.toBeNull();
    expect(productScreen().querySelector('[data-result-mark="success"]')).toBeNull();
    expect(buttons()).not.toContain('Опубликовать');

    press('Войти, чтобы посмотреть просьбу');
    expect(h1()).toBe('Вход в аккаунт');
    type('Email', 'maria.k@example.com');
    press('Получить ссылку для входа');
    review('Открыть ссылку из письма');
    expect(buttons()).toContain('Войти');
    expect(buttons().some((label) => label.includes('опубликовать'))).toBe(false);
    press('Войти');
    expect(h1()).toBe('Вы вошли');
    notPublished();
  });

  /* ------------------------------------------------------------------ boundaries */

  it('marks every string of group 7 approved, with the publication messages among them', () => {
    render(<CopyReviewPage />);
    authSamples.forEach(([label]) => {
      openSample(label);
      sourceRows().forEach(([row, mark]) => expect(`${label} · ${row}: ${mark}`).not.toMatch(/: Проект$/));
    });
    openSample('57 · Опубликовано');
    const marks = Object.fromEntries(sourceRows());
    successTitles.forEach((title) => expect(`${title}: ${marks[title]}`).toBe(`${title}: Утверждено`));
    expect(screen.getByRole('complementary', { name: 'Источники формулировок на экране' }).textContent)
      .toContain('Группа утверждена владельцем 19 октября 2026 года');
  });

  it('keeps implementation words and review vocabulary out of the product screens', () => {
    render(<CopyReviewPage />);
    authSamples.forEach(([label]) => {
      openSample(label);
      ['localStorage', 'mock', 'черновик', 'сервер', 'токен', 'Проект', 'Утверждено', 'действие уже выполнено', 'Остался последний шаг']
        .forEach((forbidden) => expect(`${label}: ${text().toLowerCase().includes(forbidden.toLowerCase())}`).toBe(`${label}: false`));
    });
  });

  it('leaves the approved forms of groups 2B and 3 with their own dates and inert publish', () => {
    render(<CopyReviewPage />);
    openSample('14 · Последние детали: заполнено');
    expect(text()).toContain('23 августа');
    press('Опубликовать');
    expect(h1()).toBe('Последние детали');
    openSample('23 · Проверьте поездку: заполнено');
    press('Опубликовать');
    expect(h1()).toBe('Проверьте поездку');
  });

  it('records the decisions and the proposals in the documents', () => {
    const copy = readFileSync(resolve(process.cwd(), 'docs/ORTHODOX_ROUTES_UX_COPY_LOCALIZATION_V1.md'), 'utf8');
    const architecture = readFileSync(resolve(process.cwd(), 'docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md'), 'utf8');
    const scope = readFileSync(resolve(process.cwd(), 'docs/ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md'), 'utf8');

    [94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]
      .forEach((n) => expect(`${n}: ${copy.includes(`| ${n} | **`)}`).toBe(`${n}: true`));
    expect(copy).toContain('| `request.step.note.hint` | Не сообщайте домашний адрес, телефон, email и ссылки. |');
    const proposals = copy.slice(copy.indexOf('#### 4.10.1.'), copy.indexOf('### 4.11.'));
    ['Подтвердить и опубликовать', 'Включить уведомления и опубликовать', 'Подтвердить email и получить код',
      'Просьба опубликована на другом устройстве', 'Дата поездки уже прошла', 'У вас уже есть аккаунт']
      .forEach((needle) => expect(`${needle}: ${proposals.includes(needle)}`).toBe(`${needle}: true`));
    expect(proposals).toContain('Утверждено 19.10.2026');
    expect(proposals).not.toMatch(/\| Проект \|/);
    expect(proposals).not.toContain('`auth.email.notify_hint`');
    expect(copy).toContain('| `request.published` | Просьба опубликована | Утверждено 19.10.2026 (группа 7) |');
    expect(copy).toContain('| `offer.published.recurring` | Регулярная поездка опубликована | Утверждено 19.10.2026 (группа 7) |');
    // The deferred reviews outside group 7 stay open.
    expect(copy).toContain('| Приглашение администратора | Вас приглашают управлять страницей храма «{church}» | Приглашение управлять страницей храма |');
    expect(copy).not.toMatch(/Нашлось подходящее объявление на \{date\} \| [^|]*Утверждено/);
    expect(architecture).toContain('**Уточнение 19 октября 2026 года**');
    expect(scope).toContain('**Уточнение 19 октября 2026 года**');
    // Decision 109 in both approved documents.
    [architecture, scope].forEach((doc) => expect(doc).toContain('функциональные уведомления о поездках по email **включены по умолчанию**'));
  });

  it('touches no production file and contacts no service', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/copy-review/copy-review.tsx'), 'utf8');
    ['fetch(', 'supabase', 'XMLHttpRequest', 'navigator.serviceWorker', 'Notification.requestPermission', 'localStorage', 'sessionStorage']
      .forEach((needle) => expect(`${needle}: ${source.includes(needle)}`).toBe(`${needle}: false`));

    const groupStrings = [
      'Подтвердить и опубликовать',
      'Подтвердить email и получить код',
      'Включить уведомления и опубликовать',
      'Дата поездки уже прошла',
      'У вас уже есть аккаунт',
      'опубликована на другом устройстве',
      'Не сообщайте домашний адрес, телефон, email и ссылки.',
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
      groupStrings.forEach((needle) => expect(`${file}: ${content.includes(needle)}`).toBe(`${file}: false`));
    });
  });
});
