import { describe, expect, it } from 'vitest';
import {
  addedKilometres,
  addedMinutes,
  detourSummary,
  matchesOccurrence,
  matchesRequest,
  parseQualityMatches,
} from './match';

const raw = [{
  added_distance_m: 4200,
  added_duration_s: 480,
  arrival_at: '2026-09-01T09:00:00Z',
  available_seats: 3,
  current_role: 'passenger',
  departure_at: '2026-09-01T08:00:00Z',
  occurrence_id: '20000000-0000-4000-8000-000000000001',
  passenger_count: 2,
  places: [
    { added_distance_m: 4200, added_duration_s: 480, best: true, place_id: 'a', position: 1, public_area_label: 'Torino' },
    { added_distance_m: 6100, added_duration_s: 700, best: false, place_id: 'b', position: 2, public_area_label: 'Moncalieri' },
  ],
  request_id: '10000000-0000-4000-8000-000000000001',
  timezone: 'UTC',
}];

describe('parseQualityMatches', () => {
  it('reads a match and its alternative places', () => {
    const [match] = parseQualityMatches(raw);
    expect(match.currentRole).toBe('passenger');
    expect(match.places).toHaveLength(2);
    expect(match.places[0].best).toBe(true);
    expect(match.places[1].best).toBe(false);
  });

  it('drops a malformed match rather than guessing', () => {
    expect(parseQualityMatches([{ ...raw[0], current_role: 'observer' }])).toEqual([]);
    expect(parseQualityMatches([{ ...raw[0], added_distance_m: 'far' }])).toEqual([]);
    expect(parseQualityMatches([{ ...raw[0], places: [] }])).toEqual([]);
    expect(parseQualityMatches(null)).toEqual([]);
  });
});

describe('detour explanation', () => {
  it('rounds kilometres the way the approved copy shows them', () => {
    expect(addedKilometres(4200)).toBe(4);
    expect(addedKilometres(700)).toBe(0.7);
    expect(addedKilometres(80)).toBe(0);
  });

  it('rounds minutes and never returns a negative value', () => {
    expect(addedMinutes(480)).toBe(8);
    expect(addedMinutes(20)).toBe(0);
    expect(addedMinutes(-5)).toBe(0);
  });

  it('states the detour in concrete terms rather than as a score', () => {
    expect(detourSummary({ addedDistanceM: 4200, addedDurationS: 480 }))
      .toBe('+4 км · примерно +8 мин');
    expect(detourSummary({ addedDistanceM: 700, addedDurationS: 90 }))
      .toBe('+0,7 км · примерно +2 мин');
  });

  // A detour that rounds away entirely must not read as a misleading "+0 км".
  it('describes a negligible detour as being on the way', () => {
    expect(detourSummary({ addedDistanceM: 40, addedDurationS: 10 })).toBe('По пути · без заезда');
  });
});

describe('match lookup', () => {
  it('matches a driver offer only for the passenger side', () => {
    const matches = parseQualityMatches(raw);
    expect(matchesOccurrence(matches, '20000000-0000-4000-8000-000000000001')).toBe(true);
    expect(matchesRequest(matches, '10000000-0000-4000-8000-000000000001')).toBe(false);
  });

  it('matches a passenger request only for the driver side', () => {
    const matches = parseQualityMatches([{ ...raw[0], current_role: 'driver' }]);
    expect(matchesRequest(matches, '10000000-0000-4000-8000-000000000001')).toBe(true);
    expect(matchesOccurrence(matches, '20000000-0000-4000-8000-000000000001')).toBe(false);
  });
});
