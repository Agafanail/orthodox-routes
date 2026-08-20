import { describe, expect, it } from 'vitest';
import { zonedLocalDateTimeToIso } from './time';

describe('zonedLocalDateTimeToIso', () => {
  it('converts a church-local value without trusting the server timezone', () => {
    expect(zonedLocalDateTimeToIso('2026-08-23T10:30', 'Europe/Rome'))
      .toBe('2026-08-23T08:30:00.000Z');
  });

  it('rejects nonexistent local wall-clock times and unknown zones', () => {
    expect(zonedLocalDateTimeToIso('2026-03-29T02:30', 'Europe/Rome')).toBeNull();
    expect(zonedLocalDateTimeToIso('2026-08-23T10:30', 'Not/AZone')).toBeNull();
  });
});
