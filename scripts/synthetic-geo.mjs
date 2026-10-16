// Shared synthetic geography for local verification scripts.
//
// Every coordinate here is invented test data. Verification never uses a real person's
// location, a production record, or a map-provider response.

/** One confirmed place in the shape the protected publication RPCs accept. */
export function syntheticPlace(latitude, longitude, address, locality, extra = {}) {
  return {
    address,
    country_code: 'IT',
    lat: latitude,
    lng: longitude,
    locality,
    source_kind: 'user_confirmed_geocode',
    ...extra,
  };
}

/** Great-circle distance in metres, used only to assert privacy distances in tests. */
export function haversineMetres(fromLat, fromLng, toLat, toLng) {
  const earthRadius = 6371008.8;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Compare a complete geographic point, not one coincidentally unchanged axis. */
export function containsExactCoordinate(value, exactLat, exactLng) {
  const same = (candidate, exact) => typeof candidate === 'number' && Math.abs(candidate - exact) < 1e-9;
  if (Array.isArray(value)) {
    if (value.length === 2 && same(value[0], exactLng) && same(value[1], exactLat)) return true;
    return value.some((item) => containsExactCoordinate(item, exactLat, exactLng));
  }
  if (!value || typeof value !== 'object') return false;
  if (same(value.lat, exactLat) && same(value.lng, exactLng)) return true;
  return Object.values(value).some((item) => containsExactCoordinate(item, exactLat, exactLng));
}
