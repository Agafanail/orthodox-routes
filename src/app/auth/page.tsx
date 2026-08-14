import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveVerifiedAuthIdentity } from '@/lib/auth/flow';
import { getPublicSupabaseConfig } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requestEmailLinkAction, signOutAction } from './actions';
import { EmailEntry } from './email-entry';
import styles from './auth.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Войти — Православные маршруты',
  robots: { follow: false, index: false },
};

type AuthPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errors: Record<string, string> = {
  'sign-out-failed': 'Не удалось выйти. Обновите страницу и попробуйте ещё раз.',
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : null;
  const error = typeof params.error === 'string' ? errors[params.error] : null;
  const configured = getPublicSupabaseConfig() !== null;
  const supabase = await createServerSupabaseClient();
  const identity = await resolveVerifiedAuthIdentity(supabase?.auth ?? null);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          Православные маршруты
        </Link>
        <Link className={styles.quietLink} href="/churches">
          Храмы
        </Link>
      </header>

      <section className={styles.panel}>
        {identity ? (
          <>
            <p className={styles.eyebrow}>Вход выполнен</p>
            <h1 className={styles.title}>Вы вошли</h1>
            {identity.email ? (
              <dl className={styles.identity}>
                <div>
                  <dt>Email</dt>
                  <dd>{identity.email}</dd>
                </div>
              </dl>
            ) : null}
            <p className={styles.secondaryText}>
              Публикация поездок пока недоступна: для неё понадобятся отдельные шаги проверки.
            </p>
            <Link className={styles.primaryLink} href="/">
              Перейти на главную
            </Link>
            <form action={signOutAction} className={styles.form}>
              <button className={styles.secondaryButton} type="submit">
                Выйти на этом устройстве
              </button>
            </form>
          </>
        ) : (
          <EmailEntry
            configured={configured}
            initialError={error}
            requestAction={requestEmailLinkAction}
            signedOut={status === 'signed-out'}
          />
        )}
      </section>
    </main>
  );
}
