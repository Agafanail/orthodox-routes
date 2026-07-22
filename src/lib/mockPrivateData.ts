import type { LocalDriverProfile, PrivateContact } from './types';

const staticDriverContacts: Record<string, PrivateContact> = {
  dmitry: { phone: '+390000000001', email: 'dmitry@example.test' },
  anna: { phone: '+390000000002', email: 'anna@example.test' },
  mihai: { phone: '+390000000003', email: 'mihai@example.test' },
};

export function getDriverPrivateContact(
  driverId: string,
  localDriverProfile: LocalDriverProfile | null,
): PrivateContact | null {
  if (localDriverProfile?.driverId === driverId) {
    return {
      phone: localDriverProfile.phonePrivate,
      email: localDriverProfile.emailPrivate,
    };
  }

  return staticDriverContacts[driverId] ?? null;
}
