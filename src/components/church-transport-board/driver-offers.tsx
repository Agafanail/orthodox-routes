import { CompletedActivity } from '@/components/church-transport-board/completed-activity';
import type { TargetedRequestDialogInput } from '@/components/church-transport-board/types';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { getMaxDetourCopy } from '@/lib/driverOfferState';
import type { CompletedActivitySummary } from '@/lib/rideMatchState';
import { formatAvailableOfTotal, formatSeatCount } from '@/lib/russianCount';
import type { Church, DriverPublicProfile, Route, Trip } from '@/lib/types';

const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function getDriverName(drivers: DriverPublicProfile[], driverId: string) {
  return drivers.find((driver) => driver.id === driverId)?.publicName ?? 'Водитель';
}

export function DriverOffers({
  church,
  drivers,
  routes,
  trips,
  completedOffers,
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
  completedOffers: CompletedActivitySummary[];
  ownedRouteIds: string[];
  ownedTripIds: string[];
  onRequestRide: (context: TargetedRequestDialogInput) => void;
  onCancelRoute: (route: Route) => void;
  onCancelTrip: (trip: Trip) => void;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Предлагают поездки</h2>

      <div className="mt-5 grid gap-6">
        <section aria-labelledby="regular-rides-heading">
          <h3 className="text-lg font-bold" id="regular-rides-heading">Регулярные поездки</h3>
          <div className="mt-3 grid gap-3">
            {routes.map((route) => {
              const driverName = getDriverName(drivers, route.driverId);
              const offerContext = `Регулярная поездка: ${route.originLabel} → ${church.name}, ${route.recurrence.daysOfWeek
                .map((day) => dayNames[day])
                .join(', ')} в ${route.recurrence.typicalDepartureTime}`;

              return (
                <article className="rounded-lg bg-stone-100 p-4" key={route.id}>
                  <h4 className="font-semibold">
                    {route.originLabel} → {church.name}
                  </h4>
                  <p className="mt-2 text-sm text-stone-700">Выезжает из {route.originLabel}</p>
                  <p className="mt-1 text-sm text-stone-600">{getMaxDetourCopy(route.maxDetourKm)}</p>
                  <p className="mt-1 text-sm text-stone-600">
                    {route.recurrence.daysOfWeek.map((day) => dayNames[day]).join(', ')} в{' '}
                    {route.recurrence.typicalDepartureTime}; мест: {route.seats}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                  <p className="mt-3 text-sm leading-6 text-stone-700">Контакты откроются после подтверждения поездки.</p>
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
                          serviceEvent: 'Дата поездки будет выбрана в запросе',
                          departureTime: route.recurrence.typicalDepartureTime,
                          routeDaysOfWeek: route.recurrence.daysOfWeek,
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
                        Отменить поездку
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="one-time-rides-heading">
          <h3 className="text-lg font-bold" id="one-time-rides-heading">Разовые поездки</h3>
          <div className="mt-3 grid gap-3">
            {trips.length > 0 ? (
              trips.map((trip) => {
                const driverName = getDriverName(drivers, trip.driverId);
                const dateTime = formatDateTime(trip.date, trip.departureTime);
                const offerContext = `Разовая поездка: ${dateTime}, выезд из ${trip.originLabel}`;
                const service = church.schedule?.services?.find((item) => item.id === trip.serviceEventId);
                const serviceEvent = service
                  ? `${service.name}, ${formatDate(service.date)}`
                  : `Дата поездки: ${formatDate(trip.date)}`;
                const occupiedSeats = trip.seatsTotal - trip.seatsAvailable;
                const partiallyOccupied = occupiedSeats > 0;

                return (
                  <article className="rounded-lg bg-stone-100 p-4" key={trip.id}>
                    <h4 className="font-semibold">{dateTime}</h4>
                    <p className="mt-2 text-sm text-stone-700">Выезжает из {trip.originLabel}</p>
                    <p className="mt-1 text-sm text-stone-600">{getMaxDetourCopy(trip.maxDetourKm)}</p>
                    <p className={`mt-3 w-fit rounded-full px-3 py-1 text-xs font-semibold ${partiallyOccupied ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                      {partiallyOccupied ? 'Часть мест занята' : 'Есть свободные места'}
                    </p>
                    <p className="mt-2 text-sm text-stone-700">
                      {partiallyOccupied
                        ? formatAvailableOfTotal(trip.seatsAvailable, trip.seatsTotal)
                        : `Свободно ${formatSeatCount(trip.seatsAvailable)}`}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">Водитель: {driverName}</p>
                    <p className="mt-3 text-sm leading-6 text-stone-700">Контакты откроются после подтверждения поездки.</p>
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
                            rideDate: trip.date,
                            serviceEvent,
                            serviceEventId: trip.serviceEventId,
                            departureTime: trip.departureTime,
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
        </section>

        <CompletedActivity summaries={completedOffers} />
      </div>
    </section>
  );
}
