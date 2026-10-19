import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BirdSmsConfig } from '@/lib/supabase/config';
import { deliverPhoneVerificationCode, type PhoneVerificationDelivery } from './adapter';
import { createBirdSmsAdapter } from './bird';
import { phoneVerificationLanguages, renderPhoneVerificationSms } from './messages';

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
  afterEach(() => vi.useRealTimers());
  it.each([301, 302, 307, 308, 429, 500])('refuses HTTP %s without replaying code data or consuming its body', async (status) => {
    const cancel = vi.fn();
    const fetchBird = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }),
      { status, headers: { location: 'https://untrusted.example.test/otp' } }));
    expect(await createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery)).toEqual({ delivered: false });
    expect(fetchBird).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    expect(fetchBird.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
  });
  it('refuses advertised and streamed oversize, malformed UTF-8/JSON, and private acknowledgement identifiers', async () => {
    for (const response of [new Response('{}', { status: 202, headers: { 'content-length': '16385' } }),
      new Response('x'.repeat(16_385), { status: 202 }), new Response(new Uint8Array([0xff]), { status: 202 }),
      new Response('not-json', { status: 202 }), new Response(JSON.stringify({ id: delivery.phoneE164 }), { status: 202 })]) {
      const fetchBird = vi.fn<typeof fetch>(async () => response);
      const result = await createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery);
      expect(result).toEqual({ delivered: false }); expect(JSON.stringify(result)).not.toContain(delivery.phoneE164);
    }
  });
  it('accepts a valid acknowledgement exactly at the byte ceiling', async () => {
    const body = JSON.stringify({ id: 'sms_syntheticaccepted1' }).padEnd(16_384, ' ');
    const fetchBird = vi.fn<typeof fetch>(async () => new Response(body, { status: 202, headers: { 'content-length': '16384' } }));
    expect(await createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery))
      .toEqual({ delivered: true, providerReference: 'sms_syntheticaccepted1' });
  });
  it('bounds an uncooperative fetch to the whole deadline and clears its timer', async () => {
    vi.useFakeTimers(); const fetchBird = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ delivered: false });
    expect((fetchBird.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a stalled acknowledgement stream at the same deadline', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const fetchBird = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), { status: 202 }));
    const pending = createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toEqual({ delivered: false }); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a response arriving after an ignored request abort without accepting it', async () => {
    vi.useFakeTimers(); const cancel = vi.fn(); let settle!: (value: Response) => void;
    const fetchBird = vi.fn<typeof fetch>(() => new Promise((resolve) => { settle = resolve; }));
    const pending = createBirdSmsAdapter(config, fetchBird).sendVerificationCode(delivery);
    await vi.advanceTimersByTimeAsync(10_001); expect(await pending).toEqual({ delivered: false });
    settle(new Response(new ReadableStream({ cancel }), { status: 202 }));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(phoneVerificationLanguages)('sends only the frozen %s template with the same attempt idempotency key', async (language) => {
    const fetchBird = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'sms_syntheticaccepted1' }), { status: 202 }));
    await deliverPhoneVerificationCode(createBirdSmsAdapter(config, fetchBird), { ...delivery, smsTemplateVersion: 2, smsLanguage: language });
    expect(JSON.parse(String(fetchBird.mock.calls[0][1]?.body)).text).toBe(renderPhoneVerificationSms(delivery.verificationCode, 2, language));
    expect(fetchBird.mock.calls[0][1]?.headers).toMatchObject({ 'idempotency-key': delivery.attemptId });
  });
  it('refuses incomplete explicit template metadata before direct adapter I/O', async () => {
    const fetchBird = vi.fn<typeof fetch>();
    expect(await createBirdSmsAdapter(config, fetchBird).sendVerificationCode({ ...delivery, smsTemplateVersion: 2 })).toEqual({ delivered: false });
    expect(fetchBird).not.toHaveBeenCalled();
  });
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
