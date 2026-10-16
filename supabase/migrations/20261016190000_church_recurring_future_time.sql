-- A weekly time change reschedules services, never the linked ride snapshots.
alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'reschedule_recurring_service_date', 'update_recurring_service_date_content',
  'cancel_recurring_service_future', 'correct_church_content_translation',
  'request_church_archival', 'cancel_church_archival_request', 'update_church_public_contacts',
  'update_recurring_service_future_content', 'reschedule_recurring_service_future'
));

create function api.preview_recurring_service_future_time(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  impact jsonb := api.preview_recurring_service_future_content(p_service_id);
  time_fields jsonb;
begin
  select jsonb_build_object('local_start_time', series.local_start_time, 'timezone', series.timezone)
  into time_fields from app.service_occurrence as service
  join app.service_series as series on series.id = service.source_series_id
  where service.public_id = p_service_id;
  return impact || time_fields;
end;
$$;

create function api.reschedule_recurring_service_future(
  p_service_id uuid, p_local_start_time time,
  p_expected_series_version integer, p_expected_schedule_updated_at timestamptz, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_eligible_actor();
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  selected_row app.service_occurrence%rowtype;
  series_row app.service_series%rowtype;
  service_row app.service_occurrence%rowtype;
  changed_count integer := 0;
  source_changed boolean;
  result jsonb;
begin
  if p_service_id is null or p_client_key is null or p_local_start_time is null
    or p_expected_series_version is null or p_expected_series_version < 1
    or p_expected_schedule_updated_at is null then
    raise exception using errcode = '22023', message = 'Recurring service time input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'local_start_time', p_local_start_time,
    'expected_series_version', p_expected_series_version,
    'expected_schedule_updated_at', p_expected_schedule_updated_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':reschedule_recurring_service_future:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'reschedule_recurring_service_future', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select church.* into church_row from app.church as church
  join app.service_occurrence as service on service.church_id = church.id
  where service.public_id = p_service_id for update of church;
  select * into selected_row from app.service_occurrence as service
  where service.public_id = p_service_id for update;
  select * into series_row from app.service_series as series
  where series.id = selected_row.source_series_id for update;
  if church_row.id is null or church_row.status <> 'published'
    or selected_row.source_kind <> 'recurring' or series_row.status <> 'active'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if series_row.version <> p_expected_series_version
    or church_row.schedule_updated_at is distinct from p_expected_schedule_updated_at then
    raise exception using errcode = 'PT409', message = 'Schedule changed; reload the preview before rescheduling.';
  end if;
  if selected_row.status <> 'scheduled' or selected_row.starts_at <= now()
    or series_row.materialized_through is null
    or series_row.materialized_through < selected_row.local_date then
    raise exception using errcode = '22023', message = 'Recurring service cannot be rescheduled.';
  end if;
  -- Reject the whole operation before I/O if any selected slot would become a past service.
  if exists (select 1 from app.service_occurrence as service
    where service.source_series_id = series_row.id and service.local_date >= selected_row.local_date
      and service.status = 'scheduled' and service.starts_at > now()
      and ((service.local_date + p_local_start_time) at time zone series_row.timezone) <= now()) then
    raise exception using errcode = '22023', message = 'Replacement service time must be in the future.';
  end if;

  source_changed := series_row.local_start_time is distinct from p_local_start_time;
  for service_row in
    select * from app.service_occurrence as service
    where service.source_series_id = series_row.id and service.local_date >= selected_row.local_date
      and service.status = 'scheduled' and service.starts_at > now()
      and service.starts_at is distinct from
        ((service.local_date + p_local_start_time) at time zone series_row.timezone)
    order by service.local_date, service.id for update
  loop
    -- Retain the established generation, exception, notification, and ride-disclosure boundary.
    perform api.reschedule_recurring_service_date(service_row.public_id,
      (service_row.local_date + p_local_start_time) at time zone series_row.timezone,
      service_row.version, gen_random_uuid());
    changed_count := changed_count + 1;
  end loop;
  if source_changed or changed_count > 0 then
    update app.service_series set local_start_time = p_local_start_time,
      version = version + 1, updated_at = clock_timestamp()
    where id = series_row.id returning * into series_row;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.rescheduled');
  end if;
  result := jsonb_build_object('status', 'saved', 'series_id', series_row.public_id,
    'series_version', series_row.version, 'from_local_date', selected_row.local_date,
    'rescheduled_service_count', changed_count);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'reschedule_recurring_service_future', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_recurring_service_future_time(uuid),
  api.reschedule_recurring_service_future(uuid, time, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_future_time(uuid),
  api.reschedule_recurring_service_future(uuid, time, integer, timestamptz, uuid)
  to authenticated;

comment on function api.reschedule_recurring_service_future(uuid, time, integer, timestamptz, uuid) is
  'Changes weekly time from the selected source-local slot onward, preserving earlier/cancelled services and immutable ride snapshots.';
