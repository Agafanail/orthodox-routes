-- Edit source text from one concrete weekly slot onward without moving rides or service times.
alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'reschedule_recurring_service_date', 'update_recurring_service_date_content',
  'cancel_recurring_service_future', 'correct_church_content_translation',
  'request_church_archival', 'cancel_church_archival_request', 'update_church_public_contacts',
  'update_recurring_service_future_content'
));

create function api.preview_recurring_service_future_content(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  impact jsonb := api.preview_recurring_service_future_cancellation(p_service_id);
  source_fields jsonb;
begin
  select jsonb_build_object('source_name', series.source_name,
    'source_description', series.source_description,
    'schedule_updated_at', church.schedule_updated_at)
  into source_fields
  from app.service_occurrence as service
  join app.service_series as series on series.id = service.source_series_id
  join app.church as church on church.id = service.church_id
  where service.public_id = p_service_id;
  return impact || source_fields;
end;
$$;

create function api.update_recurring_service_future_content(
  p_service_id uuid, p_source_name text, p_source_description text,
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
  normalized_name text := btrim(coalesce(p_source_name, ''));
  normalized_description text := nullif(btrim(p_source_description), '');
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
  if p_service_id is null or p_client_key is null or p_expected_series_version is null
    or p_expected_series_version < 1 or p_expected_schedule_updated_at is null
    or char_length(normalized_name) not between 1 and 160 or normalized_name ~ '[[:cntrl:]]'
    or (normalized_description is not null and (
      char_length(normalized_description) > 4000
      or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Recurring service content input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'source_name', normalized_name,
    'source_description', normalized_description, 'expected_series_version', p_expected_series_version,
    'expected_schedule_updated_at', p_expected_schedule_updated_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':update_recurring_service_future_content:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_recurring_service_future_content', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  -- Match the materializer and existing schedule mutation lock order.
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
    raise exception using errcode = 'PT409', message = 'Schedule changed; reload the preview before editing.';
  end if;
  if selected_row.status <> 'scheduled' or selected_row.starts_at <= now()
    or series_row.materialized_through is null
    or series_row.materialized_through < selected_row.local_date then
    raise exception using errcode = '22023', message = 'Recurring service cannot be edited.';
  end if;

  source_changed := series_row.source_name is distinct from normalized_name
    or series_row.source_description is distinct from normalized_description;
  for service_row in
    select * from app.service_occurrence as service
    where service.source_series_id = series_row.id and service.local_date >= selected_row.local_date
      and service.status = 'scheduled' and service.starts_at > now()
      and (service.source_name is distinct from normalized_name
        or service.source_description is distinct from normalized_description)
    order by service.local_date, service.id for update
  loop
    -- Reuse the protected one-date path: exception history, translation invalidation,
    -- participant notifications, and unchanged ride snapshots stay in one implementation.
    perform api.update_recurring_service_date_content(service_row.public_id,
      normalized_name, normalized_description, service_row.version, gen_random_uuid());
    changed_count := changed_count + 1;
  end loop;
  if source_changed or changed_count > 0 then
    update app.service_series set source_name = normalized_name,
      source_description = normalized_description, version = version + 1,
      updated_at = clock_timestamp()
    where id = series_row.id returning * into series_row;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.content_updated');
  end if;
  result := jsonb_build_object('status', 'saved', 'series_id', series_row.public_id,
    'series_version', series_row.version, 'from_local_date', selected_row.local_date,
    'updated_service_count', changed_count);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_recurring_service_future_content', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_recurring_service_future_content(uuid),
  api.update_recurring_service_future_content(uuid, text, text, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_future_content(uuid),
  api.update_recurring_service_future_content(uuid, text, text, integer, timestamptz, uuid)
  to authenticated;

comment on function api.update_recurring_service_future_content(uuid, text, text, integer, timestamptz, uuid) is
  'Edits selected/later scheduled weekly slots and the future source; preserves earlier/cancelled dates, service times, and ride snapshots.';
