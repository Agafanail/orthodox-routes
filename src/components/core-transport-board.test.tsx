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
    lat: 45.0703, lng: 7.6869,
  },
  driverOccurrences: [], eligibility: { eligible: true, reasons: [], currentTermsAccepted: true },
  mapAvailable: true, mapBrowserKey: 'test-browser-key', matchingAvailable: true,
  ownedOccurrences: [], ownedRequests: [],
  ownedSeries: [], passengerRequests: [], qualityMatches: [], responses: [], savedPlaces: [],
  showMatchesOnly: false, signedIn: true,
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
    expect(html).toContain('name="places"');
    expect(html).toContain('name="target_name"');
    expect(html).toContain('value="Иван"');
    expect(html).not.toContain('driver@example.test');
  });
});

const suggestion = {
  addedDistanceM: 4200,
  addedDurationS: 480,
  arrivalAt: '2026-09-01T09:00:00Z',
  availableSeats: 3,
  currentRole: 'passenger' as const,
  departureAt: '2026-09-01T08:00:00Z',
  occurrenceId: '20000000-0000-4000-8000-000000000001',
  passengerCount: 2,
  places: [
    { addedDistanceM: 4200, addedDurationS: 480, best: true, placeId: 'a', position: 1, publicAreaLabel: 'Северный район' },
    { addedDistanceM: 6100, addedDurationS: 700, best: false, placeId: 'b', position: 2, publicAreaLabel: 'Центр' },
  ],
  requestId: '10000000-0000-4000-8000-000000000001',
  timezone: 'UTC',
};

const offer = {
  occurrenceId: '20000000-0000-4000-8000-000000000001',
  churchId: base.church.churchId,
  authorName: 'Иван',
  departureAt: '2026-09-01T08:00:00Z',
  arrivalAt: '2026-09-01T09:00:00Z',
  timezone: 'UTC',
  availableSeats: 3,
  maxDetourKm: 5,
  childrenAllowed: true,
  driverChildSeatAvailable: true,
  returnAvailable: false,
  publicOriginArea: 'Южный район',
};

describe('CoreTransportBoard quality matching', () => {
  it('explains a suggestion with facts rather than a score', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard
      {...base}
      driverOccurrences={[offer]}
      qualityMatches={[suggestion]}
    />);

    expect(html).toContain('Подходит');
    expect(html).toContain('+4 км · примерно +8 мин');
    expect(html).toContain('Лучше всего подходит');
    // Alternatives stay visible instead of being hidden behind the best one.
    expect(html).toContain('Также подходит');
    expect(html).not.toMatch(/\d+\s*%/);
    expect(html).not.toContain('рейтинг');
  });

  it('keeps every listing on the ordinary board even when nothing matches', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard {...base} driverOccurrences={[offer]} />);

    expect(html).toContain('Иван');
    expect(html).not.toContain('Подходит ·');
    // An unestablished result is never turned into a negative claim on an ordinary card.
    expect(html).not.toContain('не подходит');
  });

  it('shows only suggestions in the dedicated view and keeps the board reachable', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard
      {...base}
      driverOccurrences={[offer, { ...offer, occurrenceId: '20000000-0000-4000-8000-000000000002', authorName: 'Пётр' }]}
      qualityMatches={[suggestion]}
      showMatchesOnly
    />);

    expect(html).toContain('Иван');
    expect(html).not.toContain('Пётр');
    expect(html).toContain('Все объявления');
    expect(html).toContain('Договориться можно и с теми, кого здесь нет.');
  });

  it('explains an unavailable check only inside the suggestions view', () => {
    const unavailable = renderToStaticMarkup(<CoreTransportBoard
      {...base}
      driverOccurrences={[offer]}
      matchingAvailable={false}
      showMatchesOnly
    />);
    expect(unavailable).toContain('Не удалось проверить подходящие поездки. Посмотрите все объявления.');

    const ordinary = renderToStaticMarkup(<CoreTransportBoard
      {...base}
      driverOccurrences={[offer]}
      matchingAvailable={false}
    />);
    expect(ordinary).not.toContain('Не удалось проверить подходящие поездки');
    // Ordinary cards never mention a provider, an interface, or a technical cause.
    expect(ordinary).not.toContain('API');
    expect(ordinary).not.toContain('Google');
  });
});

describe('CoreTransportBoard disclosure boundary', () => {
  const disclosure = {
    agreementId: base.agreements[0].agreementId,
    counterpartyName: 'Иван',
    departurePlace: { exactAddress: 'Via Partenza 88, у ворот', placeId: 'd' },
    email: 'driver@example.test',
    exactMeetingLabel: 'Via Roma 1',
    meetingPlace: { exactAddress: 'Via Roma 1', placeId: 'm' },
    phone: '+390000000000',
    visibleUntil: '2026-10-01T09:00:00Z',
  };

  it('opens the selected meeting place and the driver exact departure place together', () => {
    const html = renderToStaticMarkup(<CoreTransportBoard {...base} disclosure={disclosure} />);

    expect(html).toContain('Точное место встречи');
    expect(html).toContain('Via Roma 1');
    expect(html).toContain('Точное место отправления водителя');
    expect(html).toContain('Via Partenza 88, у ворот');
    expect(html).toContain('driver@example.test');
  });

  // A pre-Maps agreement has no coordinate for the departure place; the block simply omits it.
  it('omits the departure place when the record predates coordinates', () => {
    const legacy = { ...disclosure };
    delete (legacy as Partial<typeof disclosure>).departurePlace;
    delete (legacy as Partial<typeof disclosure>).meetingPlace;
    const html = renderToStaticMarkup(<CoreTransportBoard {...base} disclosure={legacy} />);

    expect(html).toContain('Via Roma 1');
    expect(html).not.toContain('Точное место отправления водителя');
  });
});
