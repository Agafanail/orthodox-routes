import { getComplaintMaintenanceSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { maintainComplaintPreparation } from '@/lib/complaints/maintenance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
});

export async function POST(request: Request) {
  // No request body selects operations, limits, policy, recipients or row IDs.
  try { void request.body?.cancel().catch(() => {}); } catch { /* Never await unneeded input. */ }
  try {
    const secret = getComplaintMaintenanceSecret();
    if (!secret) return reply({ status: 'unavailable' }, 503);
    if (!hasValidBearerSecret(request, secret)) return reply({ status: 'unauthorized' }, 401);
    if (request.signal.aborted) return reply({ status: 'unavailable' }, 503);
    const result = await maintainComplaintPreparation();
    return reply({ configured: result.configured, expiredDrafts: result.expiredDrafts,
      expiredPreparationBuckets: result.expiredPreparationBuckets, expiredVerificationBuckets: result.expiredVerificationBuckets,
      failed: result.failed }, !result.configured ? 503 : result.failed ? 500 : 200);
  } catch { return reply({ status: 'unavailable' }, 503); }
}
