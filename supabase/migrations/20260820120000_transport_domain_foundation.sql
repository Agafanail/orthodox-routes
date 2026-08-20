create table app.church (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  slug text not null unique,
  official_name text not null,
  source_language text not null default 'en',
  address_display text,
  locality text not null,
  country_code text not null,
  timezone text not null,
  status text not null default 'draft',
  schedule_updated_at timestamptz,
  created_by uuid references app.account (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_slug_safe check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint church_name_safe check (char_length(official_name) between 1 and 200 and official_name !~ '[[:cntrl:]]'),
  constraint church_language check (source_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint church_locality_safe check (char_length(locality) between 1 and 120 and locality !~ '[[:cntrl:]]'),
  constraint church_country_code check (country_code ~ '^[A-Z]{2}$'),
  constraint church_status check (status in ('draft', 'published', 'hidden', 'archive_requested', 'archived')),
  constraint church_published_address check (status <> 'published' or address_display is not null)
);

create table app.service_occurrence (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  church_id uuid not null references app.church (id) on delete restrict,
  source_name text not null,
  starts_at timestamptz not null,
  timezone text not null,
  status text not null default 'scheduled',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_occurrence_name_safe check (char_length(source_name) between 1 and 160 and source_name !~ '[[:cntrl:]]'),
  constraint service_occurrence_status check (status in ('scheduled', 'cancelled')),
  constraint service_occurrence_version check (version > 0),
  unique (church_id, starts_at, source_name)
);

create table private.user_place (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  owner_account_id uuid not null references app.account (id) on delete cascade,
  exact_label text not null,
  public_area_label text not null,
  created_at timestamptz not null default now(),
  retention_due_at timestamptz,
  constraint user_place_exact_label check (char_length(exact_label) between 1 and 300 and exact_label !~ '[[:cntrl:]]'),
  constraint user_place_public_label check (char_length(public_area_label) between 1 and 120 and public_area_label !~ '[[:cntrl:]]')
);

create table private.transport_operation (
  actor_account_id uuid not null references app.account (id) on delete cascade,
  operation_type text not null,
  client_key uuid not null,
  input_digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_account_id, operation_type, client_key),
  constraint transport_operation_type check (operation_type in (
    'publish_passenger_request',
    'publish_driver_occurrence',
    'publish_driver_series',
    'cancel_passenger_request',
    'cancel_driver_occurrence',
    'stop_driver_series'
  )),
  constraint transport_operation_digest check (input_digest ~ '^[0-9a-f]{64}$')
);

create table app.passenger_request (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  author_account_id uuid not null references app.account (id) on delete restrict,
  church_id uuid not null references app.church (id) on delete restrict,
  service_occurrence_id uuid references app.service_occurrence (id) on delete restrict,
  desired_arrival_at timestamptz not null,
  timezone text not null,
  service_name_snapshot text,
  total_passengers smallint not null,
  children_count smallint not null default 0,
  child_seat_required boolean not null,
  return_required boolean not null,
  public_note text,
  remaining_passengers smallint not null,
  status text not null default 'active',
  terms_version text not null,
  content_version integer not null default 1,
  published_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint passenger_request_count check (total_passengers between 1 and 55),
  constraint passenger_request_children check (children_count between 0 and total_passengers),
  constraint passenger_request_child_seat check (children_count > 0 or child_seat_required = false),
  constraint passenger_request_remaining check (remaining_passengers between 0 and total_passengers),
  constraint passenger_request_status check (status in ('draft', 'verification', 'active', 'partial', 'fulfilled', 'restore', 'cancelled', 'expired')),
  constraint passenger_request_note check (public_note is null or (char_length(public_note) between 1 and 300 and public_note !~ '[[:cntrl:]]')),
  constraint passenger_request_content_version check (content_version > 0),
  constraint passenger_request_closed_state check ((status in ('cancelled', 'expired')) = (closed_at is not null))
);

create table app.passenger_request_place (
  request_id uuid not null references app.passenger_request (id) on delete cascade,
  user_place_id uuid not null references private.user_place (id) on delete restrict,
  position smallint not null,
  primary key (request_id, user_place_id),
  unique (request_id, position),
  constraint passenger_request_place_position check (position between 1 and 3)
);

create unique index passenger_request_active_deduplication
  on app.passenger_request (author_account_id, church_id, desired_arrival_at)
  where status in ('active', 'partial', 'fulfilled', 'restore');

create index passenger_request_public_lookup
  on app.passenger_request (church_id, desired_arrival_at)
  where status in ('active', 'partial');

create table app.driver_offer_series (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  author_account_id uuid not null references app.account (id) on delete restrict,
  church_id uuid not null references app.church (id) on delete restrict,
  recurrence_weekdays smallint[] not null,
  local_departure_time time not null,
  local_arrival_time time not null,
  timezone text not null,
  starts_on date not null,
  ends_on date not null,
  total_seats_default smallint not null,
  max_detour_km smallint not null,
  children_allowed boolean not null,
  driver_child_seat_available boolean not null,
  return_available boolean not null,
  public_note text,
  status text not null default 'active',
  content_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_series_weekdays check (
    cardinality(recurrence_weekdays) between 1 and 7
    and recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint driver_series_time_order check (local_departure_time < local_arrival_time),
  constraint driver_series_bounds check (ends_on >= starts_on and ends_on <= starts_on + 55),
  constraint driver_series_seats check (total_seats_default between 1 and 55),
  constraint driver_series_detour check (max_detour_km in (0, 2, 5, 10, 15, 20)),
  constraint driver_series_child_seat check (children_allowed or driver_child_seat_available = false),
  constraint driver_series_note check (public_note is null or (char_length(public_note) between 1 and 300 and public_note !~ '[[:cntrl:]]')),
  constraint driver_series_status check (status in ('draft', 'active', 'change_pending', 'stopped', 'ended')),
  constraint driver_series_content_version check (content_version > 0)
);

create table app.driver_offer_occurrence (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  publication_key uuid not null,
  series_id uuid references app.driver_offer_series (id) on delete restrict,
  author_account_id uuid not null references app.account (id) on delete restrict,
  church_id uuid not null references app.church (id) on delete restrict,
  service_occurrence_id uuid references app.service_occurrence (id) on delete restrict,
  departure_at timestamptz not null,
  arrival_at timestamptz not null,
  timezone text not null,
  service_name_snapshot text,
  origin_place_id uuid not null references private.user_place (id) on delete restrict,
  total_seats smallint not null,
  confirmed_seats smallint not null default 0,
  max_detour_km smallint not null,
  children_allowed boolean not null,
  driver_child_seat_available boolean not null,
  return_available boolean not null,
  public_note text,
  status text not null default 'active',
  conditions_version integer not null default 1,
  published_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_occurrence_time_order check (departure_at < arrival_at),
  constraint driver_occurrence_seats check (total_seats between 1 and 55 and confirmed_seats between 0 and total_seats),
  constraint driver_occurrence_detour check (max_detour_km in (0, 2, 5, 10, 15, 20)),
  constraint driver_occurrence_child_seat check (children_allowed or driver_child_seat_available = false),
  constraint driver_occurrence_note check (public_note is null or (char_length(public_note) between 1 and 300 and public_note !~ '[[:cntrl:]]')),
  constraint driver_occurrence_status check (status in ('draft', 'verification', 'active', 'full', 'cancelled', 'completed', 'expired')),
  constraint driver_occurrence_conditions_version check (conditions_version > 0),
  constraint driver_occurrence_closed_state check ((status in ('cancelled', 'completed', 'expired')) = (closed_at is not null)),
  unique (author_account_id, publication_key),
  unique (series_id, departure_at)
);

create index driver_occurrence_public_lookup
  on app.driver_offer_occurrence (church_id, arrival_at)
  where status = 'active';

alter table app.church enable row level security;
alter table app.church force row level security;
alter table app.service_occurrence enable row level security;
alter table app.service_occurrence force row level security;
alter table private.user_place enable row level security;
alter table private.user_place force row level security;
alter table private.transport_operation enable row level security;
alter table private.transport_operation force row level security;
alter table app.passenger_request enable row level security;
alter table app.passenger_request force row level security;
alter table app.passenger_request_place enable row level security;
alter table app.passenger_request_place force row level security;
alter table app.driver_offer_series enable row level security;
alter table app.driver_offer_series force row level security;
alter table app.driver_offer_occurrence enable row level security;
alter table app.driver_offer_occurrence force row level security;

revoke all on table app.church, app.service_occurrence, private.user_place,
  private.transport_operation, app.passenger_request, app.passenger_request_place,
  app.driver_offer_series, app.driver_offer_occurrence
from public, anon, authenticated, service_role;

create function app.transport_input_digest(input jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(input::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function app.safe_public_transport_text(value text, maximum_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is null or (
    char_length(value) between 1 and maximum_length
    and value = btrim(value)
    and value !~ '[[:cntrl:]]'
    and value !~* '(https?://|www\.|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|\+?[0-9][0-9 ()-]{6,}[0-9])'
  );
$$;

create function app.require_transport_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  if not coalesce((app.current_eligibility_result(actor_id)->>'eligible')::boolean, false) then
    raise exception using errcode = '42501', message = 'Current participation eligibility is required.';
  end if;
  return actor_id;
end;
$$;

create function app.transport_operation_result(
  actor_id uuid,
  requested_operation text,
  requested_key uuid,
  requested_digest text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  existing private.transport_operation%rowtype;
begin
  select * into existing
  from private.transport_operation as operation
  where operation.actor_account_id = actor_id
    and operation.operation_type = requested_operation
    and operation.client_key = requested_key;

  if not found then return null; end if;
  if existing.input_digest <> requested_digest then
    raise exception using errcode = '22023', message = 'The idempotency key was already used for different input.';
  end if;
  return existing.result;
end;
$$;

create function app.assert_transport_reference(
  requested_church_public_id uuid,
  requested_service_public_id uuid,
  requested_time timestamptz
)
returns table (church_id uuid, service_id uuid, service_name text)
language plpgsql
stable
set search_path = ''
as $$
declare
  resolved_church_id uuid;
begin
  select church.id into resolved_church_id
  from app.church as church
  where church.public_id = requested_church_public_id and church.status = 'published';
  if resolved_church_id is null then
    raise exception using errcode = 'P0002', message = 'The church is unavailable.';
  end if;

  church_id := resolved_church_id;
  service_id := null;
  service_name := null;
  if requested_service_public_id is not null then
    select service.id, service.source_name
    into service_id, service_name
    from app.service_occurrence as service
    where service.public_id = requested_service_public_id
      and service.church_id = resolved_church_id
      and service.status = 'scheduled'
      and service.starts_at = requested_time;
    if service_id is null then
      raise exception using errcode = '22023', message = 'The service occurrence does not match the requested ride.';
    end if;
  end if;
  return next;
end;
$$;

create function api.publish_passenger_request(
  p_church_id uuid,
  p_service_occurrence_id uuid,
  p_desired_arrival_at timestamptz,
  p_timezone text,
  p_total_passengers integer,
  p_children_count integer,
  p_child_seat_required boolean,
  p_return_required boolean,
  p_public_note text,
  p_places jsonb,
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
  input jsonb := jsonb_build_object(
    'church', p_church_id, 'service', p_service_occurrence_id,
    'arrival', p_desired_arrival_at, 'timezone', p_timezone,
    'total', p_total_passengers, 'children', p_children_count,
    'child_seat', p_child_seat_required, 'return', p_return_required,
    'note', nullif(btrim(p_public_note), ''), 'places', p_places
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  reference record;
  request_id uuid;
  request_public_id uuid;
  place jsonb;
  place_id uuid;
  position integer := 0;
  terms_version text;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':publish_passenger_request:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'publish_passenger_request', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  if p_desired_arrival_at <= clock_timestamp() or p_desired_arrival_at > clock_timestamp() + interval '8 weeks'
    or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)
    or p_total_passengers not between 1 and 55
    or p_children_count not between 0 and p_total_passengers
    or (p_children_count = 0 and p_child_seat_required)
    or jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) not between 1 and 3
    or not app.safe_public_transport_text(nullif(btrim(p_public_note), ''), 300)
  then
    raise exception using errcode = '22023', message = 'Passenger request input is invalid.';
  end if;

  select * into reference from app.assert_transport_reference(p_church_id, p_service_occurrence_id, p_desired_arrival_at);
  select document.version into terms_version
  from app.legal_document_version as document
  where document.id = app.current_legal_document_id('terms', clock_timestamp());
  if terms_version is null then raise exception using errcode = '42501', message = 'Current participation eligibility is required.'; end if;

  insert into app.passenger_request (
    author_account_id, church_id, service_occurrence_id, desired_arrival_at, timezone,
    service_name_snapshot, total_passengers, children_count, child_seat_required,
    return_required, public_note, remaining_passengers, terms_version
  ) values (
    actor_id, reference.church_id, reference.service_id, p_desired_arrival_at, p_timezone,
    reference.service_name, p_total_passengers, p_children_count, p_child_seat_required,
    p_return_required, nullif(btrim(p_public_note), ''), p_total_passengers, terms_version
  ) returning id, public_id into request_id, request_public_id;

  for place in select value from jsonb_array_elements(p_places) loop
    position := position + 1;
    if jsonb_typeof(place) <> 'object'
      or nullif(btrim(place->>'exact_label'), '') is null
      or char_length(btrim(place->>'exact_label')) > 300
      or not app.safe_public_transport_text(nullif(btrim(place->>'public_area_label'), ''), 120)
    then
      raise exception using errcode = '22023', message = 'Passenger meeting place input is invalid.';
    end if;
    insert into private.user_place (owner_account_id, exact_label, public_area_label)
    values (actor_id, btrim(place->>'exact_label'), btrim(place->>'public_area_label'))
    returning id into place_id;
    insert into app.passenger_request_place (request_id, user_place_id, position)
    values (request_id, place_id, position);
  end loop;

  result := jsonb_build_object('request_id', request_public_id, 'status', 'active', 'remaining_passengers', p_total_passengers);
  insert into private.transport_operation values (actor_id, 'publish_passenger_request', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.publish_driver_occurrence(
  p_church_id uuid,
  p_service_occurrence_id uuid,
  p_departure_at timestamptz,
  p_arrival_at timestamptz,
  p_timezone text,
  p_total_seats integer,
  p_max_detour_km integer,
  p_children_allowed boolean,
  p_driver_child_seat_available boolean,
  p_return_available boolean,
  p_public_note text,
  p_exact_origin_label text,
  p_public_origin_area text,
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
  input jsonb := jsonb_build_object(
    'church', p_church_id, 'service', p_service_occurrence_id, 'departure', p_departure_at,
    'arrival', p_arrival_at, 'timezone', p_timezone, 'seats', p_total_seats,
    'detour', p_max_detour_km, 'children', p_children_allowed,
    'child_seat', p_driver_child_seat_available, 'return', p_return_available,
    'note', nullif(btrim(p_public_note), ''), 'exact_origin', p_exact_origin_label,
    'public_origin', p_public_origin_area
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  reference record;
  place_id uuid;
  occurrence_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':publish_driver_occurrence:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'publish_driver_occurrence', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  if p_departure_at <= clock_timestamp() or p_arrival_at <= p_departure_at or p_arrival_at > clock_timestamp() + interval '8 weeks'
    or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)
    or p_total_seats not between 1 and 55 or p_max_detour_km not in (0, 2, 5, 10, 15, 20)
    or (not p_children_allowed and p_driver_child_seat_available)
    or nullif(btrim(p_exact_origin_label), '') is null or char_length(btrim(p_exact_origin_label)) > 300
    or not app.safe_public_transport_text(nullif(btrim(p_public_origin_area), ''), 120)
    or not app.safe_public_transport_text(nullif(btrim(p_public_note), ''), 300)
  then
    raise exception using errcode = '22023', message = 'Driver occurrence input is invalid.';
  end if;

  select * into reference from app.assert_transport_reference(p_church_id, p_service_occurrence_id, p_arrival_at);
  insert into private.user_place (owner_account_id, exact_label, public_area_label)
  values (actor_id, btrim(p_exact_origin_label), btrim(p_public_origin_area)) returning id into place_id;

  insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id, departure_at, arrival_at,
    timezone, service_name_snapshot, origin_place_id, total_seats, max_detour_km,
    children_allowed, driver_child_seat_available, return_available, public_note
  ) values (
    p_client_key, actor_id, reference.church_id, reference.service_id, p_departure_at, p_arrival_at,
    p_timezone, reference.service_name, place_id, p_total_seats, p_max_detour_km,
    p_children_allowed, p_driver_child_seat_available, p_return_available, nullif(btrim(p_public_note), '')
  ) returning public_id into occurrence_public_id;

  result := jsonb_build_object('occurrence_id', occurrence_public_id, 'status', 'active', 'available_seats', p_total_seats);
  insert into private.transport_operation values (actor_id, 'publish_driver_occurrence', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.publish_driver_series(
  p_church_id uuid,
  p_weekdays smallint[],
  p_local_departure_time time,
  p_local_arrival_time time,
  p_timezone text,
  p_starts_on date,
  p_ends_on date,
  p_total_seats integer,
  p_max_detour_km integer,
  p_children_allowed boolean,
  p_driver_child_seat_available boolean,
  p_return_available boolean,
  p_public_note text,
  p_exact_origin_label text,
  p_public_origin_area text,
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
  input jsonb := jsonb_build_object(
    'church', p_church_id, 'weekdays', p_weekdays, 'departure_time', p_local_departure_time,
    'arrival_time', p_local_arrival_time, 'timezone', p_timezone, 'starts_on', p_starts_on,
    'ends_on', p_ends_on, 'seats', p_total_seats, 'detour', p_max_detour_km,
    'children', p_children_allowed, 'child_seat', p_driver_child_seat_available,
    'return', p_return_available, 'note', nullif(btrim(p_public_note), ''),
    'exact_origin', p_exact_origin_label, 'public_origin', p_public_origin_area
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  internal_church_id uuid;
  place_id uuid;
  series_id uuid;
  series_public_id uuid;
  occurrence_date date;
  occurrence_count integer := 0;
  first_occurrence_public_id uuid;
  occurrence_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':publish_driver_series:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'publish_driver_series', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  select church.id into internal_church_id from app.church as church where church.public_id = p_church_id and church.status = 'published';
  if internal_church_id is null then raise exception using errcode = 'P0002', message = 'The church is unavailable.'; end if;
  if cardinality(p_weekdays) not between 1 and 7 or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
    or p_local_departure_time >= p_local_arrival_time
    or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)
    or p_starts_on < (clock_timestamp() at time zone p_timezone)::date
    or p_ends_on < p_starts_on or p_ends_on > p_starts_on + 55
    or ((p_ends_on + p_local_arrival_time) at time zone p_timezone) > clock_timestamp() + interval '8 weeks'
    or p_total_seats not between 1 and 55 or p_max_detour_km not in (0, 2, 5, 10, 15, 20)
    or (not p_children_allowed and p_driver_child_seat_available)
    or nullif(btrim(p_exact_origin_label), '') is null or char_length(btrim(p_exact_origin_label)) > 300
    or not app.safe_public_transport_text(nullif(btrim(p_public_origin_area), ''), 120)
    or not app.safe_public_transport_text(nullif(btrim(p_public_note), ''), 300)
  then
    raise exception using errcode = '22023', message = 'Driver series input is invalid.';
  end if;

  insert into private.user_place (owner_account_id, exact_label, public_area_label)
  values (actor_id, btrim(p_exact_origin_label), btrim(p_public_origin_area)) returning id into place_id;
  insert into app.driver_offer_series (
    author_account_id, church_id, recurrence_weekdays, local_departure_time, local_arrival_time,
    timezone, starts_on, ends_on, total_seats_default, max_detour_km, children_allowed,
    driver_child_seat_available, return_available, public_note
  ) values (
    actor_id, internal_church_id, p_weekdays, p_local_departure_time, p_local_arrival_time,
    p_timezone, p_starts_on, p_ends_on, p_total_seats, p_max_detour_km, p_children_allowed,
    p_driver_child_seat_available, p_return_available, nullif(btrim(p_public_note), '')
  ) returning id, public_id into series_id, series_public_id;

  for occurrence_date in select day::date from generate_series(p_starts_on, p_ends_on, interval '1 day') as day
    where extract(dow from day)::smallint = any(p_weekdays)
  loop
    insert into app.driver_offer_occurrence (
      publication_key, series_id, author_account_id, church_id, departure_at, arrival_at,
      timezone, origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available, public_note
    ) values (
      gen_random_uuid(), series_id, actor_id, internal_church_id,
      (occurrence_date + p_local_departure_time) at time zone p_timezone,
      (occurrence_date + p_local_arrival_time) at time zone p_timezone,
      p_timezone, place_id, p_total_seats, p_max_detour_km, p_children_allowed,
      p_driver_child_seat_available, p_return_available, nullif(btrim(p_public_note), '')
    ) returning public_id into occurrence_public_id;
    occurrence_count := occurrence_count + 1;
    if first_occurrence_public_id is null then first_occurrence_public_id := occurrence_public_id; end if;
  end loop;
  if occurrence_count = 0 then raise exception using errcode = '22023', message = 'The series does not contain a future occurrence.'; end if;

  result := jsonb_build_object(
    'series_id', series_public_id, 'status', 'active', 'occurrence_count', occurrence_count,
    'first_occurrence_id', first_occurrence_public_id
  );
  insert into private.transport_operation values (actor_id, 'publish_driver_series', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.list_active_passenger_requests(p_church_id uuid default null)
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
    'public_areas', (
      select jsonb_agg(place.public_area_label order by link.position)
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

create function api.list_active_driver_occurrences(p_church_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', occurrence.public_id,
    'series_id', series.public_id,
    'church_id', church.public_id,
    'author_name', account.display_name,
    'service_id', service.public_id,
    'service_name', occurrence.service_name_snapshot,
    'departure_at', occurrence.departure_at,
    'arrival_at', occurrence.arrival_at,
    'timezone', occurrence.timezone,
    'available_seats', occurrence.total_seats - occurrence.confirmed_seats,
    'max_detour_km', occurrence.max_detour_km,
    'children_allowed', occurrence.children_allowed,
    'driver_child_seat_available', occurrence.driver_child_seat_available,
    'return_available', occurrence.return_available,
    'public_note', occurrence.public_note,
    'public_origin_area', place.public_area_label
  ) order by occurrence.arrival_at, occurrence.public_id), '[]'::jsonb)
  from app.driver_offer_occurrence as occurrence
  join app.account as account on account.id = occurrence.author_account_id
  join app.church as church on church.id = occurrence.church_id
  join private.user_place as place on place.id = occurrence.origin_place_id
  left join app.driver_offer_series as series on series.id = occurrence.series_id
  left join app.service_occurrence as service on service.id = occurrence.service_occurrence_id
  where occurrence.status = 'active'
    and occurrence.total_seats > occurrence.confirmed_seats
    and occurrence.arrival_at > clock_timestamp()
    and (p_church_id is null or church.public_id = p_church_id);
$$;

create function api.current_transport_items()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select jsonb_build_object(
    'passenger_requests', coalesce((select jsonb_agg(jsonb_build_object(
      'request_id', request.public_id, 'church_id', church.public_id,
      'desired_arrival_at', request.desired_arrival_at, 'timezone', request.timezone,
      'total_passengers', request.total_passengers, 'remaining_passengers', request.remaining_passengers,
      'children_count', request.children_count, 'child_seat_required', request.child_seat_required,
      'return_required', request.return_required, 'public_note', request.public_note,
      'status', request.status, 'places', (select jsonb_agg(jsonb_build_object(
        'position', link.position, 'exact_label', place.exact_label, 'public_area_label', place.public_area_label
      ) order by link.position) from app.passenger_request_place as link join private.user_place as place on place.id = link.user_place_id where link.request_id = request.id)
    ) order by request.created_at desc) from app.passenger_request as request join app.church as church on church.id = request.church_id, actor where request.author_account_id = actor.id), '[]'::jsonb),
    'driver_series', coalesce((select jsonb_agg(jsonb_build_object(
      'series_id', series.public_id, 'church_id', church.public_id, 'weekdays', series.recurrence_weekdays,
      'starts_on', series.starts_on, 'ends_on', series.ends_on, 'status', series.status
    ) order by series.created_at desc) from app.driver_offer_series as series join app.church as church on church.id = series.church_id, actor where series.author_account_id = actor.id), '[]'::jsonb),
    'driver_occurrences', coalesce((select jsonb_agg(jsonb_build_object(
      'occurrence_id', occurrence.public_id, 'series_id', series.public_id, 'church_id', church.public_id,
      'departure_at', occurrence.departure_at, 'arrival_at', occurrence.arrival_at,
      'total_seats', occurrence.total_seats, 'confirmed_seats', occurrence.confirmed_seats,
      'available_seats', occurrence.total_seats - occurrence.confirmed_seats, 'status', occurrence.status,
      'exact_origin_label', place.exact_label, 'public_origin_area', place.public_area_label
    ) order by occurrence.arrival_at) from app.driver_offer_occurrence as occurrence
      join app.church as church on church.id = occurrence.church_id
      join private.user_place as place on place.id = occurrence.origin_place_id
      left join app.driver_offer_series as series on series.id = occurrence.series_id, actor
      where occurrence.author_account_id = actor.id), '[]'::jsonb)
  );
$$;

create function api.cancel_passenger_request(p_request_id uuid, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object('request', p_request_id);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':cancel_passenger_request:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'cancel_passenger_request', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  update app.passenger_request
  set status = 'cancelled', closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where public_id = p_request_id and author_account_id = actor_id and status in ('active', 'partial', 'restore');
  if not found then raise exception using errcode = 'P0002', message = 'The passenger request is unavailable.'; end if;
  result := jsonb_build_object('request_id', p_request_id, 'status', 'cancelled');
  insert into private.transport_operation values (actor_id, 'cancel_passenger_request', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.cancel_driver_occurrence(p_occurrence_id uuid, p_client_key uuid)
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
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':cancel_driver_occurrence:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'cancel_driver_occurrence', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  update app.driver_offer_occurrence
  set status = 'cancelled', closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where public_id = p_occurrence_id and author_account_id = actor_id and status in ('active', 'full');
  if not found then raise exception using errcode = 'P0002', message = 'The driver occurrence is unavailable.'; end if;
  result := jsonb_build_object('occurrence_id', p_occurrence_id, 'status', 'cancelled');
  insert into private.transport_operation values (actor_id, 'cancel_driver_occurrence', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function api.stop_driver_series(p_series_id uuid, p_client_key uuid)
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
  cancelled_count integer;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':stop_driver_series:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'stop_driver_series', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  update app.driver_offer_series
  set status = 'stopped', updated_at = clock_timestamp()
  where public_id = p_series_id and author_account_id = actor_id and status = 'active'
  returning id into internal_series_id;
  if internal_series_id is null then raise exception using errcode = 'P0002', message = 'The driver series is unavailable.'; end if;
  update app.driver_offer_occurrence
  set status = 'cancelled', closed_at = clock_timestamp(), updated_at = clock_timestamp()
  where series_id = internal_series_id and status = 'active' and confirmed_seats = 0;
  get diagnostics cancelled_count = row_count;
  result := jsonb_build_object('series_id', p_series_id, 'status', 'stopped', 'cancelled_occurrences', cancelled_count);
  insert into private.transport_operation values (actor_id, 'stop_driver_series', p_client_key, digest_value, result, now());
  return result;
end;
$$;

create function ops.expire_transport_items(p_evaluated_at timestamptz default clock_timestamp())
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
begin
  update app.passenger_request set status = 'expired', closed_at = p_evaluated_at, updated_at = p_evaluated_at
  where status in ('active', 'partial', 'fulfilled', 'restore') and desired_arrival_at <= p_evaluated_at;
  get diagnostics request_count = row_count;
  update app.driver_offer_occurrence set status = case when confirmed_seats > 0 then 'completed' else 'expired' end,
    closed_at = p_evaluated_at, updated_at = p_evaluated_at
  where status in ('active', 'full') and arrival_at <= p_evaluated_at;
  get diagnostics occurrence_count = row_count;
  update app.driver_offer_series set status = 'ended', updated_at = p_evaluated_at
  where status = 'active' and ends_on < (p_evaluated_at at time zone timezone)::date;
  get diagnostics series_count = row_count;
  return jsonb_build_object('requests', request_count, 'occurrences', occurrence_count, 'series', series_count);
end;
$$;

revoke all on function app.transport_input_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.safe_public_transport_text(text, integer) from public, anon, authenticated, service_role;
revoke all on function app.require_transport_actor() from public, anon, authenticated, service_role;
revoke all on function app.transport_operation_result(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.assert_transport_reference(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function api.publish_passenger_request(uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_driver_occurrence(uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_driver_series(uuid, smallint[], time, time, text, date, date, integer, integer, boolean, boolean, boolean, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function api.list_active_passenger_requests(uuid) from public, anon, authenticated, service_role;
revoke all on function api.list_active_driver_occurrences(uuid) from public, anon, authenticated, service_role;
revoke all on function api.current_transport_items() from public, anon, authenticated, service_role;
revoke all on function api.cancel_passenger_request(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.cancel_driver_occurrence(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.stop_driver_series(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function ops.expire_transport_items(timestamptz) from public, anon, authenticated, service_role;

grant usage on schema api to anon;
grant execute on function api.list_active_passenger_requests(uuid) to anon, authenticated;
grant execute on function api.list_active_driver_occurrences(uuid) to anon, authenticated;
grant execute on function api.publish_passenger_request(uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_driver_occurrence(uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid) to authenticated;
grant execute on function api.publish_driver_series(uuid, smallint[], time, time, text, date, date, integer, integer, boolean, boolean, boolean, text, text, text, uuid) to authenticated;
grant execute on function api.current_transport_items() to authenticated;
grant execute on function api.cancel_passenger_request(uuid, uuid) to authenticated;
grant execute on function api.cancel_driver_occurrence(uuid, uuid) to authenticated;
grant execute on function api.stop_driver_series(uuid, uuid) to authenticated;

comment on table app.church is 'Canonical church identity subset required by the Core transport domain; maps and administration extend it later.';
comment on table app.service_occurrence is 'Concrete service references used by rides without implementing the later schedule-management phase.';
comment on table private.user_place is 'Protected pre-map meeting-place labels; coordinates and stable approximate geometry remain in the Maps phase.';
comment on table app.passenger_request is 'Server-owned multi-user passenger requests.';
comment on table app.driver_offer_series is 'Bounded regular driver series; capacity remains occurrence-specific.';
comment on table app.driver_offer_occurrence is 'Date-specific driver capacity, including one-time and regular occurrences.';
