export type PhoneVerificationDelivery = {
  attemptId: string;
  expiresAt: string;
  phoneE164: string;
  verificationCode: string;
};

export type PhoneVerificationDeliveryResult = {
  delivered: boolean;
  providerAdapter: string;
  providerReference: string | null;
};

export interface PhoneVerificationProviderAdapter {
  readonly adapterId: string;
  sendVerificationCode(
    delivery: PhoneVerificationDelivery,
  ): Promise<{ delivered: boolean; providerReference?: string | null }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const CODE_PATTERN = /^[0-9]{6}$/;

function isSafeProviderValue(value: string, maximumLength: number) {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function validatePhoneVerificationDelivery(delivery: PhoneVerificationDelivery) {
  return (
    UUID_PATTERN.test(delivery.attemptId) &&
    PHONE_PATTERN.test(delivery.phoneE164) &&
    CODE_PATTERN.test(delivery.verificationCode) &&
    Number.isFinite(Date.parse(delivery.expiresAt))
  );
}

export async function deliverPhoneVerificationCode(
  adapter: PhoneVerificationProviderAdapter,
  delivery: PhoneVerificationDelivery,
): Promise<PhoneVerificationDeliveryResult> {
  if (!isSafeProviderValue(adapter.adapterId, 64) || !validatePhoneVerificationDelivery(delivery)) {
    return { delivered: false, providerAdapter: 'invalid-adapter', providerReference: null };
  }

  try {
    const result = await adapter.sendVerificationCode(delivery);
    const providerReference = result.providerReference ?? null;
    if (
      providerReference !== null &&
      !isSafeProviderValue(providerReference, 256)
    ) {
      return { delivered: false, providerAdapter: adapter.adapterId, providerReference: null };
    }

    return {
      delivered: result.delivered === true,
      providerAdapter: adapter.adapterId,
      providerReference,
    };
  } catch {
    return { delivered: false, providerAdapter: adapter.adapterId, providerReference: null };
  }
}
