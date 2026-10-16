import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { churchImageManifest, prepareChurchImage } from './process';
import type { ChurchImageObjectStorage } from './storage';

type ReplacementResult = {
  status: 'saved';
  church_id: string;
  image_id: string;
  content_version: number;
};

type PreparedReplacement = {
  status: 'prepared';
  replacement_id: string;
  expires_at: string;
};

type InspectedReplacement =
  | { state: 'pending'; expires_at: string; manifest: null; result: null }
  | { state: 'staged'; expires_at: string; manifest: ReturnType<typeof churchImageManifest>; result: null }
  | { state: 'succeeded'; expires_at: string; manifest: ReturnType<typeof churchImageManifest>; result: ReplacementResult };

export type ReplaceChurchImageInput = {
  actorClient: SupabaseClient;
  serviceClient: SupabaseClient;
  storage: ChurchImageObjectStorage;
  churchId: string;
  expectedContentVersion: number;
  clientKey: string;
  rightsConfirmed: true;
  attribution?: string | null;
  upload: Buffer;
};

const UNAVAILABLE = 'Church photograph replacement is unavailable.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(): never {
  throw new Error(UNAVAILABLE);
}

function isSaved(value: unknown): value is ReplacementResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ReplacementResult>;
  return item.status === 'saved' && typeof item.content_version === 'number'
    && Number.isSafeInteger(item.content_version) && item.content_version > 0
    && typeof item.church_id === 'string' && UUID.test(item.church_id)
    && typeof item.image_id === 'string' && UUID.test(item.image_id);
}

function isPrepared(value: unknown): value is PreparedReplacement {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PreparedReplacement>;
  return item.status === 'prepared' && typeof item.replacement_id === 'string'
    && UUID.test(item.replacement_id) && typeof item.expires_at === 'string'
    && Number.isFinite(Date.parse(item.expires_at));
}

function isInspection(value: unknown): value is InspectedReplacement {
  if (!value || typeof value !== 'object') return false;
  const item = value as {
    state?: unknown;
    expires_at?: unknown;
    manifest?: unknown;
    result?: unknown;
  };
  if (typeof item.state !== 'string' || !['pending', 'staged', 'succeeded'].includes(item.state)
    || typeof item.expires_at !== 'string' || !Number.isFinite(Date.parse(item.expires_at))) return false;
  if (item.state === 'pending') return item.manifest === null && item.result === null;
  if (!item.manifest || typeof item.manifest !== 'object') return false;
  const manifest = item.manifest as { imageId?: unknown };
  if (typeof manifest.imageId !== 'string' || !UUID.test(manifest.imageId)) return false;
  return item.state === 'succeeded' ? isSaved(item.result) : item.state === 'staged' && item.result === null;
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail();
  return result.data as unknown;
}

/**
 * Trusted server orchestration. The untouched upload stays in memory and only cleaned, verified
 * immutable WebP objects reach Storage. UI wiring remains gated on owner-approved upload limits.
 */
export async function replaceChurchImage(input: ReplaceChurchImageInput): Promise<ReplacementResult> {
  try {
    if (!Buffer.isBuffer(input.upload)) fail();
    const uploadSha256 = createHash('sha256').update(input.upload).digest('hex');
    const prepared = await rpc(input.actorClient, 'prepare_church_image_replacement', {
      p_church_id: input.churchId,
      p_expected_version: input.expectedContentVersion,
      p_upload_sha256: uploadSha256,
      p_rights_confirmed: input.rightsConfirmed,
      p_attribution: input.attribution ?? null,
      p_client_key: input.clientKey,
    });
    if (isSaved(prepared)) return prepared;
    if (!isPrepared(prepared)) fail();

    const inspected = await rpc(input.serviceClient, 'inspect_church_image_replacement', {
      p_replacement_id: prepared.replacement_id,
    });
    if (!isInspection(inspected)) fail();
    if (inspected.state === 'succeeded') return inspected.result;

    const image = await prepareChurchImage(
      input.upload,
      inspected.state === 'staged' ? inspected.manifest.imageId : undefined,
    );
    const manifest = churchImageManifest(image);
    const staged = await rpc(input.serviceClient, 'stage_church_image_replacement', {
      p_replacement_id: prepared.replacement_id,
      p_upload_sha256: uploadSha256,
      p_manifest: manifest,
    });
    if (staged !== true && staged !== false) fail();
    if (staged) {
      for (const file of image.files) await input.storage.putVerified(file);
    }
    const completed = await rpc(input.serviceClient, 'complete_church_image_replacement', {
      p_replacement_id: prepared.replacement_id,
    });
    if (!isSaved(completed)) fail();
    return completed;
  } catch {
    fail();
  }
}
