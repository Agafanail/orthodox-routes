-- Maps campaign, checkpoint C: the protected geographic foundation.
--
-- Replaces the interim pre-map text-label representation with application-owned exact
-- coordinates plus a stable, deliberately off-centre public approximation. There is no
-- public driver route geometry: a driver is represented publicly by an approximate
-- departure area only.

create extension if not exists postgis with schema extensions;

-- ------------------------------------------------------------------ approximation secret

create table private.geo_approximation_secret (
  id smallint primary key,
  approximation_version smallint not null,
  pepper bytea not null,
  created_at timestamptz not null default now(),
  constraint geo_secret_single_row check (id = 1),
  constraint geo_secret_version check (approximation_version > 0),
  constraint geo_secret_pepper_length check (octet_length(pepper) = 32)
);

alter table private.geo_approximation_secret enable row level security;
alter table private.geo_approximation_secret force row level security;
revoke all on table private.geo_approximation_secret from public, anon, authenticated, service_role;

insert into private.geo_approximation_secret (id, approximation_version, pepper)
values (1, 1, extensions.gen_random_bytes(32));

-- The public centre is a deterministic function of a coarse grid cell, the owner, and a
-- database-owned pepper. Determinism is the privacy property: republishing the same place
-- reproduces the same circle, so an observer cannot average several independent offsets to
-- recover the exact point. Including the owner keeps two people who choose the same building
-- from receiving the same circle.
create function app.public_area_center(exact_point extensions.geography, owner_id uuid)
returns extensions.geography
language plpgsql
stable
set search_path = ''
as $$
declare
  cell_degrees constant double precision := 0.001;
  minimum_offset constant double precision := 300.0;
  offset_span constant double precision := 400.0;
  pepper bytea;
  latitude double precision;
  longitude double precision;
  cell text;
  material bytea;
  bearing double precision;
  offset_metres double precision;
begin
  if exact_point is null or owner_id is null then
    return null;
  end if;

  select secret.pepper into pepper from private.geo_approximation_secret as secret where secret.id = 1;
  if pepper is null then
    raise exception using errcode = '55000', message = 'The geographic approximation secret is unavailable.';
  end if;

  latitude := extensions.st_y(exact_point::extensions.geometry);
  longitude := extensions.st_x(exact_point::extensions.geometry);
  cell := floor(latitude / cell_degrees)::bigint::text || ':'
    || floor(longitude / cell_degrees)::bigint::text || ':' || owner_id::text;
  material := extensions.hmac(convert_to(cell, 'UTF8'), pepper, 'sha256');

  bearing := (
    get_byte(material, 0)::double precision * 65536
    + get_byte(material, 1)::double precision * 256
    + get_byte(material, 2)::double precision
  ) / 16777216.0 * 2 * pi();
  offset_metres := minimum_offset + (
    get_byte(material, 3)::double precision * 256 + get_byte(material, 4)::double precision
  ) / 65536.0 * offset_span;

  return extensions.st_project(exact_point, offset_metres, bearing);
end;
$$;

create function app.current_approximation_version()
returns smallint
language sql
stable
set search_path = ''
as $$
  select secret.approximation_version from private.geo_approximation_secret as secret where secret.id = 1;
$$;

-- ------------------------------------------------------------------ church geography

alter table app.church
  add column location extensions.geography(Point, 4326);

-- Existing published churches predate the Maps phase, so the rule is enforced for every new
-- or updated row without rewriting history that no production system holds.
alter table app.church
  add constraint church_published_location
  check (status <> 'published' or location is not null) not valid;

create index church_location_gist on app.church using gist (location);

-- ------------------------------------------------------------------ user places

alter table private.user_place
  rename column exact_label to exact_address;
alter table private.user_place
  rename column public_area_label to public_area_name;

alter table private.user_place
  rename constraint user_place_exact_label to user_place_exact_address;
alter table private.user_place
  rename constraint user_place_public_label to user_place_public_area_name;

alter table private.user_place
  add column exact_location extensions.geography(Point, 4326),
  add column normalized_address text,
  add column locality text,
  add column country_code text,
  add column source_kind text,
  add column provider_place_id text,
  add column public_center extensions.geography(Point, 4326),
  add column public_radius_m integer not null default 1000,
  add column approximation_version smallint,
  add column saved boolean not null default false,
  add column saved_label text,
  add column anonymized_at timestamptz;

