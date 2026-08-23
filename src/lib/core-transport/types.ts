import type { QualityMatch } from '@/lib/geo/match';
import type { PublicPlace, SavedPlace } from '@/lib/geo/types';

export type CoreChurch = {
  churchId: string;
  slug: string;
  officialName: string;
  address: string;
  locality: string;
  countryCode: string;
  timezone: string;
  /** The church location is public and exact; it is absent only before the Maps migration. */
  lat?: number;
  lng?: number;
};

/** A place as an anonymous visitor sees it: an approximate area, never an exact point. */
export type CorePlaceOption = PublicPlace;

export type CorePassengerRequest = {
  requestId: string;
  churchId: string;
  authorName: string;
  desiredArrivalAt: string;
  timezone: string;
  passengerCount: number;
  childrenCount: number;
  childSeatRequired: boolean;
  returnRequired: boolean;
  publicNote?: string;
  placeOptions: CorePlaceOption[];
};

export type CoreDriverOccurrence = {
  occurrenceId: string;
  seriesId?: string;
  churchId: string;
  authorName: string;
  departureAt: string;
  arrivalAt: string;
  timezone: string;
  availableSeats: number;
  maxDetourKm: number;
  childrenAllowed: boolean;
  driverChildSeatAvailable: boolean;
  returnAvailable: boolean;
  publicNote?: string;
  publicOriginArea: string;
  originArea?: CorePlaceOption;
};

export type CoreOwnedRequest = {
  requestId: string;
  status: string;
  totalPassengers: number;
  remainingPassengers: number;
};

export type CoreOwnedOccurrence = {
  occurrenceId: string;
  seriesId?: string;
  status: string;
  totalSeats: number;
  confirmedSeats: number;
  availableSeats: number;
};

export type CoreOwnedSeries = {
  seriesId: string;
  status: string;
};

export type CoreResponse = {
  responseId: string;
  direction: 'passenger_to_driver' | 'driver_to_passenger';
  status: string;
  currentRole: 'passenger' | 'driver';
  requestId: string;
  occurrenceId: string;
  passengerName: string;
  driverName: string;
  offeredPassengerCount: number;
  selectedPlace?: CorePlaceOption;
  expiresAt: string;
};

export type CoreAgreement = {
  agreementId: string;
  status: string;
  currentRole: 'passenger' | 'driver';
  requestId: string;
  occurrenceId: string;
  passengerName: string;
  driverName: string;
  confirmedPassengerCount: number;
  scheduledArrivalAt: string;
  timezone: string;
  contactAvailable: boolean;
};

export type CoreEligibility = {
  eligible: boolean;
  reasons: string[];
  currentTermsVersion?: string;
  currentTermsAccepted: boolean;
};

export type CoreExactPlace = {
  placeId: string;
  exactAddress: string;
  locality?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
};

/**
 * What a confirmed participant receives. The driver learns the one meeting place selected for
 * this agreement, the passenger learns the driver's exact departure place, and neither learns
 * the passenger's unused places.
 */
export type CoreDisclosure = {
  agreementId: string;
  counterpartyName: string;
  email: string;
  phone: string;
  exactMeetingLabel: string;
  meetingPlace?: CoreExactPlace;
  departurePlace?: CoreExactPlace;
  visibleUntil: string;
};

export type CoreTransportData = {
  church: CoreChurch;
  passengerRequests: CorePassengerRequest[];
  driverOccurrences: CoreDriverOccurrence[];
  ownedRequests: CoreOwnedRequest[];
  ownedOccurrences: CoreOwnedOccurrence[];
  ownedSeries: CoreOwnedSeries[];
  responses: CoreResponse[];
  agreements: CoreAgreement[];
  accountName?: string;
  eligibility?: CoreEligibility;
  disclosure?: CoreDisclosure;
  signedIn: boolean;
  /** Whether the browser may render map imagery for place selection. */
  mapAvailable: boolean;
  /** Render-only provider key; it carries no search or routing rights. */
  mapBrowserKey: string | null;
  savedPlaces: SavedPlace[];
  /**
   * Suggestions for the current user. They are a recommendation only: the board stays the
   * primary experience and never hides a listing because matching did not name it.
   */
  qualityMatches: QualityMatch[];
  /**
   * False when suggestions could not be established at all. The board then simply makes no
   * claim; only the explicit suggestions view says so in one ordinary sentence.
   */
  matchingAvailable: boolean;
  showMatchesOnly: boolean;
};
