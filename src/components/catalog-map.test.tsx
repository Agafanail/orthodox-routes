import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The catalog renders a client action that navigates; only its presence is under test here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

function parseMapUrl(html: string) {
  const match = html.match(/src="([^"]*staticmap[^"]*)"/);
  if (!match) return null;
  return new URL(match[1].replaceAll('&amp;', '&'));
}

describe('CatalogMap', () => {
  it('plots every returned church and shows the required attribution', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey="browser-key" churches={[church, far]} mapAvailable near={null} />,
    );
    const url = parseMapUrl(html)!;

    expect(url.origin + url.pathname).toBe('https://maps.geoapify.com/v1/staticmap');
    expect(url.searchParams.getAll('marker')).toHaveLength(2);
    expect(html).toContain('data-church-pins="2"');
    // The licence obligation is part of the surface, not an optional extra.
    expect(html).toContain('OpenStreetMap');
  });

  it('frames both churches into one view rather than centring on one', () => {
    const url = parseMapUrl(renderToStaticMarkup(
      <CatalogMap browserKey="browser-key" churches={[church, far]} mapAvailable near={null} />,
    ))!;
    const zoom = Number(url.searchParams.get('zoom'));
    // Two churches nearly a thousand kilometres apart cannot share a close zoom.
    expect(zoom).toBeLessThan(10);
  });

  it('marks the person location only when they asked for it', () => {
    const without = parseMapUrl(renderToStaticMarkup(
      <CatalogMap browserKey="browser-key" churches={[church]} mapAvailable near={null} />,
    ))!;
    expect(without.searchParams.getAll('marker')).toHaveLength(1);

    const withLocation = renderToStaticMarkup(
      <CatalogMap browserKey="browser-key" churches={[church]} mapAvailable near={{ lat: 45.07, lng: 7.68 }} />,
    );
    expect(parseMapUrl(withLocation)!.searchParams.getAll('marker')).toHaveLength(2);
    expect(withLocation).toContain('data-user-located="true"');
  });

  // The list is the dependable half: a missing map never blocks finding a church.
  it('explains itself without imagery and never invents a map', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey={null} churches={[church]} mapAvailable={false} near={null} />,
    );
    expect(html).toContain('Карта сейчас недоступна');
    expect(html).toContain('Список храмов рядом работает как обычно');
    expect(parseMapUrl(html)).toBeNull();
  });

  it('does not request imagery when no key is available even if a map is expected', () => {
    const html = renderToStaticMarkup(
      <CatalogMap browserKey={null} churches={[church]} mapAvailable near={null} />,
    );
    expect(parseMapUrl(html)).toBeNull();
  });
});

describe('ChurchCatalog', () => {
  it('offers one universal search and the explicit location action', () => {
    const html = renderToStaticMarkup(
      <ChurchCatalog browserKey="browser-key" churches={[church]} mapAvailable near={null} query="" />,
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
      <ChurchCatalog browserKey="browser-key" churches={[church]} mapAvailable near={null} query="" />,
    );
    expect(without).not.toContain('от вас');

    const withLocation = renderToStaticMarkup(
      <ChurchCatalog
        browserKey="browser-key"
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
      <ChurchCatalog browserKey="browser-key" churches={[]} mapAvailable near={null} query="нет" />,
    );
    expect(html).toContain('Храмы не найдены');
  });
});
