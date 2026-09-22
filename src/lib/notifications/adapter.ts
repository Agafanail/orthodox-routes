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
