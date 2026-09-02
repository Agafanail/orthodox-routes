import { describe, expect, it } from 'vitest';
import {
  parsePlaceInput,
  parsePlaceInputList,
  parsePublicPlace,
  parseSavedPlaces,
  parseSelectedPlace,
  placeToRpcInput,
  savedPlaceName,
} from './place';

const valid = {
  address: 'Via Roma 1',
  countryCode: 'IT',
  lat: 45.0703,
  lng: 7.6869,
  locality: 'Torino',
  sourceKind: 'user_confirmed_geocode',
};

describe('parseSelectedPlace', () => {
  it('accepts a confirmed place', () => {
    expect(parseSelectedPlace(valid)).toEqual({
      address: 'Via Roma 1',
      countryCode: 'IT',
      lat: 45.0703,
      lng: 7.6869,
      locality: 'Torino',
      sourceKind: 'user_confirmed_geocode',
    });
  });

  it('rejects a place without a coordinate or an address', () => {
    expect(parseSelectedPlace({ ...valid, lat: undefined })).toBeNull();
    expect(parseSelectedPlace({ ...valid, address: '   ' })).toBeNull();
    expect(parseSelectedPlace({ ...valid, lat: 95 })).toBeNull();
    expect(parseSelectedPlace({ ...valid, lng: 181 })).toBeNull();
  });

  it('rejects an invented source kind and a malformed country', () => {
    expect(parseSelectedPlace({ ...valid, sourceKind: 'guessed' })).toBeNull();
    expect(parseSelectedPlace({ ...valid, countryCode: 'italy' })).toBeNull();
  });

  it('rejects control characters in an address', () => {
    expect(parseSelectedPlace({ ...valid, address: `Via${String.fromCharCode(7)}Roma` })).toBeNull();
  });

  // A name only exists for a place the person chose to keep.
  it('rejects a label without saving', () => {
    expect(parseSelectedPlace({ ...valid, label: 'Дом' })).toBeNull();
    expect(parseSelectedPlace({ ...valid, label: 'Дом', save: true })).toMatchObject({ label: 'Дом', save: true });
  });

  // The public area is derived by the server; a caller must never be able to supply one.
  it('ignores any caller-supplied public area', () => {
    const parsed = parseSelectedPlace({ ...valid, public_area: { lat: 1, lng: 2 }, publicArea: { lat: 1 } });
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('ublic');
  });
});

describe('parsePlaceInput', () => {
  it('accepts a saved place reference', () => {
    expect(parsePlaceInput({ savedPlaceId: '11111111-1111-4111-8111-111111111111' }))
      .toEqual({ savedPlaceId: '11111111-1111-4111-8111-111111111111' });
  });

  it('rejects a malformed saved place reference', () => {
    expect(parsePlaceInput({ savedPlaceId: 'not-a-uuid' })).toBeNull();
  });
});

describe('parsePlaceInputList', () => {
  it('accepts up to the allowed number of places', () => {
    const payload = JSON.stringify([valid, { ...valid, address: 'Via Po 2' }]);
    expect(parsePlaceInputList(payload, 3)).toHaveLength(2);
  });

  it('rejects an empty list, an oversized list, and malformed JSON', () => {
    expect(parsePlaceInputList(JSON.stringify([]), 3)).toBeNull();
    expect(parsePlaceInputList(JSON.stringify([valid, valid, valid, valid]), 3)).toBeNull();
    expect(parsePlaceInputList('{', 3)).toBeNull();
    expect(parsePlaceInputList(undefined, 3)).toBeNull();
  });

  it('rejects the whole list when one entry is invalid', () => {
    expect(parsePlaceInputList(JSON.stringify([valid, { address: 'x' }]), 3)).toBeNull();
  });
});

describe('placeToRpcInput', () => {
  it('maps a confirmed place to the database shape', () => {
    expect(placeToRpcInput(parseSelectedPlace(valid)!)).toEqual({
      address: 'Via Roma 1',
      country_code: 'IT',
      lat: 45.0703,
      lng: 7.6869,
      locality: 'Torino',
      source_kind: 'user_confirmed_geocode',
    });
  });

  it('maps a saved place reference', () => {
    expect(placeToRpcInput({ savedPlaceId: '11111111-1111-4111-8111-111111111111' }))
      .toEqual({ saved_place_id: '11111111-1111-4111-8111-111111111111' });
  });
});

describe('parsePublicPlace', () => {
  it('reads the approximate area', () => {
    expect(parsePublicPlace({
      place_id: '11111111-1111-4111-8111-111111111111',
      public_area: { lat: 45.07, lng: 7.68, radius_m: 1000 },
      public_area_label: 'Torino',
    })).toEqual({
      placeId: '11111111-1111-4111-8111-111111111111',
      publicArea: { lat: 45.07, lng: 7.68, radiusM: 1000 },
      publicAreaLabel: 'Torino',
    });
  });

  // A pre-map record has a label but no circle; the board must still show it.
  it('accepts a place without an area', () => {
    expect(parsePublicPlace({ place_id: 'a', public_area_label: 'Torino' }))
      .toEqual({ placeId: 'a', publicAreaLabel: 'Torino' });
  });
});

describe('parseSavedPlaces', () => {
  it('reads saved places and falls back to the address for a name', () => {
    const places = parseSavedPlaces([
      { exact_address: 'Via Roma 1', lat: 45.07, lng: 7.68, place_id: 'a' },
      { exact_address: 'Via Po 2', label: 'Дом', lat: 45.06, lng: 7.67, place_id: 'b' },
      { place_id: 'broken' },
    ]);
    expect(places).toHaveLength(2);
    expect(savedPlaceName(places[0])).toBe('Via Roma 1');
    expect(savedPlaceName(places[1])).toBe('Дом');
  });
});
