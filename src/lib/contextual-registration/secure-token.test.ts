import { describe, expect, it } from 'vitest';
import {
  deriveContextualRateKey,
  isContextualCapability,
  isContextualTicket,
  openContextualResume,
  sealContextualResume,
} from './secure-token';

const secret = 'contextual-test-secret-that-is-long-enough';
const capability = 'a'.repeat(64);
const expiresAt = '2026-08-16T12:00:00.000Z';

describe('contextual resume protection', () => {
  it('round-trips an unexpired capability without placing it in the ticket', () => {
    const ticket = sealContextualResume({ capability, expiresAt }, secret);
    expect(isContextualTicket(ticket)).toBe(true);
    expect(ticket).not.toContain(capability);
    expect(openContextualResume(ticket, secret, new Date('2026-08-15T12:00:00.000Z'))).toEqual({
      capability,
      expiresAt,
    });
  });

  it('rejects tampering, a different secret, and expiry', () => {
    const ticket = sealContextualResume({ capability, expiresAt }, secret);
    const tamperedParts = ticket.split('.');
    tamperedParts[2] = `${tamperedParts[2][0] === 'a' ? 'b' : 'a'}${tamperedParts[2].slice(1)}`;
    expect(openContextualResume(tamperedParts.join('.'), secret)).toBeNull();
    expect(openContextualResume(ticket, `${secret}-different`)).toBeNull();
    expect(openContextualResume(ticket, secret, new Date(expiresAt))).toBeNull();
  });

  it('validates only full-strength database capabilities and bounded tickets', () => {
    expect(isContextualCapability(capability)).toBe(true);
    expect(isContextualCapability('A'.repeat(64))).toBe(false);
    expect(isContextualCapability('short')).toBe(false);
    expect(isContextualTicket(`v1.${'a'.repeat(16)}.${'b'.repeat(1025)}.${'c'.repeat(22)}`)).toBe(false);
  });

  it('derives stable non-reversible rate keys without retaining the network value', () => {
    const first = deriveContextualRateKey('203.0.113.9', secret);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(deriveContextualRateKey('203.0.113.9', secret));
    expect(first).not.toBe(deriveContextualRateKey('203.0.113.10', secret));
    expect(first).not.toContain('203.0.113.9');
  });
});
