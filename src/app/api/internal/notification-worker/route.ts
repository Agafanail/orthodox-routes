import { getNotificationWorkerSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { processNotificationDeliveries } from '@/lib/notifications/worker';
import { processChurchInviteMail } from '@/lib/church-admin/invite-worker';
import { materializeChurchServiceSchedule } from '@/lib/church-admin/schedule-worker';
import { cleanupAbandonedChurchImages } from '@/lib/church-images/cleanup-worker';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = getNotificationWorkerSecret();
  if (!secret) return Response.json({ status: 'unavailable' }, { status: 503 });
  if (!hasValidBearerSecret(request, secret)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }
  const [notifications, churchInvites, churchSchedule, churchImageCleanup] = await Promise.all([
    processNotificationDeliveries(), processChurchInviteMail(), materializeChurchServiceSchedule(),
    cleanupAbandonedChurchImages(),
  ]);
  return Response.json({ ...notifications, churchInvites, churchSchedule, churchImageCleanup }, {
    headers: { 'cache-control': 'no-store' },
    status: churchSchedule.failed > 0 || churchImageCleanup.failed > 0 ? 500
      : notifications.configured || churchInvites.configured || churchSchedule.configured
        || churchImageCleanup.configured ? 200 : 503,
  });
}
