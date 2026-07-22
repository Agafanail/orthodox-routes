import { describe, expect, it } from 'vitest';
import {
  formatAgreementCount,
  formatAvailableOfTotal,
  formatOccupiedOfTotal,
  formatPassengerCount,
  formatSeatCount,
} from './russianCount';

describe('formatSeatCount', () => {
  it.each([
    [0, '0 мест'],
    [1, '1 место'],
    [2, '2 места'],
    [4, '4 места'],
    [5, '5 мест'],
    [11, '11 мест'],
    [14, '14 мест'],
    [21, '21 место'],
    [23, '23 места'],
  ])('formats %i with the correct Russian noun form', (count, expected) => {
    expect(formatSeatCount(count)).toBe(expected);
  });
});

describe('public board count copy', () => {
  it.each([
    [1, '1 пассажир'],
    [2, '2 пассажира'],
    [5, '5 пассажиров'],
    [11, '11 пассажиров'],
    [21, '21 пассажир'],
  ])('formats %i passengers', (count, expected) => {
    expect(formatPassengerCount(count)).toBe(expected);
  });

  it('formats completed passenger-request totals', () => {
    expect(formatAgreementCount(1, 1)).toBe('1 из 1 человека договорился о поездке');
    expect(formatAgreementCount(4, 4)).toBe('4 из 4 человек договорились о поездке');
    expect(formatAgreementCount(21, 21)).toBe('21 из 21 человека договорились о поездке');
  });

  it('formats partial trip availability with the total in the genitive form', () => {
    expect(formatAvailableOfTotal(2, 4)).toBe('Свободно 2 из 4 мест');
    expect(formatAvailableOfTotal(1, 21)).toBe('Свободно 1 из 21 места');
  });

  it('formats occupied seats with the total in the genitive form', () => {
    expect(formatOccupiedOfTotal(2, 3)).toBe('Занято 2 из 3 мест');
    expect(formatOccupiedOfTotal(1, 1)).toBe('Занято 1 из 1 места');
  });
});
