'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { coarseLocation } from '@/lib/geo/church';

/**
 * The only place the catalog asks for the device location.
 *
 * Permission is requested after this explicit action and never when the page or the map opens,
 * and nothing is tracked in the background. The position is rounded to roughly a kilometre
 * before it is used, which is precise enough to sort a catalog and keeps an exact position out
 * of request URLs and ordinary server logs.
 */
/**
 * How uncertain a position may be and still sort a catalog.
 *
 * The browser reports its own uncertainty in metres. A position derived from the network rather
 * than from satellites can be hundreds of kilometres out — far enough to land in another
 * country — and it arrives looking exactly like a good one. Sorting churches by such a position
 * would quietly present a wrong answer as a fact, so past this radius the position is reported
 * back to the person instead of being used. Nothing is corrected or guessed here: the only
 * numbers this component ever touches are the ones the browser supplied.
 */
const USABLE_ACCURACY_M = 25_000;

export function NearMeAction({ query }: { query: string }) {
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  const [refused, setRefused] = useState(false);
  const [vagueKm, setVagueKm] = useState<number | null>(null);

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setRefused(true);
      return;
    }
    setLocating(true);
    setRefused(false);
    setVagueKm(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const { accuracy } = position.coords;
        if (Number.isFinite(accuracy) && accuracy > USABLE_ACCURACY_M) {
          setVagueKm(Math.round(accuracy / 1000));
          return;
        }
        const coarse = coarseLocation(position.coords.latitude, position.coords.longitude);
        if (!coarse) {
          setRefused(true);
          return;
        }
        const parameters = new URLSearchParams({ lat: String(coarse.lat), lng: String(coarse.lng) });
        if (query.length > 0) parameters.set('q', query);
        router.push(`/churches?${parameters.toString()}`);
      },
      () => {
        setLocating(false);
        setRefused(true);
      },
      // Ask for the best fix the device can give, and ask for it now. The previous settings
      // accepted a cached position up to five minutes old and told the browser that a rough one
      // would do, which invites the network-derived answer that can be a country out.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  return (
    <span className="grid gap-1">
      <button
        className="min-h-11 rounded-lg border border-amber-800 px-4 py-2 font-semibold text-amber-900"
        disabled={locating}
        onClick={locate}
        type="button"
      >
        Рядом со мной
      </button>
      {refused ? (
        <span className="text-sm text-stone-600" data-near-me-refused>
          Не удалось определить местоположение. Найдите храм по названию или городу.
        </span>
      ) : null}
      {vagueKm !== null ? (
        <span className="text-sm text-stone-600" data-near-me-vague>
          Браузер определил ваше местоположение слишком приблизительно — с точностью около
          {' '}{vagueKm} км. Сортировать храмы по такому ответу нельзя. Найдите храм по названию
          или городу, а точность геолокации проверьте в настройках браузера и системы.
        </span>
      ) : null}
    </span>
  );
}
