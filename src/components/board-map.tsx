import type { CoreChurch, CoreDriverOccurrence, CorePassengerRequest } from '@/lib/core-transport/types';
import { AREA_COLOURS, AREA_TITLES, type MapArea, type MapMarker } from '@/lib/geo/map-style';
import { InteractiveMap } from './interactive-map';

/**
 * The transport board map for one service or date group.
 *
 * The board itself stays the default experience; this is a second way to look at the same
 * listings for people who do not know the area. It shows the exact church, the approximate
 * passenger meeting areas, and the approximate driver departure areas.
 *
 * There is no route line and no corridor. A driver never promised to follow a road some service
 * computed, so drawing one would claim more than the product knows.
 */
export function BoardMap({
  browserKey,
  church,
  driverOccurrences,
  mapAvailable,
  passengerRequests,
}: {
  browserKey: string | null;
  church: CoreChurch;
  driverOccurrences: CoreDriverOccurrence[];
  mapAvailable: boolean;
  passengerRequests: CorePassengerRequest[];
}) {
  const churchPoint = church.lat !== undefined && church.lng !== undefined
    ? { lat: church.lat, lng: church.lng }
    : null;

  const meetingAreas: MapArea[] = passengerRequests.flatMap((request) => request.placeOptions.flatMap(
    (place) => (place.publicArea
      ? [{
        id: `${request.requestId}-${place.placeId}`,
        kind: 'meeting' as const,
        label: `${request.authorName}: ${place.publicAreaLabel}`,
        lat: place.publicArea.lat,
        lng: place.publicArea.lng,
        radiusM: place.publicArea.radiusM,
      }]
      : []),
  ));

  const departureAreas: MapArea[] = driverOccurrences.flatMap((offer) => (offer.originArea?.publicArea
    ? [{
      id: offer.occurrenceId,
      kind: 'departure' as const,
      label: `${offer.authorName}: ${offer.originArea.publicAreaLabel}`,
      lat: offer.originArea.publicArea.lat,
      lng: offer.originArea.publicArea.lng,
      radiusM: offer.originArea.publicArea.radiusM,
    }]
    : []));

  const areas = [...meetingAreas, ...departureAreas];
  const markers: MapMarker[] = churchPoint
    ? [{ id: 'church', kind: 'church', label: church.officialName, ...churchPoint }]
    : [];

  if (!churchPoint || areas.length === 0) return null;

  return (
    <details className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm" data-board-map>
      <summary className="cursor-pointer font-bold text-amber-900">Поездки на карте</summary>
      <div className="mt-4">
        <InteractiveMap
          ariaLabel="Поездки этой группы на карте"
          areas={areas}
          browserKey={mapAvailable ? browserKey : null}
          center={churchPoint}
          fitToContent
          heightClass="h-96"
          markers={markers}
          unavailableText="Карта сейчас недоступна. Список объявлений работает как обычно."
        />
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" data-board-map-legend>
          {(['meeting', 'departure'] as const).map((kind) => (
            <li className="flex items-center gap-2" key={kind}>
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-full border-2"
                style={{
                  backgroundColor: `${AREA_COLOURS[kind]}26`,
                  borderColor: AREA_COLOURS[kind],
                  borderStyle: kind === 'meeting' ? 'dashed' : 'solid',
                }}
              />
              {AREA_TITLES[kind]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-stone-600" data-board-map-privacy>
          Показаны точное место храма и примерные области радиусом около 1 км. Нажмите на область,
          чтобы увидеть, чья она. Точные места видны только тем, с кем человек договорился.
          Маршрут поездки не показывается.
        </p>
      </div>
    </details>
  );
}
