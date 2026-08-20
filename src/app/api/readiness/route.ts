import { createClient } from '@supabase/supabase-js';
import {
  getContextualRegistrationConfig,
  getPublicSupabaseConfig,
  getServerSupabaseConfig,
} from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

function readinessResponse(status: 'ready' | 'unavailable', httpStatus: 200 | 503) {
  return Response.json(
    { scope: 'core-application', status },
    {
      headers: { 'cache-control': 'no-store' },
      status: httpStatus,
    },
  );
}

export async function GET() {
  const publicConfig = getPublicSupabaseConfig();
  if (!publicConfig || !getServerSupabaseConfig() || !getContextualRegistrationConfig()) {
    return readinessResponse('unavailable', 503);
  }

  const client = createClient(publicConfig.url, publicConfig.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const result = await client
    .schema('api')
    .rpc('transport_church_by_slug', { p_slug: '__core_readiness__' });

  return result.error
    ? readinessResponse('unavailable', 503)
    : readinessResponse('ready', 200);
}
