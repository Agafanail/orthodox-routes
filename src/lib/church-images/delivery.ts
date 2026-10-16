import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChurchImageObjectMetadata, ChurchImageObjectStorage } from './storage';

export type PublishedChurchImageObject = ChurchImageObjectMetadata & {
  role: '480' | '960' | '1600';
  width: number;
  height: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = new Set(['480', '960', '1600']);

function isPublishedObject(value: unknown): value is PublishedChurchImageObject {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PublishedChurchImageObject>;
  return typeof item.role === 'string' && ROLES.has(item.role)
    && typeof item.objectKey === 'string'
    && /^[-0-9a-f]{36}\/(480|960|1600)\.webp$/.test(item.objectKey)
    && item.contentType === 'image/webp'
    && typeof item.byteLength === 'number' && Number.isSafeInteger(item.byteLength) && item.byteLength > 0
    && typeof item.width === 'number' && Number.isSafeInteger(item.width) && item.width > 0
    && typeof item.height === 'number' && Number.isSafeInteger(item.height) && item.height > 0
    && typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256);
}

export async function readPublishedChurchImage(
  client: SupabaseClient,
  storage: ChurchImageObjectStorage,
  churchId: string,
  imageId: string,
  role: string,
): Promise<{ bytes: Buffer; metadata: PublishedChurchImageObject } | null> {
  if (!UUID.test(churchId) || !UUID.test(imageId) || !ROLES.has(role)) return null;
  const result = await client.schema('api').rpc('published_church_image_object', {
    p_church_id: churchId, p_image_id: imageId, p_role: role,
  });
  if (result.error) throw new Error('Church photograph delivery is unavailable.');
  if (result.data === null) return null;
  if (!isPublishedObject(result.data)) throw new Error('Church photograph delivery is unavailable.');
  if (result.data.role !== role || result.data.objectKey !== `${imageId}/${role}.webp`) {
    throw new Error('Church photograph delivery is unavailable.');
  }
  const bytes = await storage.readVerified(result.data);
  if (!bytes) throw new Error('Church photograph delivery is unavailable.');
  return { bytes, metadata: result.data };
}
