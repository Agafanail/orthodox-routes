import { describe, expect, it, vi } from 'vitest';
import type { WebPushNotificationConfig } from '@/lib/supabase/config';
import type { NotificationDeliveryJob, NotificationMessage } from './adapter';
import { createWebPushNotificationAdapter } from './web-push';

const config: WebPushNotificationConfig = {
  keyVersion: 1,
  privateKey: 'B'.repeat(43),
  publicKey: 'A'.repeat(87),
  subject: 'mailto:push@example.org',
};
const job = {
  authKey: 'C'.repeat(22), channel: 'web_push',
  destinationValue: 'https://push.example.org/subscription',
  p256dhKey: 'D'.repeat(87), vapidKeyVersion: 1,
} as NotificationDeliveryJob;
const message = { email: { html: '', subject: '', text: '' }, push: '{"safe":true}' };

describe('Web Push notification adapter', () => {
  it('uses per-delivery keys and the configured VAPID version', async () => {
    const send = vi.fn(async () => ({ body: '', headers: {}, statusCode: 201 }));
    const adapter = createWebPushNotificationAdapter(config, send as never);
    await expect(adapter.send(job, message as NotificationMessage)).resolves.toEqual({
      outcome: 'sent', providerAdapter: 'web-push-vapid-1', providerCode: 'http_201',
      providerReference: null, safeFailureClass: null,
    });
    expect(send).toHaveBeenCalledWith({
      endpoint: job.destinationValue,
      keys: { auth: job.authKey, p256dh: job.p256dhKey },
    }, message.push, expect.objectContaining({
      TTL: 86_400,
      vapidDetails: {
        privateKey: config.privateKey,
        publicKey: config.publicKey,
        subject: config.subject,
      },
    }));
  });

  it('invalidates gone subscriptions and retries provider outages', async () => {
    const gone = vi.fn(async () => { throw { statusCode: 410 }; });
    const outage = vi.fn(async () => { throw new Error('provider secret'); });
    await expect(createWebPushNotificationAdapter(config, gone as never).send(job, message)).resolves.toMatchObject({
      outcome: 'permanent_failure', providerCode: 'http_410', safeFailureClass: 'subscription_gone',
    });
    await expect(createWebPushNotificationAdapter(config, outage as never).send(job, message)).resolves.toMatchObject({
      outcome: 'temporary_failure', providerCode: null, safeFailureClass: 'provider_unavailable',
    });
  });
});
