export type ChurchStatus = 'unverified' | 'claimed' | 'verified' | 'hidden';

export type Church = {
  id: string;
  name: string;
  slug: string;
  jurisdiction: string;
  languages: string[];
  address: string;
  imageUrl: string;
  imageAlt: string;
  imageSource: 'uploaded' | 'default';
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

export type LocalDriverProfile = {
  ownerId: string;
  driverId: string;
  publicName: string;
  phonePrivate: string;
  emailPrivate?: string;
  departureArea: string;
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
  status: 'active' | 'paused' | 'archived' | 'cancelled';
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

export type PickupZone = {
  label: string;
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number;
};

export type PassengerRequestStatus = 'open' | 'waitingForDriver' | 'pendingContact' | 'cancelled';

export type PassengerRequest = {
  id: string;
  churchId: string;
  firstName: string;
  phonePrivate: string;
  emailPrivate?: string;
  serviceEvent: string;
  passengerCount: number;
  pickupZone: PickupZone;
  safePublicComment?: string;
  consentToShareContact: boolean;
  status: PassengerRequestStatus;
  publicVisible: boolean;
  createdAt: string;
};

export type DriverResponse = {
  id: string;
  passengerRequestId: string;
  status: 'pendingContact' | 'cancelled';
  createdAt: string;
  cancelledAt?: string;
};

export type TargetedPassengerRequest = {
  id: string;
  churchId: string;
  driverId: string;
  driverName: string;
  targetOfferId: string;
  targetOfferType: 'regularRoute' | 'oneTimeTrip';
  offerContext: string;
  firstName: string;
  phonePrivate: string;
  emailPrivate?: string;
  passengerCount: number;
  pickupZone: PickupZone;
  privateComment?: string;
  consentToShareContact: boolean;
  status: 'waitingForDriver';
  publicVisible: false;
  createdAt: string;
};

export type MockNotification = {
  id: string;
  churchId: string;
  message: string;
  createdAt: string;
};
