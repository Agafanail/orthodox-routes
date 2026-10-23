export type NotificationChannel = 'email' | 'web_push';
export type NotificationDeliveryOutcome = 'sent' | 'temporary_failure' | 'permanent_failure';

export type NotificationDeliveryJob = {
  attemptCount: number;
  authKey: string | null;
  channel: NotificationChannel;
  destinationValue: string;
  eventType: string;
  jobId: string;
  language: 'en' | 'ru' | 'it' | 'ro' | 'uk' | 'de';
  localizationKey: string;
  notificationId: string;
  p256dhKey: string | null;
  safeParameters: Record<string, string | number | boolean | null>;
  safeRoute: string;
  vapidKeyVersion: number | null;
};

export type NotificationMessage = {
  email: { html: string; subject: string; text: string };
  push: string;
};

export type NotificationDeliveryResult = {
  outcome: NotificationDeliveryOutcome;
  providerAdapter: string;
  providerCode: string | null;
  providerReference: string | null;
  safeFailureClass: string | null;
};

export interface NotificationProviderAdapter {
  readonly adapterId: string;
  readonly channel: NotificationChannel;
  send(job: NotificationDeliveryJob, message: NotificationMessage): Promise<NotificationDeliveryResult>;
}

const SAFE_PROVIDER_VALUE = /^[^\u0000-\u001f\u007f]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_CLASSES = new Set(['provider_unavailable', 'provider_rate_limited', 'provider_rejected',
  'invalid_provider_ack', 'vapid_key_unavailable', 'subscription_gone']);

export function safeProviderValue(value: unknown, maximumLength: number) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    && SAFE_PROVIDER_VALUE.test(value);
}

export function containedFailure(
  adapterId: string,
  outcome: Exclude<NotificationDeliveryOutcome, 'sent'>,
  failureClass: string,
  providerCode: string | null = null,
): NotificationDeliveryResult {
  return {
    outcome,
    providerAdapter: safeProviderValue(adapterId, 64) ? adapterId : 'invalid-adapter',
    providerCode: safeProviderValue(providerCode, 80) ? providerCode : null,
    providerReference: null,
    safeFailureClass: safeProviderValue(failureClass, 80) ? failureClass : 'provider_error',
  };
}

export function normalizeNotificationDeliveryResult(value: unknown, adapter: NotificationProviderAdapter): NotificationDeliveryResult {
  const fallback = containedFailure(adapter.adapterId, 'temporary_failure', 'provider_unavailable');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const item = value as Record<string, unknown>;
  const code = typeof item.providerCode === 'string' && /^http_[1-5][0-9]{2}$/.test(item.providerCode) ? item.providerCode : null;
  if (item.providerAdapter !== adapter.adapterId || (item.providerCode !== null && !code)) return fallback;
  if (item.outcome === 'sent') {
    if (item.safeFailureClass !== null || !code?.startsWith('http_2') || (adapter.channel === 'web_push' && item.providerReference !== null)
      || (adapter.channel === 'email'
      && (typeof item.providerReference !== 'string' || !UUID.test(item.providerReference)))) return fallback;
    return { outcome: 'sent', providerAdapter: adapter.adapterId, providerCode: code,
      providerReference: adapter.channel === 'email' ? item.providerReference as string : null, safeFailureClass: null };
  }
  return (item.outcome === 'temporary_failure' || item.outcome === 'permanent_failure')
    && item.providerReference === null && typeof item.safeFailureClass === 'string' && FAILURE_CLASSES.has(item.safeFailureClass)
    ? containedFailure(adapter.adapterId, item.outcome,
      item.safeFailureClass, code)
    : fallback;
}
