import { getNotificationWorkerSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { processNotificationDeliveries } from '@/lib/notifications/worker';
import { processChurchInviteMail } from '@/lib/church-admin/invite-worker';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = getNotificationWorkerSecret();
  if (!secret) return Response.json({ status: 'unavailable' }, { status: 503 });
  if (!hasValidBearerSecret(request, secret)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }
  const [notifications, churchInvites] = await Promise.all([
    processNotificationDeliveries(), processChurchInviteMail(),
  ]);
  return Response.json({ ...notifications, churchInvites }, {
    headers: { 'cache-control': 'no-store' },
    status: notifications.configured || churchInvites.configured ? 200 : 503,
  });
}
