import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { churchImageManifest, prepareChurchImage } from './process';
import { replaceChurchImage } from './replacement';
import type { ChurchImageObjectStorage } from './storage';

const churchId = '11111111-1111-4111-8111-111111111111';
const replacementId = '22222222-2222-4222-8222-222222222222';

function client(handler: (name: string, args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    try {
      return { data: await handler(name, args), error: null };
    } catch (error) {
      return { data: null, error };
    }
  });
  return { value: { schema: vi.fn(() => ({ rpc })) } as unknown as SupabaseClient, rpc };
}

async function upload() {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: '#824a31' } })
    .jpeg().toBuffer();
}

function input(actorClient: SupabaseClient, serviceClient: SupabaseClient,
  storage: ChurchImageObjectStorage, bytes: Buffer) {
  return {
    actorClient, serviceClient, storage, churchId, upload: bytes,
    expectedContentVersion: 3, clientKey: randomUUID(), rightsConfirmed: true as const,
    attribution: 'Synthetic photographer',
  };
}

describe('church photograph replacement orchestration', () => {
  it('stages a strict manifest before uploading cleaned objects and completing', async () => {
    const bytes = await upload();
    const events: string[] = [];
    const saved = { status: 'saved', church_id: churchId, image_id: '', content_version: 4 } as const;
    const actor = client((name, args) => {
      expect(name).toBe('prepare_church_image_replacement');
      expect(args.p_upload_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      return { status: 'prepared', replacement_id: replacementId, expires_at: new Date(Date.now() + 60_000).toISOString() };
    });
    let stagedImageId = '';
    const service = client((name, args) => {
      events.push(name);
      if (name === 'inspect_church_image_replacement') {
        return { state: 'pending', expires_at: new Date(Date.now() + 60_000).toISOString(), manifest: null, result: null };
      }
      if (name === 'stage_church_image_replacement') {
        const manifest = args.p_manifest as ReturnType<typeof churchImageManifest>;
        stagedImageId = manifest.imageId;
        expect(manifest.files).toHaveLength(4);
        expect(JSON.stringify(manifest)).not.toContain(bytes.toString('base64'));
        return true;
      }
      if (name === 'complete_church_image_replacement') return { ...saved, image_id: stagedImageId };
      throw new Error('unexpected RPC');
    });
    const putVerified = vi.fn(async (
      file: Parameters<ChurchImageObjectStorage['putVerified']>[0],
    ) => {
      expect(file.contentType).toBe('image/webp');
      events.push('storage.putVerified');
    });
    const storage = { putVerified, readVerified: vi.fn() } satisfies ChurchImageObjectStorage;

    const result = await replaceChurchImage(input(actor.value, service.value, storage, bytes));

    expect(result).toEqual({ ...saved, image_id: stagedImageId });
    expect(events).toEqual([
      'inspect_church_image_replacement', 'stage_church_image_replacement',
      'storage.putVerified', 'storage.putVerified', 'storage.putVerified', 'storage.putVerified',
      'complete_church_image_replacement',
    ]);
    expect(putVerified.mock.calls.map(([file]) => file.role)).toEqual(['master', '480', '960', '1600']);
  });

  it('reuses the staged opaque identifier and deterministic manifest on retry', async () => {
    const bytes = await upload();
    const previouslyPrepared = await prepareChurchImage(bytes);
    const manifest = churchImageManifest(previouslyPrepared);
    const actor = client(() => ({
      status: 'prepared', replacement_id: replacementId, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }));
    const service = client((name, args) => {
      if (name === 'inspect_church_image_replacement') return {
        state: 'staged', expires_at: new Date(Date.now() + 60_000).toISOString(), manifest, result: null,
      };
      if (name === 'stage_church_image_replacement') {
        expect(args.p_manifest).toEqual(manifest);
        return true;
      }
      return { status: 'saved', church_id: churchId, image_id: manifest.imageId, content_version: 4 };
    });
    const storage = { putVerified: vi.fn(), readVerified: vi.fn() } satisfies ChurchImageObjectStorage;

    const result = await replaceChurchImage(input(actor.value, service.value, storage, bytes));

    expect(result.image_id).toBe(manifest.imageId);
    expect(storage.putVerified).toHaveBeenCalledTimes(4);
  });

  it('returns a committed retry without processing or touching Storage', async () => {
    const saved = { status: 'saved', church_id: churchId, image_id: randomUUID(), content_version: 7 } as const;
    const actor = client(() => saved);
    const service = client(() => { throw new Error('must not inspect'); });
    const storage = { putVerified: vi.fn(), readVerified: vi.fn() } satisfies ChurchImageObjectStorage;

    await expect(replaceChurchImage(input(actor.value, service.value, storage, Buffer.from('not decoded'))))
      .resolves.toEqual(saved);
    expect(service.rpc).not.toHaveBeenCalled();
    expect(storage.putVerified).not.toHaveBeenCalled();
  });

  it('never completes metadata when a cleaned object cannot be verified', async () => {
    const bytes = await upload();
    const actor = client(() => ({
      status: 'prepared', replacement_id: replacementId, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }));
    const service = client((name) => name === 'inspect_church_image_replacement'
      ? { state: 'pending', expires_at: new Date(Date.now() + 60_000).toISOString(), manifest: null, result: null }
      : name === 'stage_church_image_replacement' ? true : { status: 'saved' });
    const storage = {
      putVerified: vi.fn().mockRejectedValue(new Error('private storage detail')),
      readVerified: vi.fn(),
    } satisfies ChurchImageObjectStorage;

    await expect(replaceChurchImage(input(actor.value, service.value, storage, bytes)))
      .rejects.toThrow('Church photograph replacement is unavailable.');
    expect(service.rpc.mock.calls.map(([name]) => name)).not.toContain('complete_church_image_replacement');
  });
});
