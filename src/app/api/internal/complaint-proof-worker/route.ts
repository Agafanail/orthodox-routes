import { getComplaintProofWorkerSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { processComplaintProofMail } from '@/lib/complaints/proof-mail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
});

export async function POST(request: Request) {
  try { void request.body?.cancel().catch(() => {}); } catch { /* No request payload selects work. */ }
  try {
    const secret = getComplaintProofWorkerSecret();
    if (!secret) return reply({ status: 'unavailable' }, 503);
    if (!hasValidBearerSecret(request, secret)) return reply({ status: 'unauthorized' }, 401);
    if (request.signal.aborted) return reply({ status: 'unavailable' }, 503);
    // One fresh lease per HTTP invocation; do not multiply a 22-second dependency envelope.
    const result = await processComplaintProofMail(1);
    return reply({ configured: result.configured, claimed: result.claimed, sent: result.sent, failed: result.failed },
      !result.configured ? 503 : result.failed ? 500 : 200);
  } catch { return reply({ status: 'unavailable' }, 503); }
}
