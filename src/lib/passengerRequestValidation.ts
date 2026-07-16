export type PassengerRequestDraft = {
  firstName: string;
  phone: string;
  email: string;
  serviceEvent: string;
  passengerCount: string;
  pickupArea: string;
  comment: string;
  consent: boolean;
};

export type PassengerRequestDraftErrors = Partial<Record<keyof PassengerRequestDraft, string>>;

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

export function validatePassengerRequestDraft(draft: PassengerRequestDraft, requireService: boolean) {
  const errors: PassengerRequestDraftErrors = {};
  const normalizedPhone = normalizePhone(draft.phone);
  const passengerCount = Number.parseInt(draft.passengerCount, 10);

  if (!draft.firstName.trim()) {
    errors.firstName = 'Введите имя.';
  }

  if (!isInternationalPhoneValid(draft.phone)) {
    errors.phone = PHONE_VALIDATION_MESSAGE;
  }

  if (!isOptionalEmailValid(draft.email)) {
    errors.email = EMAIL_VALIDATION_MESSAGE;
  }

  if (requireService && !draft.serviceEvent) {
    errors.serviceEvent = 'Выберите службу или событие.';
  }

  if (!Number.isFinite(passengerCount) || passengerCount < 1) {
    errors.passengerCount = 'Укажите количество пассажиров от 1.';
  }

  if (!draft.pickupArea.trim()) {
    errors.pickupArea = 'Укажите удобную точку встречи.';
  }

  if (!draft.consent) {
    errors.consent = 'Нужно подтвердить согласие на передачу контакта водителю.';
  }

  return { errors, normalizedPhone, passengerCount };
}
