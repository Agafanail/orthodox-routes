import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareChurchImage } from './process';
import { CHURCH_IMAGE_BUCKET, SupabaseChurchImageStorage } from './storage';

const enabled = process.env.CHURCH_IMAGE_STORAGE_INTEGRATION === '1';
const supabaseCli = fileURLToPath(new URL('../../../node_modules/supabase/dist/supabase.js', import.meta.url));

function localConfiguration() {
  const result = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error('The isolated local Storage stack is unavailable.');
  const values = new Map<string, string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const secretKey = values.get('SECRET_KEY') ?? values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !secretKey) throw new Error('Local Storage credentials are unavailable.');
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('Church image integration refuses a non-local project.');
  }
  return { publicKey, secretKey, url };
}

describe.runIf(enabled)('private church-image Storage integration', () => {
  it('uploads, reads back, retries, denies public reads, and cleans exact synthetic objects', async () => {
    const config = localConfiguration();
    const privileged = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const anonymous = createClient(config.url, config.publicKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const existing = await privileged.storage.getBucket(CHURCH_IMAGE_BUCKET);
    expect(existing.data).toBeNull();
    expect(existing.error).toBeTruthy();
    let created = false;
    let objectKeys: string[] = [];
    try {
      const bucket = await privileged.storage.createBucket(CHURCH_IMAGE_BUCKET, {
        allowedMimeTypes: ['image/webp'], public: false,
      });
      expect(bucket.error).toBeNull();
      created = true;
      const checkedBucket = await privileged.storage.getBucket(CHURCH_IMAGE_BUCKET);
      expect(checkedBucket.error).toBeNull();
      expect(checkedBucket.data?.public).toBe(false);

      const input = await sharp({
        create: { width: 64, height: 32, channels: 3, background: '#824a31' },
      }).png().toBuffer();
      const image = await prepareChurchImage(input);
      objectKeys = image.files.map((file) => file.objectKey);
      const storage = new SupabaseChurchImageStorage(privileged);
      for (const file of image.files) await storage.putVerified(file);
      for (const file of image.files) {
        expect(await storage.readVerified(file)).toEqual(file.data);
        await storage.putVerified(file);
      }
      const denied = await anonymous.storage.from(CHURCH_IMAGE_BUCKET).download(objectKeys[1]);
      expect(denied.data).toBeNull();
      expect(denied.error).toBeTruthy();
    } finally {
      if (created) {
        let removalError: unknown = null;
        if (objectKeys.length > 0) {
          const removed = await privileged.storage.from(CHURCH_IMAGE_BUCKET).remove(objectKeys);
          removalError = removed.error;
        }
        const deleted = await privileged.storage.deleteBucket(CHURCH_IMAGE_BUCKET);
        expect(removalError).toBeNull();
        expect(deleted.error).toBeNull();
      }
    }
  }, 30_000);
});
