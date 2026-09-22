import { describe, expect, it } from 'vitest';
import { hasValidBearerSecret } from './request-auth';

describe('notification worker request authentication', () => {
  it('accepts only the exact bearer secret', () => {
    const secret = 's'.repeat(32);
    expect(hasValidBearerSecret(new Request('https://example.test', {
      headers: { authorization: `Bearer ${secret}` },
    }), secret)).toBe(true);
    expect(hasValidBearerSecret(new Request('https://example.test', {
      headers: { authorization: `Bearer ${'x'.repeat(32)}` },
    }), secret)).toBe(false);
    expect(hasValidBearerSecret(new Request('https://example.test'), secret)).toBe(false);
  });
});
