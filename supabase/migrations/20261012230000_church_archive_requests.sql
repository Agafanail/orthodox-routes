-- Asking for archival does not itself hide a church or change existing transport obligations.
create table app.church_archive_request (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  church_id uuid not null references app.church (id) on delete restrict,
  requested_by uuid references app.account (id) on delete set null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  resolved_at timestamptz,
  constraint church_archive_request_status check (status in ('pending', 'cancelled', 'resolved')),
  constraint church_archive_request_lifecycle check (
    (status = 'pending' and cancelled_at is null and resolved_at is null)
    or (status = 'cancelled' and cancelled_at is not null and resolved_at is null)
    or (status = 'resolved' and cancelled_at is null and resolved_at is not null)
  )
);
create unique index church_archive_one_pending
  on app.church_archive_request (church_id) where status = 'pending';
create index church_archive_request_church_time
  on app.church_archive_request (church_id, requested_at desc);
alter table app.church_archive_request enable row level security;
alter table app.church_archive_request force row level security;
revoke all on table app.church_archive_request from public, anon, authenticated, service_role;

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content',
  'create_one_off_service', 'cancel_one_off_service',
  'request_church_archival', 'cancel_church_archival_request'
));

create function api.request_church_archival(p_church_id uuid, p_client_key uuid)
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
  request_row app.church_archive_request%rowtype;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null then
    raise exception using errcode = '22023', message = 'Church archival request input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':request_church_archival:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'request_church_archival', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select * into church_row from app.church as church
  where church.public_id = p_church_id for update;
  if not found or church_row.status <> 'published'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;

  select * into request_row from app.church_archive_request as archive_request
  where archive_request.church_id = church_row.id and archive_request.status = 'pending';
  if found then
    result := jsonb_build_object('status', 'already_requested',
      'church_id', church_row.public_id, 'request_id', request_row.public_id);
  else
    insert into app.church_archive_request (church_id, requested_by)
    values (church_row.id, actor_id) returning * into request_row;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'archive.requested');
    result := jsonb_build_object('status', 'requested',
      'church_id', church_row.public_id, 'request_id', request_row.public_id);
  end if;
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'request_church_archival', p_client_key, input_digest, result);
  return result;
end;
$$;

create function api.cancel_church_archival_request(
  p_church_id uuid, p_request_id uuid, p_client_key uuid
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
  request_row app.church_archive_request%rowtype;
  result jsonb;
begin
  if p_church_id is null or p_request_id is null or p_client_key is null then
    raise exception using errcode = '22023', message = 'Church archival cancellation input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'request_id', p_request_id
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':cancel_church_archival_request:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'cancel_church_archival_request', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select * into church_row from app.church as church
  where church.public_id = p_church_id for update;
  if not found or church_row.status not in ('published', 'hidden')
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  select * into request_row from app.church_archive_request as archive_request
  where archive_request.church_id = church_row.id
    and archive_request.public_id = p_request_id for update;
  if not found or request_row.status <> 'pending' then
    raise exception using errcode = '22023', message = 'The church archival request is no longer pending.';
  end if;
  update app.church_archive_request set status = 'cancelled', cancelled_at = clock_timestamp()
  where id = request_row.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (church_row.id, actor_id, 'archive.request_cancelled');
  result := jsonb_build_object('status', 'cancelled',
    'church_id', church_row.public_id, 'request_id', request_row.public_id);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'cancel_church_archival_request', p_client_key, input_digest, result);
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

revoke all on function api.request_church_archival(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.request_church_archival(uuid, uuid) to authenticated;
revoke all on function api.cancel_church_archival_request(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.cancel_church_archival_request(uuid, uuid, uuid) to authenticated;

comment on table app.church_archive_request is
  'Protected owner-review request; creation alone does not change church visibility or ride obligations.';
