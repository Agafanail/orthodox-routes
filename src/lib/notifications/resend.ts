import type { ResendNotificationConfig } from '@/lib/supabase/config';
import {
  containedFailure,
  safeProviderValue,
  type NotificationProviderAdapter,
} from './adapter';

const RESEND_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createResendNotificationAdapter(
  config: ResendNotificationConfig,
  providerFetch: typeof fetch = fetch,
): NotificationProviderAdapter {
  return {
    adapterId: 'resend-email-v1',
    channel: 'email',
    async send(job, message) {
      try {
        const response = await providerFetch('https://api.resend.com/emails', {
          body: JSON.stringify({
            from: config.from,
            html: message.email.html,
            subject: message.email.subject,
            text: message.email.text,
            to: [job.destinationValue],
          }),
          cache: 'no-store',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': `notification-${job.jobId}`,
          },
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        });
        const providerCode = `http_${response.status}`;
        if (!response.ok) {
          return containedFailure(
            this.adapterId,
            response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
              ? 'temporary_failure'
              : 'permanent_failure',
            response.status === 429 ? 'provider_rate_limited' : 'provider_rejected',
            providerCode,
          );
        }
        const payload: unknown = await response.json().catch(() => null);
        const reference = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).id
          : null;
        if (typeof reference !== 'string' || !RESEND_REFERENCE.test(reference)) {
          return containedFailure(this.adapterId, 'temporary_failure', 'invalid_provider_ack', providerCode);
        }
        return {
          outcome: 'sent',
          providerAdapter: this.adapterId,
          providerCode,
          providerReference: safeProviderValue(reference, 200) ? reference : null,
          safeFailureClass: null,
        };
      } catch {
        return containedFailure(this.adapterId, 'temporary_failure', 'provider_unavailable');
      }
    },
  };
}
