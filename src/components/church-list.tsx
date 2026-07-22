'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getChurchOfferCounts } from '@/lib/churchOfferCounts';
import { parseLocalDriverProfile, parseLocalRoute, parseLocalTrip } from '@/lib/driverOfferState';
import { driverOfferStorageKeys } from '@/lib/driverOfferStorage';
import { readStoredArray } from '@/lib/storage';
import { parseRideMatch } from '@/lib/rideMatchState';
import { rideMatchStorageKey } from '@/lib/rideMatchStorage';
import type { Church, DriverPublicProfile, LocalDriverProfile, RideMatch, Route, Trip } from '@/lib/types';

type LocalOffers = {
  profile: LocalDriverProfile | null;
  routes: Route[];
  trips: Trip[];
  rideMatches: RideMatch[];
};

const emptyLocalOffers: LocalOffers = { profile: null, routes: [], trips: [], rideMatches: [] };

function readLocalOffers(): LocalOffers {
  let profile: LocalDriverProfile | null = null;

  try {
    const storedProfile = window.localStorage.getItem(driverOfferStorageKeys.localDriverProfile);
    profile = storedProfile ? parseLocalDriverProfile(JSON.parse(storedProfile) as unknown) : null;
  } catch {
    profile = null;
  }

  return {
    profile,
    routes: readStoredArray<unknown>(window.localStorage, driverOfferStorageKeys.localRoutes)
      .map(parseLocalRoute)
      .filter((route): route is Route => route !== null),
    trips: readStoredArray<unknown>(window.localStorage, driverOfferStorageKeys.localTrips)
      .map(parseLocalTrip)
      .filter((trip): trip is Trip => trip !== null),
    rideMatches: readStoredArray<unknown>(window.localStorage, rideMatchStorageKey)
      .map(parseRideMatch)
      .filter((match): match is RideMatch => match !== null),
  };
}

export function ChurchList({
  churches,
  drivers,
  routes,
  trips,
  initialNow,
}: {
  churches: Church[];
  drivers: DriverPublicProfile[];
  routes: Route[];
  trips: Trip[];
  initialNow: string;
}) {
  const [localOffers, setLocalOffers] = useState<LocalOffers>(emptyLocalOffers);
  const now = useMemo(() => new Date(initialNow), [initialNow]);
  const refreshLocalOffers = useCallback(() => setLocalOffers(readLocalOffers()), []);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(refreshLocalOffers, 0);
    window.addEventListener('focus', refreshLocalOffers);
    window.addEventListener('storage', refreshLocalOffers);

    return () => {
      window.clearTimeout(hydrationTimer);
      window.removeEventListener('focus', refreshLocalOffers);
      window.removeEventListener('storage', refreshLocalOffers);
    };
  }, [refreshLocalOffers]);

  return (
    <section className="mt-7 grid gap-4 md:grid-cols-2">
      {churches.map((church) => {
        const { driverCount, routeCount, tripCount } = getChurchOfferCounts({
          churchId: church.id,
          staticDrivers: drivers.filter((driver) => driver.visibleChurchIds.includes(church.id)),
          staticRoutes: routes,
          staticTrips: trips,
          localDriverProfile: localOffers.profile,
          localRoutes: localOffers.routes,
          localTrips: localOffers.trips,
          rideMatches: localOffers.rideMatches,
          now,
        });

        return (
          <Link
            className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-amber-700"
            href={`/churches/${church.slug}`}
            key={church.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{church.name}</h2>
                <p className="mt-2 text-sm text-stone-600">{church.address}</p>
              </div>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">
                {church.status}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-600">{church.jurisdiction}</p>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
              <span className="rounded-lg bg-stone-100 p-3">{driverCount} вод.</span>
              <span className="rounded-lg bg-stone-100 p-3">{routeCount} рег.</span>
              <span className="rounded-lg bg-stone-100 p-3">{tripCount} раз.</span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
