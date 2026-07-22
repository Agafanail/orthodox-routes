import { useId } from 'react';

export const minimumCount = 1;
export const maximumCount = 55;

export function canStepCount(value: string, direction: -1 | 1) {
  const count = Number(value);
  return Number.isInteger(count) &&
    count >= minimumCount &&
    count <= maximumCount &&
    (direction === -1 ? count > minimumCount : count < maximumCount);
}

export function stepCount(value: string, direction: -1 | 1) {
  return canStepCount(value, direction) ? String(Number(value) + direction) : value;
}

export function CountControl({
  describedBy,
  invalid = false,
  label,
  onBlur,
  onChange,
  value,
}: {
  describedBy?: string;
  invalid?: boolean;
  label: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  value: string;
}) {
  const generatedId = useId();
  const inputId = `count-${generatedId}`;
  const labelId = `count-label-${generatedId}`;

  return (
    <div aria-labelledby={labelId} className="grid min-w-0 gap-1" role="group">
      <label className="text-sm font-semibold" htmlFor={inputId} id={labelId}>{label}</label>
      <div className={`grid w-full max-w-52 grid-cols-[3rem_minmax(0,1fr)_3rem] overflow-hidden rounded-lg border bg-white ${invalid ? 'border-red-600' : 'border-stone-300'}`}>
        <button
          aria-controls={inputId}
          aria-label={`Уменьшить: ${label.replace('*', '')}`}
          className="touch-manipulation border-r border-stone-300 text-2xl font-semibold disabled:cursor-not-allowed disabled:text-stone-300"
          disabled={!canStepCount(value, -1)}
          onClick={() => onChange(stepCount(value, -1))}
          type="button"
        >
          −
        </button>
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className="min-w-0 border-0 px-2 py-3 text-center font-normal outline-offset-0"
          id={inputId}
          inputMode="numeric"
          max={maximumCount}
          min={minimumCount}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          required
          type="number"
          value={value}
        />
        <button
          aria-controls={inputId}
          aria-label={`Увеличить: ${label.replace('*', '')}`}
          className="touch-manipulation border-l border-stone-300 text-2xl font-semibold disabled:cursor-not-allowed disabled:text-stone-300"
          disabled={!canStepCount(value, 1)}
          onClick={() => onChange(stepCount(value, 1))}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
