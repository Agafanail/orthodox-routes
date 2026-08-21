import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  processPhoneVerificationDelivery: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`redirect:${location}`);
  }),
  rpc: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock('@/lib/phone-verification/worker', () => ({
  processPhoneVerificationDelivery: mocks.processPhoneVerificationDelivery,
}));

import { requestContextualPhoneVerificationAction } from './actions';

const draftId = '019c7134-a39b-4d8e-a4ad-8b11d56d0011';
const attemptId = '019c7134-a39b-4d8e-a4ad-8b11d56d0022';

function formData() {
  const value = new FormData();
  value.set('draft_id', draftId);
  return value;
}

describe('contextual phone delivery action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabaseClient.mockResolvedValue({
      schema: vi.fn(() => ({ rpc: mocks.rpc })),
    });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_contextual_draft') return { data: { status: 'claimed' }, error: null };
      if (name === 'current_account') return { data: { phone: '+390000000101' }, error: null };
      if (name === 'request_phone_verification') {
        return { data: { attempt_id: attemptId, status: 'queued' }, error: null };
      }
      return { data: null, error: { code: 'unexpected_rpc' } };
    });
  });

  it('shows a requested state only after the configured worker records provider acceptance', async () => {
    mocks.processPhoneVerificationDelivery.mockResolvedValue({
      configured: true,
      outcomes: [{ attemptId, delivered: true }],
    });

    await expect(requestContextualPhoneVerificationAction(formData())).rejects.toThrow(
      `redirect:/registration/${draftId}?status=phone-requested`,
    );
    expect(mocks.processPhoneVerificationDelivery).toHaveBeenCalledWith(attemptId);
  });

  it('fails closed when Bird configuration or acknowledgement is unavailable', async () => {
    mocks.processPhoneVerificationDelivery.mockResolvedValue({
      configured: false,
      outcomes: [{ attemptId, delivered: false }],
    });

    await expect(requestContextualPhoneVerificationAction(formData())).rejects.toThrow(
      `redirect:/registration/${draftId}?status=phone-unavailable`,
    );
  });

  it('does not invoke the delivery worker for an already verified phone', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'current_contextual_draft') return { data: { status: 'claimed' }, error: null };
      if (name === 'current_account') return { data: { phone: '+390000000101' }, error: null };
      return { data: { status: 'already_verified' }, error: null };
    });

    await expect(requestContextualPhoneVerificationAction(formData())).rejects.toThrow(
      `redirect:/registration/${draftId}?status=phone-verified`,
    );
    expect(mocks.processPhoneVerificationDelivery).not.toHaveBeenCalled();
  });
});
