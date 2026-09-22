import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260922100000_notification_delivery_workers.sql', import.meta.url,
)), 'utf8');

describe('notification delivery worker migration boundary', () => {
  it('keeps minimized webhook receipts behind forced RLS', () => {
    expect(migration).toContain('create table ops.provider_webhook_receipt');
    expect(migration).toContain('alter table ops.provider_webhook_receipt force row level security');
    expect(migration).toContain('revoke all on table ops.provider_webhook_receipt');
  });

  it('leases only configured channels and exposes worker functions only to service_role', () => {
    expect(migration).toContain('delivery.channel = any(p_channels)');
    expect(migration).toContain('grant execute on function api.notification_worker_claim_jobs_v2');
    expect(migration).toContain('to service_role');
  });

  it('prevents out-of-order provider events from regressing terminal state', () => {
    expect(migration).toContain("delivery.state not in ('delivered', 'permanent_failure', 'suppressed')");
    expect(migration).toContain('p_occurred_at >= delivery.provider_event_at');
  });
});
