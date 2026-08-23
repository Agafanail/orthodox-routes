import { GEOAPIFY_ATTRIBUTION } from '@/lib/geo/geoapify';
import type { CatalogChurch } from '@/lib/geo/church';
import { clampZoom, project, staticMapUrl, unproject, type StaticMapMarker } from '@/lib/geo/static-map';
import type { Coordinate } from '@/lib/geo/types';

/**
 * The catalog map.
 *
 * A church location is public and exact, so the map plots real pins. The view is framed around
 * whatever the search returned, and the list beside it keeps working unchanged when no map
 * imagery is available.
 */

const WIDTH = 400;
const HEIGHT = 400;
const MAX_PINS = 20;

/** Frames the view so every returned church, and the person's own location, fits inside it. */
function frame(points: Coordinate[]): { center: Coordinate; zoom: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { center: points[0], zoom: 13 };

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const east = Math.max(...lngs);
  const west = Math.min(...lngs);

  // Choose the largest zoom at which the whole span still fits in the image.
  let zoom = 18;
  while (zoom > 3) {
    const topLeft = project({ lat: north, lng: west }, zoom);
    const bottomRight = project({ lat: south, lng: east }, zoom);
    if (bottomRight.x - topLeft.x <= WIDTH * 0.9 && bottomRight.y - topLeft.y <= HEIGHT * 0.9) break;
    zoom -= 1;
  }

  const topLeft = project({ lat: north, lng: west }, zoom);
  const bottomRight = project({ lat: south, lng: east }, zoom);
  return {
    center: unproject({ x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 }, zoom),
    zoom: clampZoom(zoom),
  };
}

export function CatalogMap({
  browserKey,
  churches,
  mapAvailable,
  near,
}: {
  browserKey: string | null;
  churches: CatalogChurch[];
  mapAvailable: boolean;
  near: Coordinate | null;
}) {
  const pins = churches.slice(0, MAX_PINS);
  const view = frame([...pins.map((church) => ({ lat: church.lat, lng: church.lng })), ...(near ? [near] : [])]);
  const markers: StaticMapMarker[] = [
    ...pins.map((church) => ({ kind: 'church' as const, lat: church.lat, lng: church.lng })),
    ...(near ? [{ kind: 'user' as const, ...near }] : []),
  ];

  return (
    <aside className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" data-catalog-map>
      <h2 className="font-bold">Храмы на карте</h2>
      {mapAvailable && browserKey && view ? (
        <figure className="mt-3" data-catalog-map-canvas data-church-pins={pins.length} data-user-located={near ? 'true' : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider-rendered map tile, not a static asset */}
          <img
            alt={`Найденные храмы на карте: ${pins.length}`}
            className="w-full rounded-lg border border-stone-200"
            height={HEIGHT}
            src={staticMapUrl({
              apiKey: browserKey,
              center: view.center,
              height: HEIGHT,
              markers,
              width: WIDTH,
              zoom: view.zoom,
            })}
            width={WIDTH}
          />
          <figcaption className="mt-1 text-xs text-stone-500">{GEOAPIFY_ATTRIBUTION}</figcaption>
        </figure>
      ) : mapAvailable && browserKey ? (
        <p className="mt-3 text-sm text-stone-600" data-catalog-map-empty>
          Здесь появятся найденные храмы.
        </p>
      ) : (
        <p className="mt-3 text-sm text-stone-600" data-catalog-map-unavailable>
          Карта сейчас недоступна. Список храмов рядом работает как обычно.
        </p>
      )}
    </aside>
  );
}
