'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { confirmEmailAction } from '../actions';
import styles from '../auth.module.css';
import { parseConfirmationFragment, type ConfirmationState } from './confirmation-state';

type ConfirmationClientProps = {
  hasServerError: boolean;
};

const MISSING_FRAGMENT = 'missing';

export default function ConfirmationClient({ hasServerError }: ConfirmationClientProps) {
  const fragment = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('hashchange', onStoreChange);
      return () => window.removeEventListener('hashchange', onStoreChange);
    },
    () => window.location.hash || MISSING_FRAGMENT,
    () => '',
  );
  const confirmation: ConfirmationState | null | undefined = hasServerError
    ? null
    : fragment
      ? parseConfirmationFragment(fragment)
      : undefined;

  if (confirmation === undefined) {
    return (
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Вход</p>
        <h1 className={styles.title}>Проверяем ссылку</h1>
        <p className={styles.lead}>Подождите несколько секунд.</p>
      </section>
    );
  }

  if (!confirmation) {
    return (
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Вход</p>
        <h1 className={styles.title}>Не удалось войти</h1>
        <p aria-live="assertive" className={styles.error} role="alert">
          Ссылка могла устареть или уже быть использована.
        </p>
        <Link className={styles.primaryLink} href="/auth" prefetch={false}>
          Получить новую ссылку
        </Link>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <p className={styles.eyebrow}>Вход</p>
      <h1 className={styles.title}>
        {confirmation.contextual ? 'Подтвердить email и продолжить' : 'Подтвердить вход'}
      </h1>
      <p className={styles.lead}>
        {confirmation.contextual
          ? 'После подтверждения вы вернётесь к проверке сохранённых данных. Они не будут отправлены автоматически.'
          : 'Чтобы завершить вход, нажмите кнопку ниже.'}
      </p>
      <form action={confirmEmailAction} className={styles.form}>
        <input name="flow" type="hidden" value={confirmation.flow} />
        {confirmation.contextual ? <input name="draft" type="hidden" value={confirmation.draft ?? ''} /> : null}
        <input name="token_hash" type="hidden" value={confirmation.tokenHash} />
        <input name="type" type="hidden" value="email" />
        <button className={styles.primaryButton} type="submit">
          {confirmation.contextual ? 'Подтвердить и продолжить' : 'Войти'}
        </button>
      </form>
    </section>
  );
}
