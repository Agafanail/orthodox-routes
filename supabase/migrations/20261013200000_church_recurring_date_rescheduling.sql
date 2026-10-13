-- One recurring date may move without changing its source weekday or old ride snapshots.
alter table app.service_exception
  add column replacement_starts_at timestamptz,
  add column version integer not null default 1,
  add column updated_by uuid references app.account (id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add constraint service_exception_version_positive check (version > 0),
  add constraint service_exception_replacement_shape check (
    (action = 'cancelled' and replacement_starts_at is null)
    or (action = 'rescheduled' and replacement_starts_at is not null)
  );
alter table app.service_exception drop constraint service_exception_action;
alter table app.service_exception add constraint service_exception_action
  check (action in ('cancelled', 'rescheduled'));
alter table app.service_exception
  drop constraint service_exception_service_occurrence_id_key,
  drop constraint service_exception_source_series_id_local_date_key;
create index service_exception_occurrence_history
  on app.service_exception (service_occurrence_id, created_at desc);
create index service_exception_source_date_history
  on app.service_exception (source_series_id, local_date, created_at desc);

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'reschedule_recurring_service_date',
  'request_church_archival', 'cancel_church_archival_request'
));
alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created', 'service.date_cancelled', 'service.date_rescheduled',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.preview_recurring_service_date_edit(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  impact jsonb;
  service_row app.service_occurrence%rowtype;
begin
  impact := api.preview_recurring_service_date_cancellation(p_service_id);
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id;
  return impact || jsonb_build_object(
    'source_name', service_row.source_name,
    'source_description', service_row.source_description,
    'starts_at', service_row.starts_at,
    'timezone', service_row.timezone,
    'schedule_generation', service_row.schedule_generation
  );
end;
$$;

create function api.reschedule_recurring_service_date(
  p_service_id uuid, p_starts_at timestamptz, p_expected_version integer, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  service_row app.service_occurrence%rowtype;
  exception_row app.service_exception%rowtype;
  recipient record;
  result jsonb;
begin
  if p_service_id is null or p_starts_at is null or p_expected_version is null
    or p_expected_version < 1 or p_client_key is null then
    raise exception using errcode = '22023', message = 'Service rescheduling input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'starts_at', p_starts_at,
    'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':reschedule_recurring_service_date:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'reschedule_recurring_service_date', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select church.* into church_row from app.church as church
  join app.service_occurrence as service on service.church_id = church.id
  where service.public_id = p_service_id for update of church;
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id for update;
  if church_row.id is null or church_row.status <> 'published'
    or service_row.source_kind <> 'recurring'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if service_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Service changed; reload it before rescheduling.';
  end if;
  if service_row.status <> 'scheduled' or service_row.starts_at <= now()
    or p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'Service cannot be rescheduled.';
  end if;

  if service_row.starts_at is distinct from p_starts_at then
    select * into exception_row from app.service_exception as date_exception
    where date_exception.service_occurrence_id = service_row.id
      and date_exception.action = 'rescheduled' for update;
    if exception_row.id is null then
      insert into app.service_exception (
        source_series_id, service_occurrence_id, local_date, action,
        original_starts_at, replacement_starts_at, created_by, updated_by
      ) values (
        service_row.source_series_id, service_row.id, service_row.local_date,
        'rescheduled', service_row.starts_at, p_starts_at, actor_id, actor_id
      );
    else
      update app.service_exception
      set replacement_starts_at = p_starts_at, version = version + 1,
        updated_by = actor_id, updated_at = clock_timestamp()
      where id = exception_row.id;
    end if;
    update app.service_occurrence as service
    set starts_at = p_starts_at, version = service.version + 1,
      schedule_generation = service.schedule_generation + 1,
      updated_at = clock_timestamp()
    where service.id = service_row.id returning * into service_row;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.date_rescheduled');

    for recipient in
      select distinct affected.account_id from (
        select request.author_account_id as account_id
        from app.passenger_request as request
        where request.service_occurrence_id = service_row.id
          and request.status in ('active', 'partial', 'fulfilled', 'restore')
          and request.desired_arrival_at > now()
        union
        select offer.author_account_id
        from app.driver_offer_occurrence as offer
        where offer.service_occurrence_id = service_row.id
          and offer.status in ('active', 'full') and offer.arrival_at > now()
        union
        select response.passenger_account_id
        from app.ride_response as response
        join app.passenger_request as request on request.id = response.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select response.driver_account_id
        from app.ride_response as response
        join app.passenger_request as request on request.id = response.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select agreement.passenger_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
        union
        select agreement.driver_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
      ) as affected
    loop
      perform app.create_notification_once(
        recipient.account_id,
        'service:' || service_row.public_id::text || ':rescheduled:' || service_row.version::text,
        'church.service.rescheduled', 'service_occurrence', service_row.public_id,
        '/trips', 'church.service.rescheduled', '{}'::jsonb, 50
      );
    end loop;
  end if;
  result := jsonb_build_object(
    'status', 'saved', 'service_id', service_row.public_id,
    'local_date', service_row.local_date, 'starts_at', service_row.starts_at,
    'version', service_row.version,
    'schedule_generation', service_row.schedule_generation
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'reschedule_recurring_service_date', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_recurring_service_date_edit(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_date_edit(uuid) to authenticated;
revoke all on function api.reschedule_recurring_service_date(uuid, timestamptz, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.reschedule_recurring_service_date(uuid, timestamptz, integer, uuid)
  to authenticated;

comment on function api.reschedule_recurring_service_date(uuid, timestamptz, integer, uuid) is
  'Moves only one future recurring service date; old and new ride listings retain separate generations.';