alter table private.user_place
  add constraint user_place_source_kind check (
    source_kind is null or source_kind in ('user_pin', 'user_confirmed_geocode', 'place_selection')
  ),
  add constraint user_place_point_metadata check (
    (exact_location is null) = (source_kind is null)
  ),
  add constraint user_place_public_pair check (
    exact_location is null or (public_center is not null and approximation_version is not null)
  ),
  add constraint user_place_radius check (public_radius_m = 1000),
  add constraint user_place_country check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add constraint user_place_locality check (
    locality is null or (char_length(locality) between 1 and 120 and locality !~ '[[:cntrl:]]')
  ),
  add constraint user_place_normalized_address check (
    normalized_address is null
    or (char_length(normalized_address) between 1 and 300 and normalized_address !~ '[[:cntrl:]]')
  ),
  add constraint user_place_provider_place_id check (
    provider_place_id is null or provider_place_id ~ '^[A-Za-z0-9_:.-]{1,255}$'
  ),
  add constraint user_place_saved_label check (
    saved_label is null
    or (saved and char_length(saved_label) between 1 and 60 and saved_label !~ '[[:cntrl:]]')
  ),
  add constraint user_place_anonymized check (
    anonymized_at is null or (exact_location is null and not saved)
  ),
  -- The exact point must lie inside the published circle, and the centre must never be the
  -- point itself: a centred circle would publish the exact location it is meant to hide.
  add constraint user_place_public_contains_exact check (
    exact_location is null
    or (
      extensions.st_dwithin(exact_location, public_center, public_radius_m::double precision)
      and extensions.st_distance(exact_location, public_center) >= 100
    )
  );

create index user_place_exact_location_gist on private.user_place using gist (exact_location);
create index user_place_public_center_gist on private.user_place using gist (public_center);
create index user_place_saved_lookup on private.user_place (owner_account_id, created_at desc)
  where saved and anonymized_at is null;

comment on table private.user_place is
  'Protected exact user places with a stable, deliberately off-centre public approximation. A saved place lives until its owner deletes it; ride-linked exact data follows the agreement retention rules.';
comment on column private.user_place.exact_address is
  'Protected exact address text. Never present in an anonymous projection.';
comment on column private.user_place.public_area_name is
  'System-derived public area name. It is never user-entered: the person selects only the real place.';
comment on column private.user_place.public_center is
  'Application-owned approximate centre. Deliberately offset so the exact point cannot be inferred from it.';
comment on column private.user_place.saved is
  'A saved place is reusable and is exempt from ride exact-data retention until its owner deletes it.';

-- ------------------------------------------------------------------ place helpers

