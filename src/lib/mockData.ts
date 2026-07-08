import type { Church, DriverPublicProfile, Route, Trip } from './types';

export const mockChurches: Church[] = [
  {
    id: 'catanzaro-pokrov',
    name: 'Храм Покрова Пресвятой Богородицы',
    slug: 'catanzaro-pokrov',
    jurisdiction: 'Archdiocese of Orthodox Churches of Russian Tradition in Western Europe',
    languages: ['ru', 'it', 'church-slavonic'],
    address: 'Catanzaro, Calabria, Italy',
    location: { lat: 38.9098, lng: 16.5877 },
    status: 'verified',
    contacts: { website: '', telegram: '' },
    schedule: { regular: 'Воскресенье: Литургия 9:00' },
  },
];

export const mockDrivers: DriverPublicProfile[] = [
  {
    userId: 'driver-1',
    publicName: 'Дмитрий',
    departureArea: 'Squillace / Catanzaro Lido',
    visibleChurchIds: ['catanzaro-pokrov'],
  },
];

export const mockRoutes: Route[] = [
  {
    id: 'route-1',
    churchId: 'catanzaro-pokrov',
    driverId: 'driver-1',
    originLabel: 'Squillace',
    meetingPoints: [{ label: 'Catanzaro Lido station' }],
    recurrence: { daysOfWeek: [0], typicalDepartureTime: '08:15', typicalArrivalTime: '08:50' },
    seats: 2,
    returnTrip: true,
    status: 'active',
  },
];

export const mockTrips: Trip[] = [
  {
    id: 'trip-1',
    churchId: 'catanzaro-pokrov',
    driverId: 'driver-1',
    routeId: 'route-1',
    date: '2026-07-12',
    departureTime: '08:15',
    originLabel: 'Squillace',
    meetingPoints: [{ label: 'Catanzaro Lido station' }],
    seatsTotal: 2,
    seatsAvailable: 2,
    returnTrip: true,
    status: 'open',
  },
];
