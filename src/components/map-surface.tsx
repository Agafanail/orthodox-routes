'use client';

import { useState } from 'react';
import { GEOAPIFY_ATTRIBUTION } from '@/lib/geo/geoapify';
import {
  clampZoom,
  coordinateToPixel,
  pixelToCoordinate,
  staticMapUrl,
  type StaticMapMarker,
} from '@/lib/geo/static-map';
import type { Coordinate } from '@/lib/geo/types';

/**
 * The map used for confirming a place.
 *
 * A person searches for an address, sees it here, and may tap anywhere on the map to correct the
 * marker or to place it by hand where address data is poor. Panning and zooming use explicit
 * controls, which keeps the surface dependency-free and equally usable with a keyboard.
 *
 * The view only ever moves because someone moved it: choosing a search result, asking for their
 * own location, or returning to the marker. Tapping to place a point pins the current view, so
 * the ground under a finger never shifts mid-correction.
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

const WIDTH = 600;
const HEIGHT = 320;
const DEFAULT_ZOOM = 15;

export function MapSurface({ browserKey, focus, marker, near, onMarkerChange }: MapSurfaceProps) {
  const [override, setOverride] = useState<Coordinate | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
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

  function place(event: React.MouseEvent<HTMLImageElement>) {
    if (!center) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    // The image is rendered responsively, so a tap is scaled back to the requested pixel size.
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const y = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
    const point = pixelToCoordinate({ center, height: HEIGHT, width: WIDTH, zoom }, x, y);
    if (!point) return;
    // Pin the view where it is, so correcting a marker never scrolls the ground.
    setOverride(center);
    onMarkerChange(point);
  }

  const locate = (
    <>
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
    </>
  );

  if (!browserKey || !center) {
    return (
      <div className="grid gap-2" data-map-surface>
        <div
          className="grid min-h-40 place-items-center rounded-lg border border-stone-300 bg-stone-100 p-4 text-center text-sm text-stone-600"
          data-map-canvas
          data-map-unavailable={!browserKey || undefined}
        >
          {browserKey
            ? 'Найдите адрес или нажмите «Показать, где я», чтобы поставить отметку.'
            : 'Карта сейчас недоступна.'}
        </div>
        {locate}
      </div>
    );
  }

  const markers: StaticMapMarker[] = [
    ...(marker ? [{ ...marker, kind: 'place' as const }] : []),
    ...(near ? [{ ...near, kind: 'church' as const }] : []),
  ];
  const markerPixel = marker
    ? coordinateToPixel({ center, height: HEIGHT, width: WIDTH, zoom }, marker)
    : null;

  return (
    <div className="grid gap-2" data-map-surface>
      <div className="relative overflow-hidden rounded-lg border border-stone-300">
        {/* eslint-disable-next-line @next/next/no-img-element -- provider-rendered map tile, not a static asset */}
        <img
          alt="Карта выбранного места"
          className="w-full cursor-crosshair"
          data-map-canvas
          height={HEIGHT}
          onClick={place}
          src={staticMapUrl({
            apiKey: browserKey,
            center,
            height: HEIGHT,
            markers,
            width: WIDTH,
            zoom,
          })}
          width={WIDTH}
        />
        {markerPixel ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full text-xl"
            data-map-marker
            style={{ left: `${(markerPixel.x / WIDTH) * 100}%`, top: `${(markerPixel.y / HEIGHT) * 100}%` }}
          >
            📍
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-11 rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
          onClick={() => setZoom((current) => clampZoom(current + 1))}
          type="button"
        >
          Ближе
        </button>
        <button
          className="min-h-11 rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
          onClick={() => setZoom((current) => clampZoom(current - 1))}
          type="button"
        >
          Дальше
        </button>
        {marker ? (
          <button
            className="min-h-11 rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
            onClick={() => setOverride(marker)}
            type="button"
          >
            К отметке
          </button>
        ) : null}
        {locate}
      </div>

      <p className="text-xs text-stone-500" data-map-attribution>{GEOAPIFY_ATTRIBUTION}</p>
    </div>
  );
}
