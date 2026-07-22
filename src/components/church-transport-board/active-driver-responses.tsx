import { formatDate } from '@/lib/dateFormat';
import { formatSeatCount } from '@/lib/russianCount';
import type { DriverResponse, PassengerRequest } from '@/lib/types';
import { getBoardCardId } from '@/components/church-transport-board/board-card';

export function ActiveDriverResponses({
  responses,
  passengerRequests,
  driverNames,
  onAcceptResponse,
  onCancelResponse,
  onDeclineResponse,
}: {
  responses: DriverResponse[];
  passengerRequests: PassengerRequest[];
  driverNames: Record<string, string>;
  onAcceptResponse: (response: DriverResponse) => void;
  onCancelResponse: (response: DriverResponse) => void;
  onDeclineResponse: (response: DriverResponse) => void;
}) {
  return responses.length > 0 ? (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
      <h2 className="text-xl font-bold">Ответы водителей</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Запрос остаётся открытым для других водителей, пока пассажир не примет одно из предложений.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {responses.map((response) => {
          const request = passengerRequests.find((item) => item.id === response.passengerRequestId);
          if (!request) return null;

          return (
            <article className="rounded-lg bg-white p-4" id={getBoardCardId(response.id)} key={response.id}>
              <h3 className="font-semibold">{driverNames[response.driverId] ?? 'Водитель'} предлагает подвезти</h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                {response.offeredPassengerCount} из {request.passengerCount} пассажиров · {formatDate(response.rideDate)}
              </p>
              {response.privateOffer ? (
                <p className="mt-1 text-sm leading-6 text-stone-700">
                  Выезд из {response.privateOffer.originLabel} в {response.privateOffer.departureTime}
                </p>
              ) : null}
              <p className="mt-3 text-xs font-semibold uppercase text-sky-800">Ожидает решения пассажира</p>
              <p className="mt-2 text-xs leading-5 text-stone-600">Контакты пока скрыты.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button className="rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white" onClick={() => onAcceptResponse(response)} type="button">
                  Принять {formatSeatCount(response.offeredPassengerCount)}
                </button>
                <button className="rounded-lg border border-stone-300 px-4 py-3 font-semibold" onClick={() => onDeclineResponse(response)} type="button">
                  Отклонить
                </button>
                <button className="rounded-lg border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-600 sm:col-span-2" onClick={() => onCancelResponse(response)} type="button">
                  Отменить предложение водителя
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  ) : null;
}
