import Link from 'next/link';
import { getChurchDrivers, getChurchRoutes, getChurchTrips, mockChurches } from '@/lib/mockData';

export default function ChurchesPage() {
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
        Выберите храм, чтобы увидеть маршруты, ближайшие поездки и водителей, которые уже едут туда.
      </p>

      <section className="mt-7 grid gap-4 md:grid-cols-2">
        {mockChurches.map((church) => {
          const driverCount = getChurchDrivers(church.id).length;
          const routeCount = getChurchRoutes(church.id).length;
          const tripCount = getChurchTrips(church.id).length;

          return (
            <Link
              className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-700"
              href={`/churches/${church.slug}`}
              key={church.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{church.name}</h2>
                  <p className="mt-2 text-sm text-stone-600">{church.address}</p>
                </div>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                  {church.status}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-600">{church.jurisdiction}</p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                <span className="rounded-lg bg-stone-100 p-3">{driverCount} вод.</span>
                <span className="rounded-lg bg-stone-100 p-3">{routeCount} марш.</span>
                <span className="rounded-lg bg-stone-100 p-3">{tripCount} поезд.</span>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
