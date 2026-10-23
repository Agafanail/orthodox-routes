import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ process: vi.fn(), secret: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getComplaintMaintenanceSecret: mocks.secret }));
vi.mock('@/lib/complaints/maintenance', () => ({ maintainComplaintPreparation: mocks.process }));
import { POST } from './route';

const secret = 'synthetic-maintenance-secret-'.repeat(2), url = 'https://routes.example.test/api/internal/complaint-maintenance';
const summary = { configured: true, expiredDrafts: 1, expiredPreparationBuckets: 2, expiredVerificationBuckets: 3, failed: 0 };
const request = (authorization = `Bearer ${secret}`, options: RequestInit = {}) => new Request(url, {
  method: 'POST', headers: { authorization }, ...options,
});
beforeEach(() => { vi.clearAllMocks(); mocks.secret.mockReturnValue(secret); mocks.process.mockResolvedValue(summary); });

describe('protected complaint maintenance route', () => {
  it('does no privileged work without a configured independent secret or exact bearer', async () => {
    mocks.secret.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(503);
    for (const header of ['', 'Bearer wrong', `bearer ${secret}`, `Bearer ${secret}extra`]) {
      expect((await POST(request(header))).status).toBe(401);
    }
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('ignores request-selected actions/limits and discloses only fixed counters', async () => {
    mocks.process.mockResolvedValueOnce({ ...summary, secret: 'private fixture', draftId: 'private reference' });
    const response = await POST(request(`Bearer ${secret}`, { body: JSON.stringify({ operation: 'send_mail', limit: 999999 }) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(summary);
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith();
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('contains unconfigured/failed maintenance and unexpected exceptions', async () => {
    mocks.process.mockResolvedValueOnce({ ...summary, configured: false });
    expect((await POST(request())).status).toBe(503);
    mocks.process.mockResolvedValueOnce({ ...summary, failed: 1 });
    expect((await POST(request())).status).toBe(500);
    mocks.process.mockRejectedValueOnce(new Error('private database error'));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ status: 'unavailable' });
  });
  it('does not start a batch for an already aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(`Bearer ${secret}`, { signal: controller.signal }))).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
