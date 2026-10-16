import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { SupabaseChurchImageStorage } from './storage';

type CleanupStorage = { removeAbandoned(imageId: string): Promise<void> };
type Dependencies = { client?: SupabaseClient | null; storage?: CleanupStorage };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = ['master', '480', '960', '1600'];

function parseJob(value: unknown): { replacementId: string; imageId: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const job = value as Record<string, unknown>;
  if (typeof job.replacement_id !== 'string' || !UUID.test(job.replacement_id)
    || typeof job.image_id !== 'string' || !UUID.test(job.image_id)
    || !Array.isArray(job.object_keys) || job.object_keys.length !== 4) return null;
  const keys = new Set(job.object_keys);
  if (keys.size !== 4 || !ROLES.every((role) => keys.has(`${job.image_id}/${role}.webp`))) return null;
  return { replacementId: job.replacement_id, imageId: job.image_id };
}

/** Only expired, uncommitted manifests can be leased. Results contain counters, never object keys. */
export async function cleanupAbandonedChurchImages(limit = 10, dependencies: Dependencies = {}) {
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient({ requestTimeoutMs: 10_000 }) : dependencies.client;
  const result = { configured: client !== null, claimed: 0, cleaned: 0, failed: 0 };
  if (!client) return result;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) return { ...result, failed: 1 };
  const storage = dependencies.storage ?? new SupabaseChurchImageStorage(client);
  const api = client.schema('api');
  for (let index = 0; index < limit; index += 1) {
    // Claim immediately before I/O so later items never consume a batch lease while queued.
    const leaseToken = randomUUID();
    let jobs: unknown;
    try {
      const claim = await api.rpc('church_image_cleanup_claim', { p_lease_token: leaseToken, p_limit: 1 });
      if (claim.error) throw new Error();
      jobs = claim.data;
    } catch {
      result.failed += 1;
      break;
    }
    if (!Array.isArray(jobs) || jobs.length > 1) { result.failed += 1; break; }
    if (jobs.length === 0) break;
    result.claimed += 1;
    const job = parseJob(jobs[0]);
    if (!job) { result.failed += 1; continue; }
    let success = false;
    try {
      await storage.removeAbandoned(job.imageId);
      success = true;
    } catch {
      // The database schedules a retry without retaining a provider response or untrusted text.
    }
    try {
      const completed = await api.rpc('church_image_cleanup_complete', {
        p_replacement_id: job.replacementId, p_lease_token: leaseToken, p_success: success,
      });
      if (success && !completed.error && completed.data === true) result.cleaned += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
