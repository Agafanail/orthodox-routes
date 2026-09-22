import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260922130000_transport_notification_events.sql', import.meta.url,
)), 'utf8');

describe('transport notification event migration boundary', () => {
  it('deduplicates scheduled and transition notifications per recipient', () => {
    expect(migration).toContain('create unique index notification_recipient_deduplication');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('create function app.create_notification_once');
  });

  it('attaches notification creation to authoritative transport tables', () => {
    expect(migration).toContain('after insert or update of status on app.ride_response');
    expect(migration).toContain('after insert or update of status on app.ride_agreement');
    expect(migration).toContain('after insert or update of state on app.agreement_change_proposal');
  });

  it('keeps the replay-safe scheduler service-role only', () => {
    expect(migration).toContain('create function ops.enqueue_scheduled_transport_notifications');
    expect(migration).toContain("'ride.quality_match'");
    expect(migration).toContain("'ride.reminder'");
    expect(migration).toContain("'ride.outcome_requested'");
    expect(migration).toContain('revoke all on function api.notification_worker_enqueue_scheduled');
    expect(migration).toContain('grant execute on function api.notification_worker_enqueue_scheduled');
  });
});
