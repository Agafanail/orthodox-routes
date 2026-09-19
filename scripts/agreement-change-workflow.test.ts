import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20260919120000_agreement_change_workflow.sql', import.meta.url)),
  'utf8',
);

describe('agreement change migration boundary', () => {
  it('keeps pending changes in an immutable snapshot until the responder accepts', () => {
    expect(migration).toContain('proposed_snapshot_id uuid not null');
    expect(migration).toContain("proposal.responder_account_id <> actor_id");
    expect(migration).toContain("set state = 'accepted', resolved_at = evaluated_at");
    expect(migration).toContain('active_snapshot_id = proposed.id');
  });

  it('updates request need and occurrence capacity in the accepting transaction', () => {
    expect(migration).toContain('confirmed_seats = confirmed_seats + capacity_delta');
    expect(migration).toContain('remaining_passengers = remaining_passengers - capacity_delta');
  });

  it('keeps proposal storage private and exposes only authenticated RPCs', () => {
    expect(migration).toContain('alter table app.agreement_change_proposal force row level security');
    expect(migration).toContain(
      'revoke all on table app.agreement_change_proposal from public, anon, authenticated, service_role',
    );
    expect(migration).toContain(
      'grant execute on function api.propose_agreement_change(uuid, jsonb, uuid) to authenticated',
    );
    expect(migration).toContain(
      'grant execute on function api.resolve_agreement_change(uuid, boolean, uuid) to authenticated',
    );
  });
});
