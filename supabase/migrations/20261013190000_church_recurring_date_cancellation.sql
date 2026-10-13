-- A one-date exception cancels one concrete occurrence, never the weekly source.
create table app.service_exception (
  id uuid primary key default gen_random_uuid(),
  source_series_id uuid not null references app.service_series (id) on delete restrict,
  service_occurrence_id uuid not null unique references app.service_occurrence (id) on delete restrict,
  local_date date not null,
  action text not null,
  original_starts_at timestamptz not null,
  created_by uuid references app.account (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint service_exception_action check (action = 'cancelled'),
  unique (source_series_id, local_date)
);
alter table app.service_exception enable row level security;
alter table app.service_exception force row level security;
revoke all on table app.service_exception from public, anon, authenticated, service_role;

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'request_church_archival', 'cancel_church_archival_request'
));
alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created', 'service.date_cancelled',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.preview_recurring_service_date_cancellation(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  service_row app.service_occurrence%rowtype;
  church_row app.church%rowtype;
  request_count integer;
  offer_count integer;
  response_count integer;
  agreement_count integer;
begin
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id and service.source_kind = 'recurring';
  select * into church_row from app.church as church
  where church.id = service_row.church_id;
  if service_row.id is null or church_row.status <> 'published'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  select count(*) into request_count from app.passenger_request as request
  where request.service_occurrence_id = service_row.id
    and request.status in ('active', 'partial', 'fulfilled', 'restore')
    and request.desired_arrival_at > now();
  select count(*) into offer_count from app.driver_offer_occurrence as offer
  where offer.service_occurrence_id = service_row.id
    and offer.status in ('active', 'full') and offer.arrival_at > now();
  select count(*) into response_count from app.ride_response as response
  join app.passenger_request as request on request.id = response.passenger_request_id
  join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
  where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
    and response.status in ('await_driver', 'await_passenger')
    and response.expires_at > now();
  select count(*) into agreement_count from app.ride_agreement as agreement
  join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
  join app.passenger_request as request on request.id = agreement.passenger_request_id
  join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
  where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
    and agreement.status in ('confirmed', 'change_pending')
    and snapshot.scheduled_arrival_at > now();
  return jsonb_build_object(
    'service_id', service_row.public_id, 'series_id', (
      select series.public_id from app.service_series as series
      where series.id = service_row.source_series_id
    ),
    'local_date', service_row.local_date, 'status', service_row.status,
    'version', service_row.version, 'passenger_requests', request_count,
    'driver_offers', offer_count, 'pending_responses', response_count,
    'agreements', agreement_count
  );
end;
$$;

create function api.cancel_recurring_service_date(
  p_service_id uuid, p_expected_version integer, p_client_key uuid
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
  recipient record;
  result jsonb;
begin
  if p_service_id is null or p_expected_version is null or p_expected_version < 1
    or p_client_key is null then
    raise exception using errcode = '22023', message = 'Service cancellation input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':cancel_recurring_service_date:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'cancel_recurring_service_date', p_client_key, input_digest
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
    raise exception using errcode = '40001', message = 'Service changed; reload it before cancelling.';
  end if;
  if service_row.status <> 'scheduled' or service_row.starts_at <= now() then
    raise exception using errcode = '22023', message = 'Service cannot be cancelled.';
  end if;

  insert into app.service_exception (
    source_series_id, service_occurrence_id, local_date, action,
    original_starts_at, created_by
  ) values (
    service_row.source_series_id, service_row.id, service_row.local_date,
    'cancelled', service_row.starts_at, actor_id
  );
  update app.service_occurrence as service
  set status = 'cancelled', version = service.version + 1, updated_at = clock_timestamp()
  where service.id = service_row.id returning * into service_row;
  update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = church_row.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (church_row.id, actor_id, 'service.date_cancelled');

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
      where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
        and response.status in ('await_driver', 'await_passenger')
        and response.expires_at > now()
      union
      select response.driver_account_id
      from app.ride_response as response
      join app.passenger_request as request on request.id = response.passenger_request_id
      join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
      where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
        and response.status in ('await_driver', 'await_passenger')
        and response.expires_at > now()
      union
      select agreement.passenger_account_id
      from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      join app.passenger_request as request on request.id = agreement.passenger_request_id
      join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
      where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
        and agreement.status in ('confirmed', 'change_pending')
        and snapshot.scheduled_arrival_at > now()
      union
      select agreement.driver_account_id
      from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      join app.passenger_request as request on request.id = agreement.passenger_request_id
      join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
      where (request.service_occurrence_id = service_row.id or offer.service_occurrence_id = service_row.id)
        and agreement.status in ('confirmed', 'change_pending')
        and snapshot.scheduled_arrival_at > now()
    ) as affected
  loop
    perform app.create_notification_once(
      recipient.account_id,
      'service:' || service_row.public_id::text || ':cancelled:' || service_row.version::text,
      'church.service.cancelled', 'service_occurrence', service_row.public_id,
      '/trips', 'church.service.cancelled', '{}'::jsonb, 50
    );
  end loop;
  result := jsonb_build_object(
    'status', 'cancelled', 'service_id', service_row.public_id,
    'series_id', (select public_id from app.service_series where id = service_row.source_series_id),
    'local_date', service_row.local_date, 'version', service_row.version
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'cancel_recurring_service_date', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_recurring_service_date_cancellation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_recurring_service_date_cancellation(uuid) to authenticated;
revoke all on function api.cancel_recurring_service_date(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.cancel_recurring_service_date(uuid, integer, uuid) to authenticated;

comment on function api.cancel_recurring_service_date(uuid, integer, uuid) is
  'Cancels only one future recurring service date, preserving the weekly source and ride snapshots.';
