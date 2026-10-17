import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261004193000_account_data_export.sql', import.meta.url),
  'utf8',
);
const administrationMigration = readFileSync(
  new URL('../supabase/migrations/20261017090000_church_administration_export.sql', import.meta.url),
  'utf8',
);

describe('account data export migration', () => {
  it('keeps the export actor-derived and hardened', () => {
    expect(migration).toContain('actor_id uuid := app.current_actor_id()');
    expect(migration).toContain("account.status in ('active', 'restricted')");
    expect(migration).toMatch(/security definer\r?\nset search_path = ''/);
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

describe('church administration export extension', () => {
  it('selects only own positions, actions, invitations, and archival requests', () => {
    for (const predicate of [
      'membership.account_id = p_actor_id',
      'invitation.sender_account_id = p_actor_id or invitation.accepted_account_id = p_actor_id',
      'event.actor_account_id = p_actor_id or event.subject_account_id = p_actor_id',
      'request.requested_by = p_actor_id',
    ]) expect(administrationMigration).toContain(predicate);
  });

  it('does not fetch recipient contacts, capabilities, mail, or current page content', () => {
    for (const excluded of [
      'invite_email', 'token_hash', 'token_value', 'church_invite_mail', 'account_contact',
      'official_name', 'description_source', 'operator_fingerprint', 'support_reference',
    ]) expect(administrationMigration).not.toContain(excluded);
  });

  it('keeps the trusted helper ungranted and preserves the existing export definition', () => {
    expect(administrationMigration).toContain("stable set search_path = ''");
    expect(administrationMigration).toContain(
      'revoke all on function app.export_church_administration(uuid) from public, anon, authenticated, service_role',
    );
    expect(administrationMigration).toContain("pg_get_functiondef('api.export_current_account_data()'::regprocedure)");
    expect(administrationMigration).toContain('Unexpected account export definition.');
    expect(administrationMigration).not.toContain('create or replace function api.');
    expect(administrationMigration).not.toContain('grant execute');
  });
});
