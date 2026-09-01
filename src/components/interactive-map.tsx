'use client';

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  areaExtremes,
  areasToGeoJson,
  boundsOf,
  geoapifyStyleUrl,
  isPointBounds,
  AREA_COLOURS,
  AREA_TITLES,
  GEOAPIFY_MAP_ATTRIBUTION,
  type MapArea,
  type MapMarker,
} from '@/lib/geo/map-style';
import type { Coordinate } from '@/lib/geo/types';

/**
 * The one embedded map in Orthodox Routes.
 *
 * Every map surface — the church catalog, the church location screen, the transport board map,
 * and the place picker — renders through this component, so there is a single embedded map
 * architecture rather than one per screen. It draws Geoapify vector tiles with MapLibre GL,
 * which gives pan, zoom, and touch gestures without a vendor SDK.
 *
 * MapLibre is loaded only in the browser and only when a render key exists. Without a key the
 * surface says so plainly and the page around it keeps working.
 */

export type InteractiveMapProps = {
  browserKey: string | null;
  markers?: MapMarker[];
  areas?: MapArea[];
  /** Centre used when there is nothing to fit, or when a single point is shown. */
  center?: Coordinate | null;
  zoom?: number;
  /** Fit the view to everything drawn. Ignored while the person is choosing a point. */
  fitToContent?: boolean;
  /** Enables tap-to-place. Absent means the map is for looking at, not for choosing. */
  onSelect?: (point: Coordinate) => void;
  heightClass?: string;
  ariaLabel: string;
  unavailableText?: string;
};

const MARKER_COLOURS: Record<MapMarker['kind'], string> = {
  church: '#92400e',
  place: '#b45309',
  user: '#1d4ed8',
};

const AREA_SOURCE = 'orthodox-routes-areas';
/** Published by `scripts/copy-maplibre-worker.mjs` beside the module the worker imports. */
const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

