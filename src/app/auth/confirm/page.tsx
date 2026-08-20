import type { Metadata } from 'next';
import Link from 'next/link';
import ConfirmationClient from './confirmation-client';
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
  const hasError = typeof params.error === 'string';

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" prefetch={false}>
          Православные маршруты
        </Link>
      </header>

      <ConfirmationClient hasServerError={hasError} />
    </main>
  );
}
