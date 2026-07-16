import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dateFormat';

describe('date formatting', () => {
  it('formats an ISO date as dd.mm.yyyy', () => {
    expect(formatDate('2026-07-19')).toBe('19.07.2026');
  });

  it('formats date and time without timezone conversion', () => {
    expect(formatDateTime('2026-07-19', '07:55')).toBe('19.07.2026 в 07:55');
  });

  it('returns an unexpected non-ISO date unchanged', () => {
    expect(formatDate('19 July 2026')).toBe('19 July 2026');
  });

  it('is deterministic because it does not use machine timezone parsing', () => {
    expect(formatDateTime('2026-07-19', '00:15')).toBe('19.07.2026 в 00:15');
  });
});
