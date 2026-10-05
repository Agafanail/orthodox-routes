import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261004220000_church_administration_foundation.sql', import.meta.url),
  'utf8',
);

describe('church administration foundation migration', () => {
  it('publishes through an eligible actor-derived operation', () => {
    expect(migration).toContain('actor_id uuid := app.require_transport_actor()');
    expect(migration).toContain("timezone, status, created_by, location, address_fingerprint");
    expect(migration).toContain("'published', actor_id");
    expect(migration).toMatch(/security definer\r?\nset search_path = ''/);
  });

  it('combines normalized-address and spatial duplicate protection', () => {
    expect(migration).toContain("hashtextextended('church-address:' || fingerprint, 0)");
    expect(migration).toContain('extensions.st_dwithin(church.location, requested_location, 100)');
    expect(migration).toContain('create unique index church_active_address_fingerprint');
    expect(migration).toContain("'status', 'potential_duplicate'");
  });

  it('creates one equal administrator place without widening transport access', () => {
    expect(migration).toContain('create table app.church_admin_membership');
    expect(migration).toContain('A church can have at most three administrator places.');
    expect(migration).not.toContain('private.agreement_contact_snapshot');
    expect(migration).toContain('grant execute on function api.current_managed_churches() to authenticated');
  });
});
