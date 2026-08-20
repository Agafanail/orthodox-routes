import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/core-transport/actions', () => ({
  answerPassengerResponseAction: vi.fn(), cancelDriverOccurrenceAction: vi.fn(),
  cancelPassengerRequestAction: vi.fn(), cancelRideAgreementAction: vi.fn(),
  confirmRideResponseAction: vi.fn(), declineRideResponseAction: vi.fn(),
  publishDriverOccurrenceAction: vi.fn(), publishDriverSeriesAction: vi.fn(),
  publishDriverResponseWithOccurrenceAction: vi.fn(), publishPassengerRequestAction: vi.fn(),
  publishPassengerResponseWithRequestAction: vi.fn(), rejectPassengerResponseAction: vi.fn(),
  restorePassengerRequestAction: vi.fn(), revealAgreementAction: vi.fn(),
  startDriverOccurrenceContextualAction: vi.fn(), startDriverResponseContextualAction: vi.fn(),
  startDriverSeriesContextualAction: vi.fn(), startPassengerContextualAction: vi.fn(),
  startPassengerResponseContextualAction: vi.fn(), stopDriverSeriesAction: vi.fn(),
  submitDriverResponseAction: vi.fn(), submitPassengerResponseAction: vi.fn(),
  withdrawRideResponseAction: vi.fn(),
}));

import { CoreTransportBoard } from './core-transport-board';

const base = {
  accountName: 'Анна',
  agreements: [{
    agreementId: '30000000-0000-4000-8000-000000000001', status: 'confirmed', currentRole: 'passenger' as const,
    requestId: '10000000-0000-4000-8000-000000000001', occurrenceId: '20000000-0000-4000-8000-000000000001',
    passengerName: 'Анна', driverName: 'Иван', confirmedPassengerCount: 1,
    scheduledArrivalAt: '2026-09-01T09:00:00Z', timezone: 'UTC', contactAvailable: true,
  }],
  church: {
    churchId: '00000000-0000-4000-8000-000000000001', slug: 'test-church', officialName: 'Test Church',
    address: 'Public address', locality: 'Test', countryCode: 'IT', timezone: 'UTC',
  },
  driverOccurrences: [], eligibility: { eligible: true, reasons: [], currentTermsAccepted: true },
  ownedOccurrences: [], ownedRequests: [], ownedSeries: [], passengerRequests: [], responses: [], signedIn: true,
};

describe('CoreTransportBoard', () => {
  it('does not preload protected disclosure into the ordinary participant board', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard {...base} />);
    expect(html).toContain('Показать контакт и точное место');
    expect(html).not.toContain('driver@example.test');
    expect(html).not.toContain('+390000000000');
    expect(html).not.toContain('Via Roma 1');
  });

  it('renders separately authorized disclosure only for the selected agreement', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard {...base} disclosure={{
      agreementId: base.agreements[0].agreementId, counterpartyName: 'Иван',
      email: 'driver@example.test', phone: '+390000000000', exactMeetingLabel: 'Via Roma 1',
      visibleUntil: '2026-10-01T09:00:00Z',
    }} />);
    expect(html).toContain('driver@example.test');
    expect(html).toContain('+390000000000');
    expect(html).toContain('Via Roma 1');
  });

  it('keeps an anonymous response as a contextual useful action', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard
      {...base}
      accountName={undefined}
      agreements={[]}
      driverOccurrences={[{
        occurrenceId: '20000000-0000-4000-8000-000000000009',
        churchId: base.church.churchId,
        authorName: 'Иван',
        departureAt: '2026-09-01T08:00:00Z',
        arrivalAt: '2026-09-01T09:00:00Z',
        timezone: 'UTC',
        availableSeats: 2,
        maxDetourKm: 5,
        childrenAllowed: true,
        driverChildSeatAvailable: true,
        returnAvailable: false,
        publicOriginArea: 'Северный район',
      }]}
      eligibility={undefined}
      signedIn={false}
    />);
    expect(html).toContain('Попросить подвезти');
    expect(html).toContain('Продолжить с регистрацией');
    expect(html).toContain('name="occurrence_id"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="exact_label"');
    expect(html).toContain('name="target_name"');
    expect(html).toContain('value="Иван"');
    expect(html).not.toContain('driver@example.test');
  });
});
