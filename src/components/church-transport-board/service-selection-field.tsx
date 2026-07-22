import { selectAlternativeDate, selectChurchService } from '@/lib/serviceOptions';
import type { ServiceOption, ServiceSelection } from '@/lib/serviceOptions';

export function ServiceSelectionField({
  error,
  errorId,
  label,
  name,
  onBlur,
  onChange,
  options,
  selection,
}: {
  error?: string;
  errorId: string;
  label: string;
  name: string;
  onBlur?: (fieldName: keyof ServiceSelection) => void;
  onChange: (selection: ServiceSelection, fieldName: keyof ServiceSelection) => void;
  options: ServiceOption[];
  selection: ServiceSelection;
}) {
  const describedBy = error ? errorId : undefined;
  const fieldClassName =
    'block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3 py-3 font-normal';
  const groupLabelId = `${name}-choice-label`;

  return (
    <div aria-labelledby={groupLabelId} className="grid min-w-0 max-w-full gap-3" role="group">
      <p className="text-sm font-semibold" id={groupLabelId}>{label}</p>
      {options.length > 0 ? (
        <label className="grid min-w-0 max-w-full gap-1 overflow-hidden text-sm font-semibold">
          Служба
          <select
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
            className={fieldClassName}
            name={name}
            onBlur={() => onBlur?.('selectedServiceId')}
            onChange={(event) =>
              onChange(
                selectChurchService(selection, event.target.value),
                'selectedServiceId',
              )
            }
            value={selection.selectedServiceId}
          >
            <option value="">Выберите службу</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="grid min-w-0 max-w-full gap-1 text-sm font-semibold">
        Другая дата
        <input
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={fieldClassName}
          onBlur={() => onBlur?.('date')}
          onInput={(event) =>
            onChange(
              selectAlternativeDate(selection, event.currentTarget.value),
              'date',
            )
          }
          type="date"
          value={selection.date}
        />
      </label>

      {error ? (
        <span className="text-sm font-normal text-red-700" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
