'use server';

import { GeoProviderUnavailableError } from '@/lib/geo/provider';
import { resolveGeoProvider } from '@/lib/geo/provider-factory';
import type { Coordinate, PlaceCandidate } from '@/lib/geo/types';

/**
 * Address search for the place picker.
 *
 * It runs on the server so the provider's server key never reaches a browser, so the query can
 * be bounded, and so a provider outage becomes one ordinary sentence rather than a vendor error.
 * Nothing about the person is sent: only the text they typed and, at most, the public location
 * of the church they are already looking at.
 */

export type PlaceSearchResult = {
  candidates: PlaceCandidate[];
  /** False when the search could not run at all, which the picker states in plain words. */
  available: boolean;
};

const MAX_QUERY_LENGTH = 200;

export async function searchPlacesAction(query: string, near?: Coordinate): Promise<PlaceSearchResult> {
  const text = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY_LENGTH) : '';
  if (text.length === 0) return { available: true, candidates: [] };

  const provider = resolveGeoProvider();
  if (!provider) return { available: false, candidates: [] };

  const bias = near
    && Number.isFinite(near.lat) && Number.isFinite(near.lng)
    && Math.abs(near.lat) <= 85 && Math.abs(near.lng) <= 180
    ? { lat: near.lat, lng: near.lng }
    : undefined;

  try {
    const candidates = await provider.searchPlaces(text, {
      language: 'ru',
      limit: 8,
      ...(bias ? { near: bias } : {}),
    });
    return { available: true, candidates };
  } catch (error) {
    // A provider outage is an ordinary state here, not something to report in detail.
    if (error instanceof GeoProviderUnavailableError) return { available: false, candidates: [] };
    return { available: false, candidates: [] };
  }
}
