import type { CompletedActivitySummary } from '@/lib/rideMatchState';

export function CompletedActivity({ summaries }: { summaries: CompletedActivitySummary[] }) {
  return summaries.length > 0 ? (
    <section className="mt-5 border-t border-stone-200 pt-4">
      <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">Уже договорились</h3>
      <div className="mt-3 grid gap-2">
        {summaries.map((summary) => (
          <article
            className={`cursor-default rounded-lg border p-3 ${
              summary.kind === 'partialRouteOccurrence'
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-stone-200 bg-stone-200/70 text-stone-600'
            }`}
            key={summary.id}
          >
            {summary.offerTypeLabel ? (
              <p className="text-xs font-bold uppercase tracking-wide">{summary.offerTypeLabel}</p>
            ) : null}
            {summary.badge ? (
              <p className="mt-2 w-fit rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950">
                {summary.badge}
              </p>
            ) : null}
            <h4 className={`${summary.offerTypeLabel || summary.badge ? 'mt-2' : ''} font-semibold`}>{summary.message}</h4>
            <p className="mt-1 text-sm leading-5">{summary.detail}</p>
          </article>
        ))}
      </div>
    </section>
  ) : null;
}
