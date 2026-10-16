import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedChurchImageFile } from './process';

export const CHURCH_IMAGE_BUCKET = 'church-images';

export type ChurchImageObjectMetadata = Pick<
  PreparedChurchImageFile,
  'objectKey' | 'contentType' | 'byteLength' | 'sha256'
>;

export interface ChurchImageObjectStorage {
  putVerified(file: PreparedChurchImageFile): Promise<void>;
  readVerified(metadata: ChurchImageObjectMetadata): Promise<Buffer | null>;
}

const UNAVAILABLE = 'Church photograph storage is unavailable.';

function storageFailure(): Error {
  return new Error(UNAVAILABLE);
}

function isConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return candidate.status === 409 || candidate.statusCode === '409';
}

function matches(metadata: ChurchImageObjectMetadata, data: Buffer) {
  return data.length === metadata.byteLength
    && createHash('sha256').update(data).digest('hex') === metadata.sha256;
}

/** Server-only private-bucket adapter. It never creates public URLs or enables client access. */
export class SupabaseChurchImageStorage implements ChurchImageObjectStorage {
  constructor(private readonly client: SupabaseClient) {}

  private async assertPrivateBucket() {
    const { data, error } = await this.client.storage.getBucket(CHURCH_IMAGE_BUCKET);
    if (error || !data || data.public !== false) throw storageFailure();
  }

  async readVerified(metadata: ChurchImageObjectMetadata): Promise<Buffer | null> {
    try {
      await this.assertPrivateBucket();
      const { data, error } = await this.client.storage
        .from(CHURCH_IMAGE_BUCKET)
        .download(metadata.objectKey, {}, { cache: 'no-store' });
      if (error) {
        if (isConflict(error)) throw storageFailure();
        const status = typeof error === 'object' && error !== null
          ? (error as { status?: unknown; statusCode?: unknown }) : {};
        if (status.status === 404 || status.statusCode === '404') return null;
        throw storageFailure();
      }
      if (!data) throw storageFailure();
      const bytes = Buffer.from(await data.arrayBuffer());
      if (!matches(metadata, bytes)) throw storageFailure();
      return bytes;
    } catch (error) {
      if (error instanceof Error && error.message === UNAVAILABLE) throw error;
      throw storageFailure();
    }
  }

  async putVerified(file: PreparedChurchImageFile): Promise<void> {
    try {
      await this.assertPrivateBucket();
      const { error } = await this.client.storage.from(CHURCH_IMAGE_BUCKET).upload(
        file.objectKey,
        file.data,
        { cacheControl: '31536000', contentType: file.contentType, upsert: false },
      );
      // A retry may find the exact immutable object. Every success and conflict is read back and
      // checksum-verified before database completion; a conflicting byte sequence always fails.
      if (error && !isConflict(error)) throw storageFailure();
      const stored = await this.readVerified(file);
      if (!stored) throw storageFailure();
    } catch (error) {
      if (error instanceof Error && error.message === UNAVAILABLE) throw error;
      throw storageFailure();
    }
  }
}
