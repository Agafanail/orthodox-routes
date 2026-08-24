import { describe, expect, it } from 'vitest';
import { externalPlaceLinks, externalRouteLinks } from './external-maps';

const point = { lat: 45.0703, lng: 7.6869 };

describe('externalPlaceLinks', () => {
  it('opens the place in both external applications', () => {
    const links = externalPlaceLinks({ point });
    expect(links.map((link) => link.id)).toEqual(['google', 'yandex']);

    const google = new URL(links[0].href);
    expect(google.host).toBe('www.google.com');
    expect(google.searchParams.get('query')).toBe('45.070300,7.686900');

    const yandex = new URL(links[1].href);
    expect(yandex.host).toBe('yandex.ru');
    expect(yandex.searchParams.get('pt')).toBe('7.686900,45.070300');
  });
});

describe('externalRouteLinks', () => {
  it('sets only the destination and leaves the origin to the other application', () => {
    const [google, yandex] = externalRouteLinks({ point });

    const googleUrl = new URL(google.href);
    expect(googleUrl.searchParams.get('destination')).toBe('45.070300,7.686900');
    expect(googleUrl.searchParams.get('travelmode')).toBe('driving');
    // No origin is sent: Orthodox Routes never asks for a location to build this link.
    expect(googleUrl.searchParams.get('origin')).toBeNull();

    const yandexUrl = new URL(yandex.href);
    expect(yandexUrl.searchParams.get('rtext')).toBe('~45.070300,7.686900');
    expect(yandexUrl.searchParams.get('rtt')).toBe('auto');
  });
});

describe('external links stay links', () => {
  // These must never become an embedded map, search, or routing integration.
  it('targets only the public web pages of the other applications', () => {
    const all = [...externalPlaceLinks({ point }), ...externalRouteLinks({ point })];
    for (const link of all) {
      const url = new URL(link.href);
      expect(url.protocol).toBe('https:');
      expect(['www.google.com', 'yandex.ru']).toContain(url.host);
      expect(url.pathname).toMatch(/^\/maps/);
      // No key, token, or account identifier is attached to an outbound link.
      expect(link.href.toLowerCase()).not.toMatch(/apikey|key=|token/);
    }
  });

  it('rounds coordinates rather than passing raw precision along', () => {
    const [google] = externalPlaceLinks({ point: { lat: 45.07031234567, lng: 7.68691234567 } });
    expect(new URL(google.href).searchParams.get('query')).toBe('45.070312,7.686912');
  });
});
