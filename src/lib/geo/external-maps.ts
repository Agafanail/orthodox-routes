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

/**
 * Opens one point on Yandex Maps.
 *
 * Yandex orders `ll`, `pt`, and `whatshere[point]` as longitude first and `rtext` as latitude
 * first. Getting that backwards silently lands somewhere else entirely, so the order is written
 * out here once and every caller reuses it. `whatshere` is what makes Yandex name the point and
 * offer its own route action beside it.
 */
function yandexPlaceUrl({ lat, lng }: Coordinate) {
  const pair = `${lng.toFixed(6)},${lat.toFixed(6)}`;
  const url = new URL('https://yandex.ru/maps/');
  url.searchParams.set('ll', pair);
  url.searchParams.set('z', '17');
  url.searchParams.set('pt', pair);
  url.searchParams.set('whatshere[point]', pair);
  url.searchParams.set('whatshere[zoom]', '17');
  return url;
}

/** Opens the place itself, so the person can look before deciding to navigate. */
export function externalPlaceLinks(target: ExternalMapTarget): ExternalMapLink[] {
  const pair = coordinatePair(target.point);
  const google = new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api', '1');
  google.searchParams.set('query', pair);

  const yandex = yandexPlaceUrl(target.point);

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

  // Yandex documents `rtext` as `lat,lon~lat,lon`: both ends of the route, never one. An empty
  // origin is not part of the scheme, and supplying it produced a generic map in an unrelated
  // region rather than anything about this church. Building a real two-point route would mean
  // learning where the person is, which this product refuses to do for the sake of a link.
  //
  // So the church is opened as a place instead, through the documented `whatshere` form. Yandex
  // names the point and offers its own «Маршрут» beside it, which starts from the location the
  // person already granted Yandex. The origin therefore never passes through Orthodox Routes.
  const yandex = yandexPlaceUrl(target.point);

  return [
    { href: google.toString(), id: 'google', title: 'Маршрут в Google Картах' },
    { href: yandex.toString(), id: 'yandex', title: 'Открыть в Яндекс Картах' },
  ];
}
