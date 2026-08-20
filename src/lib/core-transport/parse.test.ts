import { describe, expect, it } from 'vitest';
import { parseCoreDisclosure, parseCorePassengerRequests, parseCoreResponses } from './parse';

describe('Core transport response parsing', () => {
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
