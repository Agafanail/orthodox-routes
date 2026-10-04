alter table app.church
  add column address_fingerprint text,
  add column deduplication_exempt boolean not null default false,
  add constraint church_address_fingerprint
    check (address_fingerprint is null or address_fingerprint ~ '^[0-9a-f]{64}$');

create unique index church_active_address_fingerprint
  on app.church (address_fingerprint)
  where address_fingerprint is not null
    and not deduplication_exempt
    and status in ('published', 'hidden', 'archive_requested');

create table app.church_slug_history (
  slug text primary key,
  church_id uuid not null references app.church (id) on delete restrict,
  became_active_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint church_slug_history_slug check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint church_slug_history_time check (retired_at is null or retired_at >= became_active_at)
);

insert into app.church_slug_history (slug, church_id, became_active_at)
select church.slug, church.id, church.created_at from app.church as church;

create table app.church_admin_membership (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  church_id uuid not null references app.church (id) on delete restrict,
  account_id uuid not null references app.account (id) on delete restrict,
  status text not null default 'active',
  access_source text not null,
  accepted_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_admin_membership_status
    check (status in ('active', 'transferring', 'ended')),
  constraint church_admin_membership_source
    check (access_source in ('creator', 'invite', 'protected_repair')),
  constraint church_admin_membership_state
    check ((status = 'ended') = (ended_at is not null)),
  constraint church_admin_membership_time
    check (accepted_at >= created_at and (ended_at is null or ended_at >= accepted_at))
);

create unique index church_admin_membership_active_pair
  on app.church_admin_membership (church_id, account_id)
  where status in ('active', 'transferring');

create index church_admin_membership_account
  on app.church_admin_membership (account_id, accepted_at desc)
  where status in ('active', 'transferring');

create table app.church_admin_event (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app.church (id) on delete restrict,
  actor_account_id uuid references app.account (id) on delete set null,
  subject_account_id uuid references app.account (id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  constraint church_admin_event_type check (event_type in (
    'church.created', 'membership.joined', 'membership.transferred',
    'membership.left', 'archive.requested', 'archive.request_cancelled'
  ))
);

create index church_admin_event_church_time
  on app.church_admin_event (church_id, occurred_at desc);

create table private.church_operation (
  actor_account_id uuid not null references app.account (id) on delete cascade,
  operation_type text not null,
  client_key uuid not null,
  input_digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_account_id, operation_type, client_key),
  constraint church_operation_type check (operation_type = 'create_church'),
  constraint church_operation_digest check (input_digest ~ '^[0-9a-f]{64}$')
);

alter table app.church_slug_history enable row level security;
alter table app.church_slug_history force row level security;
alter table app.church_admin_membership enable row level security;
alter table app.church_admin_membership force row level security;
alter table app.church_admin_event enable row level security;
alter table app.church_admin_event force row level security;
alter table private.church_operation enable row level security;
alter table private.church_operation force row level security;

revoke all on table app.church_slug_history from public, anon, authenticated, service_role;
revoke all on table app.church_admin_membership from public, anon, authenticated, service_role;
revoke all on table app.church_admin_event from public, anon, authenticated, service_role;
revoke all on table private.church_operation from public, anon, authenticated, service_role;

create function app.normalize_church_address(requested_address text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(btrim(requested_address), '[[:space:]]+', ' ', 'g'));
$$;

create function app.enforce_church_admin_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.status not in ('active', 'transferring') then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || new.church_id::text, 0));
  select count(*) into active_count
  from app.church_admin_membership as membership
  where membership.church_id = new.church_id
    and membership.status in ('active', 'transferring')
    and membership.id <> new.id;

  if active_count >= 3 then
    raise exception using errcode = '23514', message = 'A church can have at most three administrator places.';
  end if;
  return new;
end;
$$;

create trigger enforce_church_admin_limit
before insert or update of church_id, status on app.church_admin_membership
for each row execute function app.enforce_church_admin_limit();

