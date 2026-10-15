-- Church administration requires the confirmed-user role, not optional ride delivery preferences.
create function app.require_eligible_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  if not coalesce((app.current_eligibility_result(actor_id)->>'eligible')::boolean, false) then
    raise exception using errcode = '42501', message = 'Current participation eligibility is required.';
  end if;
  return actor_id;
end;
$$;
revoke all on function app.require_eligible_actor() from public, anon, authenticated, service_role;

create or replace function app.require_transport_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_id uuid := app.require_eligible_actor();
begin
  if not coalesce(app.has_effective_external_channel(actor_id), false) then
    raise exception using errcode = '42501', message = 'An effective external notification channel is required.';
  end if;
  return actor_id;
end;
$$;

-- This is a migration-only rewrite of one exact call in an explicit function allowlist.
-- Preserve each current signature, grants, security-definer flag, remaining body, and search path.
do $$
declare
  function_name text;
  definition text;
  old_call constant text := 'app.require_transport_actor()';
begin
  foreach function_name in array array[
    'api.create_church', 'api.invite_church_admin', 'api.accept_church_admin_invite',
    'api.update_church_content', 'api.create_one_off_service',
    'api.preview_one_off_service_cancellation', 'api.cancel_one_off_service',
    'api.request_church_archival', 'api.cancel_church_archival_request',
    'api.update_church_address', 'api.update_one_off_service_content',
    'api.update_one_off_service_time', 'api.create_recurring_service',
    'api.preview_recurring_service_date_cancellation', 'api.cancel_recurring_service_date',
    'api.reschedule_recurring_service_date', 'api.update_recurring_service_date_content',
    'api.preview_recurring_service_future_cancellation', 'api.cancel_recurring_service_future',
    'app.managed_translation_target', 'api.correct_church_content_translation'
  ]::text[] loop
    select pg_get_functiondef(function_row.oid) into strict definition
    from pg_proc as function_row join pg_namespace as namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname || '.' || function_row.proname = function_name and function_row.prokind = 'f';
    if length(definition) - length(replace(definition, old_call, '')) <> length(old_call) then
      raise exception using errcode = '55000', message = 'Church authority migration encountered an unexpected function body.';
    end if;
    execute replace(definition, old_call, 'app.require_eligible_actor()');
  end loop;
end;
$$;

revoke all on function app.require_transport_actor() from public, anon, authenticated, service_role;
comment on function app.require_eligible_actor() is
  'Confirmed-user eligibility only; optional ride notification channels are checked by transport actions separately.';
