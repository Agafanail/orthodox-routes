export type ChurchStatus = 'unverified' | 'claimed' | 'verified' | 'hidden';

export type ChurchService = {
  id: string;
  name: string;
  date: string;
  startTime: string;
};

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
    services?: ChurchService[];
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
};

export type Route = {
  id: string;
  churchId: string;
  driverId: string;
  originLabel: string;
  maxDetourKm: number;
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
  maxDetourKm: number;
  seatsTotal: number;
  seatsAvailable: number;
  returnTrip: boolean;
  status: 'open' | 'full' | 'cancelled' | 'completed';
  serviceEventId?: string;
};

export type PickupZone = {
  label: string;
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number;
};

export type PublicDriverOfferType = 'regularRoute' | 'oneTimeTrip';
export type DriverOfferType = PublicDriverOfferType | 'privateDriverOffer';

export type PrivateDriverOffer = {
  originLabel: string;
  departureTime: string;
  maxDetourKm?: number;
};

export type PassengerRequestStatus =
  | 'open'
  | 'matched'
  | 'partiallyMatched'
  | 'cancelled'
  | 'expired';

export type PassengerRequest = {
  id: string;
  churchId: string;
  firstName: string;
  phonePrivate: string;
  emailPrivate?: string;
  serviceEvent: string;
  serviceEventId?: string;
  serviceDate?: string;
  passengerCount: number;
  pickupZone: PickupZone;
  safePublicComment?: string;
  consentToShareContact: boolean;
  status: PassengerRequestStatus;
  publicVisible: boolean;
  createdAt: string;
  updatedAt?: string;
  sourcePassengerRequestId?: string;
};

export type DriverResponse = {
  id: string;
  driverId: string;
  passengerRequestId: string;
  driverOfferId: string;
  driverOfferType: DriverOfferType;
  rideDate: string;
  offeredPassengerCount: number;
  status:
    | 'pendingPassengerConfirmation'
    | 'accepted'
    | 'declined'
    | 'cancelled'
    | 'expired';
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  privateOffer?: PrivateDriverOffer;
};

export type TargetedPassengerRequest = {
  id: string;
  churchId: string;
  driverId: string;
  driverName: string;
  targetOfferId: string;
  targetOfferType: PublicDriverOfferType;
  offerContext: string;
  rideDate?: string;
  serviceEvent: string;
  serviceEventId?: string;
  firstName: string;
  phonePrivate: string;
  emailPrivate?: string;
  passengerCount: number;
  pickupZone: PickupZone;
  privateComment?: string;
  consentToShareContact: boolean;
  offeredPassengerCount?: number;
  status:
    | 'waitingForDriver'
    | 'pendingPassengerConfirmation'
    | 'matched'
    | 'declined'
    | 'cancelled'
    | 'expired';
  publicVisible: false;
  createdAt: string;
  updatedAt: string;
  sourcePassengerRequestId?: string;
};

export type MockNotification = {
  id: string;
  churchId: string;
  message: string;
  createdAt: string;
  audience?: 'passenger' | 'driver';
};

export type PrivateContact = {
  phone: string;
  email?: string;
};

export type RideMatch = {
  id: string;
  churchId: string;
  passengerRequestId: string;
  targetedPassengerRequestId?: string;
  driverResponseId?: string;
  driverId: string;
  driverOfferId: string;
  driverOfferType: DriverOfferType;
  rideDate: string;
  originalPassengerCount: number;
  confirmedPassengerCount: number;
  status: 'confirmed' | 'cancelled' | 'completed';
  passengerName: string;
  driverName: string;
  passengerContactPrivate: PrivateContact;
  driverContactPrivate: PrivateContact;
  confirmedAt: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  remainingNeedHandledAt?: string;
  driverOfferDepartureTime?: string;
};
