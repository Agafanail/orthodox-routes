import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { formatDateTime } from '@/lib/dateFormat';
import { getDriverById, getDriverRoutes, getDriverTrips, mockChurches, mockDrivers } from '@/lib/mockData';

type PageProps = {
  params: Promise<{ id: string }>;
};

const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function generateStaticParams() {
  return mockDrivers.map((driver) => ({ id: driver.id }));
}

export default async function DriverPage({ params }: PageProps) {
  await connection();
  const now = new Date();
  const { id } = await params;
  const driver = getDriverById(id);

  if (!driver) {
    notFound();
  }

  const churches = mockChurches.filter((church) => driver.visibleChurchIds.includes(church.id));
  const routes = getDriverRoutes(driver.id);
  const trips = getDriverTrips(driver.id, now);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-7 flex items-center justify-between">
        <Link className="font-bold" href="/drivers">
          Водители
        </Link>
        <Link className="text-sm font-semibold text-amber-800" href="/churches">
          Храмы
        </Link>
      </nav>

      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          {driver.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-20 w-20 rounded-full object-cover" src={driver.photoUrl} />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-full bg-amber-800 text-2xl font-bold text-white">
              {driver.publicName.slice(0, 1)}
            </span>
          )}
          <div>
            <h1 className="text-3xl font-bold text-stone-950">{driver.publicName}</h1>
            <p className="mt-1 text-stone-700">{driver.departureArea}</p>
          </div>
        </div>
        <p className="mt-5 rounded-lg bg-stone-100 p-4 text-sm leading-6 text-stone-700">
          Контакты водителя увидит только пассажир, с которым водитель договорится о поездке.
        </p>
      </section>

      <section className="mt-5 grid gap-5 md:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Храмы</h2>
          <div className="mt-4 grid gap-3">
            {churches.map((church) => (
              <Link
                className="rounded-lg bg-stone-100 p-4 font-semibold"
                href={`/churches/${church.slug}`}
                key={church.id}
              >
                {church.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Регулярные поездки</h2>
          <div className="mt-4 grid gap-3">
            {routes.map((route) => (
              <article className="rounded-lg bg-stone-100 p-4" key={route.id}>
                <h3 className="font-semibold">{route.originLabel}</h3>
                <p className="mt-2 text-sm text-stone-700">
                  {route.recurrence.daysOfWeek.map((day) => dayNames[day]).join(', ')} в{' '}
                  {route.recurrence.typicalDepartureTime}; мест: {route.seats}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Разовые поездки</h2>
          <div className="mt-4 grid gap-3">
            {trips.map((trip) => (
              <article className="rounded-lg bg-stone-100 p-4" key={trip.id}>
                <h3 className="font-semibold">{formatDateTime(trip.date, trip.departureTime)}</h3>
                <p className="mt-2 text-sm text-stone-700">
                  Выезд из {trip.originLabel}; свободных мест: {trip.seatsAvailable}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
