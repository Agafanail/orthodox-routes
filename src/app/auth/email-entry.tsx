'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { EmailLinkActionState } from './state';
import styles from './auth.module.css';

type RequestEmailLinkAction = (
  previousState: EmailLinkActionState,
  formData: FormData,
) => Promise<EmailLinkActionState>;

type EmailEntryProps = {
  configured: boolean;
  contextual: boolean;
  initialError: string | null;
  requestAction: RequestEmailLinkAction;
  signedOut: boolean;
};

const initialState: EmailLinkActionState = { status: 'idle' };

const errors: Partial<Record<EmailLinkActionState['status'], string>> = {
  'draft-unavailable': 'Не удалось продолжить начатое действие. Заполните форму ещё раз.',
  'invalid-email': 'Введите email в формате name@example.org.',
  unavailable: 'Вход сейчас недоступен. Попробуйте позже.',
};

export function EmailEntry({
  configured,
  contextual,
  initialError,
  requestAction,
  signedOut,
}: EmailEntryProps) {
  const [state, formAction, pending] = useActionState(requestAction, initialState);
  const [dismissedState, setDismissedState] = useState<EmailLinkActionState | null>(null);
  const standalone =
    (state.status === 'sent' || state.status === 'rate-limited' || state.status === 'send-failed') &&
    state !== dismissedState;
  const stateHeadingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (standalone) stateHeadingRef.current?.focus();
    else if (
      state.status === 'sent' ||
      state.status === 'rate-limited' ||
      state.status === 'send-failed'
    ) {
      emailInputRef.current?.focus();
    }
  }, [standalone, state]);

  if (standalone) {
    const sent = state.status === 'sent';
    const rateLimited = state.status === 'rate-limited';

    return (
      <>
        <p className={styles.eyebrow}>{sent || rateLimited ? 'Письмо отправлено' : 'Вход'}</p>
        <h1 className={styles.title} ref={stateHeadingRef} tabIndex={-1}>
          {sent
            ? 'Проверьте почту'
            : rateLimited
              ? 'Ссылка уже отправлена'
              : 'Не удалось отправить ссылку'}
        </h1>
        {sent ? (
          <p aria-live="polite" className={styles.lead} role="status">
            Мы отправили ссылку для входа на {state.email}. Откройте письмо и перейдите по ссылке.
          </p>
        ) : rateLimited ? (
          <p aria-live="polite" className={styles.lead} role="status">
            Мы недавно отправили ссылку на этот email. Проверьте почту или попробуйте отправить её ещё
            раз через минуту.
          </p>
        ) : (
          <p aria-live="assertive" className={styles.error} role="alert">
            Попробуйте ещё раз позже.
          </p>
        )}
        <button
          className={`${styles.secondaryButton} ${styles.standaloneAction}`}
          onClick={() => setDismissedState(state)}
          type="button"
        >
          Указать другой email
        </button>
      </>
    );
  }

  const actionError = state.status in errors ? errors[state.status] : null;

  return (
    <>
      <p className={styles.eyebrow}>{contextual ? 'Продолжить действие' : 'Без пароля'}</p>
      <h1 className={styles.title}>{contextual ? 'Сначала подтвердите email' : 'Войти'}</h1>
      <p className={styles.lead}>
        {contextual
          ? 'Мы сохранили введённые данные. Укажите email, чтобы вернуться к проверке перед отправкой.'
          : 'Укажите email. Мы отправим одноразовую ссылку, а вход вы подтвердите отдельной кнопкой.'}
      </p>

      {signedOut ? (
        <p aria-live="polite" className={styles.notice} role="status">
          Вы вышли на этом устройстве.
        </p>
      ) : null}
      {initialError || actionError ? (
        <p aria-live="assertive" className={styles.error} role="alert">
          {initialError ?? actionError}
        </p>
      ) : null}
      {!configured && !initialError && !actionError ? (
        <p className={styles.error} role="alert">
          Вход сейчас недоступен. Попробуйте позже.
        </p>
      ) : null}

      <form action={formAction} className={styles.form}>
        {contextual ? <input name="context" type="hidden" value="contextual" /> : null}
        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input
            aria-describedby={!configured ? 'auth-unavailable' : undefined}
            autoComplete="email"
            disabled={!configured || pending}
            id="email"
            inputMode="email"
            maxLength={254}
            name="email"
            ref={emailInputRef}
            required
            type="email"
          />
        </div>
        {!configured ? (
          <p className={styles.fieldHint} id="auth-unavailable">
            Повторите попытку, когда вход снова будет доступен.
          </p>
        ) : null}
        <button className={styles.primaryButton} disabled={!configured || pending} type="submit">
          Получить ссылку для входа
        </button>
      </form>
    </>
  );
}
