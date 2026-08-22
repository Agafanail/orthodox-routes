import type { CatalogChurch } from '@/lib/geo/church';
import type { Coordinate } from '@/lib/geo/types';

/**
 * The catalog map.
 *
 * A church location is public and exact, so the map plots real pins. The tile layer belongs to
 * the selected map provider; until one is configured the panel explains itself instead of
 * failing, and the list beside it keeps working unchanged.
 */
export function CatalogMap({
  churches,
  mapAvailable,
  near,
}: {
  churches: CatalogChurch[];
  mapAvailable: boolean;
  near: Coordinate | null;
}) {
  return (
    <aside className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" data-catalog-map>
      <h2 className="font-bold">Храмы на карте</h2>
      {mapAvailable ? (
        <div
          className="mt-3 grid min-h-60 place-items-center rounded-lg bg-stone-100 p-4 text-center text-sm text-stone-600"
          data-catalog-map-canvas
          data-church-pins={churches.length}
          data-user-located={near ? 'true' : undefined}
        >
          {churches.length === 0
            ? 'Здесь появятся найденные храмы.'
            : `На карте отмечено храмов: ${churches.length}.`}
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-600" data-catalog-map-unavailable>
          Карта сейчас недоступна. Список храмов рядом работает как обычно.
        </p>
      )}
    </aside>
  );
}
