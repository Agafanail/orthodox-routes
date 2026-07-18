import Link from 'next/link';
import { connection } from 'next/server';
import { ChurchList } from '@/components/church-list';
import { mockChurches, mockDrivers, mockRoutes, mockTrips } from '@/lib/mockData';

export default async function ChurchesPage() {
  await connection();
  const now = new Date();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/">
          Православные маршруты
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/drivers">
          Водители
        </Link>
      </nav>

      <h1 className="text-3xl font-bold text-stone-950">Храмы</h1>
      <p className="mt-3 max-w-2xl leading-7 text-stone-700">
        Выберите храм, чтобы увидеть регулярные и разовые поездки, а также водителей, которые уже едут туда.
      </p>

      <ChurchList
        churches={mockChurches}
        drivers={mockDrivers}
        initialNow={now.toISOString()}
        routes={mockRoutes}
        trips={mockTrips}
      />
    </main>
  );
}
