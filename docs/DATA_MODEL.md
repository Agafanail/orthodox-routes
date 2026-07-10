# Firestore data model v0.1

This model describes the target product concept. The current runnable prototype is still mock-only and does not add Firebase.

## Status and visibility principle

Public church pages show only active board items:

- `PassengerRequest` is public only while `status === 'open'` and `publicVisible === true`.
- `DriverOffer` is public only while `status === 'active'`, `freeSeats > 0`, and `publicVisible === true`.
- `matched`, `full`, `cancelled`, `expired`, and `completed` items are hidden from the public board.
- Hidden items remain in internal history and must not be deleted just because they are no longer public.
- Private contacts are shared only after a confirmed `RideMatch`.
- Notifications and `MatchSuggestion` records do not create a confirmed match by themselves.
- A `RideMatch` is created only after the required confirmation.

## users/{userId}

```ts
type UserRole = 'passenger' | 'driver' | 'parish_coordinator' | 'admin';

type User = {
  id: string;
  role: UserRole;
  name: string;
  preferredLanguage: 'ru' | 'it' | 'en' | 'ro';
  phonePrivate?: string;
  emailPrivate?: string;
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
  languages: Array<'ru' | 'it' | 'en' | 'ro' | string>;
  address: string;
  imageUrl?: string;
  imageAlt?: string;
  imageSource: 'uploaded' | 'default';
  location?: { lat: number; lng: number };
  publicContact?: {
    phone?: string;
    email?: string;
    website?: string;
    telegram?: string;
  };
  status: 'unverified' | 'claimed' | 'verified' | 'hidden';
  createdBy?: string;
  claimedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

The church hero uses `imageUrl` when a photo exists and a local standard Orthodox church illustration when it does not. A parish coordinator may upload a photo later, but upload and Storage are not part of the current mock implementation.

## serviceEvents/{serviceEventId}

```ts
type ServiceEvent = {
  id: string;
  churchId: string;
  title: string;
  startsAt: Timestamp;
  serviceType: 'liturgy' | 'vespers' | 'vigil' | 'moleben' | 'other';
  language?: 'ru' | 'it' | 'en' | 'ro' | string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## passengerProfiles/{userId}

Passenger profile should feel like a short request form, not heavy registration.

```ts
type PassengerProfile = {
  id: string;
  userId: string;
  firstName: string;
  preferredLanguage: 'ru' | 'it' | 'en' | 'ro';
  contactPrivate?: {
    phone?: string;
    email?: string;
    telegram?: string;
  };
  notificationPrefs?: {
    inApp: boolean;
    push?: boolean;
    email?: boolean;
    telegram?: boolean;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## driverProfiles/{userId}

Driver profile can be more complete because the driver takes responsibility for passengers.

```ts
type DriverProfile = {
  id: string;
  userId: string;
  publicName: string;
  photoUrl?: string;
  approximateArea: string;
  contactPrivate: {
    phone?: string;
    email?: string;
    telegram?: string;
  };
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'blocked';
  visibleChurchIds: string[];
  notificationPrefs?: {
    inApp: boolean;
    push?: boolean;
    email?: boolean;
    telegram?: boolean;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## parishCoordinatorProfiles/{profileId}

Parish participation is optional.

```ts
type ParishCoordinatorProfile = {
  id: string;
  userId: string;
  churchId: string;
  role: 'owner' | 'editor';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## driverOffers/{driverOfferId}

A `DriverOffer` is the public board entity for both one-time trips and regular routes.

```ts
type DriverOfferStatus =
  | 'draft'
  | 'active'
  | 'pendingRequest'
  | 'full'
  | 'cancelled'
  | 'expired'
  | 'completed';

type DriverOffer = {
  id: string;
  driverId: string;
  churchId: string;
  serviceEventId?: string;
  offerType: 'one_time_trip' | 'regular_route';
  approximateDepartureArea: string;
  hubPointIds?: string[];
  departureAt?: Timestamp;
  recurrence?: {
    daysOfWeek: number[]; // 0 Sunday ... 6 Saturday
    typicalDepartureTime: string; // HH:mm
  };
  freeSeats: number;
  seatsTotal: number;
  status: DriverOfferStatus;
  publicVisible: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

Public visibility logic:

```ts
const isDriverOfferPublic = (offer: DriverOffer) =>
  offer.status === 'active' && offer.freeSeats > 0 && offer.publicVisible;
```

## passengerRequests/{passengerRequestId}

A `PassengerRequest` can be open on the church board or targeted to a specific `DriverOffer`.

```ts
type PassengerRequestStatus =
  | 'draft'
  | 'open'
  | 'waitingForDriver'
  | 'pendingContact'
  | 'matched'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'completed';

type PassengerRequest = {
  id: string;
  passengerId: string;
  churchId: string;
  serviceEventId?: string;
  targetDriverOfferId?: string;
  pickupZone: {
    label: string;
    centerLat?: number;
    centerLng?: number;
    radiusMeters?: number;
  };
  hubPointId?: string;
  passengerCount: number;
  phonePrivate: string;
  emailPrivate?: string;
  safePublicComment?: string;
  privateComment?: string;
  consentToShareContact: boolean;
  status: PassengerRequestStatus;
  publicVisible: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

Public visibility logic:

```ts
const isPassengerRequestPublic = (request: PassengerRequest) =>
  request.status === 'open' && request.publicVisible;
```

Public passenger request cards must never expose phone, exact address, private contact, or sensitive personal details.

Current mock request creation does not require visible registration. Open and targeted requests are persisted in browser localStorage and can later become backend records and lightweight `PassengerProfile` data.

For the current mock implementation, `pickupZone.label` is the only used pickup field. `centerLat`, `centerLng`, and `radiusMeters` are reserved for a future approximate circular pickup zone. Do not add maps yet.

When a passenger clicks «Попросить подвезти» on a specific `DriverOffer`, create a targeted `PassengerRequest` with `targetDriverOfferId` and `status: 'waitingForDriver'`, then notify the driver. Contacts are shared only if the driver accepts and a `RideMatch` is created.

## driverResponses/{driverResponseId}

Driver response is created when a driver clicks «Подвезти» on a concrete passenger request.

```ts
type DriverResponse = {
  id: string;
  driverId: string;
  passengerRequestId: string;
  driverOfferId?: string;
  message?: string;
  status: 'pendingPassengerConfirmation' | 'pendingContact' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: Timestamp;
  cancelledAt?: Timestamp;
  updatedAt: Timestamp;
};
```

When a driver clicks «Подвезти» on a specific `PassengerRequest`, create a `DriverResponse` with `status: 'pendingPassengerConfirmation'`, then notify the passenger. Contacts are shared only if the passenger accepts and a `RideMatch` is created.

Current mock implementation uses `status: 'pendingContact'` immediately after «Подвезти», hides the passenger request from the public board, shows passenger contact in the mock response area, and supports cancelling the response. Cancelling returns the request to `status: 'open'` and `publicVisible: true`.

## rideMatches/{rideMatchId}

`RideMatch` is created only after the required side confirms.

```ts
type RideMatch = {
  id: string;
  passengerRequestId: string;
  driverOfferId: string;
  driverResponseId?: string;
  passengerId: string;
  driverId: string;
  churchId: string;
  serviceEventId?: string;
  status: 'confirmed' | 'cancelled' | 'completed';
  contactsSharedAt?: Timestamp;
  confirmedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

After a `RideMatch` is confirmed:

- contacts are shared only with participants;
- the matched `PassengerRequest` is hidden from the public board;
- the matched `DriverOffer.freeSeats` decreases;
- the `DriverOffer` remains public only if seats remain and it is still active.

## matchSuggestions/{matchSuggestionId}

`MatchSuggestion` records are automatic suggestions, not confirmed matches.

```ts
type MatchSuggestion = {
  id: string;
  churchId: string;
  serviceEventId?: string;
  passengerRequestId: string;
  driverOfferId: string;
  priority: 'low' | 'medium' | 'high';
  reason: string;
  status:
    | 'suggested'
    | 'dismissed'
    | 'convertedToRequest'
    | 'convertedToResponse'
    | 'expired';
  createdAt: Timestamp;
};
```

Simple MVP matching rules:

- same church;
- same or compatible service/event/date;
- driver offer has free seats;
- passenger request is open;
- approximate pickup area or hub is compatible enough;
- both items have `publicVisible === true`;
- neither item is expired, cancelled, full, completed, or already matched.

## hubPoints/{hubPointId}

```ts
type HubPoint = {
  id: string;
  churchId?: string;
  name: string;
  type: 'metro' | 'bus_stop' | 'landmark' | 'church' | 'other';
  approximateAddress?: string;
  location?: { lat: number; lng: number };
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

## notifications/{notificationId}

```ts
type Notification = {
  id: string;
  recipientUserId: string;
  type:
    | 'targetedPassengerRequestCreated'
    | 'driverResponseCreated'
    | 'matchSuggestionCreated'
    | 'rideMatchConfirmed'
    | 'driverOfferUpdated'
    | 'driverOfferCancelled';
  title: string;
  message: string;
  relatedChurchId?: string;
  relatedServiceEventId?: string;
  relatedPassengerRequestId?: string;
  relatedDriverOfferId?: string;
  relatedDriverResponseId?: string;
  relatedRideMatchId?: string;
  status: 'unread' | 'read' | 'archived';
  channel: 'inApp' | 'email' | 'webPush' | 'telegram';
  createdAt: Timestamp;
};
```

A notification is a personal record inside the app; a delivery channel is the way that record reaches its recipient outside the app. Production notifications belong to a personal notification center and must never be shown to another user.

Current MVP documentation covers `channel: 'inApp'` and localStorage-backed mock notification state only. Web push/PWA push and email are planned MVP delivery channels because users may not open the app often. Telegram is a possible later channel. None of these external delivery channels are implemented in the current mock.

Notification text must not expose phone, exact address, private contact, or sensitive personal data. It may expose only safe summary data: first name, church, service/event, approximate area or hub, number of passengers, available seats, and short safe comment.

## Current mock-only implementation note

Static churches, drivers, routes, and trips remain mock arrays in `src/lib/mockData.ts`. User-created private mock state uses these namespaced browser localStorage keys:

- `orthodox-routes:passenger-requests`;
- `orthodox-routes:driver-responses`;
- `orthodox-routes:targeted-requests`;
- `orthodox-routes:notifications`;
- `orthodox-routes:passenger-draft` for optional form prefilling.

Open passenger requests are public only while `status === 'open'` and `publicVisible === true`. Targeted requests always have `publicVisible === false` and never appear in «Кому нужно место». Active driver responses and targeted requests are shown only in temporary personal mock panels. Real persistence and per-user authorization belong to the future backend/Firestore implementation.

All user-visible calendar dates use `dd.mm.yyyy`; date and time use `dd.mm.yyyy в HH:mm`. ISO strings remain valid internal storage values but are not rendered directly.

Firebase, auth, Google Maps, Telegram bot, payments, SMS, WhatsApp Business API, and admin features are intentionally not implemented in the current code.
