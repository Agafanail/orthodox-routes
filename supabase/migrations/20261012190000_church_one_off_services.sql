-- A one-off service is a concrete reference. Existing ride snapshots are never rewritten.
alter table app.service_occurrence
  add column source_description text,
  add column source_kind text not null default 'one_off',
  add column created_by uuid references app.account (id) on delete set null,
  add constraint service_description_safe check (
    source_description is null or (
      char_length(source_description) between 1 and 4000
      and translate(source_description, E'\n\r', '') !~ '[[:cntrl:]]'
    )
  ),
  add constraint service_source_kind check (source_kind = 'one_off');

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type
  check (operation_type in (
    'create_church', 'invite_church_admin', 'update_church_content', 'create_one_off_service'
  ));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'service.created',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.create_one_off_service(
  p_church_id uuid, p_source_name text, p_source_description text,
  p_starts_at timestamptz, p_client_key uuid
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
  created_service app.service_occurrence%rowtype;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null or p_starts_at is null
    or char_length(normalized_name) not between 1 and 160
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_description is not null and (
      char_length(normalized_description) > 4000
      or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Service input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'source_name', normalized_name,
    'source_description', normalized_description, 'starts_at', p_starts_at
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':create_one_off_service:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'create_one_off_service', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;
  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'Service must start in the future.';
  end if;

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

  insert into app.service_occurrence (
    church_id, source_name, source_description, starts_at, timezone, created_by
  ) values (
    church_row.id, normalized_name, normalized_description, p_starts_at,
    church_row.timezone, actor_id
  ) returning * into created_service;
  update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = church_row.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (church_row.id, actor_id, 'service.created');
  result := jsonb_build_object(
    'status', 'created', 'church_id', church_row.public_id,
    'service_id', created_service.public_id, 'version', created_service.version
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'create_one_off_service', p_client_key, input_digest, result);
  return result;
end;
$$;

create function api.published_church_schedule(p_church_id uuid, p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'service_id', service.public_id,
    'source_name', service.source_name,
    'description', service.source_description,
    'starts_at', service.starts_at,
    'timezone', service.timezone,
    'status', service.status,
    'version', service.version
  )) order by service.starts_at, service.public_id), '[]'::jsonb)
  from (
    select occurrence.*
    from app.service_occurrence as occurrence
    join app.church as church on church.id = occurrence.church_id
    where church.public_id = p_church_id and church.status = 'published'
      and occurrence.starts_at >= now()
    order by occurrence.starts_at, occurrence.public_id
    limit greatest(0, least(coalesce(p_limit, 50), 100))
  ) as service;
$$;

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
    'description', church.description_source,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone,
    'schedule_updated_at', church.schedule_updated_at,
    'lat', extensions.st_y(church.location::extensions.geometry),
    'lng', extensions.st_x(church.location::extensions.geometry)
  ))
  from app.church as church
  where church.slug = p_slug and church.status = 'published';
$$;

revoke all on function api.create_one_off_service(uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.create_one_off_service(uuid, text, text, timestamptz, uuid)
  to authenticated;
revoke all on function api.published_church_schedule(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function api.published_church_schedule(uuid, integer)
  to anon, authenticated;

comment on function api.create_one_off_service(uuid, text, text, timestamptz, uuid) is
  'Creates one future date-specific church service for an eligible current administrator.';
comment on function api.published_church_schedule(uuid, integer) is
  'Returns a bounded, chronological public schedule for a published church.';
