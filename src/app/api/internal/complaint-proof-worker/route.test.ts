import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ process: vi.fn(), secret: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getComplaintProofWorkerSecret: mocks.secret }));
vi.mock('@/lib/complaints/proof-mail', () => ({ processComplaintProofMail: mocks.process }));
import { POST } from './route';

const secret = 'synthetic-proof-dispatch-secret-'.repeat(2), url = 'https://routes.example.test/api/internal/complaint-proof-worker';
const summary = { configured: true, claimed: 1, sent: 1, failed: 0 };
const request = (authorization = `Bearer ${secret}`, options: RequestInit = {}) => new Request(url, {
  method: 'POST', headers: { authorization }, ...options,
});
beforeEach(() => { vi.clearAllMocks(); mocks.secret.mockReturnValue(secret); mocks.process.mockResolvedValue(summary); });

describe('protected single-job complaint proof worker', () => {
  it('never constructs a provider/claim without its dedicated exact bearer', async () => {
    mocks.secret.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(503);
    for (const header of ['', 'Bearer wrong', `bearer ${secret}`, `Bearer ${secret}extra`]) expect((await POST(request(header))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('dispatches exactly one server-selected job and returns only counters', async () => {
    mocks.process.mockResolvedValueOnce({ ...summary, token: 'private proof', destination: 'private@example.test' });
    const response = await POST(request(`Bearer ${secret}`, { body: JSON.stringify({ limit: 1000, destination: 'attacker@example.test' }) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(summary);
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(1);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('contains missing configuration, failures and exceptions', async () => {
    mocks.process.mockResolvedValueOnce({ ...summary, configured: false });
    expect((await POST(request())).status).toBe(503);
    mocks.process.mockResolvedValueOnce({ ...summary, failed: 1 });
    expect((await POST(request())).status).toBe(500);
    mocks.process.mockRejectedValueOnce(new Error('private provider detail'));
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
  it('starts no work for an already aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(`Bearer ${secret}`, { signal: controller.signal }))).status).toBe(503);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
