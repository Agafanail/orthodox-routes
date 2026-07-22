import { useEffect, useRef } from 'react';

export function MatchCancellationDialog({
  onCancel,
  onConfirm,
  participant,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  participant: 'passenger' | 'driver';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

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
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      aria-labelledby="match-cancellation-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-stone-950/55 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      role="dialog"
      ref={dialogRef}
    >
      <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl sm:p-6">
        <h2 className="text-xl font-bold" id="match-cancellation-title">Отменить договорённость?</h2>
        <p className="mt-3 leading-6 text-stone-700">
          {participant === 'passenger'
            ? 'Водитель снова сможет предложить эти места другим. Если поездка вам всё ещё нужна, вы сможете сразу опубликовать прежний запрос заново.'
            : 'Пассажир получит уведомление и сможет снова попросить подвезти. Эти места станут свободны для других.'}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button className="rounded-lg border border-stone-300 px-5 py-3 font-semibold" data-dialog-initial-focus onClick={onCancel} type="button">Не отменять</button>
          <button className="rounded-lg bg-red-700 px-5 py-3 font-semibold text-white" onClick={onConfirm} type="button">Отменить договорённость</button>
        </div>
      </section>
    </div>
  );
}
