import type { PassengerRequest } from '@/lib/types';

export function PassengerRequestCard({
  request,
  onRespond,
}: {
  request: PassengerRequest;
  onRespond: (request: PassengerRequest) => void;
}) {
  return (
    <article className="rounded-lg bg-stone-100 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{request.firstName}</h3>
          <p className="mt-1 text-sm text-stone-700">
            {request.passengerCount} пасс., {request.pickupZone.label}
          </p>
        </div>
        <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-700">
          {request.serviceEvent}
        </span>
      </div>
      {request.safePublicComment ? (
        <p className="mt-3 text-sm leading-6 text-stone-700">{request.safePublicComment}</p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-stone-600">Контакт скрыт публично и откроется только после отклика.</p>
      <button
        className="mt-4 w-full rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white"
        onClick={() => onRespond(request)}
        type="button"
      >
        Подвезти
      </button>
    </article>
  );
}
