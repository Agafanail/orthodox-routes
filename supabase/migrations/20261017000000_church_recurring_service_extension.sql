-- Extending a source adds later slots without rewriting existing services or ride snapshots.
do $$
declare prior_expression text;
begin
  select pg_get_expr(conbin, conrelid) into strict prior_expression from pg_constraint
  where conrelid = 'private.church_operation'::regclass and conname = 'church_operation_type';
  alter table private.church_operation drop constraint church_operation_type;
  execute format('alter table private.church_operation add constraint church_operation_type check ((%s) or operation_type = %L)',
    prior_expression, 'extend_recurring_service');
end;
$$;

create function api.preview_recurring_service_extension(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  impact jsonb := api.preview_recurring_service_future_time(p_service_id);
  bounds jsonb;
begin
  select jsonb_build_object('starts_on', series.starts_on, 'ends_on', series.ends_on, 'weekdays', series.weekdays)
  into bounds from app.service_occurrence as service
  join app.service_series as series on series.id = service.source_series_id
  where service.public_id = p_service_id;
  return impact || bounds;
end;
$$;

create function api.extend_recurring_service(
  p_service_id uuid, p_ends_on date,
  p_expected_series_version integer, p_expected_schedule_updated_at timestamptz, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  actor_id uuid := app.require_eligible_actor();
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  selected_row app.service_occurrence%rowtype;
  series_row app.service_series%rowtype;
  materialized_count integer := 0;
  result jsonb;
begin
  if p_service_id is null or p_client_key is null or p_expected_series_version is null
    or p_expected_series_version < 1 or p_expected_schedule_updated_at is null then
    raise exception using errcode = '22023', message = 'Recurring service extension input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'ends_on', p_ends_on,
    'expected_series_version', p_expected_series_version,
    'expected_schedule_updated_at', p_expected_schedule_updated_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':extend_recurring_service:' || p_client_key::text, 0));
  existing_result := app.church_operation_result(actor_id, 'extend_recurring_service', p_client_key, input_digest);
  if existing_result is not null then return existing_result; end if;

  select church.* into church_row from app.church as church
  join app.service_occurrence as service on service.church_id = church.id
  where service.public_id = p_service_id for update of church;
  select * into selected_row from app.service_occurrence as service where service.public_id = p_service_id for update;
  select * into series_row from app.service_series as series where series.id = selected_row.source_series_id for update;
  if church_row.id is null or church_row.status <> 'published'
    or selected_row.source_kind <> 'recurring' or series_row.status <> 'active'
    or not exists (select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if series_row.version <> p_expected_series_version
    or church_row.schedule_updated_at is distinct from p_expected_schedule_updated_at then
    raise exception using errcode = 'PT409', message = 'Schedule changed; reload the preview before extending.';
  end if;
  if selected_row.status <> 'scheduled' or selected_row.starts_at <= now()
    or series_row.materialized_through is null or series_row.materialized_through < selected_row.local_date then
    raise exception using errcode = '22023', message = 'Recurring service cannot be extended.';
  end if;
  if p_ends_on is not null and (series_row.ends_on is null or p_ends_on < series_row.ends_on) then
    raise exception using errcode = '22023', message = 'An extension cannot shorten the current period.';
  end if;
  if series_row.ends_on is distinct from p_ends_on then
    update app.service_series set ends_on = p_ends_on, version = version + 1, updated_at = clock_timestamp()
    where id = series_row.id returning * into series_row;
    -- Reuse the bounded rolling window, conflict alerts, local zone, and retained slot keys.
    materialized_count := app.materialize_service_series(series_row.id, now());
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp() where id = church_row.id;
    insert into app.church_admin_event(church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.rescheduled');
  end if;
  result := jsonb_build_object('status', 'saved', 'series_id', series_row.public_id,
    'series_version', series_row.version, 'ends_on', series_row.ends_on, 'new_service_count', materialized_count);
  insert into private.church_operation(actor_account_id, operation_type, client_key, input_digest, result)
  values (actor_id, 'extend_recurring_service', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_recurring_service_extension(uuid),
  api.extend_recurring_service(uuid, date, integer, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_extension(uuid),
  api.extend_recurring_service(uuid, date, integer, timestamptz, uuid) to authenticated;
