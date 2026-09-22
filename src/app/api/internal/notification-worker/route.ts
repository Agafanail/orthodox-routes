import { getNotificationWorkerSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { processNotificationDeliveries } from '@/lib/notifications/worker';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = getNotificationWorkerSecret();
  if (!secret) return Response.json({ status: 'unavailable' }, { status: 503 });
  if (!hasValidBearerSecret(request, secret)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }
  const outcome = await processNotificationDeliveries();
  return Response.json(outcome, {
    headers: { 'cache-control': 'no-store' },
    status: outcome.configured ? 200 : 503,
  });
}
