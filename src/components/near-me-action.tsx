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
export function NearMeAction({ query }: { query: string }) {
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  const [refused, setRefused] = useState(false);

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setRefused(true);
      return;
    }
    setLocating(true);
    setRefused(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
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
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 15000 },
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
    </span>
  );
}
