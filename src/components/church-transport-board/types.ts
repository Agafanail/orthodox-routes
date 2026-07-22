export type RequestDialogContext =
  | { mode: 'open'; sourcePassengerRequestId?: string }
  | {
      mode: 'targeted';
      offerId: string;
      offerType: 'regularRoute' | 'oneTimeTrip';
      driverId: string;
      driverName: string;
      offerContext: string;
      rideDate?: string;
      serviceEvent: string;
      serviceEventId?: string;
      departureTime: string;
      routeDaysOfWeek?: number[];
    };

export type TargetedRequestDialogInput = Omit<Extract<RequestDialogContext, { mode: 'targeted' }>, 'mode'>;
