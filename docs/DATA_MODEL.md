# Firestore data model v0.1

## users/{userId}

```ts
type UserRole = 'passenger' | 'driver' | 'church_admin' | 'admin';

type User = {
  id: string;
  role: UserRole;
  displayName: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
  locale: 'ru' | 'en' | 'it' | 'ro';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isBlocked: boolean;
};
```

## churches/{churchId}

```ts
type Church = {
  id: string;
  name: string;
  slug: string;
  jurisdiction: string;
  languages: string[];
  address: string;
  location: { lat: number; lng: number };
  googlePlaceId?: string;
  contacts: {
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    telegram?: string;
  };
  schedule: {
    regular?: string;
    exceptions?: string;
    lastUpdatedAt?: Timestamp;
  };
  status: 'unverified' | 'claimed' | 'verified' | 'hidden';
  createdBy: string;
  claimedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## churchClaims/{claimId}

```ts
type ChurchClaim = {
  id: string;
  churchId: string;
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
  evidenceText?: string;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
};
```

## driverProfiles/{userId}

```ts
type DriverProfile = {
  userId: string;
  publicName: string;
  photoUrl?: string;
  departureArea?: string;
  bio?: string;
  visibleChurchIds: string[];
  notificationPrefs: {
    push: boolean;
    email: boolean;
    telegram: boolean;
  };
  telegramChatId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## passengerProfiles/{userId}

```ts
type PassengerProfile = {
  userId: string;
  publicName: string;
  photoUrl?: string;
  phone?: string;
  notificationPrefs: {
    push: boolean;
    email: boolean;
    telegram: boolean;
  };
  telegramChatId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## routes/{routeId}

Регулярный маршрут.

```ts
type Route = {
  id: string;
  churchId: string;
  driverId: string;
  originLabel: string;
  originLocation?: { lat: number; lng: number };
  meetingPoints: Array<{
    label: string;
    location?: { lat: number; lng: number };
  }>;
  recurrence: {
    daysOfWeek: number[]; // 0 Sunday ... 6 Saturday
    typicalDepartureTime: string; // HH:mm
    typicalArrivalTime?: string;
  };
  seats: number;
  returnTrip: boolean;
  status: 'active' | 'paused' | 'archived';
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## trips/{tripId}

Конкретная поездка на конкретную дату.

```ts
type Trip = {
  id: string;
  churchId: string;
  driverId: string;
  routeId?: string;
  date: string; // YYYY-MM-DD
  departureTime: string; // HH:mm
  originLabel: string;
  meetingPoints: Array<{ label: string; location?: { lat: number; lng: number } }>;
  seatsTotal: number;
  seatsAvailable: number;
  returnTrip: boolean;
  status: 'open' | 'full' | 'cancelled' | 'completed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## rideRequests/{requestId}

```ts
type RideRequest = {
  id: string;
  churchId: string;
  passengerId: string;
  driverId?: string;
  tripId?: string;
  routeId?: string;
  date: string;
  pickupArea: string;
  canMeetAtHub: boolean;
  needsReturnTrip: boolean;
  comment?: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  decidedAt?: Timestamp;
};
```

## notifications/{notificationId}

```ts
type Notification = {
  id: string;
  userId: string;
  type: 'ride_request_created' | 'ride_request_accepted' | 'ride_request_declined' | 'trip_updated' | 'trip_cancelled';
  title: string;
  body: string;
  relatedId?: string;
  read: boolean;
  channels: {
    inApp: boolean;
    push?: 'sent' | 'failed' | 'skipped';
    email?: 'sent' | 'failed' | 'skipped';
    telegram?: 'sent' | 'failed' | 'skipped';
  };
  createdAt: Timestamp;
};
```

## Current mock-only implementation note

Task 1 does not add Firebase. The runnable Next.js prototype uses in-memory mock arrays in `src/lib/mockData.ts`
with public `Church`, `DriverPublicProfile`, `Route`, and `Trip` TypeScript types in `src/lib/types.ts`.
Driver phone and WhatsApp fields are intentionally absent from the public mock driver type and UI.