create function app.safe_place_label(value text, maximum_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is null or (
    char_length(value) between 1 and maximum_length
    and value = btrim(value)
    and value !~ '[[:cntrl:]]'
  );
$$;

-- Materializes one protected place from confirmed user input and derives its public
-- representation. The caller never supplies a public area: the system owns it.
create function app.create_user_place(actor_id uuid, place jsonb, keep_saved boolean default false)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  latitude double precision;
  longitude double precision;
  exact_point extensions.geography;
  address text;
  locality_name text;
  country text;
  kind text;
  provider_reference text;
  label text;
  place_id uuid;
begin
  if jsonb_typeof(place) <> 'object' then
    raise exception using errcode = '22023', message = 'The selected place is invalid.';
  end if;

  if jsonb_typeof(place->'lat') <> 'number' or jsonb_typeof(place->'lng') <> 'number' then
    raise exception using errcode = '22023', message = 'The selected place is invalid.';
  end if;

  latitude := (place->>'lat')::double precision;
  longitude := (place->>'lng')::double precision;
  address := nullif(btrim(place->>'address'), '');
  locality_name := nullif(btrim(place->>'locality'), '');
  country := nullif(btrim(place->>'country_code'), '');
  kind := nullif(btrim(place->>'source_kind'), '');
  provider_reference := nullif(btrim(place->>'provider_place_id'), '');
  label := nullif(btrim(place->>'label'), '');

  if latitude is null or longitude is null
    or latitude < -85 or latitude > 85 or longitude < -180 or longitude > 180
    or address is null or char_length(address) > 300 or address ~ '[[:cntrl:]]'
    or kind is null or kind not in ('user_pin', 'user_confirmed_geocode', 'place_selection')
    or not app.safe_place_label(locality_name, 120)
    or (country is not null and country !~ '^[A-Z]{2}$')
    or (provider_reference is not null and provider_reference !~ '^[A-Za-z0-9_:.-]{1,255}$')
    or not app.safe_place_label(label, 60)
    or (label is not null and not keep_saved)
  then
    raise exception using errcode = '22023', message = 'The selected place is invalid.';
  end if;

  exact_point := extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography;

  insert into private.user_place (
    owner_account_id, exact_address, public_area_name, exact_location, normalized_address,
    locality, country_code, source_kind, provider_place_id, public_center,
    approximation_version, saved, saved_label
  ) values (
    actor_id,
    address,
    coalesce(locality_name, country, 'Примерная область'),
    exact_point,
    address,
    locality_name,
    country,
    kind,
    provider_reference,
    app.public_area_center(exact_point, actor_id),
    app.current_approximation_version(),
    keep_saved,
    label
  ) returning id into place_id;

  return place_id;
end;
$$;

-- Resolves either a reusable saved place owned by the actor or a newly confirmed place.
create function app.resolve_user_place(actor_id uuid, place jsonb)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  saved_reference uuid;
  resolved_id uuid;
begin
  if jsonb_typeof(place) <> 'object' then
    raise exception using errcode = '22023', message = 'The selected place is invalid.';
  end if;

  if nullif(btrim(place->>'saved_place_id'), '') is not null then
    begin
      saved_reference := (place->>'saved_place_id')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'The selected place is invalid.';
    end;

    select source.id into resolved_id
    from private.user_place as source
    where source.public_id = saved_reference
      and source.owner_account_id = actor_id
      and source.saved
      and source.anonymized_at is null
      and source.exact_location is not null;

    if resolved_id is null then
      raise exception using errcode = 'P0002', message = 'The saved place is unavailable.';
    end if;

    -- A publication copies the saved place so that deleting the saved entry later never
    -- rewrites geography an active listing or a confirmed agreement already relies on.
    insert into private.user_place (
      owner_account_id, exact_address, public_area_name, exact_location, normalized_address,
      locality, country_code, source_kind, provider_place_id, public_center,
      approximation_version, saved
    )
    select source.owner_account_id, source.exact_address, source.public_area_name,
      source.exact_location, source.normalized_address, source.locality, source.country_code,
      source.source_kind, source.provider_place_id, source.public_center,
      source.approximation_version, false
    from private.user_place as source
    where source.id = resolved_id
    returning id into resolved_id;

    return resolved_id;
  end if;

  return app.create_user_place(actor_id, place, coalesce((place->>'save')::boolean, false));
end;
$$;

-- The published centre is rounded to about a metre. A circle of a kilometre needs no more, and
-- publishing thirteen decimals would only add noise to every public payload.
create function app.public_place_shape(place private.user_place)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when place.public_center is null then jsonb_build_object(
    'place_id', place.public_id,
    'public_area_label', place.public_area_name
  ) else jsonb_build_object(
    'place_id', place.public_id,
    'public_area_label', place.public_area_name,
    'public_area', jsonb_build_object(
      'lat', round(extensions.st_y(place.public_center::extensions.geometry)::numeric, 5),
      'lng', round(extensions.st_x(place.public_center::extensions.geometry)::numeric, 5),
      'radius_m', place.public_radius_m
    )
  ) end;
$$;

create function app.exact_place_shape(place private.user_place)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'place_id', place.public_id,
    'exact_address', place.exact_address,
    'locality', place.locality,
    'country_code', place.country_code,
    'exact_point', case when place.exact_location is null then null else jsonb_build_object(
      'lat', extensions.st_y(place.exact_location::extensions.geometry),
      'lng', extensions.st_x(place.exact_location::extensions.geometry)
    ) end
  ));
$$;

-- ------------------------------------------------------------------ saved places

create function api.list_saved_places()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'place_id', place.public_id,
    'label', place.saved_label,
    'exact_address', place.exact_address,
    'locality', place.locality,
    'country_code', place.country_code,
    'lat', extensions.st_y(place.exact_location::extensions.geometry),
    'lng', extensions.st_x(place.exact_location::extensions.geometry),
    'created_at', place.created_at
  ) order by place.created_at desc), '[]'::jsonb)
  from private.user_place as place, actor
  where place.owner_account_id = actor.id
    and place.saved
    and place.anonymized_at is null
    and place.exact_location is not null;
$$;

