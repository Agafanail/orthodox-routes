import { describe, expect, it } from 'vitest';
import {
  EMAIL_VALIDATION_MESSAGE,
  PHONE_VALIDATION_MESSAGE,
  clearPassengerRequestDraftFieldError,
  isInternationalPhoneValid,
  isOptionalEmailValid,
  normalizePhone,
  parsePassengerRequestDraft,
  validatePassengerRequestField,
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

  it('reports every required passenger field and enforces the shared count range', () => {
    const result = validatePassengerRequestDraft(
      {
        firstName: '', phone: '', email: '', selectedServiceId: '', date: '',
        passengerCount: '56', pickupArea: '', comment: '', consent: false,
      },
      true,
      now,
      services,
    );

    expect(result.errors).toMatchObject({
      firstName: 'Введите имя.',
      phone: PHONE_VALIDATION_MESSAGE,
      passengerCount: 'Укажите количество пассажиров от 1 до 55.',
      pickupArea: 'Укажите удобную точку встречи.',
      consent: 'Нужно подтвердить согласие на передачу контакта водителю.',
    });
    expect(result.errors.selectedServiceId ?? result.errors.date).toBeTruthy();
    expect(validatePassengerRequestDraft({ ...validDraft, passengerCount: '1.5' }, true, now, services).errors.passengerCount).toBeTruthy();
  });

  it('validates one field without changing the validation rules for other fields', () => {
    expect(validatePassengerRequestField({ ...validDraft, phone: '12345' }, 'phone', true, now, services)).toBe(PHONE_VALIDATION_MESSAGE);
    expect(validatePassengerRequestField({ ...validDraft, phone: '12345' }, 'firstName', true, now, services)).toBeUndefined();
  });

  it('always resets stored contact consent while preserving the other draft values', () => {
    expect(parsePassengerRequestDraft({ ...validDraft, consent: true })).toEqual({ ...validDraft, consent: false });
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

  it('treats service and alternative date as one required exclusive choice', () => {
    expect(validatePassengerRequestDraft(validDraft, true, now, services).errors.selectedServiceId)
      .toBeUndefined();
    expect(validatePassengerRequestDraft(
      { ...validDraft, selectedServiceId: '', date: '2026-07-21' },
      true,
      now,
      services,
    ).errors).not.toHaveProperty('date');
    expect(validatePassengerRequestDraft(
      { ...validDraft, selectedServiceId: '', date: '' },
      true,
      now,
      services,
    ).errors.selectedServiceId).toBeTruthy();
    expect(validatePassengerRequestDraft(
      { ...validDraft, date: '2026-07-21' },
      true,
      now,
      services,
    ).errors.selectedServiceId).toBeTruthy();
  });
});
