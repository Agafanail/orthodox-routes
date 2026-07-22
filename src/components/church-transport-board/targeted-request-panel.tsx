import { useState } from 'react';
import { getBoardCardId } from '@/components/church-transport-board/board-card';
import { formatDate } from '@/lib/dateFormat';
import { formatSeatCount } from '@/lib/russianCount';
import type { TargetedPassengerRequest } from '@/lib/types';

export function TargetedRequestPanel({
  requests,
  availabilityByRequestId,
  onAcceptFull,
  onAcceptPartial,
  onDecline,
  onOfferPartial,
}: {
  requests: TargetedPassengerRequest[];
  availabilityByRequestId: Record<string, number>;
  onAcceptFull: (request: TargetedPassengerRequest) => void;
  onAcceptPartial: (request: TargetedPassengerRequest) => void;
  onDecline: (request: TargetedPassengerRequest) => void;
  onOfferPartial: (request: TargetedPassengerRequest, count: number) => void;
}) {
  const [partialCounts, setPartialCounts] = useState<Record<string, number>>({});

  return requests.length > 0 ? (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <h2 className="text-xl font-bold">Мой запрос водителю</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">Контакты откроются только после окончательного принятия.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {requests.map((request) => {
          const availability = availabilityByRequestId[request.id] ?? 0;
          const maxPartial = Math.min(availability, request.passengerCount - 1);
          const partialCount = Math.min(partialCounts[request.id] ?? Math.max(1, maxPartial), Math.max(1, maxPartial));

          return (
            <article className="rounded-lg bg-white p-4" id={getBoardCardId(request.id)} key={request.id}>
              <h3 className="font-semibold">Водитель: {request.driverName}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">{request.offerContext}</p>
              <p className="mt-1 text-sm text-stone-700">Дата: {request.rideDate ? formatDate(request.rideDate) : 'нужно выбрать заново'}</p>
              <p className="mt-1 text-sm text-stone-700">Пассажиры: {request.passengerCount}; сейчас свободно: {availability}</p>

              {request.status === 'waitingForDriver' ? (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase text-emerald-800">Ожидает ответа водителя</p>
                  <div className="mt-4 grid gap-2">
                    <button
                      className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
                      disabled={availability < request.passengerCount}
                      onClick={() => onAcceptFull(request)}
                      type="button"
                    >
                      Принять {formatSeatCount(request.passengerCount)}
                    </button>
                    {maxPartial > 0 ? (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <label className="grid gap-1 text-sm font-semibold">
                          Предложить меньше мест
                          <input
                            className="min-w-0 rounded-lg border border-stone-300 px-3 py-3 font-normal"
                            max={maxPartial}
                            min="1"
                            onChange={(event) => setPartialCounts((current) => ({ ...current, [request.id]: Number(event.target.value) }))}
                            type="number"
                            value={partialCount}
                          />
                        </label>
                        <button className="self-end rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onOfferPartial(request, partialCount)} type="button">Предложить</button>
                      </div>
                    ) : null}
                    <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onDecline(request)} type="button">Отклонить</button>
                  </div>
                </>
              ) : request.status === 'pendingPassengerConfirmation' && request.offeredPassengerCount ? (
                <>
                  <p className="mt-3 font-semibold leading-6 text-stone-800">
                    {request.driverName} может подвезти {request.offeredPassengerCount} из {request.passengerCount} человек.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white" onClick={() => onAcceptPartial(request)} type="button">
                      Принять {formatSeatCount(request.offeredPassengerCount)}
                    </button>
                    <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onDecline(request)} type="button">Отклонить</button>
                  </div>
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  ) : null;
}
