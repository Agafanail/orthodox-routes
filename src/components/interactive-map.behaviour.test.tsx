// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the interactive map actually does once it mounts in a browser.
 *
 * MapLibre is replaced by a recording stand-in so the behaviour can be asserted without network
 * tiles or WebGL: which style is requested, what is drawn, whether tapping is wired, and whether
 * a provider failure degrades instead of leaving a blank frame.
 */

const handlers = new Map<string, (event: unknown) => void>();
const calls = {
  addControl: [] as unknown[],
  addLayer: [] as Record<string, unknown>[],
  addSource: [] as [string, Record<string, unknown>][],
  fitBounds: [] as unknown[],
  markers: [] as { colour: string | undefined; lngLat: [number, number]; text: string }[],
  mapOptions: [] as Record<string, unknown>[],
  removed: 0,
};

class FakeMap {
  constructor(options: Record<string, unknown>) {
    calls.mapOptions.push(options);
  }

  addControl(control: unknown) { calls.addControl.push(control); }

  addSource(id: string, source: Record<string, unknown>) { calls.addSource.push([id, source]); }

  addLayer(layer: Record<string, unknown>) { calls.addLayer.push(layer); }

  fitBounds(...args: unknown[]) { calls.fitBounds.push(args); }

  setCenter() {}

  getCanvas() { return { style: {} } as HTMLCanvasElement; }

  on(event: string, handler: (payload: unknown) => void) { handlers.set(event, handler); }

  remove() { calls.removed += 1; }
}

class FakeMarker {
  private lngLat: [number, number] = [0, 0];

  private text = '';

  constructor(private readonly options: { color?: string }) {}

  setLngLat(value: [number, number]) { this.lngLat = value; return this; }

  setPopup(popup: { text: string }) { this.text = popup.text; return this; }

  addTo() {
    calls.markers.push({ colour: this.options.color, lngLat: this.lngLat, text: this.text });
    return this;
  }

  remove() {}
}

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
  Popup: class {
    text = '';

    setText(value: string) { this.text = value; return this; }
  },
}));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import { InteractiveMap } from './interactive-map';

const church = { id: 'c', kind: 'church' as const, label: 'Тестовый храм', lat: 45.0703, lng: 7.6869 };
const meetingArea = {
  id: 'a',
  kind: 'meeting' as const,
  label: 'Torino',
  lat: 45.06,
  lng: 7.67,
  radiusM: 1000,
};

beforeEach(() => {
  handlers.clear();
  calls.addControl = [];
  calls.addLayer = [];
  calls.addSource = [];
  calls.fitBounds = [];
  calls.markers = [];
  calls.mapOptions = [];
  calls.removed = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InteractiveMap', () => {
  it('requests the Geoapify vector style with the render credential', async () => {
    render(<InteractiveMap ariaLabel="Карта" browserKey="render-key" center={church} />);

    await waitFor(() => expect(calls.mapOptions).toHaveLength(1));
    const style = String(calls.mapOptions[0].style);
    expect(style).toContain('https://maps.geoapify.com/v1/styles/');
    expect(style).toContain('style.json');
    expect(style).toContain('apiKey=render-key');
    // Zoom and pan controls are what make the map interactive rather than a picture.
    expect(calls.addControl).toHaveLength(1);
  });

  it('draws markers and approximate areas once the style has loaded', async () => {
    render(
      <InteractiveMap
        areas={[meetingArea, { ...meetingArea, id: 'b', kind: 'departure' }]}
        ariaLabel="Карта"
        browserKey="render-key"
        markers={[church]}
      />,
    );

    await waitFor(() => expect(handlers.has('load')).toBe(true));
    handlers.get('load')!({});

    expect(calls.markers).toEqual([
      { colour: '#92400e', lngLat: [7.6869, 45.0703], text: 'Тестовый храм' },
    ]);
    expect(calls.addSource[0][0]).toBe('orthodox-routes-areas');

    const source = calls.addSource[0][1] as { data: { features: unknown[] } };
    expect(source.data.features).toHaveLength(2);
    // A circle outline plus a fill, and nothing resembling a route line.
    expect(calls.addLayer.map((layer) => layer.type)).toEqual(['fill', 'line']);
    expect(JSON.stringify(calls.addLayer)).not.toContain('LineString');
  });

  it('fits the view around whole areas rather than their centres', async () => {
    render(
      <InteractiveMap areas={[meetingArea]} ariaLabel="Карта" browserKey="render-key" fitToContent markers={[church]} />,
    );

    await waitFor(() => expect(handlers.has('load')).toBe(true));
    handlers.get('load')!({});

    expect(calls.fitBounds).toHaveLength(1);
    const [[[west, south], [east, north]]] = calls.fitBounds[0] as [[[number, number], [number, number]], unknown];
    // The circle extends past its centre in every direction, so the box must too.
    expect(south).toBeLessThan(meetingArea.lat);
    expect(north).toBeGreaterThan(church.lat - 0.02);
    expect(west).toBeLessThan(meetingArea.lng);
    expect(east).toBeGreaterThan(meetingArea.lng);
  });

  it('reports a tapped coordinate only when the surface is for choosing', async () => {
    const onSelect = vi.fn();
    render(<InteractiveMap ariaLabel="Карта" browserKey="render-key" center={church} onSelect={onSelect} />);

    await waitFor(() => expect(handlers.has('click')).toBe(true));
    handlers.get('click')!({ lngLat: { lat: 45.05, lng: 7.65 } });
    expect(onSelect).toHaveBeenCalledWith({ lat: 45.05, lng: 7.65 });
  });

  it('does not wire tapping on a map that is only for looking at', async () => {
    render(<InteractiveMap ariaLabel="Карта" browserKey="render-key" center={church} />);
    await waitFor(() => expect(calls.mapOptions).toHaveLength(1));
    expect(handlers.has('click')).toBe(false);
  });

  // A tile outage must leave an explanation, never a blank frame.
  it('falls back to plain words when the provider fails', async () => {
    const { container, findByRole } = render(
      <InteractiveMap ariaLabel="Карта" browserKey="render-key" center={church} unavailableText="Карта сейчас недоступна." />,
    );

    await waitFor(() => expect(handlers.has('error')).toBe(true));
    handlers.get('error')!({});

    const note = await findByRole('note');
    expect(note.textContent).toBe('Карта сейчас недоступна.');
    expect(container.querySelector('[data-map-canvas]')).toBeNull();
  });

  it('never initialises a map without a render credential', () => {
    render(<InteractiveMap ariaLabel="Карта" browserKey={null} center={church} />);
    expect(calls.mapOptions).toHaveLength(0);
  });

  it('releases the map when the surface unmounts', async () => {
    const { unmount } = render(<InteractiveMap ariaLabel="Карта" browserKey="render-key" center={church} />);
    await waitFor(() => expect(calls.mapOptions).toHaveLength(1));
    unmount();
    expect(calls.removed).toBe(1);
  });
});
