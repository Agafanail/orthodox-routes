-- A cancelled service remains visible, while existing ride and agreement snapshots stay unchanged.
alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content',
  'create_one_off_service', 'cancel_one_off_service'
));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'service.created', 'service.cancelled',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.preview_one_off_service_cancellation(p_service_id uuid)
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
  where service.public_id = p_service_id and service.source_kind = 'one_off';
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
    'service_id', service_row.public_id, 'status', service_row.status,
    'version', service_row.version, 'passenger_requests', request_count,
    'driver_offers', offer_count, 'pending_responses', response_count,
    'agreements', agreement_count
  );
end;
$$;

create function api.cancel_one_off_service(
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
    actor_id::text || ':cancel_one_off_service:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'cancel_one_off_service', p_client_key, input_digest
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
    raise exception using errcode = '40001', message = 'Service changed; reload it before cancelling.';
  end if;
  if service_row.status <> 'scheduled' or service_row.starts_at <= now() then
    raise exception using errcode = '22023', message = 'Service cannot be cancelled.';
  end if;

  update app.service_occurrence as service
  set status = 'cancelled', version = service.version + 1, updated_at = clock_timestamp()
  where service.id = service_row.id returning * into service_row;
  update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = church_row.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (church_row.id, actor_id, 'service.cancelled');

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
      '/churches/' || church_row.slug, 'church.service.cancelled', '{}'::jsonb, 50
    );
  end loop;
  result := jsonb_build_object(
    'status', 'cancelled', 'service_id', service_row.public_id, 'version', service_row.version
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'cancel_one_off_service', p_client_key, input_digest, result);
  return result;
end;
$$;

create function app.reject_cancelled_service_participation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status not in ('await_driver', 'await_passenger', 'accepted') then
    return new;
  end if;
  -- Serialize new responses and confirmations with cancellation so neither side misses the other.
  perform 1 from app.service_occurrence as service
  where service.id in (
    select request.service_occurrence_id from app.passenger_request as request
    where request.id = new.passenger_request_id
    union
    select offer.service_occurrence_id from app.driver_offer_occurrence as offer
    where offer.id = new.driver_occurrence_id
  ) for share;
  if exists (
    select 1 from app.passenger_request as request
    join app.service_occurrence as service on service.id = request.service_occurrence_id
    where request.id = new.passenger_request_id and service.status = 'cancelled'
  ) or exists (
    select 1 from app.driver_offer_occurrence as offer
    join app.service_occurrence as service on service.id = offer.service_occurrence_id
    where offer.id = new.driver_occurrence_id and service.status = 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'The linked service was cancelled.';
  end if;
  return new;
end;
$$;

create trigger ride_response_reject_cancelled_service
before insert or update of status on app.ride_response
for each row execute function app.reject_cancelled_service_participation();

create trigger ride_agreement_reject_cancelled_service
before insert on app.ride_agreement
for each row execute function app.reject_cancelled_service_participation();

-- Cancelled services may still anchor unchanged trips, but they never seed new automatic suggestions.
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
      and request.service_occurrence_id = occurrence.service_occurrence_id)
    or occurrence.arrival_at between
      request.desired_arrival_at - app.arrival_window_earliest()
      and request.desired_arrival_at + app.arrival_window_latest()
  )
  and not app.accounts_are_blocked(request.author_account_id, occurrence.author_account_id);

revoke all on function api.preview_one_off_service_cancellation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_one_off_service_cancellation(uuid) to authenticated;
revoke all on function api.cancel_one_off_service(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.cancel_one_off_service(uuid, integer, uuid) to authenticated;
revoke all on table app.quality_match_candidate from public, anon, authenticated, service_role;
revoke all on function app.reject_cancelled_service_participation()
  from public, anon, authenticated, service_role;

comment on function api.cancel_one_off_service(uuid, integer, uuid) is
  'Cancels a future one-off service, leaves ride snapshots unchanged, and notifies affected accounts atomically.';
