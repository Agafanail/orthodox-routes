-- Time edits create a new schedule generation without changing existing ride snapshots.
alter table app.service_occurrence
  add column schedule_generation integer not null default 1,
  add constraint service_schedule_generation_positive check (schedule_generation > 0);
alter table app.passenger_request add column service_generation_snapshot integer;
alter table app.driver_offer_occurrence add column service_generation_snapshot integer;
update app.passenger_request as request
set service_generation_snapshot = service.schedule_generation
from app.service_occurrence as service
where request.service_occurrence_id = service.id;
update app.driver_offer_occurrence as offer
set service_generation_snapshot = service.schedule_generation
from app.service_occurrence as service
where offer.service_occurrence_id = service.id;
alter table app.passenger_request add constraint passenger_service_generation_consistent check (
  (service_occurrence_id is null) = (service_generation_snapshot is null)
);
alter table app.driver_offer_occurrence add constraint driver_service_generation_consistent check (
  (service_occurrence_id is null) = (service_generation_snapshot is null)
);

create function app.capture_service_generation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.service_occurrence_id is not distinct from old.service_occurrence_id then
    new.service_generation_snapshot := old.service_generation_snapshot;
  elsif new.service_occurrence_id is null then
    new.service_generation_snapshot := null;
  else
    select service.schedule_generation into new.service_generation_snapshot
    from app.service_occurrence as service where service.id = new.service_occurrence_id;
    if new.service_generation_snapshot is null then
      raise exception using errcode = 'P0002', message = 'The linked service is unavailable.';
    end if;
  end if;
  return new;
end;
$$;
create trigger passenger_capture_service_generation
before insert or update of service_occurrence_id, service_generation_snapshot on app.passenger_request
for each row execute function app.capture_service_generation();
create trigger driver_capture_service_generation
before insert or update of service_occurrence_id, service_generation_snapshot on app.driver_offer_occurrence
for each row execute function app.capture_service_generation();

-- The same service ID no longer means the same intended date after a time edit.
create or replace view app.quality_match_candidate
with (security_invoker = false) as
select
  request.id as request_id,
  request.public_id as request_public_id,
  request.author_account_id as passenger_account_id,
  occurrence.id as occurrence_id,
  occurrence.public_id as occurrence_public_id,
  occurrence.author_account_id as driver_account_id,
  occurrence.church_id,
  occurrence.origin_place_id,
  occurrence.max_detour_km,
  request.remaining_passengers,
  occurrence.total_seats - occurrence.confirmed_seats as available_seats,
  request.desired_arrival_at,
  occurrence.arrival_at,
  occurrence.departure_at,
  occurrence.timezone
from app.passenger_request as request
join app.driver_offer_occurrence as occurrence
  on occurrence.church_id = request.church_id
where request.status in ('active', 'partial')
  and request.remaining_passengers > 0
  and request.desired_arrival_at > clock_timestamp()
  and occurrence.status = 'active'
  and occurrence.arrival_at > clock_timestamp()
  and occurrence.total_seats > occurrence.confirmed_seats
  and request.author_account_id <> occurrence.author_account_id
  and occurrence.total_seats - occurrence.confirmed_seats >= request.remaining_passengers
  and (request.children_count = 0 or occurrence.children_allowed)
  and (not request.child_seat_required or occurrence.driver_child_seat_available)
  and not exists (
    select 1 from app.service_occurrence as service
    where service.id in (request.service_occurrence_id, occurrence.service_occurrence_id)
      and service.status <> 'scheduled'
  )
  and (
    (request.service_occurrence_id is not null
      and request.service_occurrence_id = occurrence.service_occurrence_id
      and request.service_generation_snapshot = occurrence.service_generation_snapshot)
    or ((request.service_occurrence_id is null or occurrence.service_occurrence_id is null
        or request.service_occurrence_id <> occurrence.service_occurrence_id)
      and occurrence.arrival_at between
        request.desired_arrival_at - app.arrival_window_earliest()
        and request.desired_arrival_at + app.arrival_window_latest())
  )
  and not app.accounts_are_blocked(request.author_account_id, occurrence.author_account_id);

create or replace function app.reject_cancelled_service_participation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_service_id uuid;
  offer_service_id uuid;
  request_generation integer;
  offer_generation integer;
begin
  if tg_op = 'UPDATE' and new.status not in ('await_driver', 'await_passenger', 'accepted') then
    return new;
  end if;
  perform 1 from app.service_occurrence as service
  where service.id in (
    select request.service_occurrence_id from app.passenger_request as request
    where request.id = new.passenger_request_id
    union
    select offer.service_occurrence_id from app.driver_offer_occurrence as offer
    where offer.id = new.driver_occurrence_id
  ) for share;
  select request.service_occurrence_id, request.service_generation_snapshot
  into request_service_id, request_generation
  from app.passenger_request as request where request.id = new.passenger_request_id;
  select offer.service_occurrence_id, offer.service_generation_snapshot
  into offer_service_id, offer_generation
  from app.driver_offer_occurrence as offer where offer.id = new.driver_occurrence_id;
  if exists (
    select 1 from app.service_occurrence as service
    where service.id in (request_service_id, offer_service_id) and service.status = 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'The linked service was cancelled.';
  end if;
  if request_service_id is not null and request_service_id = offer_service_id
    and request_generation is distinct from offer_generation then
    raise exception using errcode = '22023', message = 'The linked service changed; review the ride.';
  end if;
  return new;
end;
$$;

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'request_church_archival', 'cancel_church_archival_request'
));
alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.update_one_off_service_time(
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
    actor_id::text || ':update_one_off_service_time:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_one_off_service_time', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select church.* into church_row from app.church as church
  join app.service_occurrence as service on service.church_id = church.id
  where service.public_id = p_service_id for update of church;
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id for update;
  if church_row.id is null or church_row.status <> 'published'
    or service_row.source_kind <> 'one_off'
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
    update app.service_occurrence as service
    set starts_at = p_starts_at, version = service.version + 1,
      schedule_generation = service.schedule_generation + 1,
      updated_at = clock_timestamp()
    where service.id = service_row.id returning * into service_row;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.rescheduled');

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
  result := jsonb_build_object('status', 'saved', 'service_id', service_row.public_id,
    'starts_at', service_row.starts_at, 'version', service_row.version,
    'schedule_generation', service_row.schedule_generation);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_one_off_service_time', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.update_one_off_service_time(uuid, timestamptz, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.update_one_off_service_time(uuid, timestamptz, integer, uuid)
  to authenticated;
revoke all on function app.capture_service_generation()
  from public, anon, authenticated, service_role;
revoke all on table app.quality_match_candidate from public, anon, authenticated, service_role;

comment on function api.update_one_off_service_time(uuid, timestamptz, integer, uuid) is
  'Reschedules a future one-off service without moving existing rides; new listings use a new schedule generation.';
