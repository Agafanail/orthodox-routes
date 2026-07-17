import Link from 'next/link';
import type { TargetedRequestDialogInput } from '@/components/church-transport-board/types';
import { formatDateTime } from '@/lib/dateFormat';
import type { Church, DriverPublicProfile, Route, Trip } from '@/lib/types';

const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function getDriverName(drivers: DriverPublicProfile[], driverId: string) {
  return drivers.find((driver) => driver.id === driverId)?.publicName ?? 'Водитель';
}

function DriverCardContent({ driver }: { driver: DriverPublicProfile }) {
  return (
    <div className="flex items-center gap-3">
      {driver.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="h-12 w-12 rounded-full object-cover" src={driver.photoUrl} />
      ) : (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-800 font-bold text-white">
          {driver.publicName.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="font-semibold">{driver.publicName}</p>
        <p className="text-sm text-stone-600">{driver.departureArea}</p>
      </div>
    </div>
  );
}

export function DriverOffers({
  church,
  drivers,
  routes,
  trips,
  localDriverId,
  ownedRouteIds,
  ownedTripIds,
  onRequestRide,
  onCancelRoute,
  onCancelTrip,
}: {
  church: Church;
  drivers: DriverPublicProfile[];
  routes: Route[];
  trips: Trip[];
  localDriverId?: string;
  ownedRouteIds: string[];
  ownedTripIds: string[];
  onRequestRide: (context: TargetedRequestDialogInput) => void;
  onCancelRoute: (route: Route) => void;
  onCancelTrip: (trip: Trip) => void;
}) {
  return (
    <section className="grid gap-5 lg:grid-cols-3">
      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Видимые водители</h2>
        <div className="mt-4 grid gap-3">
          {drivers.map((driver) => (
            localDriverId === driver.id ? (
              <article className="rounded-lg bg-stone-100 p-4" key={driver.id}>
                <DriverCardContent driver={driver} />
              </article>
            ) : (
              <Link className="rounded-lg bg-stone-100 p-4" href={`/drivers/${driver.id}`} key={driver.id}>
                <DriverCardContent driver={driver} />
              </Link>
            )
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Кто едет регулярно</h2>
        <div className="mt-4 grid gap-3">
          {routes.map((route) => {
            const driverName = getDriverName(drivers, route.driverId);
            const offerContext = `Регулярный маршрут: ${route.originLabel} → ${church.name}, ${route.recurrence.daysOfWeek
              .map((day) => dayNames[day])
              .join(', ')} в ${route.recurrence.typicalDepartureTime}`;

            return (
              <article className="rounded-lg bg-stone-100 p-4" key={route.id}>
                <h3 className="font-semibold">
                  {route.originLabel} → {church.name}
                </h3>
                <p className="mt-2 text-sm text-stone-700">
                  {route.recurrence.daysOfWeek.map((day) => dayNames[day]).join(', ')} в{' '}
                  {route.recurrence.typicalDepartureTime}; мест: {route.seats}
                </p>
                <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                <div className="mt-4 grid gap-2">
                  <button
                    className="w-full rounded-lg bg-white px-4 py-3 font-semibold text-stone-950"
                    onClick={() =>
                      onRequestRide({
                        offerId: route.id,
                        offerType: 'regularRoute',
                        driverId: route.driverId,
                        driverName,
                        offerContext,
                      })
                    }
                    type="button"
                  >
                    Попросить подвезти
                  </button>
                  {ownedRouteIds.includes(route.id) ? (
                    <button
                      className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-700"
                      onClick={() => onCancelRoute(route)}
                      type="button"
                    >
                      Отменить маршрут
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Ближайшие поездки</h2>
        <div className="mt-4 grid gap-3">
          {trips.length > 0 ? (
            trips.map((trip) => {
              const driverName = getDriverName(drivers, trip.driverId);
              const dateTime = formatDateTime(trip.date, trip.departureTime);
              const offerContext = `Разовая поездка: ${dateTime}, выезд из ${trip.originLabel}`;

              return (
                <article className="rounded-lg bg-stone-100 p-4" key={trip.id}>
                  <h3 className="font-semibold">{dateTime}</h3>
                  <p className="mt-2 text-sm text-stone-700">
                    Выезд из {trip.originLabel}; свободных мест: {trip.seatsAvailable}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                  <div className="mt-4 grid gap-2">
                    <button
                      className="w-full rounded-lg bg-white px-4 py-3 font-semibold text-stone-950"
                      onClick={() =>
                        onRequestRide({
                          offerId: trip.id,
                          offerType: 'oneTimeTrip',
                          driverId: trip.driverId,
                          driverName,
                          offerContext,
                        })
                      }
                      type="button"
                    >
                      Попросить подвезти
                    </button>
                    {ownedTripIds.includes(trip.id) ? (
                      <button
                        className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-700"
                        onClick={() => onCancelTrip(trip)}
                        type="button"
                      >
                        Отменить поездку
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="rounded-lg bg-stone-100 p-4 text-sm text-stone-600">
              Нет доступных разовых поездок.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
