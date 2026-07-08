export type ChurchStatus = 'unverified' | 'claimed' | 'verified' | 'hidden';

export type Church = {
  id: string;
  name: string;
  slug: string;
  jurisdiction: string;
  languages: string[];
  address: string;
  location: { lat: number; lng: number };
  googlePlaceId?: string;
  contacts?: {
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    telegram?: string;
  };
  schedule?: {
    regular?: string;
    exceptions?: string;
    lastUpdatedAt?: string;
  };
  status: ChurchStatus;
};

export type DriverPublicProfile = {
  id: string;
  publicName: string;
  photoUrl?: string;
  departureArea: string;
  visibleChurchIds: string[];
};

export type Route = {
  id: string;
  churchId: string;
  driverId: string;
  originLabel: string;
  meetingPoints: Array<{ label: string; location?: { lat: number; lng: number } }>;
  recurrence: {
    daysOfWeek: number[];
    typicalDepartureTime: string;
    typicalArrivalTime?: string;
  };
  seats: number;
  returnTrip: boolean;
  status: 'active' | 'paused' | 'archived';
};

export type Trip = {
  id: string;
  churchId: string;
  driverId: string;
  routeId?: string;
  date: string;
  departureTime: string;
  originLabel: string;
  meetingPoints: Array<{ label: string; location?: { lat: number; lng: number } }>;
  seatsTotal: number;
  seatsAvailable: number;
  returnTrip: boolean;
  status: 'open' | 'full' | 'cancelled' | 'completed';
};
