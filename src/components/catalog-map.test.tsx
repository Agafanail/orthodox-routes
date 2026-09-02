import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The catalog renders a client action that navigates; only its presence is under test here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { BoardMap } from './board-map';
import { CatalogMap } from './catalog-map';
import { ChurchCatalog } from './church-catalog';

const church = {
  address: 'Via Roma 1',
  churchId: '00000000-0000-4000-8000-000000000001',
  countryCode: 'IT',
  lat: 45.0703,
  slug: 'test-church',
  lng: 7.6869,
  locality: 'Torino',
  officialName: 'Тестовый храм',
  timezone: 'Europe/Rome',
};

const far = {
  ...church,
  churchId: '00000000-0000-4000-8000-000000000002',
  lat: 38.1157,
  lng: 13.3614,
  locality: 'Palermo',
  officialName: 'Дальний храм',
  slug: 'far-church',
};

describe('CatalogMap', () => {
  it('mounts the shared interactive map with one pin per returned church', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey="render-key" churches={[church, far]} mapAvailable near={null} />,
    );

    expect(html).toContain('data-interactive-map');
    expect(html).toContain('data-map-markers="2"');
    expect(html).toContain('data-church-pins="2"');
    // The licence obligation is part of the surface, not an optional extra.
    expect(html).toContain('OpenStreetMap');
    expect(html).toContain('Geoapify');
  });

  it('adds the person marker only when they asked to be located', () => {
    const without = renderToStaticMarkup(
      <CatalogMap browserKey="render-key" churches={[church]} mapAvailable near={null} />,
    );
    expect(without).toContain('data-map-markers="1"');

    const withLocation = renderToStaticMarkup(
      <CatalogMap browserKey="render-key" churches={[church]} mapAvailable near={{ lat: 45.07, lng: 7.68 }} />,
    );
    expect(withLocation).toContain('data-map-markers="2"');
    expect(withLocation).toContain('data-user-located="true"');
  });

  // The list is the dependable half: a missing map never blocks finding a church.
  it('explains itself without a render key and never invents a map', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey={null} churches={[church]} mapAvailable={false} near={null} />,
    );
    expect(html).toContain('data-map-unavailable');
    expect(html).toContain('Список храмов рядом работает как обычно');
    expect(html).not.toContain('data-map-canvas');
  });

  it('withholds the map when a key exists but the surface is disabled', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey="render-key" churches={[church]} mapAvailable={false} near={null} />,
    );
    expect(html).toContain('data-map-unavailable');
  });
});

describe('ChurchCatalog', () => {
  it('offers one universal search and the explicit location action', () => {
    const html = renderToStaticMarkup(
      <ChurchCatalog browserKey="render-key" churches={[church]} mapAvailable near={null} query="" />,
    );

    expect(html).toContain('name="q"');
    expect(html).toContain('Поиск храма');
    expect(html).toContain('Рядом со мной');
    expect(html).toContain('Тестовый храм');
    expect(html).toContain('Via Roma 1');
    // No separate country or locality filter exists on the public catalog.
    expect(html).not.toContain('Страна');
  });

  it('shows an approximate distance only when a location was supplied', () => {
    const without = renderToStaticMarkup(
      <ChurchCatalog browserKey="render-key" churches={[church]} mapAvailable near={null} query="" />,
    );
    expect(without).not.toContain('от вас');

    const withLocation = renderToStaticMarkup(
      <ChurchCatalog
        browserKey="render-key"
        churches={[{ ...church, distanceM: 23400 }]}
        mapAvailable
        near={{ lat: 45.07, lng: 7.68 }}
        query=""
      />,
    );
    expect(withLocation).toContain('≈23 км от вас');
    expect(withLocation).toContain('Расстояние примерное');
  });

  it('says plainly when a search found nothing', () => {
    const html = renderToStaticMarkup(
      <ChurchCatalog browserKey="render-key" churches={[]} mapAvailable near={null} query="нет" />,
    );
    expect(html).toContain('Храмы не найдены');
  });
});

describe('BoardMap', () => {
  const coreChurch = {
    address: 'Via Roma 1',
    churchId: 'c1',
    countryCode: 'IT',
    lat: 45.0703,
    lng: 7.6869,
    locality: 'Torino',
    officialName: 'Тестовый храм',
    slug: 'test-church',
    timezone: 'UTC',
  };

  const request = {
    authorName: 'Анна',
    childSeatRequired: false,
    childrenCount: 0,
    churchId: 'c1',
    desiredArrivalAt: '2026-09-01T09:00:00Z',
    passengerCount: 1,
    placeOptions: [{
      placeId: 'p1',
      publicArea: { lat: 45.06, lng: 7.67, radiusM: 1000 },
      publicAreaLabel: 'Torino',
    }],
    requestId: 'r1',
    returnRequired: false,
    timezone: 'UTC',
  };

  const offer = {
    arrivalAt: '2026-09-01T09:00:00Z',
    authorName: 'Иван',
    availableSeats: 3,
    childrenAllowed: true,
    churchId: 'c1',
    departureAt: '2026-09-01T08:00:00Z',
    driverChildSeatAvailable: true,
    maxDetourKm: 5,
    occurrenceId: 'o1',
    originArea: {
      placeId: 'p2',
      publicArea: { lat: 45.03, lng: 7.64, radiusM: 1000 },
      publicAreaLabel: 'Moncalieri',
    },
    publicOriginArea: 'Moncalieri',
    returnAvailable: false,
    timezone: 'UTC',
  };

  it('draws the exact church and both kinds of approximate area', () => {
    const html = renderToStaticMarkup(
      <BoardMap
        browserKey="render-key"
        church={coreChurch}
        driverOccurrences={[offer]}
        mapAvailable
        passengerRequests={[request]}
      />,
    );

    expect(html).toContain('Поездки на карте');
    expect(html).toContain('data-map-markers="1"');
    expect(html).toContain('data-map-areas="2"');
    expect(html).toContain('Маршрут поездки не показывается');
  });

  // The map is a second view of the same listings, never a replacement for the board.
  it('is absent when the group has no approximate area to show', () => {
    const html = renderToStaticMarkup(
      <BoardMap
        browserKey="render-key"
        church={coreChurch}
        driverOccurrences={[]}
        mapAvailable
        passengerRequests={[]}
      />,
    );
    expect(html).toBe('');
  });

  it('is absent when the church has no published location', () => {
    const html = renderToStaticMarkup(
      <BoardMap
        browserKey="render-key"
        church={{ ...coreChurch, lat: undefined, lng: undefined }}
        driverOccurrences={[offer]}
        mapAvailable
        passengerRequests={[request]}
      />,
    );
    expect(html).toBe('');
  });
});
