-- These deliberately public church details never inherit an account's private contacts.
alter table app.church add column public_contact_details text,
  add constraint church_public_contacts_safe check (
    public_contact_details is null or (
      char_length(public_contact_details) between 1 and 4000
      and btrim(public_contact_details, E' \n\r') <> ''
      and translate(public_contact_details, E'\n\r', '') !~ '[[:cntrl:]]'
    )
  );

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'reschedule_recurring_service_date', 'update_recurring_service_date_content',
  'cancel_recurring_service_future', 'correct_church_content_translation',
  'request_church_archival', 'cancel_church_archival_request', 'update_church_public_contacts'
));

create function api.update_church_public_contacts(
  p_church_id uuid, p_public_contact_details text,
  p_expected_version integer, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_eligible_actor();
  normalized_contacts text := nullif(btrim(p_public_contact_details, E' \n\r'), '');
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null or p_expected_version is null
    or p_expected_version < 1 or (normalized_contacts is not null and (
      char_length(normalized_contacts) > 4000
      or translate(normalized_contacts, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Church public contact input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'public_contact_details', normalized_contacts,
    'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':update_church_public_contacts:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_church_public_contacts', p_client_key, input_digest
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
  if church_row.public_contact_details is distinct from normalized_contacts then
    update app.church as church
    set public_contact_details = normalized_contacts,
      content_version = church.content_version + 1, updated_at = clock_timestamp()
    where church.id = church_row.id returning * into church_row;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'church.content_updated');
  end if;
  result := jsonb_build_object('status', 'saved', 'church_id', church_row.public_id,
    'content_version', church_row.content_version);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_church_public_contacts', p_client_key, input_digest, result);
  return result;
end;
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
    'public_contact_details', church.public_contact_details,
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
    'public_contact_details', church.public_contact_details,
    'content_version', church.content_version,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone,
    'lat', extensions.st_y(church.location::extensions.geometry),
    'lng', extensions.st_x(church.location::extensions.geometry),
    'status', case when church.status = 'published' and exists (
      select 1 from app.church_archive_request as pending_request
      where pending_request.church_id = church.id and pending_request.status = 'pending'
    ) then 'archive_requested' else church.status end,
    'schedule_updated_at', church.schedule_updated_at,
    'membership_id', membership.public_id,
    'membership_status', membership.status,
    'archive_request', (
      select jsonb_build_object('request_id', archive_request.public_id,
        'status', archive_request.status, 'requested_at', archive_request.requested_at)
      from app.church_archive_request as archive_request
      where archive_request.church_id = church.id and archive_request.status = 'pending'
    ),
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

revoke all on function api.update_church_public_contacts(uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.update_church_public_contacts(uuid, text, integer, uuid)
  to authenticated;
comment on column app.church.public_contact_details is
  'Optional administrator-supplied public plain text; never copied from account contacts or sent for machine translation.';
comment on function api.update_church_public_contacts(uuid, text, integer, uuid) is
  'Updates or removes deliberate public church contacts with current membership, shared content version, and actor-scoped retries.';
