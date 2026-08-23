'use client';

import { useState } from 'react';
import type { Coordinate } from '@/lib/geo/types';

/**
 * The interactive map surface used for confirming a place.
 *
 * The tile layer belongs to the selected map provider, which is an owner-controlled decision.
 * Until a provider is configured the surface renders its own explanatory state and the explicit
 * location action, so the surrounding flow, validation, and privacy rules stay verifiable
 * without any vendor account.
 *
 * Device geolocation is requested only from the explicit action below. The surface never asks
 * for permission on open and never tracks in the background.
 */

export type MapSurfaceProps = {
  marker: Coordinate | null;
  near?: Coordinate;
  onMarkerChange: (point: Coordinate) => void;
};

export function MapSurface({ marker, near, onMarkerChange }: MapSurfaceProps) {
  const [locating, setLocating] = useState(false);
  const [locationRefused, setLocationRefused] = useState(false);

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationRefused(true);
      return;
    }
    setLocating(true);
    setLocationRefused(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onMarkerChange({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setLocationRefused(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  return (
    <div className="grid gap-2" data-map-surface>
      <div
        className="grid min-h-40 place-items-center rounded-lg border border-stone-300 bg-stone-100 p-4 text-center text-sm text-stone-600"
        data-map-canvas
      >
        {marker ? (
          <span data-map-marker>
            Отметка стоит на выбранном месте.
            {near ? ' Храм показан рядом.' : ''}
          </span>
        ) : (
          <span>Найдите адрес или нажмите «Показать, где я», чтобы поставить отметку.</span>
        )}
      </div>

      <button
        className="min-h-11 justify-self-start rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
        disabled={locating}
        onClick={useMyLocation}
        type="button"
      >
        Показать, где я
      </button>

      {locationRefused && (
        <p className="text-sm" data-map-location-refused>
          Не удалось определить ваше местоположение. Поставьте отметку на карте вручную.
        </p>
      )}
    </div>
  );
}