create function api.save_place(p_place jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  saved_count integer;
  place_id uuid;
  place_public_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated account is required.';
  end if;

  select count(*) into saved_count
  from private.user_place as place
  where place.owner_account_id = actor_id and place.saved and place.anonymized_at is null;
  if saved_count >= 20 then
    raise exception using errcode = '23514', message = 'The saved place limit is reached.';
  end if;

  place_id := app.create_user_place(actor_id, p_place, true);
  select place.public_id into place_public_id from private.user_place as place where place.id = place_id;
  return jsonb_build_object('place_id', place_public_id, 'status', 'saved');
end;
$$;

create function api.rename_saved_place(p_place_id uuid, p_label text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  label text := nullif(btrim(p_label), '');
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated account is required.';
  end if;
  if not app.safe_place_label(label, 60) then
    raise exception using errcode = '22023', message = 'The place name is invalid.';
  end if;

  update private.user_place
  set saved_label = label
  where public_id = p_place_id and owner_account_id = actor_id and saved and anonymized_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'The saved place is unavailable.';
  end if;
  return jsonb_build_object('place_id', p_place_id, 'status', 'renamed');
end;
$$;

-- Deleting a saved place removes only the reusable entry. Copies already bound to a listing or
-- a confirmed agreement are separate rows and keep their own retention rules.
create function api.delete_saved_place(p_place_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  place_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'An authenticated account is required.';
  end if;

  select place.id into place_id
  from private.user_place as place
  where place.public_id = p_place_id and place.owner_account_id = actor_id and place.saved;
  if place_id is null then
    raise exception using errcode = 'P0002', message = 'The saved place is unavailable.';
  end if;

  delete from private.user_place where id = place_id;
  return jsonb_build_object('place_id', p_place_id, 'status', 'deleted');
end;
$$;

-- ------------------------------------------------------------------ church projections

-- The church location is public and exact, so it joins the existing safe church projection
-- rather than becoming a second endpoint. It stays null only for a church created before the
-- Maps migration, which the catalog map simply does not plot.
create or replace function api.transport_church_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'church_id', church.public_id,
    'slug', church.slug,
    'official_name', church.official_name,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone,
    'lat', extensions.st_y(church.location::extensions.geometry),
    'lng', extensions.st_x(church.location::extensions.geometry)
  ))
  from app.church as church
  where church.slug = p_slug and church.status = 'published';
$$;

-- One catalog entry point: universal text search, optional viewport bounds, and optional
-- proximity ordering. Proximity is used only when the caller supplies a location, because the
-- device location is requested only after an explicit user action.
create function api.search_published_churches(
  p_query text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_south double precision default null,
  p_west double precision default null,
  p_north double precision default null,
  p_east double precision default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounded as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as query,
      case
        when p_lat is null or p_lng is null or p_lat < -85 or p_lat > 85
          or p_lng < -180 or p_lng > 180 then null
        else extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      end as near,
      case
        when p_south is null or p_west is null or p_north is null or p_east is null then null
        else extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography
      end as viewport,
      least(greatest(coalesce(p_limit, 50), 1), 200) as row_limit
  ),
  matched as (
    select church.public_id, church.slug, church.official_name, church.address_display,
      church.locality, church.country_code, church.timezone, church.location,
      case when bounded.near is null then null
        else extensions.st_distance(church.location, bounded.near) end as distance_m
    from app.church as church, bounded
    where church.status = 'published'
      and church.location is not null
      and (
        bounded.query is null
        or church.official_name ilike '%' || bounded.query || '%'
        or church.locality ilike '%' || bounded.query || '%'
        or church.country_code ilike bounded.query
      )
      and (bounded.viewport is null or extensions.st_intersects(church.location, bounded.viewport))
    order by
      case when bounded.near is null then null
        else extensions.st_distance(church.location, bounded.near) end asc nulls last,
      church.official_name asc
    limit (select row_limit from bounded)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'church_id', matched.public_id,
    'slug', matched.slug,
    'official_name', matched.official_name,
    'address', matched.address_display,
    'locality', matched.locality,
    'country_code', matched.country_code,
    'timezone', matched.timezone,
    'lat', extensions.st_y(matched.location::extensions.geometry),
    'lng', extensions.st_x(matched.location::extensions.geometry),
    'distance_m', case when matched.distance_m is null then null else round(matched.distance_m)::bigint end
  ) order by matched.distance_m asc nulls last, matched.official_name asc), '[]'::jsonb)
  from matched;
