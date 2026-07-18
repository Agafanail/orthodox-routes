import type { Church, DriverPublicProfile, Route, Trip } from './types';
import { isOneTimeTripAvailable } from './tripVisibility';

export const mockChurches: Church[] = [
  {
    id: 'pokrov-catanzaro',
    name: 'Покров Пресвятой Богородицы',
    slug: 'pokrov-catanzaro',
    jurisdiction: 'Archdiocese of Orthodox Churches of Russian Tradition in Western Europe',
    languages: ['Russian', 'Italian', 'Church Slavonic'],
    address: 'Catanzaro, Calabria, Italy',
    imageUrl: '/images/church-fallback-byzantine.png',
    imageAlt: 'Православный храм среди кипарисов',
    imageSource: 'default',
    location: { lat: 38.9098, lng: 16.5877 },
    status: 'verified',
    contacts: { website: 'https://example.org/pokrov-catanzaro' },
    schedule: {
      regular: 'Sunday: Divine Liturgy 09:00. Saturday: Vespers by announcement.',
      exceptions: 'Check the parish notice before major feasts.',
      lastUpdatedAt: '2026-07-01',
      services: [
        { id: 'pokrov-vigil-2026-07-18', name: 'Всенощное бдение', date: '2026-07-18', startTime: '17:00' },
        { id: 'pokrov-liturgy-2026-07-19', name: 'Божественная литургия', date: '2026-07-19', startTime: '09:00' },
        { id: 'pokrov-liturgy-2026-07-26', name: 'Божественная литургия', date: '2026-07-26', startTime: '09:00' },
        { id: 'pokrov-liturgy-2026-08-02', name: 'Божественная литургия', date: '2026-08-02', startTime: '09:00' },
        { id: 'pokrov-liturgy-2026-08-09', name: 'Божественная литургия', date: '2026-08-09', startTime: '09:00' },
        { id: 'pokrov-liturgy-2026-08-16', name: 'Божественная литургия', date: '2026-08-16', startTime: '09:00' },
      ],
    },
  },
  {
    id: 'st-nicholas-bari',
    name: 'Saint Nicholas Parish',
    slug: 'st-nicholas-bari',
    jurisdiction: 'Romanian Orthodox Diocese of Italy',
    languages: ['Romanian', 'Italian'],
    address: 'Bari, Apulia, Italy',
    imageUrl: '/images/church-fallback-byzantine.png',
    imageAlt: 'Православный храм среди кипарисов',
    imageSource: 'default',
    location: { lat: 41.1171, lng: 16.8719 },
    status: 'unverified',
  },
];

export const mockDrivers: DriverPublicProfile[] = [
  {
    id: 'dmitry',
    publicName: 'Дмитрий',
    departureArea: 'Squillace / Catanzaro Lido',
    visibleChurchIds: ['pokrov-catanzaro'],
  },
  {
    id: 'anna',
    publicName: 'Анна',
    photoUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=320&q=80',
    departureArea: 'Soverato',
    visibleChurchIds: ['pokrov-catanzaro'],
  },
  {
    id: 'mihai',
    publicName: 'Mihai',
    departureArea: 'Bari Centrale',
    visibleChurchIds: ['st-nicholas-bari'],
  },
];

export const mockRoutes: Route[] = [
  {
    id: 'route-1',
    churchId: 'pokrov-catanzaro',
    driverId: 'dmitry',
    originLabel: 'Squillace',
    maxDetourKm: 5,
    recurrence: { daysOfWeek: [0], typicalDepartureTime: '08:15', typicalArrivalTime: '08:50' },
    seats: 2,
    returnTrip: true,
    status: 'active',
  },
  {
    id: 'route-2',
    churchId: 'pokrov-catanzaro',
    driverId: 'anna',
    originLabel: 'Soverato',
    maxDetourKm: 0,
    recurrence: { daysOfWeek: [0], typicalDepartureTime: '07:55', typicalArrivalTime: '08:45' },
    seats: 3,
    returnTrip: true,
    status: 'active',
  },
  {
    id: 'route-3',
    churchId: 'st-nicholas-bari',
    driverId: 'mihai',
    originLabel: 'Bari Centrale',
    maxDetourKm: 2,
    recurrence: { daysOfWeek: [0], typicalDepartureTime: '09:20', typicalArrivalTime: '09:45' },
    seats: 1,
    returnTrip: false,
    status: 'active',
  },
];

export const mockTrips: Trip[] = [
  {
    id: 'trip-1',
    churchId: 'pokrov-catanzaro',
    driverId: 'dmitry',
    routeId: 'route-1',
    date: '2026-07-12',
    departureTime: '08:15',
    originLabel: 'Squillace',
    maxDetourKm: 5,
    seatsTotal: 2,
    seatsAvailable: 2,
    returnTrip: true,
    status: 'open',
  },
  {
    id: 'trip-2',
    churchId: 'pokrov-catanzaro',
    driverId: 'anna',
    routeId: 'route-2',
    date: '2026-07-19',
    departureTime: '07:55',
    originLabel: 'Soverato',
    maxDetourKm: 0,
    seatsTotal: 3,
    seatsAvailable: 1,
    returnTrip: true,
    status: 'open',
  },
  {
    id: 'trip-3',
    churchId: 'st-nicholas-bari',
    driverId: 'mihai',
    date: '2026-07-12',
    departureTime: '09:20',
    originLabel: 'Bari Centrale',
    maxDetourKm: 2,
    seatsTotal: 1,
    seatsAvailable: 1,
    returnTrip: false,
    status: 'open',
  },
];

export function getChurchBySlug(slug: string) {
  return mockChurches.find((church) => church.slug === slug);
}

export function getDriverById(id: string) {
  return mockDrivers.find((driver) => driver.id === id);
}

export function getChurchDrivers(churchId: string) {
  return mockDrivers.filter((driver) => driver.visibleChurchIds.includes(churchId));
}

export function getChurchRoutes(churchId: string) {
  return mockRoutes.filter((route) => route.churchId === churchId && route.status === 'active');
}

export function getChurchTrips(churchId: string, now: Date) {
  return mockTrips.filter((trip) => trip.churchId === churchId && isOneTimeTripAvailable(trip, now));
}

export function getDriverRoutes(driverId: string) {
  return mockRoutes.filter((route) => route.driverId === driverId && route.status === 'active');
}

export function getDriverTrips(driverId: string, now: Date) {
  return mockTrips.filter((trip) => trip.driverId === driverId && isOneTimeTripAvailable(trip, now));
}
