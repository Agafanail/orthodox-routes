import { describe, expect, it } from 'vitest';
import {
  EMAIL_VALIDATION_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  clearPassengerRequestDraftFieldError,
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
  validatePassengerRequestDraft,
  type PassengerRequestDraft,
} from './passengerRequestValidation';
import { getChurchServiceOptions, getFutureChurchServices } from './serviceOptions';
import type { ChurchService } from './types';

const services: ChurchService[] = [
  { id: 'service-1', name: 'Литургия', date: '2026-07-20', startTime: '09:00' },
];
const now = new Date(2026, 6, 19, 12, 0);

describe('passenger request field errors', () => {
  it('removes only the selected field error without mutating the original object', () => {
    const errors = { firstName: 'Name error', phone: 'Phone error' };

    const result = clearPassengerRequestDraftFieldError(errors, 'firstName');

    expect(result).toEqual({ phone: 'Phone error' });
    expect(result).not.toBe(errors);
    expect(errors).toEqual({ firstName: 'Name error', phone: 'Phone error' });
  });

  it('preserves all errors when the selected field has no error', () => {
    const errors = { phone: 'Phone error', consent: 'Consent error' };

    const result = clearPassengerRequestDraftFieldError(errors, 'email');

    expect(result).toBe(errors);
    expect(result).toEqual(errors);
  });
});

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
    selectedServiceId: 'service-1',
    date: '',
    passengerCount: '1',
    pickupArea: 'Вокзал',
    comment: '',
    consent: true,
  };

  it('preserves the phone validation message', () => {
    const result = validatePassengerRequestDraft({ ...validDraft, phone: '12345' }, true, now, services);
    expect(result.errors.phone).toBe(PHONE_VALIDATION_MESSAGE);
  });

  it('preserves the email validation message', () => {
    const result = validatePassengerRequestDraft({ ...validDraft, email: 'invalid' }, true, now, services);
    expect(result.errors.email).toBe(EMAIL_VALIDATION_MESSAGE);
  });

  it('uses the shared church service options', () => {
    expect(getChurchServiceOptions(getFutureChurchServices(services, now))).toEqual([
      { value: 'service-1', label: 'Литургия — 20.07.2026, 09:00' },
    ]);
  });

  it('supports a no-schedule church with another date', () => {
    const result = validatePassengerRequestDraft(
      { ...validDraft, selectedServiceId: '', date: '2026-07-20' },
      true,
      now,
      [],
    );
    expect(result.errors.selectedServiceId).toBeUndefined();
    expect(result.errors.date).toBeUndefined();
  });
});
