import type { TargetedPassengerRequest } from '@/lib/types';

export function TargetedRequestPanel({ requests }: { requests: TargetedPassengerRequest[] }) {
  return requests.length > 0 ? (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <h2 className="text-xl font-bold">Мой запрос водителю</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Это личная mock-зона. Контакты пока не переданы: водитель еще не принял запрос.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {requests.map((request) => (
          <article className="rounded-lg bg-white p-4" key={request.id}>
            <h3 className="font-semibold">Водитель: {request.driverName}</h3>
            <p className="mt-2 text-sm leading-6 text-stone-700">{request.offerContext}</p>
            <dl className="mt-3 grid gap-2 text-sm text-stone-700">
              <div>
                <dt className="font-semibold">Пассажиры</dt>
                <dd>{request.passengerCount}</dd>
              </div>
              <div>
                <dt className="font-semibold">Точка встречи</dt>
                <dd>{request.pickupZone.label}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs font-semibold uppercase text-emerald-800">Ожидает ответа водителя</p>
          </article>
        ))}
      </div>
    </section>
  ) : null;
}
