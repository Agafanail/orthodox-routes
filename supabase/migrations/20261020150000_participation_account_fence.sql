-- Serialize existing positive participation guards with account lifecycle writers.
-- Read-only projections keep their STABLE helpers and never acquire row locks.
create or replace function app.require_mutating_actor(p_requires_external boolean)
returns uuid
language plpgsql
volatile
set search_path = ''
set lock_timeout = '5s'
as $$
declare actor_id uuid := app.current_actor_id();
begin
  if p_requires_external is null then
    raise exception using errcode = '22023', message = 'Participation guard mode is required.';
  end if;
  -- SHARE, not KEY SHARE: a non-key status UPDATE must conflict with this fence.
  perform 1 from app.account as account where account.id = actor_id for share;
  if not found then
    raise exception using errcode = '42501', message = 'Current participation eligibility is required.';
  end if;
  -- A separate statement obtains fresh facts after a competing status writer commits.
  if p_requires_external then return app.require_transport_actor(); end if;
  return app.require_eligible_actor();
end;
$$;
revoke all on function app.require_mutating_actor(boolean) from public, anon, authenticated, service_role;

-- Rewrite only existing VOLATILE entry-point guard calls. Preserve their position,
-- conditional branches, signatures, ACL, security-definer flags, and remaining bodies.
do $$
declare routine record; definition text; guard record; checked_count integer := 0;
begin
  for routine in select routine_row.oid, routine_row.provolatile
    from pg_proc as routine_row join pg_namespace as namespace on namespace.oid = routine_row.pronamespace
    where namespace.nspname = 'api' and routine_row.prokind = 'f' and routine_row.proname in (
      'publish_passenger_request', 'publish_driver_occurrence', 'publish_driver_series',
      'submit_passenger_response', 'submit_driver_response', 'answer_passenger_response',
      'confirm_ride_response', 'restore_passenger_request', 'propose_agreement_change', 'resolve_agreement_change',
      'create_church', 'invite_church_admin', 'accept_church_admin_invite', 'update_church_content',
      'create_one_off_service', 'cancel_one_off_service',
      'request_church_archival', 'cancel_church_archival_request', 'update_church_address',
      'update_one_off_service_content', 'update_one_off_service_time', 'create_recurring_service',
      'cancel_recurring_service_date',
      'reschedule_recurring_service_date', 'update_recurring_service_date_content',
      'cancel_recurring_service_future',
      'correct_church_content_translation', 'update_church_public_contacts', 'prepare_church_image_replacement',
      'update_recurring_service_future_content', 'reschedule_recurring_service_future',
      'extend_recurring_service', 'shorten_recurring_service'
    )
  loop
    checked_count := checked_count + 1;
    if routine.provolatile <> 'v' then
      raise exception using errcode = '55000', message = 'Unexpected participation entry-point volatility.';
    end if;
    definition := pg_get_functiondef(routine.oid);
    for guard in select * from (values
      ('app.require_transport_actor()', 'app.require_mutating_actor(true)'),
      ('app.require_eligible_actor()', 'app.require_mutating_actor(false)')
    ) as guards(previous_call, fenced_call)
    loop
      if position(guard.previous_call in definition) > 0 then
        if length(definition) - length(replace(definition, guard.previous_call, '')) <> length(guard.previous_call) then
          raise exception using errcode = '55000', message = 'Unexpected participation guard count.';
        end if;
        definition := replace(definition, guard.previous_call, guard.fenced_call);
      end if;
    end loop;
    if position('app.require_mutating_actor(' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected participation entry-point guard.';
    end if;
    execute definition;
  end loop;
  if checked_count <> 33 then
    raise exception using errcode = '55000', message = 'Unexpected participation entry-point inventory.';
  end if;
end;
$$;

comment on function app.require_mutating_actor(boolean) is
  'Unexposed positive-participation fence; pins account lifecycle state until transaction end and rechecks existing eligibility/channel rules after row waits.';
