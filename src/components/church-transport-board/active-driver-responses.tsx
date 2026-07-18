import type { DriverResponse, PassengerRequest } from '@/lib/types';

export function ActiveDriverResponses({
  responses,
  passengerRequests,
  onCancelResponse,
}: {
  responses: DriverResponse[];
  passengerRequests: PassengerRequest[];
  onCancelResponse: (response: DriverResponse) => void;
}) {
  return responses.length > 0 ? (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
      <h2 className="text-xl font-bold">Мой отклик</h2>
      <p className="mt-2 text-sm leading-6 text-stone-700">
        Контакт показан здесь после вашего отклика.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {responses.map((response) => {
          const request = passengerRequests.find((item) => item.id === response.passengerRequestId);

          if (!request) {
            return null;
          }

          return (
            <article className="rounded-lg bg-white p-4" key={response.id}>
              <h3 className="font-semibold">Отклик на запрос {request.firstName}</h3>
              <dl className="mt-3 grid gap-2 text-sm text-stone-700">
                <div>
                  <dt className="font-semibold">Телефон</dt>
                  <dd>{request.phonePrivate}</dd>
                </div>
                {request.emailPrivate ? (
                  <div>
                    <dt className="font-semibold">Email</dt>
                    <dd>{request.emailPrivate}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-semibold">Точка встречи</dt>
                  <dd>{request.pickupZone.label}</dd>
                </div>
              </dl>
              <button
                className="mt-4 rounded-lg border border-stone-300 px-4 py-3 font-semibold"
                onClick={() => onCancelResponse(response)}
                type="button"
              >
                Отменить отклик
              </button>
            </article>
          );
        })}
      </div>
    </section>
  ) : null;
}
