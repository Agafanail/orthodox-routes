export type CoreChurch = {
  churchId: string;
  slug: string;
  officialName: string;
  address: string;
  locality: string;
  countryCode: string;
  timezone: string;
};

export type CorePlaceOption = {
  placeId: string;
  publicAreaLabel: string;
};

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

export type CoreDisclosure = {
  agreementId: string;
  counterpartyName: string;
  email: string;
  phone: string;
  exactMeetingLabel: string;
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
};
