import type { BirdSmsConfig } from '@/lib/supabase/config';
import type {
  PhoneVerificationDelivery,
  PhoneVerificationProviderAdapter,
} from './adapter';

type BirdFetch = typeof fetch;

const BIRD_MESSAGE_ID = /^sms_[A-Za-z0-9_-]{8,128}$/;

function verificationMessage(code: string) {
  return `Код Orthodox Routes: ${code}. Действует 10 минут.`;
}

export function createBirdSmsAdapter(
  config: BirdSmsConfig,
  fetchBird: BirdFetch = fetch,
): PhoneVerificationProviderAdapter {
  return {
    adapterId: 'bird-sms-v1',
    async sendVerificationCode(delivery: PhoneVerificationDelivery) {
      const response = await fetchBird(`${config.apiBaseUrl}/v1/sms/messages`, {
        body: JSON.stringify({
          category: 'authentication',
          from: config.sender,
          text: verificationMessage(delivery.verificationCode),
          to: delivery.phoneE164,
        }),
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': delivery.attemptId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 202) return { delivered: false };

      const payload: unknown = await response.json().catch(() => null);
      const reference = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).id
        : null;
      return typeof reference === 'string' && BIRD_MESSAGE_ID.test(reference)
        ? { delivered: true, providerReference: reference }
        : { delivered: false };
    },
  };
}
