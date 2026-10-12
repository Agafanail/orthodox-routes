-- Church text is independent of the public address and route-measurement lifecycle.
alter table app.church
  add column description_source text,
  add column content_version integer not null default 1,
  add constraint church_description_safe check (
    description_source is null or (
      char_length(description_source) between 1 and 4000
      and translate(description_source, E'\n\r', '') !~ '[[:cntrl:]]'
    )
  ),
  add constraint church_content_version_positive check (content_version > 0);

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type
  check (operation_type in ('create_church', 'invite_church_admin', 'update_church_content'));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.update_church_content(
  p_church_id uuid, p_official_name text, p_description_source text,
  p_expected_version integer, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  normalized_name text := btrim(coalesce(p_official_name, ''));
  normalized_description text := nullif(btrim(p_description_source), '');
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null or p_expected_version is null
    or p_expected_version < 1
    or char_length(normalized_name) not between 1 and 200
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_description is not null and (
      char_length(normalized_description) > 4000
      or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Church content input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'official_name', normalized_name,
    'description_source', normalized_description, 'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':update_church_content:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_church_content', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select * into church_row from app.church as church
  where church.public_id = p_church_id for update;
  if not found or church_row.status not in ('published', 'hidden', 'archive_requested')
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  if church_row.content_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Church content changed; reload it before editing.';
  end if;
  if church_row.official_name is distinct from normalized_name
    or church_row.description_source is distinct from normalized_description then
    update app.church as church
    set official_name = normalized_name, description_source = normalized_description,
      content_version = church.content_version + 1, updated_at = clock_timestamp()
    where church.id = church_row.id returning * into church_row;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'church.content_updated');
  end if;
  result := jsonb_build_object('status', 'saved', 'church_id', church_row.public_id,
    'content_version', church_row.content_version);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_church_content', p_client_key, input_digest, result);
  return result;
end;
$$;

create or replace function api.current_managed_churches()
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
    'description_source', church.description_source,
    'content_version', church.content_version,
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
    'lat', extensions.st_y(church.location::extensions.geometry),
    'lng', extensions.st_x(church.location::extensions.geometry)
  ))
  from app.church as church
  where church.slug = p_slug and church.status = 'published';
$$;

revoke all on function api.update_church_content(uuid, text, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.update_church_content(uuid, text, text, integer, uuid)
  to authenticated;

comment on function api.update_church_content(uuid, text, text, integer, uuid) is
  'Edits public church source text for a current eligible administrator with optimistic concurrency and actor-scoped idempotency.';
