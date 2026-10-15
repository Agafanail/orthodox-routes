import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ process: vi.fn(), secret: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getTranslationWorkerSecret: mocks.secret }));
vi.mock('@/lib/translations/worker', () => ({ processTranslationJobs: mocks.process }));

import { POST } from './route';

const url = 'https://routes.example.test/api/internal/translation-worker';

describe('translation worker endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.secret.mockReturnValue('translation-secret-'.repeat(3));
    mocks.process.mockResolvedValue({ configured: false, claimed: 0, failed: 0 });
  });

  it('fails closed without the server secret or a matching bearer token', async () => {
    mocks.secret.mockReturnValueOnce(null);
    expect((await POST(new Request(url, { method: 'POST' }))).status).toBe(503);
    expect((await POST(new Request(url, { method: 'POST' }))).status).toBe(401);
    expect((await POST(new Request(url, { method: 'POST', headers: {
      authorization: 'Bearer incorrect',
    } }))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('keeps provider-unconfigured jobs unavailable without claiming work', async () => {
    const response = await POST(new Request(url, { method: 'POST', headers: {
      authorization: `Bearer ${'translation-secret-'.repeat(3)}`,
    } }));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });

  it('reports only counters for successful and failed batches', async () => {
    const request = () => new Request(url, { method: 'POST', headers: {
      authorization: `Bearer ${'translation-secret-'.repeat(3)}`,
    } });
    mocks.process.mockResolvedValueOnce({ configured: true, claimed: 1, ready: 1, failed: 0 });
    const success = await POST(request());
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ configured: true, claimed: 1, ready: 1, failed: 0 });
    mocks.process.mockResolvedValueOnce({ configured: true, claimed: 1, ready: 0, failed: 1 });
    expect((await POST(request())).status).toBe(500);
  });
});
