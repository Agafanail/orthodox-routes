import type { CatalogChurch } from '@/lib/geo/church';
import type { MapMarker } from '@/lib/geo/map-style';
import type { Coordinate } from '@/lib/geo/types';
import { InteractiveMap } from './interactive-map';

/**
 * The catalog map.
 *
 * A church location is public and exact, so the map plots real pins and the view is fitted to
 * whatever the search returned. The list beside it is the dependable half and keeps working
 * unchanged when the map cannot be shown.
 */

const MAX_PINS = 30;

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
  const markers: MapMarker[] = [
    ...pins.map((church) => ({
      id: church.churchId,
      kind: 'church' as const,
      label: church.officialName,
      lat: church.lat,
      lng: church.lng,
    })),
    ...(near ? [{ id: 'you', kind: 'user' as const, label: 'Вы здесь', ...near }] : []),
  ];

  return (
    <aside className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm" data-catalog-map>
      <h2 className="font-bold">Храмы на карте</h2>
      <div className="mt-3" data-church-pins={pins.length} data-user-located={near ? 'true' : undefined}>
        {pins.length === 0 ? (
          <p className="text-sm text-stone-600" data-catalog-map-empty>Здесь появятся найденные храмы.</p>
        ) : (
          <InteractiveMap
            ariaLabel={`Найденные храмы на карте: ${pins.length}`}
            browserKey={mapAvailable ? browserKey : null}
            fitToContent
            heightClass="h-80"
            markers={markers}
            unavailableText="Карта сейчас недоступна. Список храмов рядом работает как обычно."
          />
        )}
      </div>
    </aside>
  );
}
