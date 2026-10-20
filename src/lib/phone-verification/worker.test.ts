import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneVerificationProviderAdapter } from './adapter';
import {
  processPhoneVerificationDelivery,
  type PhoneVerificationWorkerClient,
} from './worker';

const leasedDelivery = {
  attempt_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
  expires_at: '2026-10-20T12:10:00.000Z',
  evaluated_at: '2026-10-20T12:00:00.000Z',
  lease_until: '2026-10-20T12:01:00.000Z',
  phone_e164: '+390000000101',
  verification_code: '123456',
  sms_template_version: 2,
  sms_language: 'en',
};

function workerClient(claimed: unknown = leasedDelivery, completion: unknown = true) {
  const rpc = vi.fn(async (name: string) => name === 'phone_worker_claim_delivery_v3'
    ? { data: claimed, error: null }
    : { data: completion, error: null });
  const client: PhoneVerificationWorkerClient = {
    schema: vi.fn(() => ({ rpc })),
  };
  return { client, rpc };
}

describe('phone verification delivery worker', () => {
  afterEach(() => vi.useRealTimers());
  it.each([{ ...leasedDelivery, sms_template_version: undefined }, { ...leasedDelivery, sms_language: 'fr' },
    { ...leasedDelivery, sms_template_version: 3 }, { ...leasedDelivery, sms_template_version: 1, sms_language: 'en' }])(
    'does not send or acknowledge malformed template metadata', async (raw) => {
      const { client, rpc } = workerClient(raw);
      const adapter = { adapterId: 'local-template-test', sendVerificationCode: vi.fn() };
      expect((await processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client })).outcomes).toEqual([]);
      expect(adapter.sendVerificationCode).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it('leases restricted delivery material, acknowledges provider acceptance, and completes once', async () => {
    const { client, rpc } = workerClient();
    const sendVerificationCode = vi.fn(async () => ({
      delivered: true,
      providerReference: 'sms_01k3birdaccepted1234567890',
    }));
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'bird-sms-v1',
      sendVerificationCode,
    };

    await expect(processPhoneVerificationDelivery(leasedDelivery.attempt_id, {
      adapter,
      client,
      leaseToken: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
    })).resolves.toEqual({
      configured: true,
      outcomes: [{ attemptId: leasedDelivery.attempt_id, delivered: true }],
    });
    expect(sendVerificationCode).toHaveBeenCalledWith({
      attemptId: leasedDelivery.attempt_id,
      expiresAt: leasedDelivery.expires_at,
      phoneE164: leasedDelivery.phone_e164,
      verificationCode: leasedDelivery.verification_code,
      smsTemplateVersion: 2,
      smsLanguage: 'en',
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'phone_worker_claim_delivery_v3', {
      p_attempt_id: leasedDelivery.attempt_id,
      p_lease_token: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'phone_worker_complete_delivery', {
      p_attempt_id: leasedDelivery.attempt_id,
      p_lease_token: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
      p_delivered: true,
      p_provider_adapter: 'bird-sms-v1',
      p_provider_reference: 'sms_01k3birdaccepted1234567890',
    });
  });

  it('fails closed and clears a claimed code when Bird configuration is unavailable', async () => {
    const { client, rpc } = workerClient();

    await expect(processPhoneVerificationDelivery(leasedDelivery.attempt_id, {
      adapter: null,
      client,
      leaseToken: '019c7134-a39b-7d8e-a4ad-8b11d56d0022',
    })).resolves.toEqual({
      configured: false,
      outcomes: [{ attemptId: leasedDelivery.attempt_id, delivered: false }],
    });
    expect(rpc).toHaveBeenLastCalledWith('phone_worker_complete_delivery', expect.objectContaining({
      p_delivered: false,
      p_provider_adapter: 'bird-unconfigured',
      p_provider_reference: null,
    }));
  });

  it('does not lease OTP material without the privileged server client', async () => {
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'bird-sms-v1',
      sendVerificationCode: vi.fn(),
    };

    await expect(processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client: null })).resolves.toEqual({
      configured: false,
      outcomes: [],
    });
    expect(adapter.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('does not acknowledge acceptance when database completion fails', async () => {
    const { client } = workerClient(leasedDelivery, false);
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'bird-sms-v1',
      sendVerificationCode: vi.fn(async () => ({ delivered: true })),
    };

    await expect(processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client })).resolves.toEqual({
      configured: true,
      outcomes: [{ attemptId: leasedDelivery.attempt_id, delivered: false }],
    });
  });

  it.each([{ value: null }, { value: [leasedDelivery] }, { value: { ...leasedDelivery, evaluated_at: null } },
    { value: { ...leasedDelivery, lease_until: '2026-10-20T12:00:20Z' } },
    { value: { ...leasedDelivery, lease_until: '2026-10-20T12:05:01Z' } },
    { value: { ...leasedDelivery, expires_at: '2026-10-20T12:00:19Z' } },
    { value: { ...leasedDelivery, attempt_id: '019c7134-a39b-7d8e-a4ad-8b11d56d9999' } }])
  ('refuses malformed/short timing and unrelated delivery before external dispatch %#', async ({ value }) => {
    const { client, rpc } = workerClient(value);
    const adapter = { adapterId: 'local-test', sendVerificationCode: vi.fn() };
    expect((await processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client })).outcomes).toEqual([]);
    expect(adapter.sendVerificationCode).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([-86_400_000, 86_400_000])('uses relative database duration with wall-clock skew %s', async (skew) => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(leasedDelivery.evaluated_at) + skew);
    const { client } = workerClient();
    const adapter = { adapterId: 'local-test', sendVerificationCode: vi.fn().mockResolvedValue({ delivered: true }) };
    expect((await processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client })).outcomes)
      .toEqual([{ attemptId: leasedDelivery.attempt_id, delivered: true }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('subtracts claim latency before dispatching a nearly expired code', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(() => new Promise<{ data: unknown; error: null }>((resolve) => setTimeout(() => resolve({
      data: { ...leasedDelivery, lease_until: '2026-10-20T12:00:24Z' }, error: null,
    }), 4000)));
    const adapter = { adapterId: 'local-test', sendVerificationCode: vi.fn() };
    const pending = processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client: { schema: () => ({ rpc }) } });
    await vi.advanceTimersByTimeAsync(4001);
    expect((await pending).outcomes).toEqual([]); expect(adapter.sendVerificationCode).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['claim', 'send', 'complete'])('bounds an abort-ignoring %s without retries or private diagnostics', async (stage) => {
    vi.useFakeTimers();
    const rpc = vi.fn((name: string) => {
      if ((stage === 'claim' && name.endsWith('_v3')) || (stage === 'complete' && name.endsWith('_delivery')))
        return new Promise<never>(() => {});
      return Promise.resolve({ data: name.endsWith('_v3') ? leasedDelivery : true, error: null });
    });
    const adapter = { adapterId: 'local-test', sendVerificationCode: vi.fn(() => stage === 'send'
      ? new Promise<never>(() => {}) : Promise.resolve({ delivered: true })) };
    const pending = processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client: { schema: () => ({ rpc }) } });
    await vi.advanceTimersByTimeAsync(stage === 'send' ? 12_001 : 5001);
    expect((await pending).outcomes).toEqual(stage === 'send' ? [{ attemptId: leasedDelivery.attempt_id, delivered: false }] : []);
    expect(rpc).toHaveBeenCalledTimes(stage === 'claim' ? 1 : 2); expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses malformed attempt identifiers before leasing OTP material', async () => {
    const { client, rpc } = workerClient();
    expect((await processPhoneVerificationDelivery('private@example.test', { client, adapter: null })).outcomes).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
