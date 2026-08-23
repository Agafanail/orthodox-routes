'use client';

import { useId, useState } from 'react';
import { savedPlaceName } from '@/lib/geo/place';
import type { PlaceCandidate, PlaceInput, SavedPlace, SelectedPlace } from '@/lib/geo/types';
import { PlacePicker } from './place-picker';

/**
 * Collects one to three confirmed places for a publication form.
 *
 * The person selects only the real place. There is no field for a public area: the server
 * derives the privacy-safe circle. The field carries its value as JSON in one hidden input so
 * the surrounding server action receives a single validated payload.
 */

export type PlaceFieldProps = {
  /** Form field name carrying the JSON payload. */
  name: string;
  legend: string;
  hint: string;
  /** Passenger meeting places allow up to three; a driver departure is exactly one. */
  maximum: number;
  savedPlaces: SavedPlace[];
  mapAvailable: boolean;
  browserKey: string | null;
  /** Bias place search towards the church the person is looking at. */
  near?: { lat: number; lng: number };
  searchPlaces: (query: string, near?: { lat: number; lng: number })
  => Promise<{ candidates: PlaceCandidate[]; available: boolean }>;
};

type Entry =
  | { kind: 'saved'; saved: SavedPlace }
  | { kind: 'selected'; selected: SelectedPlace };

function entryName(entry: Entry) {
  return entry.kind === 'saved' ? savedPlaceName(entry.saved) : entry.selected.address;
}

function entryPayload(entry: Entry): PlaceInput {
  return entry.kind === 'saved' ? { savedPlaceId: entry.saved.placeId } : entry.selected;
}

export function PlaceField({
  browserKey,
  hint,
  legend,
  mapAvailable,
  maximum,
  name,
  near,
  savedPlaces,
  searchPlaces,
}: PlaceFieldProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [picking, setPicking] = useState(false);
  const fieldId = useId();
  const full = entries.length >= maximum;

  function add(entry: Entry) {
    setEntries((current) => (current.length >= maximum ? current : [...current, entry]));
    setPicking(false);
  }

  function remove(index: number) {
    setEntries((current) => current.filter((_, position) => position !== index));
  }

  return (
    <fieldset className="grid gap-3 rounded-lg border border-stone-200 p-4" data-place-field={name}>
      <legend className="px-1 font-semibold">{legend}</legend>
      <p className="text-sm text-stone-600">{hint}</p>

      <input
        name={name}
        type="hidden"
        value={JSON.stringify(entries.map(entryPayload))}
      />

      {entries.length > 0 && (
        <ul className="grid gap-2" data-place-list>
          {entries.map((entry, index) => (
            <li className="flex items-center justify-between gap-3 rounded-lg bg-stone-100 p-3" key={`${fieldId}-${index}`}>
              <span className="text-sm">
                {maximum > 1 ? `${index + 1}. ` : ''}
                {entryName(entry)}
              </span>
              <button className="min-h-11 px-2 text-sm font-semibold text-amber-800" onClick={() => remove(index)} type="button">
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}

      {savedPlaces.length > 0 && !full && (
        <div className="grid gap-2" data-saved-places>
          <p className="text-sm font-semibold">Мои места</p>
          <ul className="flex flex-wrap gap-2">
            {savedPlaces.map((saved) => (
              <li key={saved.placeId}>
                <button
                  className="min-h-11 rounded-full border border-stone-300 px-4 py-1 text-sm"
                  onClick={() => add({ kind: 'saved', saved })}
                  type="button"
                >
                  {savedPlaceName(saved)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!full && !picking && (
        <button
          className="min-h-11 justify-self-start rounded-lg border border-amber-800 px-4 py-2 text-sm font-semibold text-amber-900"
          onClick={() => setPicking(true)}
          type="button"
        >
          {entries.length === 0 ? 'Указать место' : 'Добавить ещё место'}
        </button>
      )}

      {picking && (
        <PlacePicker
          browserKey={browserKey}
          mapAvailable={mapAvailable}
          near={near}
          onCancel={() => setPicking(false)}
          onConfirm={(selected) => add({ kind: 'selected', selected })}
          searchPlaces={searchPlaces}
          title={legend}
        />
      )}

      {maximum > 1 && (
        <p className="text-sm text-stone-600">
          Можно указать до {maximum} мест встречи. Это не остановки по дороге, а разные места,
          где вам одинаково удобно сесть.
        </p>
      )}
    </fieldset>
  );
}
