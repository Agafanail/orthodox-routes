import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChurchBySlug,
  getChurchDrivers,
  getChurchRoutes,
  getChurchTrips,
  getDriverById,
  mockChurches,
} from '@/lib/mockData';

type PageProps = {
  params: Promise<{ slug: string }>;
};

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function generateStaticParams() {
  return mockChurches.map((church) => ({ slug: church.slug }));
}

export default async function ChurchPage({ params }: PageProps) {
  const { slug } = await params;
  const church = getChurchBySlug(slug);

  if (!church) {
    notFound();
  }

  const drivers = getChurchDrivers(church.id);
  const routes = getChurchRoutes(church.id);
  const trips = getChurchTrips(church.id);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/churches">
          Храмы
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/drivers">
          Водители
        </Link>
      </nav>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">Как мне попасть в храм?</p>
        <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_280px]">
          <div>
            <h1 className="text-3xl font-bold text-stone-950">{church.name}</h1>
            <p className="mt-3 leading-7 text-stone-700">{church.jurisdiction}</p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-stone-100 p-4">
                <dt className="font-semibold">Языки</dt>
                <dd className="mt-1 text-stone-700">{church.languages.join(', ')}</dd>
              </div>
              <div className="rounded-lg bg-stone-100 p-4">
                <dt className="font-semibold">Адрес</dt>
                <dd className="mt-1 text-stone-700">{church.address}</dd>
              </div>
            </dl>
          </div>
          <div className="grid content-start gap-3">
            <button className="rounded-lg bg-stone-950 px-5 py-4 font-semibold text-white">Мне нужно место</button>
            <button className="rounded-lg border border-stone-300 px-5 py-4 font-semibold">Могу подвезти</button>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Расписание</h2>
        <p className="mt-3 leading-7 text-stone-700">{church.schedule?.regular ?? 'Расписание пока не указано.'}</p>
        {church.schedule?.exceptions ? <p className="mt-2 text-sm text-stone-600">{church.schedule.exceptions}</p> : null}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Видимые водители</h2>
          <div className="mt-4 grid gap-3">
            {drivers.map((driver) => (
              <Link className="rounded-lg bg-stone-100 p-4" href={`/drivers/${driver.id}`} key={driver.id}>
                <div className="flex items-center gap-3">
                  {driver.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt="" className="h-12 w-12 rounded-full object-cover" src={driver.photoUrl} />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-800 font-bold text-white">
                      {driver.publicName.slice(0, 1)}
                    </span>
                  )}
                  <div>
                    <p className="font-semibold">{driver.publicName}</p>
                    <p className="text-sm text-stone-600">{driver.departureArea}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Регулярные маршруты</h2>
          <div className="mt-4 grid gap-3">
            {routes.map((route) => {
              const driver = getDriverById(route.driverId);
              return (
                <article className="rounded-lg bg-stone-100 p-4" key={route.id}>
                  <h3 className="font-semibold">
                    {route.originLabel} -&gt; {church.name}
                  </h3>
                  <p className="mt-2 text-sm text-stone-700">
                    {route.recurrence.daysOfWeek.map((day) => dayNames[day]).join(', ')} at{' '}
                    {route.recurrence.typicalDepartureTime}; seats: {route.seats}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driver?.publicName ?? 'Не указан'}</p>
                </article>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Ближайшие поездки</h2>
          <div className="mt-4 grid gap-3">
            {trips.map((trip) => {
              const driver = getDriverById(trip.driverId);
              return (
                <article className="rounded-lg bg-stone-100 p-4" key={trip.id}>
                  <h3 className="font-semibold">
                    {trip.date} at {trip.departureTime}
                  </h3>
                  <p className="mt-2 text-sm text-stone-700">
                    From {trip.originLabel}; available seats: {trip.seatsAvailable}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driver?.publicName ?? 'Не указан'}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
