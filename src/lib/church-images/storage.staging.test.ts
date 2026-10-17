import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { describe, it } from 'vitest';
import { readStagingImageConfig } from '../../../scripts/staging-image-config';
import { prepareChurchImage } from './process';
import { CHURCH_IMAGE_BUCKET, SupabaseChurchImageStorage } from './storage';

const enabled = process.env.CHURCH_IMAGE_STORAGE_STAGING_INTEGRATION === '1';
const requireProbe = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

describe.runIf(enabled)('pinned isolated staging church-image Storage', () => {
  it('verifies private immutable synthetic objects and removes only their exact keys', async () => {
    const config = readStagingImageConfig();
    const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init,
        redirect: 'error', credentials: 'omit', signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) }) } };
    const privileged = createClient(config.url, config.secretKey, options);
    const anonymous = createClient(config.url, config.publicKey, options);
    const bucket = await privileged.storage.getBucket(CHURCH_IMAGE_BUCKET);
    requireProbe(!bucket.error && bucket.data?.public === false,
      'Staging probe requires an existing private church-images bucket; it never creates or changes a bucket.');
    const input = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#824a31' } }).png().toBuffer();
    const image = await prepareChurchImage(input);
    const keys = image.files.map((file) => file.objectKey);
    const storage = new SupabaseChurchImageStorage(privileged);
    const started = performance.now();
    for (const key of keys) {
      const prior = await privileged.storage.from(CHURCH_IMAGE_BUCKET).download(key);
      requireProbe(prior.error && !prior.data && String(prior.error.statusCode) === '404',
        'Staging probe refuses a pre-existing synthetic object path.');
    }
    try {
      // Track every generated key before any put, including a committed upload with a lost response.
      for (const file of image.files) await storage.putVerified(file);
      for (const file of image.files) {
        requireProbe((await storage.readVerified(file))?.equals(file.data), 'Staging object checksum/read-back failed.');
        await storage.putVerified(file);
      }
      const denied = await anonymous.storage.from(CHURCH_IMAGE_BUCKET).download(keys[1]);
      requireProbe(denied.error && !denied.data && ['400', '403', '404'].includes(String(denied.error.statusCode)),
        'Staging anonymous private-object denial was not verified.');
      const publicRead = await fetch(`${config.url}/storage/v1/object/public/${CHURCH_IMAGE_BUCKET}/${keys[1]}`,
        { cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
      void publicRead.body?.cancel().catch(() => {});
      requireProbe([400, 403, 404].includes(publicRead.status), 'Staging public-object denial was not verified.');
      await storage.removeAbandoned(image.imageId);
      await storage.removeAbandoned(image.imageId);
      for (const key of keys) {
        const absent = await privileged.storage.from(CHURCH_IMAGE_BUCKET).download(key);
        requireProbe(absent.error && !absent.data && String(absent.error.statusCode) === '404',
          'Staging exact synthetic cleanup could not be verified.');
      }
      // Only non-personal measurements; never keys, project credentials, image UUIDs, or responses.
      console.log(JSON.stringify({ scope: 'staging-church-image-storage', objects: image.files.length,
        processedBytes: image.files.reduce((sum, file) => sum + file.byteLength, 0),
        elapsedMs: Math.ceil(performance.now() - started) }));
    } catch {
      // A timed-out upload may finish late even after acknowledged removal. Preserve only the
      // opaque synthetic reference for an exact-key recheck, never a raw Storage error/body.
      throw new Error(`Staging Storage probe failed for synthetic image ${image.imageId}; recheck its four exact keys before retrying.`);
    } finally {
      try {
        const removed = await privileged.storage.from(CHURCH_IMAGE_BUCKET).remove(keys);
        requireProbe(!removed.error, 'Synthetic cleanup was not acknowledged.');
      } catch {
        throw new Error(`Staging exact-key cleanup failed for synthetic image ${image.imageId}; operator follow-up is required.`);
      }
    }
  }, 120_000);
});
