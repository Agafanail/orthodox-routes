import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';

type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
} } };

/** Only existing logical expiry, never received complaints, case/audit retention or delivery. */
export async function maintainComplaintPreparation(dependencies: { client?: Client | null } = {}) {
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient({ requestTimeoutMs: 5000 }) : dependencies.client;
  const summary = { configured: client !== null, expiredDrafts: 0, expiredPreparationBuckets: 0, expiredVerificationBuckets: 0, failed: 0 };
  if (!client) return summary;
  const steps = [
    ['expire_complaint_email_drafts', 'expiredDrafts', 50],
    ['expire_complaint_rate_buckets', 'expiredPreparationBuckets', 100],
    ['expire_complaint_verification_rate_buckets', 'expiredVerificationBuckets', 100],
  ] as const;
  for (const [name, count, limit] of steps) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        client.schema('api').rpc(name, { p_limit: limit }).abortSignal(controller.signal),
        new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000); }),
      ]);
      if (!result || result.error || typeof result.data !== 'number' || !Number.isSafeInteger(result.data)
        || result.data < 0 || result.data > limit) { summary.failed = 1; break; }
      summary[count] = result.data;
    } catch { summary.failed = 1; break; }
    finally { clearTimeout(timer); controller.abort(); }
  }
  return summary;
}
