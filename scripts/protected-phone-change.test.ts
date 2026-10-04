import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/20261004210000_protected_phone_change.sql', import.meta.url),
  'utf8',
);

describe('protected phone change migration', () => {
  it('requires a recent non-refresh authentication method', () => {
    expect(migration).toContain("auth.jwt() -> 'amr'");
    expect(migration).toContain("entry.value ->> 'method' in ('magiclink', 'otp', 'password', 'recovery', 'email_change')");
    expect(migration).toContain('Recent reauthentication is required.');
    expect(migration).not.toContain("auth.jwt() ->> 'iat'");
  });

  it('preserves the current verified phone until the new code succeeds', () => {
    const requestBody = migration.slice(
      migration.indexOf('create function api.request_phone_change'),
      migration.indexOf('create or replace function api.current_phone_verification'),
    );
    expect(requestBody).not.toContain('update private.account_contact');
    expect(migration).toContain("attempt.purpose = 'phone_change'");
    expect(migration).toContain('phone_changed_at = verified_time');
  });

  it('keeps the public contract actor-derived and the worker material private', () => {
    expect(migration).toContain('actor_id uuid := app.current_actor_id()');
    expect(migration).toMatch(/security definer\r?\nset search_path = ''/);
    expect(migration).toContain('grant execute on function api.request_phone_change(text, uuid) to authenticated');
    expect(migration).not.toContain("'verification_code'");
  });
});
