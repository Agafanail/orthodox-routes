import { formatDate } from '@/lib/dateFormat';
import type { PassengerRequest, RideMatch, TargetedPassengerRequest } from '@/lib/types';

export function RideMatchPanel({
  matches,
  passengerRequests,
  targetedRequests,
  directRepublishEnabled,
  alreadyRepublished,
  remainingActionsEnabled,
  onCancelMatch,
  onEditCancelled,
  onEditRemaining,
  onNoMoreSeatsNeeded,
  onRepublishCancelled,
  onRepublishRemaining,
}: {
  matches: RideMatch[];
  passengerRequests: PassengerRequest[];
  targetedRequests: TargetedPassengerRequest[];
  directRepublishEnabled: Record<string, boolean>;
  alreadyRepublished: Record<string, boolean>;
  remainingActionsEnabled: Record<string, boolean>;
  onCancelMatch: (match: RideMatch, participant: 'passenger' | 'driver') => void;
  onEditCancelled: (match: RideMatch) => void;
  onEditRemaining: (match: RideMatch) => void;
  onNoMoreSeatsNeeded: (match: RideMatch) => void;
  onRepublishCancelled: (match: RideMatch) => void;
  onRepublishRemaining: (match: RideMatch) => void;
}) {
  if (matches.length === 0) return null;

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
      <h2 className="text-xl font-bold">Мои договорённости</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">Контакты доступны только здесь, участникам подтверждённой поездки.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {matches.map((match) => {
          const source =
            passengerRequests.find((request) => request.id === match.passengerRequestId) ??
            targetedRequests.find((request) => request.id === match.targetedPassengerRequestId);
          const remainingCount = match.originalPassengerCount - match.confirmedPassengerCount;
          const cancelled = match.status === 'cancelled';

          return (
            <article className="rounded-lg bg-white p-4" key={match.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{match.passengerName} и {match.driverName}</h3>
                  <p className="mt-1 text-sm text-stone-700">{formatDate(match.rideDate)} · {match.confirmedPassengerCount} пасс.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cancelled ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                  {cancelled ? 'Отменено' : 'Подтверждено'}
                </span>
              </div>

              <div className="mt-4 grid gap-3 rounded-lg bg-stone-100 p-4 text-sm text-stone-700">
                <section>
                  <h4 className="font-semibold">Контакты пассажира</h4>
                  <p className="mt-2 break-all">{match.passengerContactPrivate.phone}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a className="rounded-lg bg-white px-3 py-2 font-semibold" href={`tel:${match.passengerContactPrivate.phone}`}>Позвонить</a>
                  </div>
                  {match.passengerContactPrivate.email ? (
                    <div className="mt-3">
                      <p className="break-all">{match.passengerContactPrivate.email}</p>
                      <a className="mt-2 inline-block rounded-lg bg-white px-3 py-2 font-semibold" href={`mailto:${match.passengerContactPrivate.email}`}>Написать по email</a>
                    </div>
                  ) : null}
                </section>
                <section>
                  <h4 className="font-semibold">Контакты водителя</h4>
                  <p className="mt-2 break-all">{match.driverContactPrivate.phone}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a className="rounded-lg bg-white px-3 py-2 font-semibold" href={`tel:${match.driverContactPrivate.phone}`}>Позвонить</a>
                  </div>
                  {match.driverContactPrivate.email ? (
                    <div className="mt-3">
                      <p className="break-all">{match.driverContactPrivate.email}</p>
                      <a className="mt-2 inline-block rounded-lg bg-white px-3 py-2 font-semibold" href={`mailto:${match.driverContactPrivate.email}`}>Написать по email</a>
                    </div>
                  ) : null}
                </section>
              </div>

              {!cancelled ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button className="rounded-lg border border-red-300 px-4 py-3 font-semibold text-red-800" onClick={() => onCancelMatch(match, 'passenger')} type="button">Отменить как пассажир</button>
                  <button className="rounded-lg border border-red-300 px-4 py-3 font-semibold text-red-800" onClick={() => onCancelMatch(match, 'driver')} type="button">Отменить как водитель</button>
                </div>
              ) : (
                <div className="mt-4 grid gap-2">
                  <button
                    className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
                    disabled={!directRepublishEnabled[match.id]}
                    onClick={() => onRepublishCancelled(match)}
                    type="button"
                  >
                    Опубликовать снова
                  </button>
                  {!directRepublishEnabled[match.id] ? (
                    <p className="text-xs leading-5 text-red-700">
                      {alreadyRepublished[match.id]
                        ? 'Запрос уже опубликован снова.'
                        : 'Время этой поездки уже прошло. Сначала выберите новую дату.'}
                    </p>
                  ) : null}
                  <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onEditCancelled(match)} type="button">Изменить и опубликовать</button>
                </div>
              )}

              {!cancelled && remainingCount > 0 && remainingActionsEnabled[match.id] ? (
                <div className="mt-4 grid gap-2 border-t border-stone-200 pt-4">
                  <p className="text-sm leading-6 text-stone-700">Для остальных пассажиров можно сразу создать новый запрос.</p>
                  <button className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white" onClick={() => onRepublishRemaining(match)} type="button">
                    Опубликовать запрос ещё для {remainingCount} человек
                  </button>
                  <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onEditRemaining(match)} type="button">Изменить запрос</button>
                  <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold text-stone-600" onClick={() => onNoMoreSeatsNeeded(match)} type="button">Больше места не нужно</button>
                </div>
              ) : null}

              {source ? <p className="mt-3 text-xs text-stone-500">{source.serviceEvent}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
