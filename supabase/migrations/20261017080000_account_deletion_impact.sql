-- Informational only: this snapshot neither prepares nor authorizes destructive execution.
create function api.current_account_deletion_impact()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  evaluated_at timestamptz := current_timestamp;
  administrator_churches integer;
  final_administrator_churches integer;
begin
  if not exists (select 1 from app.account as account where account.id = actor_id
    and account.status in ('email_verified', 'active', 'restricted')) then
    raise exception using errcode = 'P0002', message = 'Application account is unavailable.';
  end if;
  -- Pending invitations are not accepted memberships and cannot resolve the final-admin boundary.
  -- Use the existing voluntary-exit membership definition, including transferring incumbents.
  select count(*)::integer, count(*) filter (where not exists (
    select 1 from app.church_admin_membership as other_membership
    where other_membership.church_id = membership.church_id
      and other_membership.account_id <> actor_id
      and other_membership.status in ('active', 'transferring')
  ))::integer into administrator_churches, final_administrator_churches
  from app.church_admin_membership as membership
  where membership.account_id = actor_id and membership.status in ('active', 'transferring');

  return jsonb_build_object(
    'schema_version', 1, 'evaluated_at', evaluated_at,
    'future_passenger_requests', (select count(*) from app.passenger_request as request
      where request.author_account_id = actor_id
        and request.status in ('active', 'partial', 'fulfilled', 'restore')
        and request.desired_arrival_at > evaluated_at),
    'future_driver_occurrences', (select count(*) from app.driver_offer_occurrence as occurrence
      where occurrence.author_account_id = actor_id and occurrence.status in ('active', 'full')
        and occurrence.arrival_at > evaluated_at),
    'future_driver_series', (select count(*) from app.driver_offer_series as series
      where series.author_account_id = actor_id and series.status in ('active', 'change_pending')
        and series.ends_on >= (evaluated_at at time zone series.timezone)::date),
    'pending_future_responses', (select count(*) from app.ride_response as response
      join app.ride_condition_snapshot as snapshot on snapshot.id = response.conditions_snapshot_id
      where actor_id in (response.passenger_account_id, response.driver_account_id)
        and response.status in ('await_driver', 'await_passenger')
        and response.expires_at > evaluated_at and snapshot.scheduled_arrival_at > evaluated_at),
    'future_agreements', (select count(*) from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      where actor_id in (agreement.passenger_account_id, agreement.driver_account_id)
        and agreement.status in ('confirmed', 'change_pending') and snapshot.scheduled_arrival_at > evaluated_at),
    'administrator_churches', administrator_churches,
    'final_administrator_churches', final_administrator_churches,
    'requires_administrator_resolution', final_administrator_churches > 0
  );
end;
$$;
revoke all on function api.current_account_deletion_impact() from public, anon, authenticated, service_role;
grant execute on function api.current_account_deletion_impact() to authenticated;
comment on function api.current_account_deletion_impact() is
  'Own count-only deletion consequences, not confirmation, permission, or an execution capability.';