export function InteractiveMap({
  areas = [],
  ariaLabel,
  browserKey,
  center = null,
  fitToContent = false,
  heightClass = 'h-72',
  markers = [],
  onSelect,
  unavailableText = 'Карта сейчас недоступна.',
  zoom = 13,
}: InteractiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const markerRefs = useRef<unknown[]>([]);
  const selectRef = useRef(onSelect);
  const [failed, setFailed] = useState(false);

  // Keeping the callback in a ref lets the map be created once instead of on every render.
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  const markerKey = JSON.stringify(markers);
  const areaKey = JSON.stringify(areas);
  const centerKey = center ? `${center.lat},${center.lng}` : '';

  useEffect(() => {
    if (!browserKey || !containerRef.current) return undefined;
    let cancelled = false;
    let map: import('maplibre-gl').Map | null = null;

    (async () => {
      try {
        const {
          Map: MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl,
        } = await import('maplibre-gl');
        if (cancelled || !containerRef.current) return;

        // MapLibre parses tiles in a module worker. Left to the bundler, that worker is emitted
        // as a lone static asset while its own relative import is not, so the browser fetches an
        // address that does not exist, refuses the reply because it is not JavaScript, and the
        // worker never starts. Nothing reports an error: the container, the controls, and the
        // credit line all appear, and the map stays completely empty. Pointing at the pair that
        // `scripts/copy-maplibre-worker.mjs` publishes side by side makes the import resolve.
        setWorkerUrl(MAPLIBRE_WORKER_URL);

        const instance = new MapLibreMap({
          attributionControl: { compact: true },
          center: center ? [center.lng, center.lat] : [0, 0],
          container: containerRef.current,
          style: geoapifyStyleUrl(browserKey),
          zoom,
        });
        map = instance;
        mapRef.current = instance;
        instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        instance.on('error', () => setFailed(true));

        instance.on('load', () => {
          instance.addSource(AREA_SOURCE, { data: areasToGeoJson(areas), type: 'geojson' });
          // Colour carries the difference between a passenger and a driver, because that is what
          // a person reads without being told. The dashed and solid outlines carry it a second
          // time, so the map still answers the question for anyone who does not see these two
          // hues apart.
          const byKind = (
            meeting: string,
            departure: string,
          ): import('maplibre-gl').ExpressionSpecification => [
            'case', ['==', ['get', 'kind'], 'meeting'], meeting, departure,
          ];
          instance.addLayer({
            id: `${AREA_SOURCE}-fill`,
            paint: {
              'fill-color': byKind(AREA_COLOURS.meeting, AREA_COLOURS.departure),
              'fill-opacity': 0.15,
            },
            source: AREA_SOURCE,
            type: 'fill',
          });
          instance.addLayer({
            id: `${AREA_SOURCE}-line`,
            paint: {
              'line-color': byKind(AREA_COLOURS.meeting, AREA_COLOURS.departure),
              'line-dasharray': ['case', ['==', ['get', 'kind'], 'meeting'], ['literal', [2, 2]], ['literal', [1, 0]]],
              'line-width': 2,
            },
            source: AREA_SOURCE,
            type: 'line',
          });

          // Tapping an area says which kind it is. Only on a map for looking at: where the map
          // is for choosing a point, a tap already means something else. The popup repeats what
          // the card beside it already shows — a name and an approximate area — and never an
          // exact place or a route.
          if (!selectRef.current) {
            instance.on('click', `${AREA_SOURCE}-fill`, (event) => {
              const feature = event.features?.[0];
              const kind = feature?.properties?.kind === 'meeting' ? 'meeting' : 'departure';
              const label = typeof feature?.properties?.label === 'string' ? feature.properties.label : '';
              new Popup({ closeButton: true })
                .setLngLat(event.lngLat)
                .setText(label ? `${AREA_TITLES[kind]} · ${label}` : AREA_TITLES[kind])
                .addTo(instance);
            });
            for (const [event, cursor] of [['mouseenter', 'pointer'], ['mouseleave', '']] as const) {
              instance.on(event, `${AREA_SOURCE}-fill`, () => {
                instance.getCanvas().style.cursor = cursor;
              });
            }
          }

          for (const marker of markers) {
            const pin = new Marker({ color: MARKER_COLOURS[marker.kind] })
              .setLngLat([marker.lng, marker.lat])
              .setPopup(new Popup({ closeButton: false }).setText(marker.label))
              .addTo(instance);
            markerRefs.current.push(pin);
          }

          const box = fitToContent
            ? boundsOf([...markers, ...areas.flatMap(areaExtremes)])
            : null;
          if (box && !isPointBounds(box)) {
            instance.fitBounds([[box.west, box.south], [box.east, box.north]], { maxZoom: 15, padding: 48 });
          } else if (box) {
            instance.setCenter([box.west, box.south]);
          }
        });

        if (selectRef.current) {
          instance.on('click', (event) => {
            selectRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
          });
          instance.getCanvas().style.cursor = 'crosshair';
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      for (const instance of markerRefs.current) {
        (instance as { remove: () => void }).remove();
      }
      markerRefs.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // The map is rebuilt when what it draws changes; the select callback is held in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserKey, markerKey, areaKey, centerKey, zoom, fitToContent, Boolean(onSelect)]);

  if (!browserKey || failed) {
    return (
      <div
        className={`grid ${heightClass} place-items-center rounded-lg border border-stone-300 bg-stone-100 p-4 text-center text-sm text-stone-600`}
        data-map-unavailable
        role="note"
      >
        {unavailableText}
      </div>
    );
  }

  return (
    <div className="grid gap-1" data-interactive-map>
      <div
        aria-label={ariaLabel}
        className={`${heightClass} w-full overflow-hidden rounded-lg border border-stone-300`}
        data-map-canvas
        data-map-areas={areas.length}
        data-map-markers={markers.length}
        ref={containerRef}
        role="application"
      />
      <p className="text-xs text-stone-500" data-map-attribution>{GEOAPIFY_MAP_ATTRIBUTION}</p>
    </div>
  );
}
