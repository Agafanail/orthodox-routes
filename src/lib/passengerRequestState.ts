import type { DriverResponse, PassengerRequest, TargetedPassengerRequest } from './types';

type PublicBoardCandidate =
  | Pick<PassengerRequest, 'status' | 'publicVisible'>
  | Pick<TargetedPassengerRequest, 'status' | 'publicVisible'>;

export function isPassengerRequestPublic(request: PublicBoardCandidate) {
  return request.status === 'open' && request.publicVisible === true;
}

export function isDriverResponseActive(response: DriverResponse) {
  return response.status === 'pendingPassengerConfirmation';
}
