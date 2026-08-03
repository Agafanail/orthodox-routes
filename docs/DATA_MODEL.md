# Current prototype data model v0.1

> **Status:** this is a historical Firestore-shaped model plus detailed notes about the current browser-only implementation. It is not an approved physical database schema, backend choice, API contract, or migration plan. The current runnable prototype remains mock-only and does not add Firebase.
>
> The approved future logical model, visibility levels, relationships, permissions, states, routes, and context transitions are defined in [ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md](ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md), especially sections 42–49. Backend technology and the physical schema will be chosen in the backend architecture phase. If this v0.1 model conflicts with Product Scope or IA V2, it remains only a current-prototype or historical implementation reference.

## Status and visibility principle

Public church pages show only active board items:

- `PassengerRequest` is public only while `status === 'open'` and `publicVisible === true`.
- `DriverOffer` is public only while `status === 'active'`, `freeSeats > 0`, and `publicVisible === true`.
- Active items stay first in the two primary board columns. All public completion uses one shared `Уже договорились` section below both columns.
- Cancelled and expired items never appear as successful public activity.
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
  originLabel: string;
  maxDetourKm: 0 | 2 | 5 | 10 | 15 | 20;
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

A `PassengerRequest` is the public request concept used by the current runtime. A private request aimed at one driver offer is a separate `TargetedPassengerRequest` concept.

```ts
type PassengerRequestStatus =
  | 'open'
  | 'matched'
  | 'partiallyMatched'
  | 'cancelled'
  | 'expired';

type PickupZone = {
  label: string;
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number;
};

type PassengerRequest = {
  id: string;
  churchId: string;
  firstName: string;
  phonePrivate: string;
  emailPrivate?: string;
  serviceEvent: string;
  serviceEventId?: string;
  serviceDate?: string; // local YYYY-MM-DD
  passengerCount: number;
  pickupZone: PickupZone;
  safePublicComment?: string;
  consentToShareContact: boolean;
  status: PassengerRequestStatus;
  publicVisible: boolean;
  createdAt: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  sourcePassengerRequestId?: string;
};
```

Public visibility logic:

```ts
const isPassengerRequestPublic = (request: PassengerRequest) =>
  request.status === 'open' && request.publicVisible;
```

Public passenger request cards must never expose phone, exact address, private contact, or sensitive personal details.

Current mock request creation does not require visible registration. Open and targeted requests are persisted separately in browser localStorage and can later become backend records and lightweight `PassengerProfile` data.

For the current mock implementation, `pickupZone.label` is the only used pickup field. The unused `centerLat`, `centerLng`, and `radiusMeters` fields are historical placeholders, not approval of the target data model. IA V2 defines a protected exact place and a separately derived public 1 km area; implementation waits for the appropriate roadmap phase.

## targetedPassengerRequests/{targetedPassengerRequestId}

`TargetedPassengerRequest` is always private and points to one concrete driver offer occurrence.

```ts
type PublicDriverOfferType = 'regularRoute' | 'oneTimeTrip';

type TargetedPassengerRequest = {
  id: string;
  churchId: string;
  driverId: string;
  driverName: string;
  targetOfferId: string;
  targetOfferType: PublicDriverOfferType;
  offerContext: string;
  rideDate?: string; // local YYYY-MM-DD; required for an actionable request
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
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  sourcePassengerRequestId?: string;
};
```

When a passenger clicks «Попросить подвезти» on a specific `DriverOffer`, create a private targeted request with a concrete `rideDate` and `status: 'waitingForDriver'`, then notify the driver. A one-time trip fixes the date. A regular route offers up to five future dates whose weekdays are in its recurrence; each date has independently derived availability, and a full date stays visible but disabled. If an open compatible `PassengerRequest` is reused, `sourcePassengerRequestId` identifies that source instead of creating an unrelated duplicate. A source already targeted to the same offer and date is excluded. Full driver acceptance closes the source request and creates the RideMatch immediately; a smaller offer changes the targeted request to `pendingPassengerConfirmation` and creates a match only after passenger acceptance.

## driverResponses/{driverResponseId}

Driver response is created when a driver clicks «Подвезти» on a concrete passenger request.

```ts
type DriverResponse = {
  id: string;
  driverId: string;
  passengerRequestId: string;
  driverOfferId: string;
  driverOfferType: 'regularRoute' | 'oneTimeTrip' | 'privateDriverOffer';
  rideDate: string; // local YYYY-MM-DD
  offeredPassengerCount: number;
  status: 'pendingPassengerConfirmation' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  cancelledAt?: string; // ISO timestamp
  privateOffer?: {
    originLabel: string;
    departureTime: string;
    maxDetourKm?: number;
  };
};
```

