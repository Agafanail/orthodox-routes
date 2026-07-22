import type { CompletedActivitySummary } from '@/lib/rideMatchState';
import { getBoardCardId } from '@/components/church-transport-board/board-card';

export function CompletedActivity({ summaries }: { summaries: CompletedActivitySummary[] }) {
  return summaries.length > 0 ? (
    <section className="border-t border-stone-300 pt-5" aria-labelledby="completed-activity-heading">
      <h2 className="text-center text-sm font-bold uppercase tracking-wide text-stone-600" id="completed-activity-heading">
        Уже договорились
      </h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {summaries.map((summary) => (
          <article
            className={`cursor-default rounded-lg border p-3 ${
              summary.kind === 'partialRouteOccurrence'
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-stone-200 bg-stone-200/70 text-stone-600'
            }`}
            id={getBoardCardId(summary.id)}
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
