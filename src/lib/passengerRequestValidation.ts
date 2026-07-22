import { validateServiceSelection } from './serviceOptions';
import type { ChurchService } from './types';

export type PassengerRequestDraft = {
  firstName: string;
  phone: string;
  email: string;
  selectedServiceId: string;
  date: string;
  passengerCount: string;
  pickupArea: string;
  comment: string;
  consent: boolean;
};

export type PassengerRequestDraftErrors = Partial<Record<keyof PassengerRequestDraft, string>>;

export function parsePassengerRequestDraft(value: unknown): PassengerRequestDraft | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const draft = value as Partial<PassengerRequestDraft>;
  const stringFields: Array<keyof Omit<PassengerRequestDraft, 'consent'>> = [
    'firstName',
    'phone',
    'email',
    'selectedServiceId',
    'date',
    'passengerCount',
    'pickupArea',
    'comment',
  ];

  if (stringFields.some((field) => draft[field] !== undefined && typeof draft[field] !== 'string')) {
    return null;
  }

  return {
    firstName: draft.firstName?.slice(0, 100) ?? '',
    phone: draft.phone?.slice(0, 40) ?? '',
    email: draft.email?.slice(0, 254) ?? '',
    selectedServiceId: draft.selectedServiceId?.slice(0, 200) ?? '',
    date: draft.date?.slice(0, 10) ?? '',
    passengerCount: draft.passengerCount?.slice(0, 3) ?? '1',
    pickupArea: draft.pickupArea?.slice(0, 200) ?? '',
    comment: draft.comment?.slice(0, 300) ?? '',
    consent: false,
  };
}

export function clearPassengerRequestDraftFieldError(
  errors: PassengerRequestDraftErrors,
  fieldName: keyof PassengerRequestDraft,
): PassengerRequestDraftErrors {
  if (!errors[fieldName]) {
    return errors;
  }

  const remainingErrors = { ...errors };
  delete remainingErrors[fieldName];
  return remainingErrors;
}

export const PHONE_VALIDATION_MESSAGE =
  'Введите номер в международном формате, например +39 333 123 4567.';
export const EMAIL_VALIDATION_MESSAGE = 'Введите корректный email, например name@example.com.';

export function normalizePhone(phone: string) {
  return phone.replace(/[\s\-()]/g, '');
}

export function isInternationalPhoneValid(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(phone));
}

export function isOptionalEmailValid(email: string) {
  const trimmedEmail = email.trim();
  return !trimmedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
}

export function validatePassengerRequestDraft(
  draft: PassengerRequestDraft,
  requireService: boolean,
  now = new Date(),
  services: ChurchService[] = [],
) {
  const errors: PassengerRequestDraftErrors = {};
  const normalizedPhone = normalizePhone(draft.phone);
  const passengerCount = Number(draft.passengerCount);

  if (!draft.firstName.trim()) {
    errors.firstName = 'Введите имя.';
  }

  if (!isInternationalPhoneValid(draft.phone)) {
    errors.phone = PHONE_VALIDATION_MESSAGE;
  }

  if (!isOptionalEmailValid(draft.email)) {
    errors.email = EMAIL_VALIDATION_MESSAGE;
  }

  if (requireService) {
    const serviceErrors = validateServiceSelection(draft, services, now);
    Object.assign(errors, serviceErrors);
  }

  if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 55) {
    errors.passengerCount = 'Укажите количество пассажиров от 1 до 55.';
  }

  if (!draft.pickupArea.trim()) {
    errors.pickupArea = 'Укажите удобную точку встречи.';
  }

  if (!draft.consent) {
    errors.consent = 'Нужно подтвердить согласие на передачу контакта водителю.';
  }

  return { errors, normalizedPhone, passengerCount };
}

export function validatePassengerRequestField(
  draft: PassengerRequestDraft,
  fieldName: keyof PassengerRequestDraft,
  requireService: boolean,
  now = new Date(),
  services: ChurchService[] = [],
) {
  const { errors } = validatePassengerRequestDraft(draft, requireService, now, services);

  if (fieldName === 'date' || fieldName === 'selectedServiceId') {
    return errors.date ?? errors.selectedServiceId;
  }

  return errors[fieldName];
}
