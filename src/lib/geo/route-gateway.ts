import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePendingLegs, type PendingLeg, type RouteWorkerGateway } from './route-worker';

/**
 * The service-role bridge to the route measurement functions.
 *
 * It exists because the legs carry exact coordinates belonging to two different people. A
 * signed-in person's own session must never be able to read them, so the bridge is granted only
 * to the service role and is used exclusively from the server.
 */
export function createRouteWorkerGateway(client: SupabaseClient): RouteWorkerGateway {
  return {
    async pendingLegs(churchId, limit): Promise<PendingLeg[]> {
      const result = await client.schema('api').rpc('route_worker_pending_legs', {
        p_church_id: churchId,
        p_limit: limit,
      });
      if (result.error) throw new Error('The pending route legs are unavailable.');
      return parsePendingLegs(result.data);
    },

    async recordLeg(leg, distanceM, durationS, providerName) {
      const result = await client.schema('api').rpc('route_worker_record_leg', {
        p_church_id: leg.churchId,
        p_distance_m: distanceM,
        p_duration_s: durationS,
        p_origin_place_id: leg.originPlaceId,
        p_provider_name: providerName,
        p_via_place_id: leg.viaPlaceId,
      });
      if (result.error) throw new Error('The route measurement could not be recorded.');
    },
  };
}
