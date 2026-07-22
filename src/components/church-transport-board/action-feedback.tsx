import { useEffect } from 'react';

export type ActionFeedbackMessage = {
  id: string;
  message: string;
  tone: 'success' | 'error';
};

export function ActionFeedback({
  feedback,
  onDismiss,
}: {
  feedback: ActionFeedbackMessage | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!feedback) return;

    const timer = window.setTimeout(onDismiss, 4_000);
    return () => window.clearTimeout(timer);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  const success = feedback.tone === 'success';

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex justify-center sm:top-5">
      <div
        aria-atomic="true"
        aria-live={success ? 'polite' : 'assertive'}
        className={`action-feedback pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${
          success
            ? 'border-emerald-200 bg-emerald-950 text-white'
            : 'border-red-200 bg-red-950 text-white'
        }`}
        role={success ? 'status' : 'alert'}
      >
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${success ? 'bg-emerald-400/20' : 'bg-red-400/20'}`}
        >
          {success ? (
            <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
              <path d="m3 8.5 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          ) : (
            <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
              <path d="M8 4.25v4.5M8 11.75h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          )}
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-5">{feedback.message}</p>
        <button
          aria-label="Закрыть уведомление"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xl leading-none text-white/80 hover:bg-white/10 hover:text-white"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
