export function PageActions({
  onCreateRequest,
  onCreateOffer,
}: {
  onCreateRequest: () => void;
  onCreateOffer: () => void;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col rounded-lg bg-stone-100 p-4">
          <h2 className="text-xl font-bold">Я пассажир</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-stone-600">
            Укажите, откуда и к какой службе хотите поехать.
          </p>
          <button
            className="mt-4 rounded-lg bg-stone-950 px-5 py-4 font-semibold text-white"
            onClick={onCreateRequest}
            type="button"
          >
            Попросить подвезти
          </button>
        </section>
        <section className="flex flex-col rounded-lg border border-stone-200 p-4">
          <h2 className="text-xl font-bold">Я водитель</h2>
          <p className="mt-2 flex-1 text-sm leading-6 text-stone-600">
            Укажите, откуда и когда вы едете и сколько у вас свободных мест.
          </p>
          <button
            className="mt-4 rounded-lg border border-stone-300 bg-white px-5 py-4 font-semibold"
            onClick={onCreateOffer}
            type="button"
          >
            Предложить поездку
          </button>
        </section>
      </div>
    </div>
  );
}
