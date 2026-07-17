export type RequestDialogContext =
  | { mode: 'open' }
  | {
      mode: 'targeted';
      offerId: string;
      offerType: 'regularRoute' | 'oneTimeTrip';
      driverId: string;
      driverName: string;
      offerContext: string;
    };

export type TargetedRequestDialogInput = Omit<Extract<RequestDialogContext, { mode: 'targeted' }>, 'mode'>;
