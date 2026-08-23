'use client';

import { useState } from 'react';
import type { Coordinate, PlaceCandidate, SelectedPlace } from '@/lib/geo/types';
import { MapSurface } from './map-surface';

/**
 * The approved place-selection flow: search by address or place name, choose a result, see it on
 * the map, correct the marker if needed, then confirm.
 *
 * The fallback matters as much as the main path. In villages and small settlements address data
 * is often poor, so a person may place or move the marker by hand; a provider-recognised postal
 * address is never required when the point on the map is right.
 *
 * Device location is requested only after the explicit action, never when the picker opens.
 */

export type PlacePickerProps = {
  title: string;
  mapAvailable: boolean;
  near?: Coordinate;
  searchPlaces?: (query: string) => Promise<PlaceCandidate[]>;
  onConfirm: (place: SelectedPlace) => void;
  onCancel: () => void;
};

type Draft = {
  point: Coordinate;
  address: string;
  locality?: string;
  countryCode?: string;
  providerPlaceId?: string;
  moved: boolean;
};

function draftFromCandidate(candidate: PlaceCandidate): Draft {
  return {
    address: candidate.address,
    moved: false,
    point: { lat: candidate.lat, lng: candidate.lng },
    ...(candidate.locality === undefined ? {} : { locality: candidate.locality }),
    ...(candidate.countryCode === undefined ? {} : { countryCode: candidate.countryCode }),
    ...(candidate.providerPlaceId === undefined ? {} : { providerPlaceId: candidate.providerPlaceId }),
  };
}

export function PlacePicker({ mapAvailable, near, onCancel, onConfirm, searchPlaces, title }: PlacePickerProps) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [save, setSave] = useState(false);
  const [label, setLabel] = useState('');

  async function search() {
    if (!searchPlaces || query.trim().length === 0) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      setCandidates(await searchPlaces(query.trim()));
    } catch {
      setCandidates([]);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }

  function confirm() {
    if (!draft) return;
    const address = draft.address.trim();
    if (address.length === 0) return;
    onConfirm({
      address,
      lat: draft.point.lat,
      lng: draft.point.lng,
      // A marker the person moved is their own placement, not a provider result.
      sourceKind: draft.moved ? 'user_pin' : 'user_confirmed_geocode',
      ...(draft.locality === undefined ? {} : { locality: draft.locality }),
      ...(draft.countryCode === undefined ? {} : { countryCode: draft.countryCode }),
      ...(draft.moved || draft.providerPlaceId === undefined
        ? {}
        : { providerPlaceId: draft.providerPlaceId }),
      ...(save ? { save: true } : {}),
      ...(save && label.trim().length > 0 ? { label: label.trim() } : {}),
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4" data-place-picker>
      <p className="font-semibold">{title}</p>

      {!mapAvailable ? (
        <p className="rounded-lg border border-amber-300 bg-white p-3 text-sm" data-place-picker-unavailable>
          Карта сейчас недоступна, поэтому выбрать новое место не получится. Попробуйте позже.
        </p>
      ) : (
        <>
          <label className="grid gap-1 text-sm">
            Найти адрес
            <input
              className="rounded-lg border border-stone-300 p-2"
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void search();
                }
              }}
              value={query}
            />
          </label>
          <button
            className="min-h-11 justify-self-start rounded-lg border border-amber-800 px-4 py-1 text-sm font-semibold text-amber-900"
            disabled={searching || query.trim().length === 0}
            onClick={() => void search()}
            type="button"
          >
            Найти
          </button>

          {searchFailed && (
            <p className="text-sm" data-place-search-failed>
              Не удалось найти адрес. Поставьте отметку на карте вручную.
            </p>
          )}

          {candidates.length > 0 && (
            <ul className="grid gap-1" data-place-candidates>
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    className="min-h-11 w-full rounded-lg border border-stone-300 bg-white p-2 text-left text-sm"
                    onClick={() => setDraft(draftFromCandidate(candidate))}
                    type="button"
                  >
                    {candidate.address}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <MapSurface
            marker={draft?.point ?? null}
            near={near}
            onMarkerChange={(point) => setDraft((current) => (current
              ? { ...current, moved: true, point }
              : { address: '', moved: true, point }))}
          />

          <p className="text-sm text-stone-700">
            Найдите адрес или передвиньте отметку на карте. Если адрес не находится, поставьте
            отметку вручную.
          </p>

          {draft && (
            <>
              <label className="grid gap-1 text-sm">
                Как называется это место
                <input
                  className="rounded-lg border border-stone-300 p-2"
                  maxLength={300}
                  onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                  value={draft.address}
                />
              </label>

              <p className="text-sm text-stone-700" data-place-privacy>
                Всем будет видна только примерная область радиусом около 1 км. Ваше место
                находится внутри неё, но не в центре.
              </p>

              <label className="text-sm">
                <input checked={save} onChange={(event) => setSave(event.target.checked)} type="checkbox" />
                {' '}Сохранить это место, чтобы выбирать его в следующий раз
              </label>

              {save && (
                <label className="grid gap-1 text-sm">
                  Название места
                  <input
                    className="rounded-lg border border-stone-300 p-2"
                    maxLength={60}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Например, «у входа в библиотеку»"
                    value={label}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-11 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!draft || draft.address.trim().length === 0}
          onClick={confirm}
          type="button"
        >
          Подтвердить место
        </button>
        <button className="min-h-11 px-4 py-2 text-sm font-semibold text-stone-700" onClick={onCancel} type="button">
          Отмена
        </button>
      </div>
    </div>
  );
}
