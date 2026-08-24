import { createClient } from '@supabase/supabase-js';
import { resolveGeoProvider, getBrowserMapKey } from '@/lib/geo/provider-factory';
import {
  getContextualRegistrationConfig,
  getPublicSupabaseConfig,
  getServerSupabaseConfig,
} from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * Whether the map capabilities are configured, as booleans only.
 *
 * This exists because a missing credential and a rejected credential look identical from a
 * page: both simply produce "the map is unavailable". Reporting which half is configured turns
 * that into a one-request answer during deployment, without revealing any key, key length, or
 * provider response.
 */
function mapReadiness() {
  return {
    // Address search and route measurement run on the server with the server credential.
    search: resolveGeoProvider() !== null,
    // Tiles are fetched by the browser with the separate render credential.
    rendering: getBrowserMapKey() !== null,
  };
}

function readinessResponse(status: 'ready' | 'unavailable', httpStatus: 200 | 503) {
  return Response.json(
    { maps: mapReadiness(), scope: 'core-application', status },
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
