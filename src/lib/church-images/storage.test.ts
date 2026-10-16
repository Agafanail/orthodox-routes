import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { PreparedChurchImageFile } from './process';
import { CHURCH_IMAGE_BUCKET, SupabaseChurchImageStorage } from './storage';

function file(data = Buffer.from('cleaned webp bytes')): PreparedChurchImageFile {
  return {
    role: '480', objectKey: '11111111-1111-4111-8111-111111111111/480.webp',
    contentType: 'image/webp', width: 480, height: 240, byteLength: data.length,
    sha256: createHash('sha256').update(data).digest('hex'), data,
  };
}

function client(
  upload: ReturnType<typeof vi.fn>,
  download: (...args: unknown[]) => Promise<{ data: Blob | null; error: unknown }>,
  isPublic = false,
) {
  const from = vi.fn(() => ({ upload, download: (...args: unknown[]) => ({
    asStream: async () => {
      const result = await download(...args);
      return { ...result, data: result.data?.stream() ?? null };
    },
  }) }));
  const getBucket = vi.fn().mockResolvedValue({ data: { public: isPublic }, error: null });
  return { value: { storage: { from, getBucket } } as unknown as SupabaseClient, from, getBucket };
}

describe('church photograph private Storage adapter', () => {
  it('uses immutable upload options and verifies the stored bytes before returning', async () => {
    const expected = file();
    const upload = vi.fn().mockResolvedValue({ data: { path: expected.objectKey }, error: null });
    const download = vi.fn().mockResolvedValue({ data: new Blob([Uint8Array.from(expected.data)]), error: null });
    const fake = client(upload, download);

    await new SupabaseChurchImageStorage(fake.value).putVerified(expected);

    expect(fake.from).toHaveBeenCalledWith(CHURCH_IMAGE_BUCKET);
    expect(fake.getBucket).toHaveBeenCalledWith(CHURCH_IMAGE_BUCKET);
    expect(upload).toHaveBeenCalledWith(expected.objectKey, expected.data, {
      cacheControl: '31536000', contentType: 'image/webp', upsert: false,
    });
    expect(download).toHaveBeenCalledWith(expected.objectKey, {}, {
      cache: 'no-store', signal: expect.any(AbortSignal),
    });
  });

  it('accepts an immutable retry conflict only when the existing bytes match', async () => {
    const expected = file();
    const upload = vi.fn().mockResolvedValue({ data: null, error: { status: 409, message: 'duplicate' } });
    const download = vi.fn().mockResolvedValue({ data: new Blob([Uint8Array.from(expected.data)]), error: null });
    const fake = client(upload, download);
    await expect(new SupabaseChurchImageStorage(fake.value).putVerified(expected)).resolves.toBeUndefined();

    download.mockResolvedValueOnce({ data: new Blob([Uint8Array.from(Buffer.from('different'))]), error: null });
    await expect(new SupabaseChurchImageStorage(fake.value).putVerified(expected))
      .rejects.toThrow('Church photograph storage is unavailable.');
  });

  it('returns only a genuine not-found result and contains provider failures', async () => {
    const expected = file();
    const upload = vi.fn();
    const download = vi.fn().mockResolvedValueOnce({ data: null, error: { statusCode: '404' } })
      .mockResolvedValueOnce({ data: null, error: { status: 500, message: 'private provider detail' } });
    const fake = client(upload, download);
    const storage = new SupabaseChurchImageStorage(fake.value);

    await expect(storage.readVerified(expected)).resolves.toBeNull();
    await expect(storage.readVerified(expected)).rejects.toThrow('Church photograph storage is unavailable.');
  });

  it('fails closed when the configured bucket is public', async () => {
    const expected = file();
    const fake = client(vi.fn(), vi.fn(), true);
    await expect(new SupabaseChurchImageStorage(fake.value).readVerified(expected))
      .rejects.toThrow('Church photograph storage is unavailable.');
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('rejects unsafe metadata and changed bytes before accessing Storage', async () => {
    const expected = file();
    const fake = client(vi.fn(), vi.fn());
    const storage = new SupabaseChurchImageStorage(fake.value);
    await expect(storage.readVerified({ ...expected, objectKey: '../another.webp' })).rejects.toThrow();
    await expect(storage.readVerified({ ...expected, byteLength: 16 * 1024 * 1024 + 1 })).rejects.toThrow();
    await expect(storage.putVerified({ ...expected, data: Buffer.from('changed') })).rejects.toThrow();
    expect(fake.getBucket).not.toHaveBeenCalled();
  });

  it('cancels an oversized response before accepting its bytes', async () => {
    const expected = file();
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(expected.byteLength + 1)); },
      cancel,
    });
    const download = vi.fn().mockReturnValue({ asStream: async () => ({ data: stream, error: null }) });
    const value = { storage: {
      getBucket: vi.fn().mockResolvedValue({ data: { public: false }, error: null }),
      from: vi.fn(() => ({ download })),
    } } as unknown as SupabaseClient;
    await expect(new SupabaseChurchImageStorage(value).readVerified(expected)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