$$;

-- ------------------------------------------------------------------ publication rewrite

drop function api.publish_passenger_request(uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid);
drop function api.publish_driver_occurrence(uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid);
drop function api.publish_driver_series(uuid, smallint[], time, time, text, date, date, integer, integer, boolean, boolean, boolean, text, text, text, uuid);
drop function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid);
drop function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid);

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
    place_id := app.resolve_user_place(actor_id, place);
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
  p_origin jsonb,
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
    'note', nullif(btrim(p_public_note), ''), 'origin', p_origin
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
    or not app.safe_public_transport_text(nullif(btrim(p_public_note), ''), 300)
  then
    raise exception using errcode = '22023', message = 'Driver offer input is invalid.';
  end if;

  select * into reference from app.assert_transport_reference(p_church_id, p_service_occurrence_id, p_arrival_at);
  place_id := app.resolve_user_place(actor_id, p_origin);

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
  p_origin jsonb,
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
    'church', p_church_id, 'weekdays', to_jsonb(p_weekdays),
    'departure_time', p_local_departure_time, 'arrival_time', p_local_arrival_time,
    'timezone', p_timezone, 'starts_on', p_starts_on,
    'ends_on', p_ends_on, 'seats', p_total_seats, 'detour', p_max_detour_km,
    'children', p_children_allowed, 'child_seat', p_driver_child_seat_available,
    'return', p_return_available, 'note', nullif(btrim(p_public_note), ''),
    'origin', p_origin
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  church_reference uuid;
  place_id uuid;
  series_id uuid;
  series_public_id uuid;
  occurrence_date date;
  occurrence_public_id uuid;
  first_occurrence_public_id uuid;
  occurrence_count integer := 0;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':publish_driver_series:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'publish_driver_series', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  if p_weekdays is null or cardinality(p_weekdays) not between 1 and 7
    or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
    or p_local_departure_time is null or p_local_arrival_time is null
    or p_local_departure_time >= p_local_arrival_time
    or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)
    or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
    or p_ends_on > p_starts_on + 55
    or p_total_seats not between 1 and 55 or p_max_detour_km not in (0, 2, 5, 10, 15, 20)
    or (not p_children_allowed and p_driver_child_seat_available)
    or not app.safe_public_transport_text(nullif(btrim(p_public_note), ''), 300)
  then
    raise exception using errcode = '22023', message = 'Driver series input is invalid.';
  end if;

  select church.id into church_reference
  from app.church as church
  where church.public_id = p_church_id and church.status = 'published';
  if church_reference is null then
    raise exception using errcode = 'P0002', message = 'The church is unavailable.';
  end if;

  place_id := app.resolve_user_place(actor_id, p_origin);

  insert into app.driver_offer_series (
    author_account_id, church_id, recurrence_weekdays, local_departure_time, local_arrival_time,
    timezone, starts_on, ends_on, total_seats_default, max_detour_km, children_allowed,
    driver_child_seat_available, return_available, public_note, status
  ) values (
    actor_id, church_reference, p_weekdays, p_local_departure_time, p_local_arrival_time,
    p_timezone, p_starts_on, p_ends_on, p_total_seats, p_max_detour_km, p_children_allowed,
    p_driver_child_seat_available, p_return_available, nullif(btrim(p_public_note), ''), 'active'
  ) returning id, public_id into series_id, series_public_id;

  for occurrence_date in select day::date from generate_series(p_starts_on, p_ends_on, interval '1 day') as day
    where extract(dow from day)::smallint = any(p_weekdays)
  loop
    insert into app.driver_offer_occurrence (
      publication_key, series_id, author_account_id, church_id, departure_at, arrival_at,
      timezone, origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available, public_note
    ) values (
      gen_random_uuid(), series_id, actor_id, church_reference,
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

create function api.publish_contextual_passenger_response(
  p_occurrence_id uuid,
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
  request_result jsonb;
begin
  request_result := api.publish_passenger_request(
    p_church_id, p_service_occurrence_id, p_desired_arrival_at, p_timezone,
    p_total_passengers, p_children_count, p_child_seat_required, p_return_required,
    p_public_note, p_places, p_client_key
  );
  return api.submit_passenger_response(
    (request_result->>'request_id')::uuid,
    p_occurrence_id,
    p_client_key
  );
end;
$$;

create function api.publish_contextual_driver_response(
  p_request_id uuid,
  p_place_id uuid,
  p_offered_passenger_count integer,
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
  p_origin jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  occurrence_result jsonb;
begin
  occurrence_result := api.publish_driver_occurrence(
    p_church_id, p_service_occurrence_id, p_departure_at, p_arrival_at, p_timezone,
    p_total_seats, p_max_detour_km, p_children_allowed, p_driver_child_seat_available,
    p_return_available, p_public_note, p_origin, p_client_key
  );
  return api.submit_driver_response(
    p_request_id,
    (occurrence_result->>'occurrence_id')::uuid,
    p_place_id,
    p_offered_passenger_count,
    p_client_key
  );
end;
$$;

-- ------------------------------------------------------------------ projections

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
      select jsonb_agg(app.public_place_shape(place.*) order by link.position)
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

create or replace function api.list_active_driver_occurrences(p_church_id uuid default null)
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
    'public_origin_area', place.public_area_name,
    'origin_area', app.public_place_shape(place.*)
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

create or replace function api.current_transport_items()
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
      'status', request.status, 'places', (select jsonb_agg(
        app.exact_place_shape(place.*) || jsonb_build_object('position', link.position)
        order by link.position
      ) from app.passenger_request_place as link join private.user_place as place on place.id = link.user_place_id where link.request_id = request.id)
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
      'origin', app.exact_place_shape(place.*)
    ) order by occurrence.arrival_at) from app.driver_offer_occurrence as occurrence
      join app.church as church on church.id = occurrence.church_id
      join private.user_place as place on place.id = occurrence.origin_place_id
      left join app.driver_offer_series as series on series.id = occurrence.series_id, actor
      where occurrence.author_account_id = actor.id), '[]'::jsonb)
  );
