import { getTranslationWorkerSecret } from '@/lib/supabase/config';
import { hasValidBearerSecret } from '@/lib/notifications/request-auth';
import { processTranslationJobs } from '@/lib/translations/worker';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = getTranslationWorkerSecret();
  if (!secret) return Response.json({ status: 'unavailable' }, { status: 503 });
  if (!hasValidBearerSecret(request, secret)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }
  const result = await processTranslationJobs();
  return Response.json(result, {
    headers: { 'cache-control': 'no-store' },
    status: !result.configured ? 503 : result.failed > 0 ? 500 : 200,
  });
}
