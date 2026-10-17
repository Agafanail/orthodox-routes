import type { ResendNotificationConfig } from '@/lib/supabase/config';
import {
  containedFailure,
  safeProviderValue,
  type NotificationProviderAdapter,
} from './adapter';

const RESEND_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 16_384;

async function readProviderAck(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Oversized email acknowledgement.');
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  let complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (signal.aborted) throw new Error('Email acknowledgement deadline exceeded.');
      const part = await reader.read();
      if (part.done) { complete = true; break; }
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Oversized email acknowledgement.');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

export function createResendNotificationAdapter(
  config: ResendNotificationConfig,
  providerFetch: typeof fetch = fetch,
): NotificationProviderAdapter {
  return {
    adapterId: 'resend-email-v1',
    channel: 'email',
    async send(job, message) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Email provider deadline exceeded.')); }, 10_000);
      });
      try {
        const dispatch = async () => {
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
            redirect: 'error',
            credentials: 'omit',
            signal: controller.signal,
          });
          if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('Email provider deadline exceeded.'); }
          const providerCode = `http_${response.status}`;
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return containedFailure(
              this.adapterId,
              response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
                ? 'temporary_failure'
                : 'permanent_failure',
              response.status === 429 ? 'provider_rate_limited' : 'provider_rejected',
              providerCode,
            );
          }
          const payload = await readProviderAck(response, controller.signal).catch(() => null);
          const reference = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).id
            : null;
          if (typeof reference !== 'string' || !RESEND_REFERENCE.test(reference)) {
            return containedFailure(this.adapterId, 'temporary_failure', 'invalid_provider_ack', providerCode);
          }
          return {
            outcome: 'sent' as const,
            providerAdapter: this.adapterId,
            providerCode,
            providerReference: safeProviderValue(reference, 200) ? reference : null,
            safeFailureClass: null,
          };
        };
        return await Promise.race([dispatch(), deadline]);
      } catch {
        return containedFailure(this.adapterId, 'temporary_failure', 'provider_unavailable');
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