$$;

-- A pending response names the selected meeting place only by its approximate public area.
-- The exact place is disclosed after confirmation, never while a response is still pending.
create or replace function api.current_ride_responses()
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
    'current_role', case when actor.id = response.passenger_account_id then 'passenger' else 'driver' end,
    'request_id', request.public_id,
    'occurrence_id', occurrence.public_id,
    'passenger_name', passenger.display_name,
    'driver_name', driver.display_name,
    'offered_passenger_count', response.offered_passenger_count,
    'selected_place', case when response.selected_request_place_id is null then null
      else app.public_place_shape(place.*) end,
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

-- ------------------------------------------------------------------ agreement disclosure

alter table app.ride_agreement
  add column driver_origin_place_id uuid references private.user_place (id) on delete restrict;

update app.ride_agreement as agreement
set driver_origin_place_id = occurrence.origin_place_id
from app.driver_offer_occurrence as occurrence
where occurrence.id = agreement.driver_occurrence_id
  and agreement.driver_origin_place_id is null;

-- The driver departure place is never caller input: it is always the departure place of the
-- occurrence the agreement was confirmed against, captured at confirmation time so a later
-- edit to the offer cannot silently change what the passenger was shown.
create function app.fill_ride_agreement_driver_origin()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  select occurrence.origin_place_id into new.driver_origin_place_id
  from app.driver_offer_occurrence as occurrence
  where occurrence.id = new.driver_occurrence_id;
  if new.driver_origin_place_id is null then
    raise exception using errcode = '23502', message = 'The driver departure place is unavailable.';
  end if;
  return new;
end;
$$;

create trigger ride_agreement_driver_origin
before insert on app.ride_agreement
for each row execute function app.fill_ride_agreement_driver_origin();

alter table app.ride_agreement
  alter column driver_origin_place_id set not null;

