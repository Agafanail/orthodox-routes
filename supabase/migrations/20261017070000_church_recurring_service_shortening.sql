-- Shortening reuses the reviewed selected-and-future cancellation path and its notifications.
do $$
declare expression text;
begin
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'private.church_operation'::regclass and conname = 'church_operation_type';
  if position('shorten_recurring_service' in expression) = 0 then
    alter table private.church_operation drop constraint church_operation_type;
    execute format('alter table private.church_operation add constraint church_operation_type check ((%s) or operation_type = ''shorten_recurring_service'')', expression);
  end if;
end;
$$;

create function api.preview_recurring_service_shortening(p_service_id uuid, p_ends_on date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare context jsonb; impact jsonb; removed_slot app.service_occurrence%rowtype;
begin
  context := api.preview_recurring_service_extension(p_service_id);
  if p_ends_on is null or not isfinite(p_ends_on) or p_ends_on < (context->>'from_local_date')::date
    or ((context->>'ends_on') is not null and p_ends_on > (context->>'ends_on')::date) then
    raise exception using errcode = '22023', message = 'Recurring service shortening input is invalid.';
  end if;
  select service.* into removed_slot from app.service_occurrence as service
    join app.service_series as series on series.id = service.source_series_id
    where series.public_id = (context->>'series_id')::uuid and service.local_date > p_ends_on
      and service.status = 'scheduled' and service.starts_at > now()
    order by service.local_date, service.id limit 1;
  if removed_slot.id is not null then
    impact := api.preview_recurring_service_future_cancellation(removed_slot.public_id);
  else
    impact := jsonb_build_object('service_count', 0, 'passenger_requests', 0,
      'driver_offers', 0, 'pending_responses', 0, 'agreements', 0);
  end if;
  return context || impact || jsonb_build_object('selected_service_id', p_service_id,
    'from_local_date', context->'from_local_date', 'proposed_ends_on', p_ends_on,
    'first_removed_local_date', removed_slot.local_date);
end;
$$;

create function api.shorten_recurring_service(
  p_service_id uuid, p_ends_on date,
  p_expected_series_version integer, p_expected_schedule_updated_at timestamptz, p_client_key uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  actor_id uuid := app.require_eligible_actor();
  input_digest text; existing_result jsonb; cancellation jsonb; result jsonb;
  church_row app.church%rowtype; series_row app.service_series%rowtype;
  selected_row app.service_occurrence%rowtype; removed_slot app.service_occurrence%rowtype;
  cancelled_count integer := 0;
begin
  if p_service_id is null or p_ends_on is null or not isfinite(p_ends_on) or p_client_key is null
    or p_expected_series_version is null or p_expected_series_version < 1
    or p_expected_schedule_updated_at is null then
    raise exception using errcode = '22023', message = 'Recurring service shortening input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'ends_on', p_ends_on, 'expected_series_version', p_expected_series_version,
    'expected_schedule_updated_at', p_expected_schedule_updated_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':shorten_recurring_service:' || p_client_key::text, 0));
  existing_result := app.church_operation_result(actor_id, 'shorten_recurring_service', p_client_key, input_digest);
  if existing_result is not null then return existing_result; end if;
  select church.* into church_row from app.church as church
    join app.service_occurrence as service on service.church_id = church.id
    where service.public_id = p_service_id for update of church;
  select * into selected_row from app.service_occurrence as service where service.public_id = p_service_id for update;
  select * into series_row from app.service_series as series where series.id = selected_row.source_series_id for update;
  if church_row.id is null or church_row.status not in ('published', 'hidden') or selected_row.source_kind <> 'recurring'
    or series_row.status <> 'active' or not exists (select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if series_row.version <> p_expected_series_version
    or church_row.schedule_updated_at is distinct from p_expected_schedule_updated_at then
    raise exception using errcode = 'PT409', message = 'Schedule changed; reload the preview before shortening.';
  end if;
  if selected_row.status <> 'scheduled' or selected_row.starts_at <= now()
    or series_row.materialized_through is null or series_row.materialized_through < selected_row.local_date
    or p_ends_on < selected_row.local_date or p_ends_on < series_row.starts_on
    or (series_row.ends_on is not null and p_ends_on > series_row.ends_on) then
    raise exception using errcode = '22023', message = 'Recurring service cannot be shortened.';
  end if;
  if series_row.ends_on is distinct from p_ends_on then
    select * into removed_slot from app.service_occurrence as service
      where service.source_series_id = series_row.id and service.local_date > p_ends_on
        and service.status = 'scheduled' and service.starts_at > now()
      order by service.local_date, service.id limit 1 for update;
    if removed_slot.id is not null then
      cancellation := api.cancel_recurring_service_future(removed_slot.public_id, series_row.version, gen_random_uuid());
      cancelled_count := (cancellation->>'cancelled_service_count')::integer;
      -- The nested cancellation already advances the series once and creates its audit/notifications.
      -- Preserve the exact requested bound, even when no weekly slot falls on the following day.
      update app.service_series set ends_on = p_ends_on, updated_at = clock_timestamp()
        where id = series_row.id returning * into series_row;
    else
      update app.service_series set ends_on = p_ends_on, version = version + 1, updated_at = clock_timestamp()
        where id = series_row.id returning * into series_row;
      insert into app.church_admin_event(church_id, actor_account_id, event_type)
        values (church_row.id, actor_id, 'service.rescheduled');
    end if;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp() where id = church_row.id;
  end if;
  result := jsonb_build_object('status', 'saved', 'series_id', series_row.public_id,
    'series_version', series_row.version, 'ends_on', series_row.ends_on, 'cancelled_service_count', cancelled_count);
  insert into private.church_operation(actor_account_id, operation_type, client_key, input_digest, result)
    values (actor_id, 'shorten_recurring_service', p_client_key, input_digest, result);
  return result;
end;
$$;
revoke all on function api.preview_recurring_service_shortening(uuid, date),
  api.shorten_recurring_service(uuid, date, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_shortening(uuid, date),
  api.shorten_recurring_service(uuid, date, integer, timestamptz, uuid) to authenticated;
