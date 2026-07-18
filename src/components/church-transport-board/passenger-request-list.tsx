import { PassengerRequestCard } from '@/components/church-transport-board/passenger-request-card';
import type { PassengerRequest } from '@/lib/types';

export function PassengerRequestList({
  requests,
  onRespond,
}: {
  requests: PassengerRequest[];
  onRespond: (request: PassengerRequest) => void;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Кому нужно место</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Запросы пассажиров, которым нужно место в машине.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {requests.length > 0 ? (
          requests.map((request) => (
            <PassengerRequestCard key={request.id} onRespond={onRespond} request={request} />
          ))
        ) : (
          <p className="rounded-lg bg-stone-100 p-4 text-sm text-stone-600">Пока нет открытых запросов.</p>
        )}
      </div>
    </section>
  );
}
