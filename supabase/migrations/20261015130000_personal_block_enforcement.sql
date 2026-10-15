-- Serialize a private pair's block with response acceptance, without locking its ride rows.
create function app.lock_personal_block_pair(first_account uuid, second_account uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if first_account is null or second_account is null or first_account = second_account then
    raise exception using errcode = '22023', message = 'The participant pair is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'personal-block:' || least(first_account, second_account)::text || ':'
      || greatest(first_account, second_account)::text, 0
  ));
end;
$$;

create function app.enforce_personal_block_commitment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ended_at is not null then return new; end if;
  perform app.lock_personal_block_pair(new.blocker_account_id, new.blocked_account_id);
  if exists (
    select 1 from app.ride_agreement as agreement
    join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
    where agreement.status in ('confirmed', 'change_pending')
      and snapshot.scheduled_arrival_at > clock_timestamp()
      and (
        (agreement.passenger_account_id = new.blocker_account_id
          and agreement.driver_account_id = new.blocked_account_id)
        or (agreement.driver_account_id = new.blocker_account_id
          and agreement.passenger_account_id = new.blocked_account_id)
      )
  ) then
    raise exception using errcode = '22023', message = 'Cancel the future agreement before blocking.';
  end if;
  return new;
end;
$$;
create trigger personal_block_commitment_guard
  before insert or update on app.personal_block
  for each row execute function app.enforce_personal_block_commitment_guard();

-- Every response direction, positive answer, confirmation, and accepted condition change
-- already uses this shared check. A neutral failure does not disclose either person's block.
create or replace function app.assert_response_participants_eligible(passenger_id uuid, driver_id uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform app.lock_personal_block_pair(passenger_id, driver_id);
  if app.accounts_are_blocked(passenger_id, driver_id)
    or not coalesce((app.current_eligibility_result(passenger_id)->>'eligible')::boolean, false)
    or not coalesce((app.current_eligibility_result(driver_id)->>'eligible')::boolean, false)
  then
    raise exception using errcode = '42501', message = 'Both participants must remain eligible.';
  end if;
  return true;
end;
$$;

revoke all on function app.lock_personal_block_pair(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app.enforce_personal_block_commitment_guard()
  from public, anon, authenticated, service_role;
revoke all on function app.assert_response_participants_eligible(uuid, uuid)
  from public, anon, authenticated, service_role;
comment on table app.personal_block is
  'Private pair block enforced by matching and response/confirmation checks. Future agreements must be cancelled first; actor-facing block operations remain separate.';