When a driver clicks «Подвезти» on a specific `PassengerRequest`, create a `DriverResponse` with `status: 'pendingPassengerConfirmation'`, then notify the passenger. Contacts are shared only if the passenger accepts and a `RideMatch` is created.

When compatible browser-owned public offers exist, the current mock links the response to the selected trip or route occurrence with available seats. When none exists, `driverOfferType: 'privateDriverOffer'` and `privateOffer` represent a request-only offer; its response ID is the private offer ID. It is persisted with the other responses but is never inserted into public Trip or Route collections, so unused seats are not published. A pending response does not hide the open request, reserve capacity, or reveal contacts. Passenger acceptance revalidates the public occurrence or the private departure, creates the RideMatch, closes the original request, and expires its other pending responses. Legacy `pendingContact` responses hydrate as inactive `expired` records and never disclose contacts.

## rideMatches/{rideMatchId}

`RideMatch` is created only after the required side confirms.

```ts
type RideMatch = {
  id: string;
  churchId: string;
  passengerRequestId: string;
  targetedPassengerRequestId?: string;
  driverResponseId?: string;
  driverId: string;
  driverOfferId: string;
  driverOfferType: 'regularRoute' | 'oneTimeTrip' | 'privateDriverOffer';
  rideDate: string; // local YYYY-MM-DD
  originalPassengerCount: number;
  confirmedPassengerCount: number;
  status: 'confirmed' | 'cancelled' | 'completed';
  passengerName: string;
  driverName: string;
  passengerContactPrivate: { phone: string; email?: string };
  driverContactPrivate: { phone: string; email?: string };
  confirmedAt: string; // ISO timestamp
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  cancelledAt?: string; // ISO timestamp
  remainingNeedHandledAt?: string; // ISO timestamp
  driverOfferDepartureTime?: string; // private offer departure snapshot
};
```

After a `RideMatch` is confirmed:

- contacts are shared only with participants;
- the matched `PassengerRequest` is hidden from the public board;
- the matched request closes as `matched` or `partiallyMatched`;
- other pending driver responses and linked targeted requests to the same open request expire;
- occupied seats are derived from confirmed RideMatches for the same concrete public offer and date;
- a one-time trip remains public only while derived availability is positive;
- a regular route remains active globally, while each occurrence date has independent capacity.

Pending requests, responses, partial counteroffers, notifications, and suggestions never create RideMatches or reserve capacity. Private targeted driver offers have no public capacity ledger; their confirmed RideMatch stores the private departure time needed by cancellation and republication checks. Cancellation keeps the RideMatch and private contact snapshots in participant history but excludes it from occupied-seat calculations. Cancelling a public offer cancels its future confirmed RideMatches before hiding the offer.

Direct republication after cancellation compares local calendar values without a UTC conversion. A known driver-offer departure time is the boundary; otherwise a structured church service uses its start time. Exact boundary time is already closed. An alternative date with no known time remains eligible through that entire local date.

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

The current prototype covers `channel: 'inApp'` and localStorage-backed mock notification state only. IA V2 requires Web Push/PWA push and email for the approved target and excludes Telegram from the first public version. None of these external delivery channels are implemented in the current mock; the historical `telegram` enum value is not target approval.

Notification text must not expose phone, exact address, private contact, or sensitive personal data. It may expose only safe summary data: first name, church, service/event, approximate area or hub, number of passengers, available seats, and short safe comment.

## Current mock-only implementation note

Static churches, drivers, routes, and trips remain mock arrays in `src/lib/mockData.ts`. User-created private mock state uses these namespaced browser localStorage keys:

`Church.schedule.services` may contain structured mock `ChurchService` entries with `id`, `name`, local ISO `date`, and local `startTime`. One shared helper sorts these entries by local start, excludes past or malformed services, limits the result to five, and formats the compact native dropdown used by both open passenger requests and one-time driver offers. A separate visible alternative-date field is mutually exclusive with the selected service. This structure does not infer driver departure time.

- `orthodox-routes:passenger-requests`;
- `orthodox-routes:driver-responses`;
- `orthodox-routes:targeted-requests`;
- `orthodox-routes:notifications`;
- `orthodox-routes:ride-matches` for confirmed, cancelled, and completed mock agreements;
- `orthodox-routes:passenger-draft` for optional form prefilling;
- `orthodox-routes:local-driver-profile` for one private browser-local driver identity;
- `orthodox-routes:local-trips` for locally created one-time trip history;
- `orthodox-routes:local-routes` for locally created regular route history.

The browser-local driver profile has this mock-only shape:

```ts
type LocalDriverProfile = {
  ownerId: string;
  driverId: string;
  publicName: string;
  phonePrivate: string;
  emailPrivate?: string;
};
```

