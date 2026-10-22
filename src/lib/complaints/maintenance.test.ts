import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase/server-privileged', () => ({ createPrivilegedSupabaseClient: mocks.client }));
import { maintainComplaintPreparation } from './maintenance';

function fixture() {
  const signals: AbortSignal[] = [];
  const response = vi.fn(async () => ({ data: 0 as unknown, error: null as unknown }));
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    expect(name).toBeTypeOf('string'); expect(args).toBeTypeOf('object');
    return { abortSignal: (signal: AbortSignal) => { signals.push(signal); return response(); } };
  });
  const client = { schema: vi.fn(() => ({ rpc })) };
  return { client, rpc, response, signals };
}
beforeEach(() => { vi.clearAllMocks(); mocks.client.mockReturnValue(null); });
afterEach(() => vi.useRealTimers());

describe('bounded complaint preparation maintenance', () => {
  it('fails closed without a configured client and never falls back after explicit null', async () => {
    expect(await maintainComplaintPreparation()).toEqual({ configured: false, expiredDrafts: 0,
      expiredPreparationBuckets: 0, expiredVerificationBuckets: 0, failed: 0 });
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ requestTimeoutMs: 5000 });
    mocks.client.mockClear();
    await maintainComplaintPreparation({ client: null });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('runs only the three fixed bounded expiry operations and returns no row material', async () => {
    const f = fixture();
    f.response.mockResolvedValueOnce({ data: 2, error: null }).mockResolvedValueOnce({ data: 4, error: null })
      .mockResolvedValueOnce({ data: 5, error: null });
    expect(await maintainComplaintPreparation({ client: f.client })).toEqual({ configured: true, expiredDrafts: 2,
      expiredPreparationBuckets: 4, expiredVerificationBuckets: 5, failed: 0 });
    expect(f.rpc.mock.calls).toEqual([
      ['expire_complaint_email_drafts', { p_limit: 50 }], ['expire_complaint_rate_buckets', { p_limit: 100 }],
      ['expire_complaint_verification_rate_buckets', { p_limit: 100 }],
    ]);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([null, '2', {}, ['private row'], -1, 1.5, 51, Infinity])('contains malformed acknowledgements without continuing %#', async (data) => {
    const f = fixture(); f.response.mockResolvedValueOnce({ data, error: null });
    expect(await maintainComplaintPreparation({ client: f.client })).toMatchObject({ failed: 1, expiredDrafts: 0 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves known earlier results without claiming rollback or retry after a later failure', async () => {
    const f = fixture();
    f.response.mockResolvedValueOnce({ data: 3, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'private SQL error' } });
    expect(await maintainComplaintPreparation({ client: f.client })).toEqual({ configured: true, expiredDrafts: 3,
      expiredPreparationBuckets: 0, expiredVerificationBuckets: 0, failed: 1 });
    expect(f.rpc).toHaveBeenCalledTimes(2);
    f.rpc.mockClear(); f.response.mockRejectedValueOnce(new Error('private database detail'));
    expect(await maintainComplaintPreparation({ client: f.client })).toMatchObject({ failed: 1 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2])('aborts an unacknowledged stage %i and starts no later operations', async (stage) => {
    vi.useFakeTimers(); const f = fixture();
    for (let i = 0; i < stage; i++) f.response.mockResolvedValueOnce({ data: 1, error: null });
    f.response.mockImplementationOnce(() => new Promise(() => {}));
    const pending = maintainComplaintPreparation({ client: f.client });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ failed: 1 });
    expect(f.rpc).toHaveBeenCalledTimes(stage + 1);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
