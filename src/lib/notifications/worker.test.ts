import { describe, expect, it, vi } from 'vitest';
import type { NotificationProviderAdapter } from './adapter';
import { parseNotificationDeliveryJob, processNotificationDeliveries, type NotificationWorkerClient } from './worker';

const leasedJob = {
  attempt_count: 1,
  auth_key: null,
  channel: 'email',
  destination_value: 'person@example.org',
  event_type: 'ride.confirmed',
  job_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
  localization_key: 'notifications.ride_confirmed',
  notification_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
  p256dh_key: null,
  preferred_language: 'de',
  safe_parameters: {},
  safe_route: '/trips',
  vapid_key_version: null,
};

function workerClient() {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'notification_worker_enqueue_scheduled') return { data: {}, error: null };
    if (name === 'notification_worker_claim_jobs_v2') return { data: [leasedJob], error: null };
    return { data: true, error: null };
  });
  return { client: { schema: vi.fn(() => ({ rpc })) } as NotificationWorkerClient, rpc };
}

describe('notification delivery worker', () => {
  it('leases only configured channels and records provider-safe completion', async () => {
    const { client, rpc } = workerClient();
    const send = vi.fn(async () => ({
      outcome: 'sent' as const, providerAdapter: 'fake-email-v1', providerCode: 'accepted',
      providerReference: 'provider-reference', safeFailureClass: null,
    }));
    const adapter: NotificationProviderAdapter = { adapterId: 'fake-email-v1', channel: 'email', send };
    await expect(processNotificationDeliveries(20, {
      adapters: { email: adapter }, appOrigin: 'https://routes.example.org', client,
      leaseToken: '019c7134-a39b-7d8e-a4ad-8b11d56d0033',
    })).resolves.toEqual({ claimed: 1, configured: true, failed: 0, sent: 1 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'notification_worker_enqueue_scheduled', {});
    expect(rpc).toHaveBeenNthCalledWith(2, 'notification_worker_claim_jobs_v2', {
      p_channels: ['email'], p_lease_token: '019c7134-a39b-7d8e-a4ad-8b11d56d0033', p_limit: 20,
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ language: 'de' }), expect.objectContaining({
      push: JSON.stringify({ eventType: 'ride.confirmed', notificationId: leasedJob.notification_id, route: '/trips' }),
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'notification_worker_complete_job', expect.objectContaining({
      p_job_id: leasedJob.job_id, p_outcome: 'sent', p_provider_adapter: 'fake-email-v1',
    }));
  });

  it('does not lease destinations when no provider or privileged client is configured', async () => {
    expect(await processNotificationDeliveries(20, { adapters: {}, appOrigin: 'https://routes.example.org', client: null }))
      .toEqual({ claimed: 0, configured: false, failed: 0, sent: 0 });
  });

  it('rejects malformed provider material before an adapter sees it', () => {
    expect(parseNotificationDeliveryJob({ ...leasedJob, safe_route: 'https://attacker.example' })).toBeNull();
    expect(parseNotificationDeliveryJob({ ...leasedJob, channel: 'web_push' })).toBeNull();
  });
});
