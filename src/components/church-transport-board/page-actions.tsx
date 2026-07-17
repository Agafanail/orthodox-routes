export function PageActions({
  onCreateRequest,
  onCreateOffer,
}: {
  onCreateRequest: () => void;
  onCreateOffer: () => void;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Действия на странице храма</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          className="rounded-lg bg-stone-950 px-5 py-4 font-semibold text-white"
          onClick={onCreateRequest}
          type="button"
        >
          Создать запрос
        </button>
        <button
          className="rounded-lg border border-stone-300 px-5 py-4 font-semibold"
          onClick={onCreateOffer}
          type="button"
        >
          Создать поездку / маршрут
        </button>
      </div>
    </div>
  );
}
