import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {},
  createClient: vi.fn(),
  read: vi.fn(),
  storage: vi.fn(),
}));

vi.mock('@/lib/supabase/server-privileged', () => ({
  createPrivilegedSupabaseClient: mocks.createClient,
}));
vi.mock('@/lib/church-images/delivery', () => ({ readPublishedChurchImage: mocks.read }));
vi.mock('@/lib/church-images/storage', () => ({
  SupabaseChurchImageStorage: mocks.storage,
}));

import { GET } from './route';

const params = {
  churchId: '11111111-1111-4111-8111-111111111111',
  imageId: '22222222-2222-4222-8222-222222222222',
  role: '480',
};

describe('church photograph delivery endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue(mocks.client);
    mocks.storage.mockImplementation(function MockStorage() {
      return { readVerified: vi.fn() };
    });
  });

  it('fails closed without privileged server configuration', async () => {
    mocks.createClient.mockReturnValue(null);
    const response = await GET(new Request('https://routes.example.test/image'), { params: Promise.resolve(params) });
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns only checksum-verified WebP bytes without cache reuse', async () => {
    const bytes = Buffer.from('cleaned webp');
    mocks.read.mockResolvedValue({ bytes, metadata: { contentType: 'image/webp' } });

    const response = await GET(new Request('https://routes.example.test/image'), { params: Promise.resolve(params) });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-length')).toBe(`${bytes.length}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.read).toHaveBeenCalledWith(mocks.client, expect.anything(), params.churchId, params.imageId, params.role);
  });

  it('keeps absent and backend-failed objects distinct without details', async () => {
    mocks.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private provider detail'));
    const request = () => GET(new Request('https://routes.example.test/image'), { params: Promise.resolve(params) });
    const missing = await request();
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ status: 'not_found' });
    const unavailable = await request();
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ status: 'unavailable' });
  });
});
