import webPush from 'web-push';
import type { WebPushNotificationConfig } from '@/lib/supabase/config';
import { containedFailure, type NotificationProviderAdapter } from './adapter';

type WebPushSender = typeof webPush.sendNotification;

export function createWebPushNotificationAdapter(
  config: WebPushNotificationConfig,
  sendNotification: WebPushSender = webPush.sendNotification,
): NotificationProviderAdapter {
  return {
    adapterId: `web-push-vapid-${config.keyVersion}`,
    channel: 'web_push',
    async send(job, message) {
      if (job.vapidKeyVersion !== config.keyVersion || !job.p256dhKey || !job.authKey) {
        return containedFailure(this.adapterId, 'permanent_failure', 'vapid_key_unavailable');
      }
      try {
        const response = await sendNotification({
          endpoint: job.destinationValue,
          keys: { auth: job.authKey, p256dh: job.p256dhKey },
        }, message.push, {
          TTL: 86_400,
          timeout: 10_000,
          urgency: 'high',
          vapidDetails: {
            privateKey: config.privateKey,
            publicKey: config.publicKey,
            subject: config.subject,
          },
        });
        return {
          outcome: 'sent',
          providerAdapter: this.adapterId,
          providerCode: `http_${response.statusCode}`,
          providerReference: null,
          safeFailureClass: null,
        };
      } catch (error: unknown) {
        const status = error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : 0;
        if (status === 404 || status === 410) {
          return containedFailure(this.adapterId, 'permanent_failure', 'subscription_gone', `http_${status}`);
        }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          return containedFailure(this.adapterId, 'permanent_failure', 'provider_rejected', `http_${status}`);
        }
        return containedFailure(
          this.adapterId,
          'temporary_failure',
          status === 429 ? 'provider_rate_limited' : 'provider_unavailable',
          status ? `http_${status}` : null,
        );
      }
    },
  };
}
