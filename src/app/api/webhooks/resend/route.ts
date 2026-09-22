import { getResendWebhookSecret } from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { processResendWebhook, readResendWebhookHeaders } from '@/lib/notifications/resend-webhook';

export const dynamic = 'force-dynamic';

const MAXIMUM_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const secret = getResendWebhookSecret();
  const client = createPrivilegedSupabaseClient();
  if (!secret || !client) return Response.json({ status: 'unavailable' }, { status: 503 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    return Response.json({ status: 'invalid' }, { status: 413 });
  }
  const headers = readResendWebhookHeaders(request.headers);
  if (!headers) return Response.json({ status: 'invalid' }, { status: 400 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAXIMUM_BODY_BYTES) {
    return Response.json({ status: 'invalid' }, { status: 413 });
  }
  const outcome = await processResendWebhook(rawBody, headers, secret, client);
  if (!outcome.accepted) {
    return Response.json(
      { status: outcome.reason },
      { status: outcome.reason === 'database_unavailable' ? 503 : 400 },
    );
  }
  return Response.json({ status: 'accepted' }, { headers: { 'cache-control': 'no-store' } });
}
