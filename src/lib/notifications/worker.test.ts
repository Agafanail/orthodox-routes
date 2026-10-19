import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationProviderAdapter } from './adapter';
import { normalizeNotificationDeliveryResult, parseNotificationDeliveryJob, processNotificationDeliveries, type NotificationWorkerClient } from './worker';

const moment = Date.now();
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
  evaluated_at: new Date(moment).toISOString(),
  lease_until: new Date(moment + 60_000).toISOString(),
};

function workerClient() {
  let claimed = false;
  const rpc = vi.fn(async (name: string) => {
    if (name === 'notification_worker_enqueue_scheduled') return { data: {}, error: null };
    if (name === 'notification_worker_claim_job_v3') {
      const data = claimed ? null : leasedJob; claimed = true; return { data, error: null };
    }
    return { data: true, error: null };
  });
  return { client: { schema: vi.fn(() => ({ rpc })) } as NotificationWorkerClient, rpc };
}

describe('notification delivery worker', () => {
  afterEach(() => vi.useRealTimers());
  const adapter: NotificationProviderAdapter = { adapterId: 'synthetic-email', channel: 'email', send: vi.fn() };
  const accepted = { outcome: 'sent', providerAdapter: adapter.adapterId, providerCode: 'http_200',
    providerReference: leasedJob.job_id, safeFailureClass: null };
  it.each([null, [], {}, { ...accepted, outcome: 'unexpected' }, { ...accepted, providerAdapter: 'private@example.test' },
    { ...accepted, providerReference: 'private@example.test' }, { ...accepted, providerCode: 'http_private@example.test' },
    { ...accepted, providerCode: 'http_500' }, { ...accepted, safeFailureClass: 'private@example.test' }])
  ('contains unknown or private adapter diagnostics %#', (value) => {
    expect(normalizeNotificationDeliveryResult(value, adapter)).toEqual({ outcome: 'temporary_failure',
      providerAdapter: adapter.adapterId, providerCode: null, providerReference: null, safeFailureClass: 'provider_unavailable' });
  });
  it('retains fixed terminal subscription failure and successful minimal push acknowledgement', () => {
    const push = { ...adapter, channel: 'web_push' as const };
    expect(normalizeNotificationDeliveryResult({ ...accepted, providerReference: null, providerCode: 'http_201' }, push))
      .toMatchObject({ outcome: 'sent', providerReference: null });
    expect(normalizeNotificationDeliveryResult({ ...accepted, outcome: 'permanent_failure', providerCode: 'http_410',
      providerReference: null, safeFailureClass: 'subscription_gone' }, push))
      .toMatchObject({ outcome: 'permanent_failure', providerCode: 'http_410', safeFailureClass: 'subscription_gone' });
  });
  it.each(['http://routes.example.test', 'https://person:secret@routes.example.test', 'https://routes.example.test/path',
    'https://routes.example.test/?private', 'https://routes.example.test/#private'])('refuses unsafe origin %s before enqueue/claim', async (appOrigin) => {
    const f = workerClient();
    expect(await processNotificationDeliveries(1, { adapters: { email: adapter }, appOrigin, client: f.client }))
      .toEqual({ claimed: 0, configured: false, failed: 0, sent: 0 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: { ...leasedJob, evaluated_at: null } }, { data: { ...leasedJob, lease_until: new Date(moment + 60_001).toISOString() } },
    { data: { ...leasedJob, lease_until: new Date(moment - 1).toISOString() } }, { data: [leasedJob] }, { data: { ...leasedJob, attempt_count: 6 } },
    { data: { ...leasedJob, channel: 'web_push', auth_key: 'synthetic', p256dh_key: 'synthetic', vapid_key_version: 1 } }])
  ('refuses missing/invalid timing and unconfigured channels before sending %#', async ({ data }) => {
    const rpc = vi.fn(async (name: string) => ({ data: name.endsWith('_v3') ? data : {}, error: null }));
    const send = vi.fn();
    expect(await processNotificationDeliveries(1, { adapters: { email: { ...adapter, send } },
      appOrigin: 'https://routes.example.test', client: { schema: () => ({ rpc }) } })).toMatchObject({ failed: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([-86_400_000, 86_400_000])('does not depend on synchronized worker wall time (%s)', async (skew) => {
    vi.useFakeTimers(); vi.setSystemTime(moment + skew);
    const f = workerClient(), send = vi.fn().mockResolvedValue(accepted);
    expect(await processNotificationDeliveries(1, { adapters: { email: { ...adapter, send } },
      appOrigin: 'https://routes.example.test', client: f.client })).toMatchObject({ sent: 1, failed: 0 });
  });
  it('subtracts actual claim latency before spending the provider/completion window', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => name.endsWith('_v3')
      ? new Promise<{ data: unknown; error: null }>((resolve) => setTimeout(() => resolve({
        data: { ...leasedJob, lease_until: new Date(moment + 24_000).toISOString() }, error: null,
      }), 4000)) : Promise.resolve({ data: true, error: null }));
    const send = vi.fn();
    const pending = processNotificationDeliveries(1, { adapters: { email: { ...adapter, send } }, appOrigin: 'https://routes.example.test',
      client: { schema: () => ({ rpc }) } });
    await vi.advanceTimersByTimeAsync(4001);
    expect(await pending).toMatchObject({ failed: 1, sent: 0 }); expect(send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('claims only after completion and uses a fresh lease for each single job', async () => {
    const order: string[] = [], leases: unknown[] = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      order.push(name);
      if (name.endsWith('_v3')) { leases.push(args.p_lease_token); expect(args).not.toHaveProperty('p_limit'); }
      return { data: name.endsWith('_v3') ? leasedJob : true, error: null };
    });
    const send = vi.fn(async () => { order.push('send'); return accepted as Awaited<ReturnType<NotificationProviderAdapter['send']>>; });
    expect(await processNotificationDeliveries(2, { adapters: { email: { ...adapter, send } }, appOrigin: 'https://routes.example.test',
      client: { schema: () => ({ rpc }) } })).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(order).toEqual(['notification_worker_enqueue_scheduled', 'notification_worker_claim_job_v3', 'send',
      'notification_worker_complete_job', 'notification_worker_claim_job_v3', 'send', 'notification_worker_complete_job']);
    expect(leases[0]).not.toBe(leases[1]);
  });
  it.each(['enqueue', 'claim', 'send', 'complete'])('bounds an abort-ignoring %s without automatic RPC retry', async (stage) => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => {
      if ((stage === 'enqueue' && name.endsWith('_scheduled')) || (stage === 'claim' && name.endsWith('_v3'))
        || (stage === 'complete' && name.endsWith('_job'))) return new Promise<never>(() => {});
      return Promise.resolve({ data: name.endsWith('_v3') ? leasedJob : true, error: null });
    });
    const send = vi.fn(() => stage === 'send' ? new Promise<never>(() => {}) : Promise.resolve(accepted as Awaited<ReturnType<NotificationProviderAdapter['send']>>));
    const pending = processNotificationDeliveries(1, { adapters: { email: { ...adapter, send } }, appOrigin: 'https://routes.example.test',
      client: { schema: () => ({ rpc }) } });
    await vi.advanceTimersByTimeAsync(stage === 'send' ? 12_001 : 5001);
    expect(await pending).toMatchObject({ sent: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(stage === 'enqueue' ? 1 : stage === 'claim' ? 2 : 3); expect(vi.getTimerCount()).toBe(0);
  });
  it('leases only configured channels and records provider-safe completion', async () => {
    const { client, rpc } = workerClient();
    const send = vi.fn(async () => ({
      outcome: 'sent' as const, providerAdapter: 'fake-email-v1', providerCode: 'http_200',
      providerReference: leasedJob.job_id, safeFailureClass: null,
    }));
    const adapter: NotificationProviderAdapter = { adapterId: 'fake-email-v1', channel: 'email', send };
    await expect(processNotificationDeliveries(20, {
      adapters: { email: adapter }, appOrigin: 'https://routes.example.org', client,
      leaseToken: '019c7134-a39b-7d8e-a4ad-8b11d56d0033',
    })).resolves.toEqual({ claimed: 1, configured: true, failed: 0, sent: 1 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'notification_worker_enqueue_scheduled', {});
    expect(rpc).toHaveBeenNthCalledWith(2, 'notification_worker_claim_job_v3', {
      p_channels: ['email'], p_lease_token: '019c7134-a39b-7d8e-a4ad-8b11d56d0033',
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