-- The confirmed passenger receives the driver's exact departure place, and the confirmed
-- driver receives only the one meeting place selected for this agreement. The passenger's
-- other places stay private.
create or replace function api.get_agreement_exact_place(p_agreement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  agreement app.ride_agreement%rowtype;
  meeting jsonb;
  departure jsonb;
begin
  select * into agreement from app.ride_agreement where public_id = p_agreement_id;
  if agreement.id is null or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or agreement.status not in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
    or clock_timestamp() >= agreement.exact_data_delete_due_at
  then
    return null;
  end if;

  select app.exact_place_shape(place.*) into meeting
  from private.user_place as place where place.id = agreement.selected_exact_place_id;
  select app.exact_place_shape(place.*) into departure
  from private.user_place as place where place.id = agreement.driver_origin_place_id;

  return jsonb_build_object(
    'agreement_id', agreement.public_id,
    'exact_meeting_label', meeting->>'exact_address',
    'meeting_place', meeting,
    'departure_place', departure
  );
end;
$$;

-- ------------------------------------------------------------------ retention

create or replace function ops.anonymize_expired_places(p_evaluated_at timestamptz default clock_timestamp())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  anonymized_count integer;
begin
  -- Exact ride geography disappears once every agreement that could disclose it is archived
  -- and its retention deadline has passed. A place the owner deliberately saved is never
  -- removed by this rule: saved-place retention is the owner's decision alone.
  with expired as (
    select place.id
    from private.user_place as place
    where place.anonymized_at is null
      and not place.saved
      and place.exact_location is not null
      and exists (
        select 1 from app.ride_agreement as agreement
        where agreement.selected_exact_place_id = place.id
           or agreement.driver_origin_place_id = place.id
      )
      and not exists (
        select 1 from app.ride_agreement as agreement
        where (agreement.selected_exact_place_id = place.id or agreement.driver_origin_place_id = place.id)
          and (agreement.status <> 'archived' or agreement.exact_data_delete_due_at > p_evaluated_at)
      )
  )
  update private.user_place as place
  set exact_location = null,
      exact_address = 'anonymized',
      normalized_address = null,
      provider_place_id = null,
      source_kind = null,
      anonymized_at = p_evaluated_at,
      retention_due_at = p_evaluated_at
  from expired
  where place.id = expired.id;
  get diagnostics anonymized_count = row_count;

  return jsonb_build_object('anonymized_places', anonymized_count);
end;
$$;

-- ------------------------------------------------------------------ grants

revoke all on function app.public_area_center(extensions.geography, uuid) from public, anon, authenticated, service_role;
revoke all on function app.current_approximation_version() from public, anon, authenticated, service_role;
revoke all on function app.safe_place_label(text, integer) from public, anon, authenticated, service_role;
revoke all on function app.create_user_place(uuid, jsonb, boolean) from public, anon, authenticated, service_role;
revoke all on function app.resolve_user_place(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.public_place_shape(private.user_place) from public, anon, authenticated, service_role;
revoke all on function app.exact_place_shape(private.user_place) from public, anon, authenticated, service_role;
revoke all on function api.list_saved_places() from public, anon, authenticated, service_role;
revoke all on function api.save_place(jsonb) from public, anon, authenticated, service_role;
revoke all on function api.rename_saved_place(uuid, text) from public, anon, authenticated, service_role;
revoke all on function api.delete_saved_place(uuid) from public, anon, authenticated, service_role;
revoke all on function api.search_published_churches(text, double precision, double precision, double precision, double precision, double precision, double precision, integer) from public, anon, authenticated, service_role;
revoke all on function api.publish_passenger_request(uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_driver_occurrence(uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_driver_series(uuid, smallint[], time, time, text, date, date, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function app.fill_ride_agreement_driver_origin() from public, anon, authenticated, service_role;
revoke all on function ops.anonymize_expired_places(timestamptz) from public, anon, authenticated, service_role;

grant execute on function api.search_published_churches(text, double precision, double precision, double precision, double precision, double precision, double precision, integer) to anon, authenticated;
grant execute on function api.list_saved_places() to authenticated;
grant execute on function api.save_place(jsonb) to authenticated;
grant execute on function api.rename_saved_place(uuid, text) to authenticated;
grant execute on function api.delete_saved_place(uuid) to authenticated;
grant execute on function api.publish_passenger_request(uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_driver_occurrence(uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_driver_series(uuid, smallint[], time, time, text, date, date, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, jsonb, uuid) to authenticated;

comment on function app.public_area_center(extensions.geography, uuid) is
  'Deterministic privacy offset. Repeated publication of one place reproduces one circle, so several public centres cannot be averaged back to the exact point.';
comment on function api.search_published_churches(text, double precision, double precision, double precision, double precision, double precision, double precision, integer) is
  'Public church catalog search with optional viewport bounds and optional proximity ordering. Proximity applies only when the caller supplies a location after an explicit user action.';
comment on function api.get_agreement_exact_place(uuid) is
  'Discloses the one selected meeting place and the driver exact departure place to the two participants only. Unused passenger places are never included.';
comment on function ops.anonymize_expired_places(timestamptz) is
  'Removes exact ride geography after every disclosing agreement is archived and expired. Saved places are excluded by design.';
