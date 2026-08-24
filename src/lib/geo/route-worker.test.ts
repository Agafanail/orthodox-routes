import { describe, expect, it, vi } from 'vitest';
import { createFakeGeoProvider } from './fake-provider';
import { GeoProviderUnavailableError, type GeoProvider } from './provider';
import { measurePendingLegs, parsePendingLegs, type PendingLeg, type RouteWorkerGateway } from './route-worker';

const church = { lat: 45.0703, lng: 7.6869 };
const origin = { lat: 45.02, lng: 7.65 };
const via = { lat: 45.05, lng: 7.67 };

function leg(overrides: Partial<PendingLeg> = {}): PendingLeg {
  return {
    churchId: '00000000-0000-4000-8000-000000000001',
    destination: church,
    origin,
    originPlaceId: '11111111-1111-4111-8111-111111111111',
    via: null,
    viaPlaceId: null,
    ...overrides,
  };
}

function gateway(legs: PendingLeg[]) {
  const recorded: Array<{ leg: PendingLeg; distanceM: number; durationS: number; provider: string }> = [];
  const value: RouteWorkerGateway = {
    async pendingLegs() { return legs; },
    async recordLeg(pending, distanceM, durationS, provider) {
      recorded.push({ distanceM, durationS, leg: pending, provider });
    },
  };
  return { gateway: value, recorded };
}

describe('measurePendingLegs', () => {
  it('measures each pending leg and records only two numbers and a provider name', async () => {
    const { gateway: value, recorded } = gateway([leg(), leg({ via, viaPlaceId: 'x' })]);
    const result = await measurePendingLegs(value, createFakeGeoProvider());

    expect(result).toEqual({ measured: 2, providerUnavailable: false });
    expect(recorded).toHaveLength(2);
    expect(Object.keys(recorded[0])).toEqual(['distanceM', 'durationS', 'leg', 'provider']);
    expect(recorded[0].provider).toBe('local-fake');
    // A detour through a point is never shorter than the direct road.
    expect(recorded[1].distanceM).toBeGreaterThan(recorded[0].distanceM);
  });

  // A provider outage must leave matching unable to claim anything, not claiming a mismatch.
  it('reports the provider as unavailable without recording anything', async () => {
    const { gateway: value, recorded } = gateway([leg()]);
    const result = await measurePendingLegs(value, createFakeGeoProvider({ unavailable: true }));

    expect(result).toEqual({ measured: 0, providerUnavailable: true });
    expect(recorded).toEqual([]);
  });

  it('treats an unexpected provider error the same way', async () => {
    const failing: GeoProvider = {
      name: 'broken',
  async probe() { return { ok: true, results: 0, status: 200 }; },
      async measureRoute() { throw new Error('unexpected'); },
      async searchPlaces() { return []; },
    };
    const { gateway: value } = gateway([leg()]);
    expect(await measurePendingLegs(value, failing)).toEqual({ measured: 0, providerUnavailable: true });
  });

  it('bounds the number of legs it asks for, so one render cannot become a spend event', async () => {
    const pendingLegs = vi.fn(async () => [] as PendingLeg[]);
    await measurePendingLegs({ pendingLegs, async recordLeg() {} }, createFakeGeoProvider(), { limit: 500 });
    expect(pendingLegs).toHaveBeenCalledWith(null, 50);

    await measurePendingLegs({ pendingLegs, async recordLeg() {} }, createFakeGeoProvider());
    expect(pendingLegs).toHaveBeenLastCalledWith(null, 8);
  });

  it('stays quiet when the database bridge itself is unavailable', async () => {
    const result = await measurePendingLegs({
      async pendingLegs() { throw new Error('bridge down'); },
      async recordLeg() {},
    }, createFakeGeoProvider());
    expect(result).toEqual({ measured: 0, providerUnavailable: false });
  });

  it('skips a nonsensical measurement rather than storing it', async () => {
    const broken: GeoProvider = {
      name: 'broken',
  async probe() { return { ok: true, results: 0, status: 200 }; },
      async measureRoute() { return { distanceM: Number.NaN, durationS: -1 }; },
      async searchPlaces() { return []; },
    };
    const { gateway: value, recorded } = gateway([leg()]);
    expect(await measurePendingLegs(value, broken)).toEqual({ measured: 0, providerUnavailable: false });
    expect(recorded).toEqual([]);
  });
});

describe('parsePendingLegs', () => {
  it('reads legs and their optional via point', () => {
    const legs = parsePendingLegs([
      {
        church_id: 'c', destination: church, origin, origin_place_id: 'o', via: null, via_place_id: null,
      },
      {
        church_id: 'c', destination: church, origin, origin_place_id: 'o', via, via_place_id: 'v',
      },
    ]);
    expect(legs).toHaveLength(2);
    expect(legs[0].via).toBeNull();
    expect(legs[1].via).toEqual(via);
  });

  it('drops a leg without usable coordinates', () => {
    expect(parsePendingLegs([{ church_id: 'c', origin_place_id: 'o' }])).toEqual([]);
    expect(parsePendingLegs('nonsense')).toEqual([]);
  });
});

describe('GeoProviderUnavailableError', () => {
  it('carries an ordinary message rather than provider detail', () => {
    expect(new GeoProviderUnavailableError().message).toBe('The map provider is unavailable.');
  });
});
