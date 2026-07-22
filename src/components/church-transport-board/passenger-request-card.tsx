import type { PublicPassengerRequestItem } from '@/lib/rideMatchState';
import { getBoardCardId } from '@/components/church-transport-board/board-card';

export function PassengerRequestCard({
  item,
  onRespond,
}: {
  item: PublicPassengerRequestItem;
  onRespond: (requestId: string) => void;
}) {
  return (
    <article className="rounded-lg bg-stone-100 p-4" id={getBoardCardId(item.id)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{item.firstName}</h3>
          <p className={`mt-1 text-sm ${item.partial ? 'font-semibold text-amber-900' : 'text-stone-700'}`}>
            {item.countLabel}
          </p>
          <p className="mt-1 text-sm text-stone-700">Район посадки: {item.pickupArea}</p>
        </div>
        <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-stone-700">
          {item.serviceEvent}
        </span>
      </div>
      <p className={`mt-3 w-fit rounded-full px-3 py-1 text-xs font-semibold ${item.partial ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
        {item.statusLabel}
      </p>
      {item.safePublicComment ? (
        <p className="mt-3 text-sm leading-6 text-stone-700">{item.safePublicComment}</p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-stone-600">Контакты откроются только после подтверждения поездки.</p>
      <button
        className="mt-4 w-full rounded-lg bg-stone-950 px-4 py-3 font-semibold text-white"
        onClick={() => onRespond(item.id)}
        type="button"
      >
        Подвезти
      </button>
    </article>
  );
}
