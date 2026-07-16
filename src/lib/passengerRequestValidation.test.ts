import { describe, expect, it } from 'vitest';
import {
  EMAIL_VALIDATION_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
  validatePassengerRequestDraft,
  type PassengerRequestDraft,
} from './passengerRequestValidation';

describe('phone validation', () => {
  it.each([
    ['+39 333 123 4567', '+393331234567'],
    ['+39 (333) 123-45-67', '+393331234567'],
    ['+375291234567', '+375291234567'],
  ])('normalizes and accepts %s', (input, normalized) => {
    expect(normalizePhone(input)).toBe(normalized);
    expect(isInternationalPhoneValid(input)).toBe(true);
  });

  it.each([
    ['number without plus', '393331234567'],
    ['number beginning with +0', '+0123456789'],
    ['too few digits', '+1234567'],
    ['more than 15 digits after plus', '+1234567890123456'],
    ['letters inside the number', '+39 333 ABC 4567'],
    ['empty value', ''],
  ])('rejects %s', (_label, input) => {
    expect(isInternationalPhoneValid(input)).toBe(false);
  });
});

describe('optional email validation', () => {
  it.each(['', '   ', 'name@example.com'])('accepts %j', (email) => {
    expect(isOptionalEmailValid(email)).toBe(true);
  });

  it.each(['nameexample.com', 'name@', '@example.com', 'name @example.com'])('rejects %j', (email) => {
    expect(isOptionalEmailValid(email)).toBe(false);
  });
});

describe('passenger request draft messages', () => {
  const validDraft: PassengerRequestDraft = {
    firstName: 'Мария',
    phone: '+39 333 123 4567',
    email: '',
    serviceEvent: 'Литургия',
    passengerCount: '1',
    pickupArea: 'Вокзал',
    comment: '',
    consent: true,
  };

  it('preserves the phone validation message', () => {
    const result = validatePassengerRequestDraft({ ...validDraft, phone: '12345' }, true);
    expect(result.errors.phone).toBe(PHONE_VALIDATION_MESSAGE);
  });

  it('preserves the email validation message', () => {
    const result = validatePassengerRequestDraft({ ...validDraft, email: 'invalid' }, true);
    expect(result.errors.email).toBe(EMAIL_VALIDATION_MESSAGE);
  });
});
