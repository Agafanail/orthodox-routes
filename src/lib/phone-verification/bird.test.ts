import { describe, expect, it, vi } from 'vitest';
import type { BirdSmsConfig } from '@/lib/supabase/config';
import { deliverPhoneVerificationCode, type PhoneVerificationDelivery } from './adapter';
import { createBirdSmsAdapter } from './bird';

const config: BirdSmsConfig = {
  apiBaseUrl: 'https://eu1.platform.bird.com',
  apiKey: `bk_eu1_${'a'.repeat(32)}`,
  sender: 'OrthoRoutes',
};
const delivery: PhoneVerificationDelivery = {
  attemptId: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
  expiresAt: '2026-08-22T12:10:00.000Z',
  phoneE164: '+390000000101',
  verificationCode: '123456',
};

describe('Bird SMS phone-verification adapter', () => {
  it('sends one application-owned authentication code with an idempotent provider request', async () => {
    const fetchBird = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ id: 'sms_01k3birdaccepted1234567890', status: 'accepted' }),
      { status: 202 },
    ));

    await expect(deliverPhoneVerificationCode(
      createBirdSmsAdapter(config, fetchBird),
      delivery,
    )).resolves.toEqual({
      delivered: true,
      providerAdapter: 'bird-sms-v1',
      providerReference: 'sms_01k3birdaccepted1234567890',
    });
    expect(fetchBird).toHaveBeenCalledOnce();
    const [url, init] = fetchBird.mock.calls[0];
    expect(url).toBe('https://eu1.platform.bird.com/v1/sms/messages');
    expect(init?.headers).toMatchObject({
      authorization: `Bearer ${config.apiKey}`,
      'idempotency-key': delivery.attemptId,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      category: 'authentication',
      from: 'OrthoRoutes',
      text: 'Код Orthodox Routes: 123456. Действует 10 минут.',
      to: delivery.phoneE164,
    });
  });

  it('contains provider rejection and malformed acknowledgement details', async () => {
    const rejected = vi.fn(async () => new Response(
      JSON.stringify({ message: `secret=${config.apiKey}; code=${delivery.verificationCode}` }),
      { status: 422 },
    ));
    const malformed = vi.fn(async () => new Response(
      JSON.stringify({ id: `unsafe\n${delivery.verificationCode}` }),
      { status: 202 },
    ));

    await expect(deliverPhoneVerificationCode(
      createBirdSmsAdapter(config, rejected),
      delivery,
    )).resolves.toEqual({
      delivered: false,
      providerAdapter: 'bird-sms-v1',
      providerReference: null,
    });
    await expect(deliverPhoneVerificationCode(
      createBirdSmsAdapter(config, malformed),
      delivery,
    )).resolves.toEqual({
      delivered: false,
      providerAdapter: 'bird-sms-v1',
      providerReference: null,
    });
  });

  it('contains network errors without logging OTP or provider credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchBird = vi.fn(async () => {
      throw new Error(`provider failure ${config.apiKey} ${delivery.verificationCode}`);
    });

    await expect(deliverPhoneVerificationCode(
      createBirdSmsAdapter(config, fetchBird),
      delivery,
    )).resolves.toEqual({
      delivered: false,
      providerAdapter: 'bird-sms-v1',
      providerReference: null,
    });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
