import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20260919150000_notification_foundation.sql', import.meta.url)),
  'utf8',
);

describe('notification foundation migration boundary', () => {
  it('stores notification destinations only in a protected table', () => {
    expect(migration).toContain('create table private.notification_destination');
    expect(migration).toContain('alter table private.notification_destination force row level security');
    expect(migration).toContain('private.notification_destination, app.outbox_job');
  });

  it('uses bounded leasing, retries, and terminal dead-letter state', () => {
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain("job.attempt_count >= 5");
    expect(migration).toContain("then 'suppressed' else 'dead'");
  });

  it('enforces an effective external channel before transport mutations', () => {
    expect(migration).toContain('create function app.has_effective_external_channel');
    expect(migration).toContain('create or replace function app.require_transport_actor()');
    expect(migration).toContain('An effective external notification channel is required.');
  });
});
