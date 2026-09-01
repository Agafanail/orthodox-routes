import { RouteNotAvailableError, type GeoProvider } from './provider';
import type { Coordinate } from './types';

/**
 * Fills the missing road measurements that quality matching needs.
 *
 * The database has already applied every cheap deterministic condition, so a leg reaches this
 * worker only for a pair that is otherwise a match. That ordering is the cost control: an
 * ineligible candidate never reaches a billed provider call.
 *
 * The worker keeps only the two numbers it needs. Provider route geometry is discarded here and
 * never crosses into the database, because the driver never promised to follow that road.
 */

export type PendingLeg = {
  churchId: string;
  originPlaceId: string;
  viaPlaceId: string | null;
  origin: Coordinate;
  destination: Coordinate;
  via: Coordinate | null;
};

/** The narrow database surface the worker needs, so it can be exercised without a network. */
export type RouteWorkerGateway = {
  pendingLegs(churchId: string | null, limit: number): Promise<PendingLeg[]>;
  recordLeg(leg: PendingLeg, distanceM: number, durationS: number, providerName: string): Promise<void>;
};

export type RouteWorkerResult = {
  measured: number;
  /** True when the provider could not answer. Matching then claims nothing, rather than "no". */
  providerUnavailable: boolean;
};

export type RouteWorkerOptions = {
  churchId?: string;
  /** Hard bound on provider calls for one run, so a busy board cannot become a spend event. */
  limit?: number;
  signal?: AbortSignal;
};

export async function measurePendingLegs(
  gateway: RouteWorkerGateway,
  provider: GeoProvider,
  options: RouteWorkerOptions = {},
): Promise<RouteWorkerResult> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  let legs: PendingLeg[];
  try {
    legs = await gateway.pendingLegs(options.churchId ?? null, limit);
  } catch {
    return { measured: 0, providerUnavailable: false };
  }

  let measured = 0;
  for (const leg of legs) {
    try {
      const measurement = await provider.measureRoute({
        destination: leg.destination,
        origin: leg.origin,
        ...(leg.via ? { via: leg.via } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!Number.isFinite(measurement.distanceM) || !Number.isFinite(measurement.durationS)
        || measurement.distanceM < 0 || measurement.durationS < 0) {
        continue;
      }
      await gateway.recordLeg(
        leg,
        Math.round(measurement.distanceM),
        Math.round(measurement.durationS),
        provider.name,
      );
      measured += 1;
    } catch (error) {
      // A leg the provider cannot route — a point with no road near it — is skipped, and the
      // run carries on. It is a fact about that one place, not about the provider, and letting
      // it stop the run left every suggestion at the church unchecked because of a single
      // unreachable meeting point. The place stays unmeasured, which already means "not
      // established" and never "does not match".
      if (error instanceof RouteNotAvailableError) continue;
      // A genuine outage does stop the run, without turning an unmeasured candidate into a
      // negative claim. The board and every existing agreement keep working.
      return { measured, providerUnavailable: true };
    }
  }

  return { measured, providerUnavailable: false };
}

function coordinate(value: unknown): Coordinate | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  return typeof item.lat === 'number' && typeof item.lng === 'number'
    ? { lat: item.lat, lng: item.lng }
    : null;
}

/** Parses the service-role bridge payload into legs the worker can measure. */
export function parsePendingLegs(value: unknown): PendingLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const churchId = typeof item.church_id === 'string' ? item.church_id : null;
    const originPlaceId = typeof item.origin_place_id === 'string' ? item.origin_place_id : null;
    const origin = coordinate(item.origin);
    const destination = coordinate(item.destination);
    if (!churchId || !originPlaceId || !origin || !destination) return [];
    return [{
      churchId,
      destination,
      origin,
      originPlaceId,
      via: coordinate(item.via),
      viaPlaceId: typeof item.via_place_id === 'string' ? item.via_place_id : null,
    }];
  });
}
