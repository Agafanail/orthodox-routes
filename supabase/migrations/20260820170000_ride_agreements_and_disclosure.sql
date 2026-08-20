alter table private.transport_operation
  drop constraint transport_operation_type,
  add constraint transport_operation_type check (operation_type in (
    'publish_passenger_request',
    'publish_driver_occurrence',
    'publish_driver_series',
    'cancel_passenger_request',
    'cancel_driver_occurrence',
    'stop_driver_series',
    'submit_passenger_response',
    'submit_driver_response',
    'answer_passenger_response',
    'confirm_ride_response',
    'decline_ride_response',
    'withdraw_ride_response',
    'cancel_ride_agreement',
    'restore_passenger_request'
  ));

create table app.ride_condition_snapshot (
  id uuid primary key default gen_random_uuid(),
  passenger_request_id uuid not null references app.passenger_request (id) on delete restrict,
  driver_occurrence_id uuid not null references app.driver_offer_occurrence (id) on delete restrict,
  church_id uuid not null references app.church (id) on delete restrict,
  selected_request_place_id uuid references private.user_place (id) on delete restrict,
  passenger_count smallint not null,
  scheduled_arrival_at timestamptz not null,
  timezone text not null,
  children_count smallint not null,
  child_seat_required boolean not null,
  children_allowed boolean not null,
  driver_child_seat_available boolean not null,
  passenger_return_required boolean not null,
  driver_return_available boolean not null,
  max_detour_km smallint not null,
  request_content_version integer not null,
  occurrence_conditions_version integer not null,
  created_at timestamptz not null default now(),
  constraint ride_snapshot_passengers check (passenger_count between 1 and 55),
  constraint ride_snapshot_children check (children_count between 0 and passenger_count),
  constraint ride_snapshot_detour check (max_detour_km in (0, 2, 5, 10, 15, 20)),
  constraint ride_snapshot_versions check (request_content_version > 0 and occurrence_conditions_version > 0)
);

create table app.ride_response (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  direction text not null,
  passenger_account_id uuid not null references app.account (id) on delete restrict,
  driver_account_id uuid not null references app.account (id) on delete restrict,
  passenger_request_id uuid not null references app.passenger_request (id) on delete restrict,
  driver_occurrence_id uuid not null references app.driver_offer_occurrence (id) on delete restrict,
  selected_request_place_id uuid references private.user_place (id) on delete restrict,
  offered_passenger_count smallint not null,
  conditions_snapshot_id uuid not null references app.ride_condition_snapshot (id) on delete restrict,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint ride_response_direction check (direction in ('passenger_to_driver', 'driver_to_passenger')),
  constraint ride_response_distinct_participants check (passenger_account_id <> driver_account_id),
  constraint ride_response_count check (offered_passenger_count between 1 and 55),
  constraint ride_response_status check (status in ('draft', 'await_driver', 'await_passenger', 'accepted', 'declined', 'withdrawn', 'expired', 'stale')),
  constraint ride_response_selected_place check (
    (status in ('draft', 'await_driver') and selected_request_place_id is null)
    or (status in ('await_passenger', 'accepted') and selected_request_place_id is not null)
    or status in ('declined', 'withdrawn', 'expired', 'stale')
  )
);

create unique index ride_response_pending_pair
  on app.ride_response (passenger_account_id, driver_account_id, passenger_request_id, driver_occurrence_id)
  where status in ('await_driver', 'await_passenger');

create index ride_response_participant_passenger
  on app.ride_response (passenger_account_id, updated_at desc);

create index ride_response_participant_driver
  on app.ride_response (driver_account_id, updated_at desc);

create table app.ride_agreement (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  response_id uuid not null unique references app.ride_response (id) on delete restrict,
  driver_occurrence_id uuid not null references app.driver_offer_occurrence (id) on delete restrict,
  passenger_request_id uuid not null references app.passenger_request (id) on delete restrict,
  driver_account_id uuid not null references app.account (id) on delete restrict,
  passenger_account_id uuid not null references app.account (id) on delete restrict,
  confirmed_passenger_count smallint not null,
  active_snapshot_id uuid not null references app.ride_condition_snapshot (id) on delete restrict,
  selected_exact_place_id uuid not null references private.user_place (id) on delete restrict,
  status text not null default 'confirmed',
  contact_visible_until timestamptz not null,
  exact_data_delete_due_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_account_id uuid references app.account (id) on delete restrict,
  completed_at timestamptz,
  archived_at timestamptz,
  constraint ride_agreement_distinct_participants check (driver_account_id <> passenger_account_id),
  constraint ride_agreement_count check (confirmed_passenger_count between 1 and 55),
  constraint ride_agreement_status check (status in ('confirmed', 'change_pending', 'cancelled', 'completed', 'outcome', 'no_outcome', 'archived')),
  constraint ride_agreement_cancelled_state check (status <> 'cancelled' or cancelled_at is not null),
  constraint ride_agreement_cancelled_history check (cancelled_at is null or status in ('cancelled', 'archived')),
  constraint ride_agreement_cancel_actor check (cancelled_at is null or cancelled_by_account_id in (driver_account_id, passenger_account_id)),
  constraint ride_agreement_visibility_order check (contact_visible_until <= exact_data_delete_due_at)
);

create index ride_agreement_passenger_history
  on app.ride_agreement (passenger_account_id, confirmed_at desc);

create index ride_agreement_driver_history
  on app.ride_agreement (driver_account_id, confirmed_at desc);

create unique index ride_agreement_active_logical_pair
  on app.ride_agreement (passenger_request_id, driver_occurrence_id, passenger_account_id, driver_account_id)
  where status in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome');

