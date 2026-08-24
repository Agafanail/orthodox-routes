'use client';

import { useState } from 'react';
import type { MapMarker } from '@/lib/geo/map-style';
import type { Coordinate } from '@/lib/geo/types';
import { InteractiveMap } from './interactive-map';

/**
 * The map used for confirming a place.
 *
 * A person searches for an address, sees it here, and may tap anywhere on the map to correct the
 * marker or to place it by hand where address data is poor. Pan, zoom, and touch gestures come
 * from the shared interactive map.
 *
 * Device geolocation is requested only from the explicit action below. The surface never asks on
 * open and never tracks in the background.
 */

export type MapSurfaceProps = {
  marker: Coordinate | null;
  /** Where the view should sit; changes only through an explicit user action. */
  focus?: Coordinate | null;
  near?: Coordinate;
  browserKey: string | null;
  onMarkerChange: (point: Coordinate) => void;
};

export function MapSurface({ browserKey, focus, marker, near, onMarkerChange }: MapSurfaceProps) {
  const [override, setOverride] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationRefused, setLocationRefused] = useState(false);

  const center = override ?? focus ?? marker ?? near ?? null;

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
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setOverride(point);
        onMarkerChange(point);
      },
      () => {
        setLocating(false);
        setLocationRefused(true);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  const markers: MapMarker[] = [
    ...(marker ? [{ id: 'chosen', kind: 'place' as const, label: 'Выбранное место', ...marker }] : []),
    ...(near ? [{ id: 'church', kind: 'church' as const, label: 'Храм', ...near }] : []),
  ];

  return (
    <div className="grid gap-2" data-map-surface>
      <InteractiveMap
        ariaLabel="Карта выбора места"
        browserKey={browserKey}
        center={center}
        heightClass="h-72"
        markers={markers}
        onSelect={onMarkerChange}
        unavailableText="Карта сейчас недоступна."
        zoom={15}
      />

      <button
        className="min-h-11 justify-self-start rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
        disabled={locating}
        onClick={useMyLocation}
        type="button"
      >
        Показать, где я
      </button>

      {locationRefused ? (
        <p className="text-sm" data-map-location-refused>
          Не удалось определить ваше местоположение. Найдите адрес или нажмите на карте.
        </p>
      ) : null}
    </div>
  );
}
