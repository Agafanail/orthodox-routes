import { describe, expect, it } from 'vitest';
import { canStepCount, maximumCount, minimumCount, stepCount } from './count-control';

describe('shared count control boundaries', () => {
  it('stops decrementing and incrementing at the supported boundaries', () => {
    expect(canStepCount(String(minimumCount), -1)).toBe(false);
    expect(stepCount(String(minimumCount), -1)).toBe(String(minimumCount));
    expect(canStepCount(String(maximumCount), 1)).toBe(false);
    expect(stepCount(String(maximumCount), 1)).toBe(String(maximumCount));
  });

  it('steps an editable value within the range', () => {
    expect(stepCount('2', -1)).toBe('1');
    expect(stepCount('2', 1)).toBe('3');
    expect(canStepCount('23', -1)).toBe(true);
    expect(canStepCount('23', 1)).toBe(true);
  });

  it.each(['', '1.5', 'abc', '56'])('does not step an invalid direct input: %s', (value) => {
    expect(canStepCount(value, -1)).toBe(false);
    expect(canStepCount(value, 1)).toBe(false);
    expect(stepCount(value, 1)).toBe(value);
  });
});
