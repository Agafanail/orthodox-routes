import { describe, expect, it } from 'vitest';
import { parseCoreDisclosure, parseCoreOwnedItems, parseCorePassengerRequests, parseCoreResponses } from './parse';

describe('Core transport response parsing', () => {
  const owned = {
    request_id: 'request-1', status: 'restore', total_passengers: 3, remaining_passengers: 2,
    church_name: 'Original church', desired_arrival_at: '2026-11-01T09:00:00Z', timezone: 'UTC',
    children_count: 1, child_seat_required: true, return_required: false, public_note: 'Old note',
    service_name_snapshot: 'Original service',
    places: [{ place_id: 'place-1', exact_address: 'Owner exact address', phone: 'not-a-place-field' }],
  };

  it('retains complete owner-only restoration conditions without unrelated private fields', () => {
    const item = parseCoreOwnedItems({ passenger_requests: [owned] }).ownedRequests[0];
    expect(item.restoration).toEqual({
      churchName: 'Original church', desiredArrivalAt: owned.desired_arrival_at, timezone: 'UTC',
      childrenCount: 1, childSeatRequired: true, returnRequired: false, publicNote: 'Old note',
      serviceName: 'Original service', places: ['Owner exact address'],
    });
    expect(JSON.stringify(item)).not.toContain('not-a-place-field');
  });

  it.each([
    { church_name: null }, { places: [] }, { places: [{}] }, { places: [owned.places[0], {}] },
    { children_count: -1 }, { children_count: 4 }, { timezone: 'Not/AZone' },
    { desired_arrival_at: 'not-a-date' }, { child_seat_required: 'true' },
  ])('does not offer incomplete or malformed conditions for restoration: %j', (changed) => {
    expect(parseCoreOwnedItems({ passenger_requests: [{ ...owned, ...changed }] }).ownedRequests[0].restoration).toBeUndefined();
  });

  it('does not carry exact restoration conditions into ordinary owned cards', () => {
    expect(parseCoreOwnedItems({ passenger_requests: [{ ...owned, status: 'active' }] }).ownedRequests[0].restoration).toBeUndefined();
  });
  it('keeps only deliberate safe passenger fields', () => {
    expect(parseCorePassengerRequests([{
      request_id: 'request-1', church_id: 'church-1', author_name: 'Anna',
      desired_arrival_at: '2026-09-01T09:00:00Z', timezone: 'UTC', passenger_count: 2,
      children_count: 0, child_seat_required: false, return_required: false,
      place_options: [{ place_id: 'place-1', public_area_label: 'North district', exact_label: 'hidden' }],
      phone: '+390000000000',
    }])).toEqual([expect.objectContaining({
      requestId: 'request-1', placeOptions: [{ placeId: 'place-1', publicAreaLabel: 'North district' }],
    })]);
  });

  it('rejects incomplete participant response shapes', () => {
    expect(parseCoreResponses([{ response_id: 'response-1', status: 'await_driver' }])).toEqual([]);
  });

  it('requires both separately authorized disclosure results for one agreement', () => {
    expect(parseCoreDisclosure('agreement-1', {
      agreement_id: 'agreement-1', counterparty_name: 'Иван', email: 'i@example.test',
      phone: '+390000000000', visible_until: '2026-09-30T00:00:00Z',
    }, {
      agreement_id: 'agreement-1', exact_meeting_label: 'Via Roma 1',
    })).toEqual(expect.objectContaining({ exactMeetingLabel: 'Via Roma 1' }));
    expect(parseCoreDisclosure('agreement-1', {
      agreement_id: 'agreement-2', counterparty_name: 'Иван', email: 'i@example.test',
      phone: '+390000000000', visible_until: '2026-09-30T00:00:00Z',
    }, {
      agreement_id: 'agreement-1', exact_meeting_label: 'Via Roma 1',
    })).toBeUndefined();
  });
});
