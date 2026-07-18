import {
  excludeIdCollisions,
  isRegularRouteAvailable,
  toDriverPublicProfile,
} from './driverOfferState';
import { isOneTimeTripAvailable } from './tripVisibility';
import type { DriverPublicProfile, LocalDriverProfile, Route, Trip } from './types';

type MergeChurchOffersInput = {
  churchId: string;
  staticDrivers: DriverPublicProfile[];
  staticRoutes: Route[];
  staticTrips: Trip[];
  localDriverProfile: LocalDriverProfile | null;
  localRoutes: Route[];
  localTrips: Trip[];
  now: Date;
};

export function mergeChurchOffers({
  churchId,
  staticDrivers,
  staticRoutes,
  staticTrips,
  localDriverProfile,
  localRoutes,
  localTrips,
  now,
}: MergeChurchOffersInput) {
  const localDriverIdCollides = Boolean(
    localDriverProfile && staticDrivers.some((driver) => driver.id === localDriverProfile.driverId),
  );
  const eligibleLocalTrips =
    localDriverProfile && !localDriverIdCollides
      ? excludeIdCollisions(
          localTrips.filter((trip) => trip.driverId === localDriverProfile.driverId),
          staticTrips,
        )
      : [];
  const eligibleLocalRoutes =
    localDriverProfile && !localDriverIdCollides
      ? excludeIdCollisions(
          localRoutes.filter((route) => route.driverId === localDriverProfile.driverId),
          staticRoutes,
        )
      : [];
  const visibleLocalTrips = eligibleLocalTrips.filter(
    (trip) => trip.churchId === churchId && isOneTimeTripAvailable(trip, now),
  );
  const visibleLocalRoutes = eligibleLocalRoutes.filter(
    (route) => route.churchId === churchId && isRegularRouteAvailable(route),
  );
  const trips = [
    ...staticTrips.filter((trip) => trip.churchId === churchId && isOneTimeTripAvailable(trip, now)),
    ...visibleLocalTrips,
  ];
  const routes = [
    ...staticRoutes.filter((route) => route.churchId === churchId && isRegularRouteAvailable(route)),
    ...visibleLocalRoutes,
  ];
  const localOrigins = [...new Set([...visibleLocalRoutes, ...visibleLocalTrips].map((offer) => offer.originLabel))];
  const localPublicDriver =
    localDriverProfile && localOrigins.length > 0
      ? toDriverPublicProfile(localDriverProfile, [churchId], localOrigins.join(' / '))
      : null;
  const drivers = localPublicDriver
    ? [...staticDrivers.filter((driver) => driver.id !== localPublicDriver.id), localPublicDriver]
    : staticDrivers;

  return {
    drivers,
    routes,
    trips,
    visibleLocalRoutes,
    visibleLocalTrips,
    eligibleLocalRoutes,
    eligibleLocalTrips,
    localPublicDriver,
  };
}

export function getChurchOfferCounts(input: MergeChurchOffersInput) {
  const { routes, trips } = mergeChurchOffers(input);
  const activeDriverIds = new Set([
    ...routes.map((route) => route.driverId),
    ...trips.map((trip) => trip.driverId),
  ]);

  return {
    driverCount: activeDriverIds.size,
    routeCount: routes.length,
    tripCount: trips.length,
  };
}
