import type { Metadata } from 'next';
import Link from 'next/link';
import { isValidEmailTokenHash } from '@/lib/auth/flow';
import { confirmEmailAction } from '../actions';
import styles from '../auth.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Подтвердить вход — Православные маршруты',
  robots: { follow: false, index: false },
};

type ConfirmationPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : null;
  const type = typeof params.type === 'string' ? params.type : null;
  const hasError = typeof params.error === 'string';
  const validInput = type === 'email' && isValidEmailTokenHash(tokenHash);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" prefetch={false}>
          Православные маршруты
        </Link>
      </header>

      <section className={styles.panel}>
        <p className={styles.eyebrow}>Вход</p>

        {validInput && !hasError ? (
          <>
            <h1 className={styles.title}>Подтвердить вход</h1>
            <p className={styles.lead}>Чтобы завершить вход, нажмите кнопку ниже.</p>
            <form action={confirmEmailAction} className={styles.form}>
              <input name="token_hash" type="hidden" value={tokenHash ?? ''} />
              <input name="type" type="hidden" value="email" />
              <button className={styles.primaryButton} type="submit">
                Войти
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Не удалось войти</h1>
            <p aria-live="assertive" className={styles.error} role="alert">
              Ссылка могла устареть или уже быть использована.
            </p>
            <Link className={styles.primaryLink} href="/auth" prefetch={false}>
              Получить новую ссылку
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
