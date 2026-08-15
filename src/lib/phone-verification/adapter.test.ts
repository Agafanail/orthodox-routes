import { describe, expect, it, vi } from 'vitest';
import {
  deliverPhoneVerificationCode,
  type PhoneVerificationDelivery,
  type PhoneVerificationProviderAdapter,
} from './adapter';

const delivery: PhoneVerificationDelivery = {
  attemptId: '019c7134-a39b-7d8e-a4ad-8b11d56d0011',
  expiresAt: '2026-08-15T12:10:00.000Z',
  phoneE164: '+390000000101',
  verificationCode: '123456',
};

describe('phone verification provider adapter boundary', () => {
  it('passes one idempotent attempt to an isolated local test adapter', async () => {
    const sendVerificationCode = vi.fn(async () => ({
      delivered: true,
      providerReference: 'synthetic-delivery-1',
    }));
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'local-test',
      sendVerificationCode,
    };

    await expect(deliverPhoneVerificationCode(adapter, delivery)).resolves.toEqual({
      delivered: true,
      providerAdapter: 'local-test',
      providerReference: 'synthetic-delivery-1',
    });
    expect(sendVerificationCode).toHaveBeenCalledOnce();
    expect(sendVerificationCode).toHaveBeenCalledWith(delivery);
  });

  it('rejects malformed delivery material before calling a provider', async () => {
    const adapter: PhoneVerificationProviderAdapter = {
      adapterId: 'local-test',
      sendVerificationCode: vi.fn(),
    };

    await expect(
      deliverPhoneVerificationCode(adapter, { ...delivery, verificationCode: 'browser-bypass' }),
    ).resolves.toEqual({
      delivered: false,
      providerAdapter: 'invalid-adapter',
      providerReference: null,
    });
    expect(adapter.sendVerificationCode).not.toHaveBeenCalled();
  });

  it('contains provider failures and unsafe references without exposing raw details', async () => {
    const throwingAdapter: PhoneVerificationProviderAdapter = {
      adapterId: 'candidate-provider',
      sendVerificationCode: vi.fn(async () => {
        throw new Error('raw secret provider response');
      }),
    };
    const unsafeReferenceAdapter: PhoneVerificationProviderAdapter = {
      adapterId: 'candidate-provider',
      sendVerificationCode: vi.fn(async () => ({
        delivered: true,
        providerReference: 'unsafe\nreference',
      })),
    };

    await expect(deliverPhoneVerificationCode(throwingAdapter, delivery)).resolves.toEqual({
      delivered: false,
      providerAdapter: 'candidate-provider',
      providerReference: null,
    });
    await expect(deliverPhoneVerificationCode(unsafeReferenceAdapter, delivery)).resolves.toEqual({
      delivered: false,
      providerAdapter: 'candidate-provider',
      providerReference: null,
    });
  });
});
