import type { Coordinate } from './types';

/**
 * Links that open a place or a route in another maps application.
 *
 * These are ordinary outbound links and nothing more. No Google or Yandex map, search, or
 * routing API is integrated: the embedded map, address search, and detour calculation all stay
 * on the selected provider. This exists only because a person who already decided to travel
 * somewhere wants their usual navigator, and duplicating a navigator inside Orthodox Routes
 * would be a far larger promise than the product makes.
 *
 * A link is offered only where it is actually useful: the public church location, and a place
 * already disclosed to a confirmed participant.
 */

export type ExternalMapTarget = {
  point: Coordinate;
  /** Shown as the destination name where the target application supports one. */
  label?: string;
};

export type ExternalMapLink = {
  id: 'google' | 'yandex';
  title: string;
  href: string;
};

function coordinatePair({ lat, lng }: Coordinate) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Opens the place itself, so the person can look before deciding to navigate. */
export function externalPlaceLinks(target: ExternalMapTarget): ExternalMapLink[] {
  const pair = coordinatePair(target.point);
  const google = new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api', '1');
  google.searchParams.set('query', pair);

  const yandex = new URL('https://yandex.ru/maps/');
  yandex.searchParams.set('ll', `${target.point.lng.toFixed(6)},${target.point.lat.toFixed(6)}`);
  yandex.searchParams.set('pt', `${target.point.lng.toFixed(6)},${target.point.lat.toFixed(6)}`);
  yandex.searchParams.set('z', '16');

  return [
    { href: google.toString(), id: 'google', title: 'Открыть в Google Картах' },
    { href: yandex.toString(), id: 'yandex', title: 'Открыть в Яндекс Картах' },
  ];
}

/**
 * Builds a driving route in the external application. The destination is the church and the
 * origin is left to the other application, which uses the device location the person already
 * granted it. Orthodox Routes never asks for a location in order to build this link.
 */
export function externalRouteLinks(target: ExternalMapTarget): ExternalMapLink[] {
  const pair = coordinatePair(target.point);
  const google = new URL('https://www.google.com/maps/dir/');
  google.searchParams.set('api', '1');
  google.searchParams.set('destination', pair);
  google.searchParams.set('travelmode', 'driving');

  const yandex = new URL('https://yandex.ru/maps/');
  yandex.searchParams.set('rtext', `~${target.point.lat.toFixed(6)},${target.point.lng.toFixed(6)}`);
  yandex.searchParams.set('rtt', 'auto');

  return [
    { href: google.toString(), id: 'google', title: 'Маршрут в Google Картах' },
    { href: yandex.toString(), id: 'yandex', title: 'Маршрут в Яндекс Картах' },
  ];
}