create table private.agreement_contact_snapshot (
  agreement_id uuid not null references app.ride_agreement (id) on delete cascade,
  participant_account_id uuid not null references app.account (id) on delete restrict,
  email_normalized text not null,
  phone_e164 text not null,
  email_verified_at timestamptz not null,
  phone_verified_at timestamptz not null,
  visible_until timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (agreement_id, participant_account_id),
  constraint agreement_contact_email check (email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''),
  constraint agreement_contact_phone check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint agreement_contact_deleted_order check (deleted_at is null or deleted_at >= created_at)
);

create table app.agreement_event (
  id bigint generated always as identity primary key,
  agreement_id uuid not null references app.ride_agreement (id) on delete cascade,
  actor_account_id uuid references app.account (id) on delete restrict,
  event_type text not null,
  created_at timestamptz not null default now(),
  constraint agreement_event_type check (event_type in ('confirmed', 'cancelled', 'completed', 'no_outcome', 'archived'))
);

alter table app.ride_condition_snapshot enable row level security;
alter table app.ride_condition_snapshot force row level security;
alter table app.ride_response enable row level security;
alter table app.ride_response force row level security;
alter table app.ride_agreement enable row level security;
alter table app.ride_agreement force row level security;
alter table private.agreement_contact_snapshot enable row level security;
alter table private.agreement_contact_snapshot force row level security;
alter table app.agreement_event enable row level security;
alter table app.agreement_event force row level security;

revoke all on table app.ride_condition_snapshot, app.ride_response, app.ride_agreement,
  private.agreement_contact_snapshot, app.agreement_event
from public, anon, authenticated, service_role;

create function app.prevent_immutable_ride_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Ride condition snapshots are immutable.';
end;
$$;

create trigger prevent_ride_snapshot_update
before update or delete on app.ride_condition_snapshot
for each row execute function app.prevent_immutable_ride_snapshot_change();

create function app.enforce_ride_response_relationships()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_author uuid;
  request_church uuid;
  occurrence_author uuid;
  occurrence_church uuid;
  snapshot_request uuid;
  snapshot_occurrence uuid;
  snapshot_place uuid;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.public_id <> old.public_id or new.direction <> old.direction
    or new.passenger_account_id <> old.passenger_account_id or new.driver_account_id <> old.driver_account_id
    or new.passenger_request_id <> old.passenger_request_id or new.driver_occurrence_id <> old.driver_occurrence_id
    or new.created_at <> old.created_at
  ) then
    raise exception using errcode = '23514', message = 'Ride response identity and actors are immutable.';
  end if;

  select request.author_account_id, request.church_id into request_author, request_church
  from app.passenger_request as request where request.id = new.passenger_request_id;
  select occurrence.author_account_id, occurrence.church_id into occurrence_author, occurrence_church
  from app.driver_offer_occurrence as occurrence where occurrence.id = new.driver_occurrence_id;
  select snapshot.passenger_request_id, snapshot.driver_occurrence_id, snapshot.selected_request_place_id
  into snapshot_request, snapshot_occurrence, snapshot_place
  from app.ride_condition_snapshot as snapshot where snapshot.id = new.conditions_snapshot_id;

  if request_author is distinct from new.passenger_account_id
    or occurrence_author is distinct from new.driver_account_id
    or request_church is distinct from occurrence_church
    or snapshot_request is distinct from new.passenger_request_id
    or snapshot_occurrence is distinct from new.driver_occurrence_id
    or snapshot_place is distinct from new.selected_request_place_id
  then
    raise exception using errcode = '23514', message = 'Ride response relationships are inconsistent.';
  end if;
  if new.selected_request_place_id is not null and not exists (
    select 1 from app.passenger_request_place as link
    where link.request_id = new.passenger_request_id and link.user_place_id = new.selected_request_place_id
  ) then
    raise exception using errcode = '23514', message = 'The selected meeting place does not belong to the request.';
  end if;
  return new;
end;
$$;

create trigger enforce_ride_response_relationships
before insert or update on app.ride_response
for each row execute function app.enforce_ride_response_relationships();

create function app.enforce_ride_agreement_relationships()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  response app.ride_response%rowtype;
  occurrence_arrival timestamptz;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.public_id <> old.public_id or new.response_id <> old.response_id
    or new.driver_occurrence_id <> old.driver_occurrence_id or new.passenger_request_id <> old.passenger_request_id
    or new.driver_account_id <> old.driver_account_id or new.passenger_account_id <> old.passenger_account_id
    or new.confirmed_passenger_count <> old.confirmed_passenger_count
    or new.active_snapshot_id <> old.active_snapshot_id or new.selected_exact_place_id <> old.selected_exact_place_id
    or new.confirmed_at <> old.confirmed_at
  ) then
    raise exception using errcode = '23514', message = 'Confirmed agreement identity and conditions are immutable.';
  end if;
  select * into response from app.ride_response where id = new.response_id;
  select occurrence.arrival_at into occurrence_arrival
  from app.driver_offer_occurrence as occurrence where occurrence.id = new.driver_occurrence_id;
  if response.status <> 'accepted'
    or response.driver_occurrence_id <> new.driver_occurrence_id
    or response.passenger_request_id <> new.passenger_request_id
    or response.driver_account_id <> new.driver_account_id
    or response.passenger_account_id <> new.passenger_account_id
    or response.offered_passenger_count <> new.confirmed_passenger_count
    or response.conditions_snapshot_id <> new.active_snapshot_id
    or response.selected_request_place_id <> new.selected_exact_place_id
    or new.contact_visible_until > occurrence_arrival + interval '30 days'
    or new.exact_data_delete_due_at > occurrence_arrival + interval '30 days'
  then
    raise exception using errcode = '23514', message = 'Agreement relationships are inconsistent.';
  end if;
  return new;
end;
$$;

create trigger enforce_ride_agreement_relationships
before insert or update on app.ride_agreement
for each row execute function app.enforce_ride_agreement_relationships();