create function app.church_operation_result(
  requested_actor uuid,
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
  existing private.church_operation%rowtype;
begin
  select * into existing
  from private.church_operation as operation
  where operation.actor_account_id = requested_actor
    and operation.operation_type = requested_operation
    and operation.client_key = requested_key;
  if not found then return null; end if;
  if existing.input_digest <> requested_digest then
    raise exception using errcode = '22023', message = 'The idempotency key was already used for different church input.';
  end if;
  return existing.result;
end;
$$;

create function api.create_church(
  p_slug text,
  p_official_name text,
  p_source_language text,
  p_address_display text,
  p_locality text,
  p_country_code text,
  p_timezone text,
  p_lat double precision,
  p_lng double precision,
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
  normalized_slug text := lower(btrim(coalesce(p_slug, '')));
  normalized_name text := btrim(coalesce(p_official_name, ''));
  public_address text := btrim(coalesce(p_address_display, ''));
  normalized_address text := app.normalize_church_address(coalesce(p_address_display, ''));
  normalized_locality text := btrim(coalesce(p_locality, ''));
  normalized_country text := upper(btrim(coalesce(p_country_code, '')));
  requested_location extensions.geography(Point, 4326);
  fingerprint text;
  input_digest text;
  existing_result jsonb;
  duplicate app.church%rowtype;
  created app.church%rowtype;
  result jsonb;
begin
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'A church creation idempotency key is required.';
  end if;
  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'Church slug is invalid.';
  end if;
  if char_length(normalized_name) not between 1 and 200 or normalized_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Church name is invalid.';
  end if;
  if p_source_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') then
    raise exception using errcode = '22023', message = 'Church source language is invalid.';
  end if;
  if char_length(public_address) not between 1 and 300 or public_address ~ '[[:cntrl:]]'
    or char_length(normalized_address) not between 1 and 300 or normalized_address ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'Church address is invalid.';
  end if;
  if char_length(normalized_locality) not between 1 and 120 or normalized_locality ~ '[[:cntrl:]]'
    or normalized_country !~ '^[A-Z]{2}$'
  then
    raise exception using errcode = '22023', message = 'Church locality or country is invalid.';
  end if;
  if p_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception using errcode = '22023', message = 'Church timezone is invalid.';
  end if;
  if p_lat is null or p_lng is null or p_lat < -85 or p_lat > 85 or p_lng < -180 or p_lng > 180 then
    raise exception using errcode = '22023', message = 'Church location is invalid.';
  end if;

  requested_location := extensions.st_setsrid(
    extensions.st_makepoint(p_lng, p_lat), 4326
  )::extensions.geography;
  fingerprint := encode(extensions.digest(convert_to(normalized_address, 'UTF8'), 'sha256'), 'hex');
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'slug', normalized_slug, 'official_name', normalized_name,
    'source_language', p_source_language, 'address_display', public_address,
    'normalized_address', normalized_address, 'locality', normalized_locality,
    'country_code', normalized_country, 'timezone', p_timezone,
    'lat', p_lat, 'lng', p_lng
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':create_church:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'create_church', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  perform pg_advisory_xact_lock(hashtextextended('church-address:' || fingerprint, 0));
  select church.* into duplicate
  from app.church as church
  where not church.deduplication_exempt
    and church.location is not null
    and coalesce(
      church.address_fingerprint,
      encode(extensions.digest(convert_to(
        app.normalize_church_address(church.address_display), 'UTF8'
      ), 'sha256'), 'hex')
    ) = fingerprint
    and extensions.st_dwithin(church.location, requested_location, 100)
  order by case church.status
    when 'published' then 1 when 'hidden' then 2 when 'archive_requested' then 3
    when 'archived' then 4 else 5 end
  limit 1;

  if found then
    if duplicate.status in ('published', 'archive_requested') then
      result := jsonb_build_object(
        'status', 'duplicate', 'church_id', duplicate.public_id,
        'slug', duplicate.slug, 'safe_route', '/churches/' || duplicate.slug
      );
    elsif duplicate.status = 'archived' then
      result := jsonb_build_object(
        'status', 'archived_match', 'church_id', duplicate.public_id,
        'slug', duplicate.slug, 'safe_route', '/churches/' || duplicate.slug
      );
    else
      result := jsonb_build_object('status', 'potential_duplicate');
    end if;
  elsif exists (
    select 1 from app.church as church
    where not church.deduplication_exempt
      and coalesce(church.address_fingerprint, encode(extensions.digest(convert_to(
        app.normalize_church_address(church.address_display), 'UTF8'
      ), 'sha256'), 'hex')) = fingerprint
  ) then
    result := jsonb_build_object('status', 'potential_duplicate');
  elsif exists (
    select 1 from app.church as church where church.slug = normalized_slug
    union all
    select 1 from app.church_slug_history as history where history.slug = normalized_slug
  ) then
    result := jsonb_build_object('status', 'slug_unavailable');
  else
    insert into app.church (
      slug, official_name, source_language, address_display, locality, country_code,
      timezone, status, created_by, location, address_fingerprint
    ) values (
      normalized_slug, normalized_name, p_source_language, public_address,
      normalized_locality, normalized_country, p_timezone, 'published', actor_id,
      requested_location, fingerprint
    ) returning * into created;

    insert into app.church_slug_history (slug, church_id)
    values (created.slug, created.id);
    insert into app.church_admin_membership (
      church_id, account_id, status, access_source
    ) values (created.id, actor_id, 'active', 'creator');
    insert into app.church_admin_event (
      church_id, actor_account_id, subject_account_id, event_type
    ) values
      (created.id, actor_id, actor_id, 'church.created'),
      (created.id, actor_id, actor_id, 'membership.joined');

    result := jsonb_build_object(
      'status', 'created', 'church_id', created.public_id, 'slug', created.slug,
      'safe_route', '/churches/' || created.slug
    );
  end if;

  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'create_church', p_client_key, input_digest, result);
  return result;
end;
$$;

create function api.current_managed_churches()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'church_id', church.public_id,
    'slug', church.slug,
    'official_name', church.official_name,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone,
    'status', church.status,
    'schedule_updated_at', church.schedule_updated_at,
    'membership_id', membership.public_id,
    'membership_status', membership.status,
    'administrator_count', (
      select count(*) from app.church_admin_membership as counted
      where counted.church_id = church.id and counted.status in ('active', 'transferring')
    )
  ) order by church.official_name, church.public_id), '[]'::jsonb)
  from app.church_admin_membership as membership
  join app.church as church on church.id = membership.church_id
  where membership.account_id = app.current_actor_id()
    and membership.status in ('active', 'transferring');
$$;

revoke all on function app.normalize_church_address(text)
  from public, anon, authenticated, service_role;
revoke all on function app.enforce_church_admin_limit()
  from public, anon, authenticated, service_role;
revoke all on function app.church_operation_result(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function api.create_church(text, text, text, text, text, text, text, double precision, double precision, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.current_managed_churches()
  from public, anon, authenticated, service_role;

grant execute on function api.create_church(text, text, text, text, text, text, text, double precision, double precision, uuid)
  to authenticated;
grant execute on function api.current_managed_churches() to authenticated;

comment on table app.church_admin_membership is
  'Equal church-administrator places; membership grants no access to visitor transport data.';
comment on function api.create_church(text, text, text, text, text, text, text, double precision, double precision, uuid) is
  'Publishes one eligible actor-owned church atomically after conservative address and proximity deduplication.';
comment on function api.current_managed_churches() is
  'Returns only the caller administrative memberships and safe church-management summary fields.';
