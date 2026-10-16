import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { cleanupAbandonedChurchImages } from './cleanup-worker';

const imageId = '11111111-1111-4111-8111-111111111111';
const replacementId = '22222222-2222-4222-8222-222222222222';
const job = {
  image_id: imageId, replacement_id: replacementId,
  object_keys: ['master', '480', '960', '1600'].map((role) => `${imageId}/${role}.webp`),
};

function client(rpc: ReturnType<typeof vi.fn>) {
  return { schema: vi.fn(() => ({ rpc })) } as unknown as SupabaseClient;
}

describe('abandoned church-image cleanup worker', () => {
  it('leases just before each deletion and returns only safe counters', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const storage = { removeAbandoned: vi.fn().mockResolvedValue(undefined) };
    const result = await cleanupAbandonedChurchImages(10, { client: client(rpc), storage });
    expect(result).toEqual({ configured: true, claimed: 1, cleaned: 1, failed: 0 });
    expect(storage.removeAbandoned).toHaveBeenCalledWith(imageId);
    const lease = rpc.mock.calls[0][1].p_lease_token;
    expect(rpc.mock.calls[1]).toEqual(['church_image_cleanup_complete', {
      p_replacement_id: replacementId, p_lease_token: lease, p_success: true,
    }]);
    expect(rpc.mock.calls[2][1].p_lease_token).not.toBe(lease);
  });

  it('records retry state after a Storage error without leaking provider text', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const storage = { removeAbandoned: vi.fn().mockRejectedValue(new Error('private provider response')) };
    const result = await cleanupAbandonedChurchImages(1, { client: client(rpc), storage });
    expect(result).toEqual({ configured: true, claimed: 1, cleaned: 0, failed: 1 });
    expect(rpc.mock.calls[1][1].p_success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private provider');
  });

  it('refuses unsafe keys before deleting any object', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...job,
      object_keys: ['../another.webp', ...job.object_keys.slice(1)],
    }], error: null });
    const storage = { removeAbandoned: vi.fn() };
    expect(await cleanupAbandonedChurchImages(1, { client: client(rpc), storage }))
      .toEqual({ configured: true, claimed: 1, cleaned: 0, failed: 1 });
    expect(storage.removeAbandoned).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does no work without configuration and rejects an unbounded batch', async () => {
    expect(await cleanupAbandonedChurchImages(10, { client: null }))
      .toEqual({ configured: false, claimed: 0, cleaned: 0, failed: 0 });
    const rpc = vi.fn();
    expect((await cleanupAbandonedChurchImages(Number.NaN, { client: client(rpc) })).failed).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('counts a lost completion lease as a failure', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [job], error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const storage = { removeAbandoned: vi.fn().mockResolvedValue(undefined) };
    expect(await cleanupAbandonedChurchImages(1, { client: client(rpc), storage }))
      .toEqual({ configured: true, claimed: 1, cleaned: 0, failed: 1 });
  });
});
