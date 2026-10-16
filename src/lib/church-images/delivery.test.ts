import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { readPublishedChurchImage } from './delivery';
import type { ChurchImageObjectStorage } from './storage';

const churchId = '11111111-1111-4111-8111-111111111111';
const imageId = '22222222-2222-4222-8222-222222222222';
const bytes = Buffer.from('published cleaned webp');
const metadata = {
  role: '480' as const, objectKey: `${imageId}/480.webp`, contentType: 'image/webp' as const,
  width: 480, height: 240, byteLength: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
};

function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { value: { schema: vi.fn(() => ({ rpc })) } as unknown as SupabaseClient, rpc };
}

function storage(result: Buffer | null = bytes): ChurchImageObjectStorage {
  return { putVerified: vi.fn(), readVerified: vi.fn().mockResolvedValue(result) };
}

describe('published church photograph delivery', () => {
  it('resolves and reads only an exact current public variant', async () => {
    const service = client(metadata);
    const objects = storage();

    await expect(readPublishedChurchImage(service.value, objects, churchId, imageId, '480'))
      .resolves.toEqual({ bytes, metadata });
    expect(service.rpc).toHaveBeenCalledWith('published_church_image_object', {
      p_church_id: churchId, p_image_id: imageId, p_role: '480',
    });
    expect(objects.readVerified).toHaveBeenCalledWith(metadata);
  });

  it.each([
    ['invalid church', imageId, '480'], [churchId, '../image', '480'], [churchId, imageId, 'master'],
  ])('rejects invalid public coordinates before a privileged lookup', async (church, image, role) => {
    const service = client(metadata);
    await expect(readPublishedChurchImage(service.value, storage(), church, image, role)).resolves.toBeNull();
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it('contains missing, mismatched, and provider-failed objects', async () => {
    await expect(readPublishedChurchImage(client(null).value, storage(), churchId, imageId, '480'))
      .resolves.toBeNull();
    await expect(readPublishedChurchImage(
      client({ ...metadata, objectKey: `${imageId}/960.webp` }).value,
      storage(), churchId, imageId, '480',
    )).rejects.toThrow('Church photograph delivery is unavailable.');
    await expect(readPublishedChurchImage(
      client(metadata, { message: 'private database detail' }).value,
      storage(), churchId, imageId, '480',
    )).rejects.toThrow('Church photograph delivery is unavailable.');
    await expect(readPublishedChurchImage(client(metadata).value, storage(null), churchId, imageId, '480'))
      .rejects.toThrow('Church photograph delivery is unavailable.');
  });
});