create function app.enforce_agreement_contact_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  agreement app.ride_agreement%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Agreement contacts must be anonymized through lifecycle processing.';
  end if;
  select * into agreement from app.ride_agreement where id = new.agreement_id;
  if agreement.id is null
    or new.participant_account_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or new.visible_until > agreement.contact_visible_until
  then
    raise exception using errcode = '23514', message = 'Agreement contact relationships are inconsistent.';
  end if;
  if tg_op = 'UPDATE' then
    if new.agreement_id <> old.agreement_id
      or new.participant_account_id <> old.participant_account_id
      or new.email_verified_at <> old.email_verified_at
      or new.phone_verified_at <> old.phone_verified_at
      or new.visible_until <> old.visible_until
      or new.created_at <> old.created_at
      or old.deleted_at is not null
      or new.deleted_at is null
      or agreement.status <> 'archived'
    then
      raise exception using errcode = '55000', message = 'Agreement contact snapshots are immutable before archival.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_agreement_contact_snapshot
before insert or update or delete on private.agreement_contact_snapshot
for each row execute function app.enforce_agreement_contact_snapshot();

create function app.create_ride_snapshot(
  requested_request_id uuid,
  requested_occurrence_id uuid,
  requested_place_id uuid,
  requested_passenger_count integer
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  snapshot_id uuid;
begin
  insert into app.ride_condition_snapshot (
    passenger_request_id, driver_occurrence_id, church_id, selected_request_place_id,
    passenger_count, scheduled_arrival_at, timezone, children_count, child_seat_required,
    children_allowed, driver_child_seat_available, passenger_return_required,
    driver_return_available, max_detour_km, request_content_version, occurrence_conditions_version
  )
  select
    request.id, occurrence.id, request.church_id, requested_place_id,
    requested_passenger_count, request.desired_arrival_at, request.timezone,
    least(request.children_count, requested_passenger_count), request.child_seat_required,
    occurrence.children_allowed, occurrence.driver_child_seat_available, request.return_required,
    occurrence.return_available, occurrence.max_detour_km, request.content_version, occurrence.conditions_version
  from app.passenger_request as request
  join app.driver_offer_occurrence as occurrence on occurrence.id = requested_occurrence_id
  where request.id = requested_request_id
  returning id into snapshot_id;
  if snapshot_id is null then
    raise exception using errcode = 'P0002', message = 'Ride source is unavailable.';
  end if;
  return snapshot_id;
end;
$$;

create function app.lock_compatible_ride_sources(
  requested_request_id uuid,
  requested_occurrence_id uuid
)
returns table (
  passenger_account_id uuid,
  driver_account_id uuid,
  request_remaining integer,
  occurrence_available integer,
  expires_at timestamptz
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  request app.passenger_request%rowtype;
  occurrence app.driver_offer_occurrence%rowtype;
begin
  select * into request from app.passenger_request where id = requested_request_id for update;
  select * into occurrence from app.driver_offer_occurrence where id = requested_occurrence_id for update;
  if request.id is null or occurrence.id is null
    or request.status not in ('active', 'partial') or request.remaining_passengers <= 0
    or occurrence.status <> 'active' or occurrence.confirmed_seats >= occurrence.total_seats
    or request.desired_arrival_at <= clock_timestamp() or occurrence.arrival_at <= clock_timestamp()
    or request.church_id <> occurrence.church_id
    or abs(extract(epoch from request.desired_arrival_at - occurrence.arrival_at)) > 3600
    or (request.children_count > 0 and not occurrence.children_allowed)
    or (request.child_seat_required and not occurrence.driver_child_seat_available)
    or request.author_account_id = occurrence.author_account_id
    or exists (
      select 1 from app.ride_agreement as agreement
      where agreement.passenger_request_id = request.id
        and agreement.driver_occurrence_id = occurrence.id
        and agreement.passenger_account_id = request.author_account_id
        and agreement.driver_account_id = occurrence.author_account_id
        and agreement.status in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
    )
  then
    raise exception using errcode = '22023', message = 'The ride sources are not currently compatible.';
  end if;
  passenger_account_id := request.author_account_id;
  driver_account_id := occurrence.author_account_id;
  request_remaining := request.remaining_passengers;
  occurrence_available := occurrence.total_seats - occurrence.confirmed_seats;
  expires_at := least(request.desired_arrival_at, occurrence.arrival_at);
  return next;
end;
$$;

create function app.assert_response_participants_eligible(passenger_id uuid, driver_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if not coalesce((app.current_eligibility_result(passenger_id)->>'eligible')::boolean, false)
    or not coalesce((app.current_eligibility_result(driver_id)->>'eligible')::boolean, false)
  then
    raise exception using errcode = '42501', message = 'Both participants must remain eligible.';
  end if;
  return true;
end;
$$;

create function api.submit_passenger_response(
  p_request_id uuid,
  p_occurrence_id uuid,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('request', p_request_id, 'occurrence', p_occurrence_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  request_internal_id uuid;
  occurrence_internal_id uuid;
  sources record;
  snapshot_id uuid;
  response_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':submit_passenger_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'submit_passenger_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select id into request_internal_id from app.passenger_request where public_id = p_request_id;
  select id into occurrence_internal_id from app.driver_offer_occurrence where public_id = p_occurrence_id;
  select * into sources from app.lock_compatible_ride_sources(request_internal_id, occurrence_internal_id);
  if sources.passenger_account_id <> actor_id then
    raise exception using errcode = '42501', message = 'The passenger request is unavailable.';
  end if;
  perform app.assert_response_participants_eligible(sources.passenger_account_id, sources.driver_account_id);
  snapshot_id := app.create_ride_snapshot(request_internal_id, occurrence_internal_id, null, sources.request_remaining);
  insert into app.ride_response (
    direction, passenger_account_id, driver_account_id, passenger_request_id,
    driver_occurrence_id, offered_passenger_count, conditions_snapshot_id,
    status, expires_at
  ) values (
    'passenger_to_driver', sources.passenger_account_id, sources.driver_account_id,
    request_internal_id, occurrence_internal_id, sources.request_remaining,
    snapshot_id, 'await_driver', sources.expires_at
  ) returning public_id into response_public_id;
  result := jsonb_build_object('response_id', response_public_id, 'status', 'await_driver');
  insert into private.transport_operation values (actor_id, 'submit_passenger_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.submit_driver_response(
  p_request_id uuid,
  p_occurrence_id uuid,
  p_place_id uuid,
  p_offered_passenger_count integer,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('request', p_request_id, 'occurrence', p_occurrence_id, 'place', p_place_id, 'count', p_offered_passenger_count);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  request_internal_id uuid;
  occurrence_internal_id uuid;
  place_internal_id uuid;
  sources record;
  snapshot_id uuid;
  response_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':submit_driver_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'submit_driver_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select id into request_internal_id from app.passenger_request where public_id = p_request_id;
  select id into occurrence_internal_id from app.driver_offer_occurrence where public_id = p_occurrence_id;
  select place.id into place_internal_id
  from private.user_place as place
  join app.passenger_request_place as link on link.user_place_id = place.id
  where place.public_id = p_place_id and link.request_id = request_internal_id;
  select * into sources from app.lock_compatible_ride_sources(request_internal_id, occurrence_internal_id);
  if sources.driver_account_id <> actor_id then
    raise exception using errcode = '42501', message = 'The driver occurrence is unavailable.';
  end if;
  if place_internal_id is null or p_offered_passenger_count not between 1 and least(sources.request_remaining, sources.occurrence_available) then
    raise exception using errcode = '22023', message = 'The offered conditions are invalid.';
  end if;
  perform app.assert_response_participants_eligible(sources.passenger_account_id, sources.driver_account_id);
  snapshot_id := app.create_ride_snapshot(request_internal_id, occurrence_internal_id, place_internal_id, p_offered_passenger_count);
  insert into app.ride_response (
    direction, passenger_account_id, driver_account_id, passenger_request_id,
    driver_occurrence_id, selected_request_place_id, offered_passenger_count,
    conditions_snapshot_id, status, expires_at
  ) values (
    'driver_to_passenger', sources.passenger_account_id, sources.driver_account_id,
    request_internal_id, occurrence_internal_id, place_internal_id, p_offered_passenger_count,
    snapshot_id, 'await_passenger', sources.expires_at
  ) returning public_id into response_public_id;
  result := jsonb_build_object('response_id', response_public_id, 'status', 'await_passenger');
  insert into private.transport_operation values (actor_id, 'submit_driver_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.answer_passenger_response(
  p_response_id uuid,
  p_place_id uuid,
  p_offered_passenger_count integer,
  p_accept boolean,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('response', p_response_id, 'place', p_place_id, 'count', p_offered_passenger_count, 'accept', p_accept);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  response app.ride_response%rowtype;
  sources record;
  place_internal_id uuid;
  snapshot_id uuid;
  result jsonb;
begin
  if p_client_key is null or p_accept is null then raise exception using errcode = '22023', message = 'A complete response action is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':answer_passenger_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'answer_passenger_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select * into response from app.ride_response where public_id = p_response_id for update;
  if response.id is null or response.direction <> 'passenger_to_driver' or response.status <> 'await_driver' or response.driver_account_id <> actor_id then
    raise exception using errcode = 'P0002', message = 'The ride response is unavailable.';
  end if;
  if not p_accept then
    update app.ride_response set status = 'declined', updated_at = clock_timestamp(), responded_at = clock_timestamp() where id = response.id;
    result := jsonb_build_object('response_id', p_response_id, 'status', 'declined');
  else
    perform app.require_transport_actor();
    select * into sources from app.lock_compatible_ride_sources(response.passenger_request_id, response.driver_occurrence_id);
    select place.id into place_internal_id from private.user_place as place
    join app.passenger_request_place as link on link.user_place_id = place.id
    where place.public_id = p_place_id and link.request_id = response.passenger_request_id;
    if place_internal_id is null or p_offered_passenger_count not between 1 and least(sources.request_remaining, sources.occurrence_available) then
      raise exception using errcode = '22023', message = 'The offered conditions are invalid.';
    end if;
    perform app.assert_response_participants_eligible(response.passenger_account_id, response.driver_account_id);
    snapshot_id := app.create_ride_snapshot(response.passenger_request_id, response.driver_occurrence_id, place_internal_id, p_offered_passenger_count);
    update app.ride_response set selected_request_place_id = place_internal_id,
      offered_passenger_count = p_offered_passenger_count, conditions_snapshot_id = snapshot_id,
      status = 'await_passenger', updated_at = clock_timestamp(), responded_at = clock_timestamp()
    where id = response.id;
    result := jsonb_build_object('response_id', p_response_id, 'status', 'await_passenger');
  end if;
  insert into private.transport_operation values (actor_id, 'answer_passenger_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.confirm_ride_response(p_response_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('response', p_response_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  response app.ride_response%rowtype;
  request app.passenger_request%rowtype;
  occurrence app.driver_offer_occurrence%rowtype;
  internal_agreement_id uuid;
  agreement_public_id uuid;
  visibility_end timestamptz;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':confirm_ride_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'confirm_ride_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select * into response from app.ride_response where public_id = p_response_id for update;
  if response.id is null or response.status <> 'await_passenger' or response.passenger_account_id <> actor_id then
    raise exception using errcode = 'P0002', message = 'The ride response is unavailable.';
  end if;
  select * into request from app.passenger_request where id = response.passenger_request_id for update;
  select * into occurrence from app.driver_offer_occurrence where id = response.driver_occurrence_id for update;
  perform app.assert_response_participants_eligible(response.passenger_account_id, response.driver_account_id);
  if request.status not in ('active', 'partial') or occurrence.status <> 'active'
    or request.desired_arrival_at <= clock_timestamp() or occurrence.arrival_at <= clock_timestamp()
    or response.expires_at <= clock_timestamp()
    or response.offered_passenger_count > request.remaining_passengers
    or response.offered_passenger_count > occurrence.total_seats - occurrence.confirmed_seats
    or request.church_id <> occurrence.church_id
    or abs(extract(epoch from request.desired_arrival_at - occurrence.arrival_at)) > 3600
    or (request.children_count > 0 and not occurrence.children_allowed)
    or (request.child_seat_required and not occurrence.driver_child_seat_available)
    or not exists (select 1 from app.passenger_request_place as link where link.request_id = request.id and link.user_place_id = response.selected_request_place_id)
  then
    update app.ride_response set status = 'stale', updated_at = clock_timestamp(), responded_at = clock_timestamp() where id = response.id;
    result := jsonb_build_object('response_id', p_response_id, 'status', 'stale');
    insert into private.transport_operation values (actor_id, 'confirm_ride_response', p_client_key, digest_value, result, now());
    return result;
  end if;

  update app.driver_offer_occurrence
  set confirmed_seats = confirmed_seats + response.offered_passenger_count,
      status = case when confirmed_seats + response.offered_passenger_count = total_seats then 'full' else 'active' end,
      updated_at = clock_timestamp()
  where id = occurrence.id;
  update app.passenger_request
  set remaining_passengers = remaining_passengers - response.offered_passenger_count,
      status = case when remaining_passengers - response.offered_passenger_count = 0 then 'fulfilled' else 'partial' end,
      updated_at = clock_timestamp()
  where id = request.id;
  update app.ride_response set status = 'accepted', updated_at = clock_timestamp(), responded_at = clock_timestamp() where id = response.id;

  visibility_end := occurrence.arrival_at + interval '30 days';
  insert into app.ride_agreement (
    response_id, driver_occurrence_id, passenger_request_id, driver_account_id,
    passenger_account_id, confirmed_passenger_count, active_snapshot_id,
    selected_exact_place_id, contact_visible_until, exact_data_delete_due_at
  ) values (
    response.id, occurrence.id, request.id, response.driver_account_id,
    response.passenger_account_id, response.offered_passenger_count,
    response.conditions_snapshot_id, response.selected_request_place_id,
    visibility_end, visibility_end
  ) returning id, public_id into internal_agreement_id, agreement_public_id;

  insert into private.agreement_contact_snapshot (
    agreement_id, participant_account_id, email_normalized, phone_e164,
    email_verified_at, phone_verified_at, visible_until
  )
  select internal_agreement_id, account.id, contact.email_normalized, contact.phone_e164,
    identity.email_confirmed_at, contact.phone_verified_at, visibility_end
  from app.account as account
  join private.account_contact as contact on contact.account_id = account.id
  join auth.users as identity on identity.id = account.id
  where account.id in (response.passenger_account_id, response.driver_account_id)
    and identity.email_confirmed_at is not null and contact.phone_verified_at is not null;
  if (select count(*) from private.agreement_contact_snapshot as snapshot where snapshot.agreement_id = internal_agreement_id) <> 2 then
    raise exception using errcode = '42501', message = 'Both participants must retain verified contacts.';
  end if;
  insert into app.agreement_event (agreement_id, actor_account_id, event_type) values (internal_agreement_id, actor_id, 'confirmed');
  result := jsonb_build_object('agreement_id', agreement_public_id, 'status', 'confirmed', 'confirmed_passenger_count', response.offered_passenger_count);
  insert into private.transport_operation values (actor_id, 'confirm_ride_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.decline_ride_response(p_response_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('response', p_response_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  response app.ride_response%rowtype;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':decline_ride_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'decline_ride_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select * into response from app.ride_response where public_id = p_response_id for update;
  if response.id is null or not (
    (response.status = 'await_driver' and response.driver_account_id = actor_id)
    or (response.status = 'await_passenger' and response.passenger_account_id = actor_id)
  ) then
    raise exception using errcode = 'P0002', message = 'The ride response is unavailable.';
  end if;
  update app.ride_response set status = 'declined', updated_at = clock_timestamp(), responded_at = clock_timestamp() where id = response.id;
  result := jsonb_build_object('response_id', p_response_id, 'status', 'declined');
  insert into private.transport_operation values (actor_id, 'decline_ride_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.withdraw_ride_response(p_response_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('response', p_response_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  response app.ride_response%rowtype;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':withdraw_ride_response:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'withdraw_ride_response', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select * into response from app.ride_response where public_id = p_response_id for update;
  if response.id is null or not (
    (response.status = 'await_driver' and response.passenger_account_id = actor_id)
    or (response.status = 'await_passenger' and response.driver_account_id = actor_id)
  ) then
    raise exception using errcode = 'P0002', message = 'The ride response is unavailable.';
  end if;
  update app.ride_response set status = 'withdrawn', updated_at = clock_timestamp(), responded_at = clock_timestamp() where id = response.id;
  result := jsonb_build_object('response_id', p_response_id, 'status', 'withdrawn');
  insert into private.transport_operation values (actor_id, 'withdraw_ride_response', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.current_ride_responses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'response_id', response.public_id,
    'direction', response.direction,
    'status', response.status,
    'request_id', request.public_id,
    'occurrence_id', occurrence.public_id,
    'passenger_name', passenger.display_name,
    'driver_name', driver.display_name,
    'offered_passenger_count', response.offered_passenger_count,
    'selected_place', case when response.selected_request_place_id is null then null else jsonb_build_object(
      'place_id', place.public_id, 'public_area_label', place.public_area_label
    ) end,
    'expires_at', response.expires_at,
    'updated_at', response.updated_at
  ) order by response.updated_at desc), '[]'::jsonb)
  from app.ride_response as response
  join app.passenger_request as request on request.id = response.passenger_request_id
  join app.driver_offer_occurrence as occurrence on occurrence.id = response.driver_occurrence_id
  join app.account as passenger on passenger.id = response.passenger_account_id
  join app.account as driver on driver.id = response.driver_account_id
  left join private.user_place as place on place.id = response.selected_request_place_id,
  actor
  where actor.id in (response.passenger_account_id, response.driver_account_id);
$$;

create function api.current_ride_agreements()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'agreement_id', agreement.public_id,
    'status', agreement.status,
    'request_id', request.public_id,
    'occurrence_id', occurrence.public_id,
    'passenger_name', passenger.display_name,
    'driver_name', driver.display_name,
    'confirmed_passenger_count', agreement.confirmed_passenger_count,
    'scheduled_arrival_at', snapshot.scheduled_arrival_at,
    'timezone', snapshot.timezone,
    'contact_available', agreement.status in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
      and clock_timestamp() < agreement.contact_visible_until,
    'confirmed_at', agreement.confirmed_at,
    'cancelled_at', agreement.cancelled_at
  ) order by agreement.confirmed_at desc), '[]'::jsonb)
  from app.ride_agreement as agreement
  join app.passenger_request as request on request.id = agreement.passenger_request_id
  join app.driver_offer_occurrence as occurrence on occurrence.id = agreement.driver_occurrence_id
  join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
  join app.account as passenger on passenger.id = agreement.passenger_account_id
  join app.account as driver on driver.id = agreement.driver_account_id,
  actor
  where actor.id in (agreement.passenger_account_id, agreement.driver_account_id);
$$;

create function api.get_agreement_contacts(p_agreement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  agreement app.ride_agreement%rowtype;
  result jsonb;
begin
  select * into agreement from app.ride_agreement where public_id = p_agreement_id;
  if agreement.id is null or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or agreement.status not in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
    or clock_timestamp() >= agreement.contact_visible_until
  then
    return null;
  end if;
  select jsonb_build_object(
    'agreement_id', agreement.public_id,
    'counterparty_name', account.display_name,
    'email', contact.email_normalized,
    'phone', contact.phone_e164,
    'visible_until', contact.visible_until
  ) into result
  from private.agreement_contact_snapshot as contact
  join app.account as account on account.id = contact.participant_account_id
  where contact.agreement_id = agreement.id
    and contact.participant_account_id <> actor_id
    and contact.deleted_at is null
    and clock_timestamp() < contact.visible_until;
  return result;
end;
$$;

create function api.get_agreement_exact_place(p_agreement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  agreement app.ride_agreement%rowtype;
  result jsonb;
begin
  select * into agreement from app.ride_agreement where public_id = p_agreement_id;
  if agreement.id is null or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or agreement.status not in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
    or clock_timestamp() >= agreement.exact_data_delete_due_at
  then
    return null;
  end if;
  select jsonb_build_object('agreement_id', agreement.public_id, 'exact_meeting_label', place.exact_label)
  into result from private.user_place as place where place.id = agreement.selected_exact_place_id;
  return result;
end;
$$;

create function app.cancel_ride_agreement_internal(
  requested_agreement_id uuid,
  cancelling_actor_id uuid,
  evaluated_at timestamptz
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  agreement app.ride_agreement%rowtype;
  request app.passenger_request%rowtype;
  occurrence app.driver_offer_occurrence%rowtype;
begin
  select * into agreement from app.ride_agreement where id = requested_agreement_id for update;
  if agreement.id is null or cancelling_actor_id not in (agreement.passenger_account_id, agreement.driver_account_id) then
    return false;
  end if;
  if agreement.status = 'cancelled' then return false; end if;
  if agreement.status not in ('confirmed', 'change_pending') then return false; end if;
  select * into occurrence from app.driver_offer_occurrence where id = agreement.driver_occurrence_id for update;
  select * into request from app.passenger_request where id = agreement.passenger_request_id for update;

  update app.ride_agreement set status = 'cancelled', cancelled_at = evaluated_at,
    cancelled_by_account_id = cancelling_actor_id where id = agreement.id;
  update app.driver_offer_occurrence
  set confirmed_seats = confirmed_seats - agreement.confirmed_passenger_count,
      status = case
        when status = 'cancelled' then 'cancelled'
        when arrival_at <= evaluated_at then 'completed'
        when confirmed_seats - agreement.confirmed_passenger_count = total_seats then 'full'
        else 'active'
      end,
      updated_at = evaluated_at
  where id = occurrence.id and confirmed_seats >= agreement.confirmed_passenger_count;
  if not found then
    raise exception using errcode = '23514', message = 'Agreement capacity cannot be returned safely.';
  end if;

  if request.status in ('active', 'partial') then
    update app.passenger_request
    set remaining_passengers = least(total_passengers, remaining_passengers + agreement.confirmed_passenger_count),
        status = case
          when remaining_passengers + agreement.confirmed_passenger_count >= total_passengers then 'active'
          else 'partial'
        end,
        updated_at = evaluated_at
    where id = request.id;
  elsif request.status in ('fulfilled', 'restore') then
    update app.passenger_request
    set remaining_passengers = least(total_passengers, remaining_passengers + agreement.confirmed_passenger_count),
        status = case when desired_arrival_at > evaluated_at then 'restore' else 'expired' end,
        closed_at = case when desired_arrival_at <= evaluated_at then evaluated_at else null end,
        updated_at = evaluated_at
    where id = request.id;
  end if;
  insert into app.agreement_event (agreement_id, actor_account_id, event_type)
  values (agreement.id, cancelling_actor_id, 'cancelled');
  return true;
end;
$$;

create function api.cancel_ride_agreement(p_agreement_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('agreement', p_agreement_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  agreement_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':cancel_ride_agreement:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'cancel_ride_agreement', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select id into agreement_id from app.ride_agreement
  where public_id = p_agreement_id and actor_id in (passenger_account_id, driver_account_id);
  if agreement_id is null or not app.cancel_ride_agreement_internal(agreement_id, actor_id, clock_timestamp()) then
    raise exception using errcode = 'P0002', message = 'The ride agreement is unavailable.';
  end if;
  result := jsonb_build_object('agreement_id', p_agreement_id, 'status', 'cancelled');
  insert into private.transport_operation values (actor_id, 'cancel_ride_agreement', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.restore_passenger_request(p_request_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('request', p_request_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  remaining integer;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':restore_passenger_request:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'restore_passenger_request', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  update app.passenger_request
  set status = case when remaining_passengers = total_passengers then 'active' else 'partial' end,
      updated_at = clock_timestamp()
  where public_id = p_request_id and author_account_id = actor_id
    and status = 'restore' and desired_arrival_at > clock_timestamp() and remaining_passengers > 0
  returning remaining_passengers into remaining;
  if remaining is null then raise exception using errcode = 'P0002', message = 'The passenger request is unavailable.'; end if;
  result := jsonb_build_object('request_id', p_request_id, 'status', case when remaining = (select total_passengers from app.passenger_request where public_id = p_request_id) then 'active' else 'partial' end, 'remaining_passengers', remaining);
  insert into private.transport_operation values (actor_id, 'restore_passenger_request', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create or replace function api.cancel_driver_occurrence(p_occurrence_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('occurrence', p_occurrence_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  occurrence_id uuid;
  agreement record;
  cancelled_count integer := 0;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':cancel_driver_occurrence:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'cancel_driver_occurrence', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select id into occurrence_id from app.driver_offer_occurrence
  where public_id = p_occurrence_id and author_account_id = actor_id and status in ('active', 'full') for update;
  if occurrence_id is null then raise exception using errcode = 'P0002', message = 'The driver occurrence is unavailable.'; end if;
  for agreement in select id from app.ride_agreement
    where driver_occurrence_id = occurrence_id and status in ('confirmed', 'change_pending') order by id for update
  loop
    if app.cancel_ride_agreement_internal(agreement.id, actor_id, clock_timestamp()) then
      cancelled_count := cancelled_count + 1;
    end if;
  end loop;
  update app.driver_offer_occurrence set status = 'cancelled', closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = occurrence_id;
  result := jsonb_build_object('occurrence_id', p_occurrence_id, 'status', 'cancelled', 'cancelled_agreements', cancelled_count);
  insert into private.transport_operation values (actor_id, 'cancel_driver_occurrence', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create or replace function api.stop_driver_series(p_series_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('series', p_series_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  internal_series_id uuid;
  occurrence record;
  agreement record;
  cancelled_occurrences integer := 0;
  cancelled_agreements integer := 0;
  evaluated_at timestamptz := clock_timestamp();
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':stop_driver_series:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'stop_driver_series', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  select id into internal_series_id from app.driver_offer_series
  where public_id = p_series_id and author_account_id = actor_id and status = 'active' for update;
  if internal_series_id is null then raise exception using errcode = 'P0002', message = 'The driver series is unavailable.'; end if;

  for occurrence in select id from app.driver_offer_occurrence
    where series_id = internal_series_id and status in ('active', 'full') and arrival_at > evaluated_at
    order by arrival_at, id for update
  loop
    for agreement in select id from app.ride_agreement
      where driver_occurrence_id = occurrence.id and status in ('confirmed', 'change_pending')
      order by id for update
    loop
      if app.cancel_ride_agreement_internal(agreement.id, actor_id, evaluated_at) then
        cancelled_agreements := cancelled_agreements + 1;
      end if;
    end loop;
    update app.driver_offer_occurrence set status = 'cancelled', closed_at = evaluated_at, updated_at = evaluated_at
    where id = occurrence.id;
    cancelled_occurrences := cancelled_occurrences + 1;
  end loop;
  update app.driver_offer_series set status = 'stopped', updated_at = evaluated_at where id = internal_series_id;
  result := jsonb_build_object(
    'series_id', p_series_id,
    'status', 'stopped',
    'cancelled_occurrences', cancelled_occurrences,
    'cancelled_agreements', cancelled_agreements
  );
  insert into private.transport_operation values (actor_id, 'stop_driver_series', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create or replace function api.list_active_passenger_requests(p_church_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request.public_id,
    'church_id', church.public_id,
    'author_name', account.display_name,
    'service_id', service.public_id,
    'service_name', request.service_name_snapshot,
    'desired_arrival_at', request.desired_arrival_at,
    'timezone', request.timezone,
    'passenger_count', request.remaining_passengers,
    'children_count', request.children_count,
    'child_seat_required', request.child_seat_required,
    'return_required', request.return_required,
    'public_note', request.public_note,
    'place_options', (
      select jsonb_agg(jsonb_build_object('place_id', place.public_id, 'public_area_label', place.public_area_label) order by link.position)
      from app.passenger_request_place as link
      join private.user_place as place on place.id = link.user_place_id
      where link.request_id = request.id
    )
  ) order by request.desired_arrival_at, request.public_id), '[]'::jsonb)
  from app.passenger_request as request
  join app.account as account on account.id = request.author_account_id
  join app.church as church on church.id = request.church_id
  left join app.service_occurrence as service on service.id = request.service_occurrence_id
  where request.status in ('active', 'partial')
    and request.remaining_passengers > 0
    and request.desired_arrival_at > clock_timestamp()
    and (p_church_id is null or church.public_id = p_church_id);
$$;

create or replace function ops.expire_transport_items(p_evaluated_at timestamptz default clock_timestamp())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_count integer;
  occurrence_count integer;
  series_count integer;
  response_count integer;
  completed_agreement_count integer;
  no_outcome_count integer;
  archived_agreement_count integer;
begin
  update app.ride_response set status = 'expired', updated_at = p_evaluated_at, responded_at = p_evaluated_at
  where status in ('await_driver', 'await_passenger') and expires_at <= p_evaluated_at;
  get diagnostics response_count = row_count;
  update app.passenger_request set status = 'expired', closed_at = p_evaluated_at, updated_at = p_evaluated_at
  where status in ('active', 'partial', 'fulfilled', 'restore') and desired_arrival_at <= p_evaluated_at;
  get diagnostics request_count = row_count;
  with completed as (
    update app.ride_agreement as agreement
    set status = 'completed', completed_at = occurrence.arrival_at
    from app.driver_offer_occurrence as occurrence
    where occurrence.id = agreement.driver_occurrence_id
      and agreement.status in ('confirmed', 'change_pending')
      and occurrence.arrival_at <= p_evaluated_at
    returning agreement.id
  )
  insert into app.agreement_event (agreement_id, event_type)
  select id, 'completed' from completed;
  get diagnostics completed_agreement_count = row_count;
  with without_outcome as (
    update app.ride_agreement
    set status = 'no_outcome'
    where status = 'completed' and completed_at + interval '7 days' <= p_evaluated_at
    returning id
  )
  insert into app.agreement_event (agreement_id, event_type)
  select id, 'no_outcome' from without_outcome;
  get diagnostics no_outcome_count = row_count;
  with archived as (
    update app.ride_agreement
    set status = 'archived', archived_at = p_evaluated_at
    where status in ('cancelled', 'outcome', 'no_outcome')
      and exact_data_delete_due_at <= p_evaluated_at
    returning id
  )
  insert into app.agreement_event (agreement_id, event_type)
  select id, 'archived' from archived;
  get diagnostics archived_agreement_count = row_count;
  update private.agreement_contact_snapshot as contact
  set deleted_at = p_evaluated_at,
      email_normalized = 'deleted-' || encode(extensions.digest(contact.agreement_id::text::bytea, 'sha256'), 'hex') || '@invalid.test',
      phone_e164 = '+99900000000'
  from app.ride_agreement as agreement
  where agreement.id = contact.agreement_id and agreement.status = 'archived' and contact.deleted_at is null;
  update app.driver_offer_occurrence set status = case when confirmed_seats > 0 then 'completed' else 'expired' end,
    closed_at = p_evaluated_at, updated_at = p_evaluated_at
  where status in ('active', 'full') and arrival_at <= p_evaluated_at;
  get diagnostics occurrence_count = row_count;
  update app.driver_offer_series set status = 'ended', updated_at = p_evaluated_at
  where status = 'active' and ends_on < (p_evaluated_at at time zone timezone)::date;
  get diagnostics series_count = row_count;
  return jsonb_build_object(
    'responses', response_count,
    'requests', request_count,
    'occurrences', occurrence_count,
    'series', series_count,
    'completed_agreements', completed_agreement_count,
    'no_outcome_agreements', no_outcome_count,
    'archived_agreements', archived_agreement_count
  );
end;
$$;

revoke all on function app.prevent_immutable_ride_snapshot_change() from public, anon, authenticated, service_role;
revoke all on function app.enforce_ride_response_relationships() from public, anon, authenticated, service_role;
revoke all on function app.enforce_ride_agreement_relationships() from public, anon, authenticated, service_role;
revoke all on function app.enforce_agreement_contact_snapshot() from public, anon, authenticated, service_role;
revoke all on function app.create_ride_snapshot(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function app.lock_compatible_ride_sources(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.assert_response_participants_eligible(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.cancel_ride_agreement_internal(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function api.submit_passenger_response(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.submit_driver_response(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function api.answer_passenger_response(uuid, uuid, integer, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function api.confirm_ride_response(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.decline_ride_response(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.withdraw_ride_response(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.current_ride_responses() from public, anon, authenticated, service_role;
revoke all on function api.current_ride_agreements() from public, anon, authenticated, service_role;
revoke all on function api.get_agreement_contacts(uuid) from public, anon, authenticated, service_role;
revoke all on function api.get_agreement_exact_place(uuid) from public, anon, authenticated, service_role;
revoke all on function api.cancel_ride_agreement(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.restore_passenger_request(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function api.submit_passenger_response(uuid, uuid, uuid) to authenticated;
grant execute on function api.submit_driver_response(uuid, uuid, uuid, integer, uuid) to authenticated;
grant execute on function api.answer_passenger_response(uuid, uuid, integer, boolean, uuid) to authenticated;
grant execute on function api.confirm_ride_response(uuid, uuid) to authenticated;
grant execute on function api.decline_ride_response(uuid, uuid) to authenticated;
grant execute on function api.withdraw_ride_response(uuid, uuid) to authenticated;
grant execute on function api.current_ride_responses() to authenticated;
grant execute on function api.current_ride_agreements() to authenticated;
grant execute on function api.get_agreement_contacts(uuid) to authenticated;
grant execute on function api.get_agreement_exact_place(uuid) to authenticated;
grant execute on function api.cancel_ride_agreement(uuid, uuid) to authenticated;
grant execute on function api.restore_passenger_request(uuid, uuid) to authenticated;

comment on table app.ride_response is 'Participant-private response state; pending responses reserve no capacity and reveal no contacts.';
comment on table app.ride_condition_snapshot is 'Immutable structured conditions for response and agreement confirmation.';
comment on table app.ride_agreement is 'Confirmed participant-private ride agreement with exact-once occurrence capacity.';
comment on table private.agreement_contact_snapshot is 'Verified contact snapshot disclosed only through the participant authorization function.';
