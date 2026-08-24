import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlaceField } from './place-field';
import { PlacePicker } from './place-picker';

const noSearch = vi.fn(async () => ({ available: true, candidates: [] }));
const church = { lat: 45.0703, lng: 7.6869 };

describe('PlaceField', () => {
  it('carries its value as one JSON payload and starts empty', () => {
    const html = renderToStaticMarkup(
      <PlaceField
        browserKey="browser-key"
        hint="Укажите, где вас удобно забрать."
        legend="Место встречи"
        mapAvailable
        maximum={3}
        name="places"
        savedPlaces={[]}
        searchPlaces={noSearch}
      />,
    );

    expect(html).toContain('name="places"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value="[]"');
    expect(html).toContain('Указать место');
    // There is no field for a public area: the server derives it.
    expect(html).not.toContain('public_area');
    expect(html).not.toContain('Район');
  });

  it('explains the three-place rule as alternatives rather than stops', () => {
    const html = renderToStaticMarkup(
      <PlaceField
        browserKey="browser-key"
        hint="hint"
        legend="Место встречи"
        mapAvailable
        maximum={3}
        name="places"
        savedPlaces={[]}
        searchPlaces={noSearch}
      />,
    );
    expect(html).toContain('до 3 мест встречи');
    expect(html).toContain('не остановки по дороге');
  });

  it('offers a saved place for reuse and never shows one to a driver as a stop', () => {
    const html = renderToStaticMarkup(
      <PlaceField
        browserKey="browser-key"
        hint="hint"
        legend="Место отправления"
        mapAvailable
        maximum={1}
        name="origin"
        savedPlaces={[{ exactAddress: 'Via Roma 1', label: 'Дом', lat: 45.06, lng: 7.67, placeId: 'p1' }]}
        searchPlaces={noSearch}
      />,
    );

    expect(html).toContain('Мои места');
    expect(html).toContain('Дом');
    // A single-place field states no alternatives rule.
    expect(html).not.toContain('до 1 мест встречи');
  });
});

describe('PlacePicker', () => {
  const picker = (browserKey: string | null) => renderToStaticMarkup(
    <PlacePicker
      browserKey={browserKey}
      mapAvailable
      near={church}
      onCancel={() => {}}
      onConfirm={() => {}}
      searchPlaces={noSearch}
      title="Место встречи"
    />,
  );

  it('leads with address search and offers the manual fallback', () => {
    const html = picker('browser-key');

    expect(html).toContain('Найти адрес');
    expect(html).toContain('нажмите на карте, чтобы поставить отметку');
    expect(html).toContain('Карту можно двигать и приближать');
    expect(html).toContain('достаточно правильно отметить место на карте');
    expect(html).toContain('Подтвердить место');
  });

  // Permission is never requested on open; the action is the only entry point.
  it('requests the device location only from the explicit action', () => {
    const html = picker('browser-key');
    expect(html).toContain('Показать, где я');
    expect(html).not.toContain('getCurrentPosition');
  });

  it('mounts the interactive map with the church shown for orientation', () => {
    const html = picker('render-key');
    expect(html).toContain('data-interactive-map');
    // One marker for the church; the chosen place appears once a person picks it.
    expect(html).toContain('data-map-markers="1"');
    expect(html).toContain('Карта выбора места');
    // The render key never appears in the served markup.
    expect(html).not.toContain('render-key');
  });

  it('keeps search usable and states the limit when the map is unavailable', () => {
    const html = picker(null);

    expect(html).not.toContain('data-map-canvas');
    expect(html).toContain('Найти адрес');
    expect(html).toContain('Карта сейчас недоступна');
    expect(html).toContain('Отметить место на карте сейчас не получится');
    // No vendor name, status code, or technical cause reaches the person.
    expect(html).not.toContain('Geoapify');
    expect(html).not.toContain('API');
  });

  it('starts with confirmation disabled until a place is chosen', () => {
    expect(picker('browser-key')).toContain('disabled');
  });
});
