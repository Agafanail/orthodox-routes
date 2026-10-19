import type { BirdSmsConfig } from '@/lib/supabase/config';
import { readBoundedProviderAcknowledgement } from '@/lib/providers/acknowledgement';
import type {
  PhoneVerificationDelivery,
  PhoneVerificationProviderAdapter,
} from './adapter';
import { renderPhoneVerificationSms } from './messages';

type BirdFetch = typeof fetch;

const BIRD_MESSAGE_ID = /^sms_[A-Za-z0-9_-]{8,128}$/;

export function createBirdSmsAdapter(
  config: BirdSmsConfig,
  fetchBird: BirdFetch = fetch,
): PhoneVerificationProviderAdapter {
  return {
    adapterId: 'bird-sms-v1',
    async sendVerificationCode(delivery: PhoneVerificationDelivery) {
      const legacy = delivery.smsTemplateVersion === undefined && delivery.smsLanguage === undefined;
      const text = renderPhoneVerificationSms(delivery.verificationCode,
        legacy ? 1 : delivery.smsTemplateVersion, legacy ? 'ru' : delivery.smsLanguage);
      if (!text) return { delivered: false };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('SMS provider deadline exceeded.')); }, 10_000);
      });
      try {
        const dispatch = async () => {
          const response = await fetchBird(`${config.apiBaseUrl}/v1/sms/messages`, {
            body: JSON.stringify({ category: 'authentication', from: config.sender, text, to: delivery.phoneE164 }),
            cache: 'no-store',
            headers: {
              accept: 'application/json', authorization: `Bearer ${config.apiKey}`,
              'content-type': 'application/json', 'idempotency-key': delivery.attemptId,
            },
            method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
          });
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            return { delivered: false };
          }
          if (response.status !== 202) {
            void response.body?.cancel().catch(() => {});
            return { delivered: false };
          }

          const payload = await readBoundedProviderAcknowledgement(response, controller.signal).catch(() => null);
          const reference = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).id : null;
          return typeof reference === 'string' && BIRD_MESSAGE_ID.test(reference)
            ? { delivered: true, providerReference: reference } : { delivered: false };
        };
        return await Promise.race([dispatch(), deadline]);
      } catch { return { delivered: false }; }
      finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