The legacy mock profile `departureArea` field is accepted and discarded during hydration. New driver data does not request or depend on it. A derived `DriverPublicProfile` receives its displayed origin from that driver's active offers for the current church. Private phone and email are never copied into public profiles, routes, trips, cards, or notifications.

Locally created `Trip` and `Route` records model a route from `originLabel` to the current church and store `maxDetourKm` as one of `0`, `2`, `5`, `10`, `15`, or `20`. Drivers do not enumerate pickup points. Until maps are implemented, the distance is only a stated willingness to detour; the driver manually evaluates each passenger's requested pickup location. Older stored records may still contain `pickupMethod`, `pickupDetails`, `meetingPoints`, `departureArea`, or `departurePlace`; hydration discards obsolete pickup fields, uses a readable legacy origin where needed, and assigns the conservative `maxDetourKm: 0` fallback when the field is absent or unsupported. A one-time `Trip` may preserve `serviceEventId`; its `date` is derived from the selected service or the alternative date, while `departureTime` remains an independent required driver input. Seats are integers from 1 through 55 in both new and hydrated records.

Locally created routes keep explicit `status: 'cancelled'` support. Cancellation changes only the status, keeps the record in localStorage history, and removes it from merged active offers. Ownership requires both membership in the matching local offer collection and the current local profile `driverId`; it is never inferred from a displayed name.

Hydration parses local profile and offer records into explicit safe shapes. Malformed or outdated entries are ignored, unexpected fields are discarded, duplicate local IDs are suppressed, and IDs colliding with static drivers or offers are not merged into the public board.

Browser localStorage is not an authorization boundary and can be manually modified. Authentication, server persistence, per-user ownership, and cancellation authorization must be enforced by the backend architecture selected in a later phase.

A mock one-time `Trip` is publicly available only while `status === 'open'`, `seatsAvailable > 0`, and the local value composed from `date` and `departureTime` has not passed. The same rule filters church and driver trip selectors and church-board offers. Passenger and driver service dropdowns use the church's structured future services rather than deriving schedule choices from transport offers. Regular-route visibility is unchanged.

The second mock church intentionally has no `schedule` data. It is the stable no-schedule scenario: its public page renders the empty schedule state, and open passenger and one-time driver forms render only the alternative-date field.

The general church list uses the same centralized merge and visibility helpers as the church board. Per-church counters include static and sanitized browser-local records, isolate offers by `churchId`, count each active driver once, exclude inactive/cancelled routes, and exclude cancelled, expired, full, or otherwise unavailable one-time trips. The server-rendered static counts are the hydration baseline; browser-local counts are merged after the client mounts.

Open passenger requests remain public while any number of driver responses are pending. Targeted requests always have `publicVisible === false` and never appear in «Ищут место». A targeted request stores a concrete `rideDate`; regular-route dates must match the recurrence weekday. Reusing an open request preserves its ID through `sourcePassengerRequestId`, and compatibility is based on church plus service or concrete date. A partial acceptance closes the original request, and any remaining need becomes a new linked open request copied from the preserved data. The public selector resolves that link to the root request so the remaining card states the original group size and does not create a simultaneous completed duplicate.

`orthodox-routes:ride-matches` is the source of truth for newly confirmed occupied seats. One-time trips retain their initial `seatsAvailable` as a legacy/static baseline, then subtract confirmed RideMatches. Regular routes never mutate global capacity: availability is `route.seats` minus confirmed matches for the same `driverOfferId` and `rideDate`. Every confirmation rechecks pending status, active offer, future occurrence, and available seats before creating one match.

Static mock driver phone/email data lives in a separate private source keyed by driver ID. Browser-created drivers use `LocalDriverProfile`. Neither source is copied into `DriverPublicProfile`, Route, Trip, public card props, public completed summaries, or notification text. Confirmed RideMatches keep explicit private contact snapshots so cancelled participant history remains useful.

The compact `Уже договорились` selector returns explicit safe fields only and limits the church page to five recent, still-date-relevant results. It aggregates by root passenger request, one-time trip, or `regularRouteId + rideDate`. Partially occupied one-time trips and passenger requests with an active linked remainder are excluded. A regular-route occurrence is included as soon as it has a confirmed RideMatch: partial occupancy carries the yellow `Часть мест занята` state, while a full occurrence uses the gray completed state. Passenger and driver-offer summaries render together in one shared section below both primary columns. Summaries never contain contact fields, pickup areas, exact addresses, private comments, actions, or cancelled records.

All user-visible calendar dates use `dd.mm.yyyy`; date and time use `dd.mm.yyyy в HH:mm`. ISO strings remain valid internal storage values but are not rendered directly.

Firebase, auth, Google Maps, Telegram bot, payments, SMS, WhatsApp Business API, and admin features are intentionally not implemented in the current code.
