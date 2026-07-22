import { PassengerRequestCard } from '@/components/church-transport-board/passenger-request-card';
import type { PublicPassengerRequestItem } from '@/lib/rideMatchState';

export function PassengerRequestList({
  requests,
  onRespond,
}: {
  requests: PublicPassengerRequestItem[];
  onRespond: (requestId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Ищут место</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Запросы пассажиров, которым нужно место в машине.
      </p>
      <div className="mt-4 grid gap-3">
        {requests.length > 0 ? (
          requests.map((item) => (
            <PassengerRequestCard item={item} key={item.id} onRespond={onRespond} />
          ))
        ) : (
          <p className="rounded-lg bg-stone-100 p-4 text-sm text-stone-600">Пока нет открытых запросов.</p>
        )}
      </div>
    </section>
  );
}
