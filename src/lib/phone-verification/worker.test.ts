import { describe, expect, it, vi } from 'vitest';
import type { PhoneVerificationProviderAdapter } from './adapter';
import {
  processPhoneVerificationDelivery,
  type PhoneVerificationWorkerClient,
} from './worker';

const leasedDelivery = {
  attempt_id: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
  expires_at: '2026-08-22T12:10:00.000Z',
  phone_e164: '+390000000101',
  verification_code: '123456',
};

function workerClient(claimed: unknown = [leasedDelivery], completion: unknown = true) {
  const rpc = vi.fn(async (name: string) => name === 'phone_worker_claim_delivery'
    ? { data: claimed, error: null }
    : { data: completion, error: null });
  const client: PhoneVerificationWorkerClient = {
    schema: vi.fn(() => ({ rpc })),
  };
  return { client, rpc };
}

describe('phone verification delivery worker', () => {
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
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'phone_worker_claim_delivery', {
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
    const { client } = workerClient([leasedDelivery], false);
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'bird-sms-v1',
      sendVerificationCode: vi.fn(async () => ({ delivered: true })),
    };

    await expect(processPhoneVerificationDelivery(leasedDelivery.attempt_id, { adapter, client })).resolves.toEqual({
      configured: true,
      outcomes: [{ attemptId: leasedDelivery.attempt_id, delivered: false }],
    });
  });
});
