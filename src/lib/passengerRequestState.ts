import type { DriverResponse, PassengerRequest, TargetedPassengerRequest } from './types';

type PublicBoardCandidate =
  | Pick<PassengerRequest, 'status' | 'publicVisible'>
  | Pick<TargetedPassengerRequest, 'status' | 'publicVisible'>;

export function isPassengerRequestPublic(request: PublicBoardCandidate) {
  return request.status === 'open' && request.publicVisible === true;
}

export function markPassengerRequestResponded(request: PassengerRequest): PassengerRequest {
  return { ...request, status: 'pendingContact', publicVisible: false };
}

export function createPendingDriverResponse(
  passengerRequestId: string,
  id: string,
  createdAt: string,
): DriverResponse {
  return { id, passengerRequestId, status: 'pendingContact', createdAt };
}

export function isDriverResponseActive(response: DriverResponse) {
  return response.status === 'pendingContact';
}

export function cancelDriverResponse(response: DriverResponse, cancelledAt: string): DriverResponse {
  return { ...response, status: 'cancelled', cancelledAt };
}

export function restorePassengerRequestAfterCancellation(request: PassengerRequest): PassengerRequest {
  return { ...request, status: 'open', publicVisible: true };
}
