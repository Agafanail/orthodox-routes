import Link from 'next/link';
import { connection } from 'next/server';
import { getDriverRoutes, getDriverTrips, mockChurches, mockDrivers } from '@/lib/mockData';

function churchNames(ids: string[]) {
  return ids
    .map((id) => mockChurches.find((church) => church.id === id)?.name)
    .filter(Boolean)
    .join(', ');
}

export default async function DriversPage() {
  await connection();
  const now = new Date();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/">
          Православные маршруты
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/churches">
          Храмы
        </Link>
      </nav>

      <h1 className="text-3xl font-bold text-stone-950">Водители</h1>
      <p className="mt-3 max-w-2xl leading-7 text-stone-700">
        Здесь можно увидеть имя водителя, откуда он едет, выбранные храмы и поездки. Телефон и WhatsApp не показываются.
      </p>

      <section className="mt-7 grid gap-4 md:grid-cols-2">
        {mockDrivers.map((driver) => {
          const routes = getDriverRoutes(driver.id);
          const trips = getDriverTrips(driver.id, now);

          return (
            <Link
              className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-700"
              href={`/drivers/${driver.id}`}
              key={driver.id}
            >
              <div className="flex items-center gap-4">
                {driver.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="h-14 w-14 rounded-full object-cover" src={driver.photoUrl} />
                ) : (
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-amber-800 font-bold text-white">
                    {driver.publicName.slice(0, 1)}
                  </span>
                )}
                <div>
                  <h2 className="text-xl font-bold">{driver.publicName}</h2>
                  <p className="text-sm text-stone-600">{driver.departureArea}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-700">Храмы: {churchNames(driver.visibleChurchIds)}</p>
              <p className="mt-2 text-sm text-stone-600">
                Регулярных поездок: {routes.length}; разовых поездок: {trips.length}
              </p>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
