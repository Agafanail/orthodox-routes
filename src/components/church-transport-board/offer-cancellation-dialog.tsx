import { useEffect, useRef } from 'react';

export function OfferCancellationDialog({
  offerType,
  onCancel,
  onConfirm,
  affectedMatchCount = 0,
}: {
  offerType: 'trip' | 'route';
  onCancel: () => void;
  onConfirm: () => void;
  affectedMatchCount?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const title =
    offerType === 'trip'
      ? 'Вы действительно хотите отменить поездку?'
      : 'Вы действительно хотите отменить регулярную поездку?';

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      aria-labelledby="offer-cancellation-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="dialog"
      ref={dialogRef}
    >
      <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl sm:p-6">
        <h2 className="text-xl font-bold" id="offer-cancellation-title">{title}</h2>
        <p className="mt-3 leading-6 text-stone-700">
          Пассажиры больше не смогут её выбрать.
          {affectedMatchCount > 0
            ? ` Существующие договорённости (${affectedMatchCount}) будут отменены, а пассажиры получат уведомления.`
            : ''}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button className="rounded-lg border border-stone-300 px-5 py-3 font-semibold" data-dialog-initial-focus onClick={onCancel} type="button">
            Не отменять
          </button>
          <button className="rounded-lg bg-red-700 px-5 py-3 font-semibold text-white" onClick={onConfirm} type="button">
            Отменить поездку
          </button>
        </div>
      </section>
    </div>
  );
}
