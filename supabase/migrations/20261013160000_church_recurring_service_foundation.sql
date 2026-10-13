-- A recurring source materializes concrete dates in the church's local time zone.
create table app.service_series (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  church_id uuid not null references app.church (id) on delete restrict,
  source_name text not null,
  source_description text,
  weekdays smallint[] not null,
  local_start_time time not null,
  timezone text not null,
  starts_on date not null,
  ends_on date,
  materialized_through date,
  status text not null default 'active',
  version integer not null default 1,
  created_by uuid references app.account (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_series_name_safe check (
    char_length(source_name) between 1 and 160 and source_name !~ '[[:cntrl:]]'
  ),
  constraint service_series_description_safe check (
    source_description is null or (
      char_length(source_description) between 1 and 4000
      and translate(source_description, E'\n\r', '') !~ '[[:cntrl:]]'
    )
  ),
  constraint service_series_weekdays_safe check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint service_series_bounds_safe check (ends_on is null or ends_on >= starts_on),
  constraint service_series_status_safe check (status in ('active', 'stopped')),
  constraint service_series_version_positive check (version > 0)
);
create index service_series_active_church on app.service_series (church_id, starts_on)
  where status = 'active';
alter table app.service_series enable row level security;
alter table app.service_series force row level security;
revoke all on table app.service_series from public, anon, authenticated, service_role;

alter table app.service_occurrence
  add column source_series_id uuid references app.service_series (id) on delete restrict,
  add column local_date date,
  add column local_start_time time,
  add constraint service_occurrence_series_shape check (
    (source_kind = 'one_off' and source_series_id is null
      and local_date is null and local_start_time is null)
    or (source_kind = 'recurring' and source_series_id is not null
      and local_date is not null and local_start_time is not null)
  );
create unique index service_occurrence_series_date
  on app.service_occurrence (source_series_id, local_date) where source_series_id is not null;
create index service_occurrence_series_lookup
  on app.service_occurrence (source_series_id, starts_at) where source_series_id is not null;
alter table app.service_occurrence drop constraint service_source_kind;
alter table app.service_occurrence add constraint service_source_kind
  check (source_kind in ('one_off', 'recurring'));

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service',
  'request_church_archival', 'cancel_church_archival_request'
));
alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function app.materialize_service_series(p_series_id uuid, p_evaluated_at timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  series_row app.service_series%rowtype;
  local_today date;
  horizon date;
  inserted_count integer := 0;
  affected integer;
begin
  select * into series_row from app.service_series as series
  where series.id = p_series_id for update;
  if not found or series_row.status <> 'active' then return 0; end if;
  local_today := (p_evaluated_at at time zone series_row.timezone)::date;
  horizon := least(coalesce(series_row.ends_on, local_today + 90), local_today + 90);
  if series_row.materialized_through is not null
    and series_row.materialized_through >= horizon then return 0; end if;
  insert into app.service_occurrence (
    church_id, source_name, source_description, source_kind, source_series_id,
    local_date, local_start_time, starts_at, timezone, created_by
  )
  select series_row.church_id, series_row.source_name, series_row.source_description,
    'recurring', series_row.id, day::date, series_row.local_start_time,
    (day::date + series_row.local_start_time) at time zone series_row.timezone,
    series_row.timezone, series_row.created_by
  from generate_series(
    greatest(series_row.starts_on, local_today,
      coalesce(series_row.materialized_through + 1, local_today))::timestamp,
    horizon::timestamp,
    interval '1 day'
  ) as day
  where extract(dow from day)::smallint = any(series_row.weekdays)
    and ((day::date + series_row.local_start_time) at time zone series_row.timezone) > p_evaluated_at
  on conflict (source_series_id, local_date) where source_series_id is not null do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;
  update app.service_series set materialized_through = horizon
  where id = series_row.id;
  return inserted_count;
end;
$$;

create function api.create_recurring_service(
  p_church_id uuid, p_source_name text, p_source_description text,
  p_weekdays smallint[], p_local_start_time time, p_starts_on date,
  p_ends_on date, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  normalized_name text := btrim(coalesce(p_source_name, ''));
  normalized_description text := nullif(btrim(p_source_description), '');
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  created_series app.service_series%rowtype;
  materialized_count integer;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null or p_starts_on is null
    or p_local_start_time is null or p_weekdays is null
    or cardinality(p_weekdays) not between 1 and 7
    or not p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
    or cardinality(p_weekdays) <> (
      select count(distinct weekday.day) from unnest(p_weekdays) as weekday(day)
    )
    or (p_ends_on is not null and p_ends_on < p_starts_on)
    or char_length(normalized_name) not between 1 and 160
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_description is not null and (
      char_length(normalized_description) > 4000
      or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Recurring service input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'source_name', normalized_name,
    'source_description', normalized_description, 'weekdays', p_weekdays,
    'local_start_time', p_local_start_time, 'starts_on', p_starts_on,
    'ends_on', p_ends_on
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':create_recurring_service:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'create_recurring_service', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select * into church_row from app.church as church
  where church.public_id = p_church_id for update;
  if not found or church_row.status <> 'published'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if p_starts_on < (now() at time zone church_row.timezone)::date then
    raise exception using errcode = '22023', message = 'Recurring service must start in the future.';
  end if;
  insert into app.service_series (
    church_id, source_name, source_description, weekdays, local_start_time,
    timezone, starts_on, ends_on, created_by
  ) values (
    church_row.id, normalized_name, normalized_description, p_weekdays,
    p_local_start_time, church_row.timezone, p_starts_on, p_ends_on, actor_id
  ) returning * into created_series;
  materialized_count := app.materialize_service_series(created_series.id, now());
  update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = church_row.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (church_row.id, actor_id, 'service.series_created');
  result := jsonb_build_object(
    'status', 'created', 'church_id', church_row.public_id,
    'series_id', created_series.public_id, 'version', created_series.version,
    'materialized_count', materialized_count
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'create_recurring_service', p_client_key, input_digest, result);
  return result;
end;
$$;

create function api.service_schedule_worker_materialize()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  series_id uuid;
  materialized_count integer := 0;
begin
  for series_id in select id from app.service_series
    where status = 'active'
      and (ends_on is null or ends_on >= (now() at time zone timezone)::date)
  loop
    materialized_count := materialized_count + app.materialize_service_series(series_id, now());
  end loop;
  return materialized_count;
end;
$$;

revoke all on function app.materialize_service_series(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function api.create_recurring_service(uuid, text, text, smallint[], time, date, date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.create_recurring_service(uuid, text, text, smallint[], time, date, date, uuid)
  to authenticated;
revoke all on function api.service_schedule_worker_materialize()
  from public, anon, authenticated, service_role;
grant execute on function api.service_schedule_worker_materialize() to service_role;

comment on function api.service_schedule_worker_materialize() is
  'Idempotently fills a rolling 90-local-day window of concrete recurring church services.';
