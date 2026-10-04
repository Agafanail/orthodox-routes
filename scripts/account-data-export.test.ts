import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261004193000_account_data_export.sql', import.meta.url),
  'utf8',
);

describe('account data export migration', () => {
  it('keeps the export actor-derived and hardened', () => {
    expect(migration).toContain('actor_id uuid := app.current_actor_id()');
    expect(migration).toContain("account.status in ('active', 'restricted')");
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('grant execute on function api.export_current_account_data() to authenticated');
  });

  it('exports safe delivery metadata without destinations or provider references', () => {
    expect(migration).toContain("'deliveries', coalesce(delivery.items");
    expect(migration).not.toContain('private.notification_destination');
    expect(migration).not.toContain('provider_reference');
    expect(migration).not.toContain('endpoint_value');
    expect(migration).not.toContain('p256dh_key');
    expect(migration).not.toContain('auth_key');
  });

  it('includes the account-owned domains needed for a complete current export', () => {
    for (const section of [
      'legal_acceptances', 'notification_preferences', 'notifications', 'push_subscriptions',
      'places', 'owned_transport', 'ride_responses', 'ride_agreements', 'my_trips',
    ]) {
      expect(migration).toContain(`'${section}'`);
    }
  });
});
