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

function readinessResponse(
  status: 'ready' | 'unavailable',
  httpStatus: 200 | 503,
  probe?: Awaited<ReturnType<NonNullable<ReturnType<typeof resolveGeoProvider>>['probe']>>,
) {
  return Response.json(
    {
      maps: { ...mapReadiness(), ...(probe ? { probe } : {}) },
      scope: 'core-application',
      status,
    },
    {
      headers: { 'cache-control': 'no-store' },
      status: httpStatus,
    },
  );
}

/**
 * Runs the provider probe only when explicitly asked. It costs a billed request, so it is never
 * part of an ordinary readiness poll.
 */
async function requestedProbe(request: Request) {
  if (new URL(request.url).searchParams.get('probe') !== 'maps') return undefined;
  const provider = resolveGeoProvider();
  return provider ? provider.probe() : { ok: false, results: null, status: null };
}

export async function GET(request: Request) {
  const probe = await requestedProbe(request);
  const publicConfig = getPublicSupabaseConfig();
  if (!publicConfig || !getServerSupabaseConfig() || !getContextualRegistrationConfig()) {
    return readinessResponse('unavailable', 503, probe);
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
    ? readinessResponse('unavailable', 503, probe)
    : readinessResponse('ready', 200, probe);
}
