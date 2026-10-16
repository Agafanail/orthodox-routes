-- An inactive, narrowly scoped operational role. No login, password, or app-role membership is provisioned.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orthodox_routes_church_operator') then
    create role orthodox_routes_church_operator nologin noinherit nosuperuser
      nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'orthodox_routes_church_operator'
    and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
    or exists (select 1 from pg_auth_members where member =
      (select oid from pg_roles where rolname = 'orthodox_routes_church_operator'))
    or exists (select 1 from pg_roles where rolname in
      ('anon', 'authenticated', 'service_role', 'authenticator', 'supabase_auth_admin', 'supabase_storage_admin')
      and pg_has_role(oid, 'orthodox_routes_church_operator', 'MEMBER')) then
    raise exception using errcode = '55000', message = 'The church operational role has unexpected privileges.';
  end if;
end;
$$;
grant usage on schema ops to orthodox_routes_church_operator;

alter table ops.audit_event drop constraint audit_event_actor_kind_check;
alter table ops.audit_event add constraint audit_event_actor_kind_check
  check (actor_kind in ('account', 'system', 'operator'));
alter table ops.audit_event add column operator_fingerprint text,
  add column support_reference text, add column reason_code text,
  add constraint audit_event_operator_shape check (
    (actor_kind = 'operator' and operator_fingerprint ~ '^[0-9a-f]{64}$'
      and operator_fingerprint is not null and support_reference is not null and reason_code is not null
      and support_reference ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'
      and reason_code in ('reviewed_archival', 'reviewed_restoration'))
    or (actor_kind <> 'operator' and operator_fingerprint is null
      and support_reference is null and reason_code is null)
  );
alter table ops.audit_event drop constraint audit_event_action_type_check;
alter table ops.audit_event add constraint audit_event_action_type_check check (action_type in (
  'agreement.confirmed', 'agreement.cancelled', 'agreement.completed', 'agreement.no_outcome',
  'agreement.archived', 'agreement.change_proposed', 'agreement.change_accepted',
  'agreement.change_declined', 'agreement.change_expired', 'agreement.change_cancelled',
  'personal_block.created', 'personal_block.ended', 'personal_block.reactivated',
  'church.created', 'church.content_updated', 'church.address_updated', 'church.archived', 'church.restored',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created', 'service.date_cancelled', 'service.date_rescheduled',
  'service.date_content_updated', 'service.future_dates_cancelled', 'translation.corrected',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create table ops.owner_operation (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null check (operation_type in ('archive_church', 'restore_church')),
  church_id uuid not null references app.church(id) on delete restrict,
  target_preview jsonb not null,
  target_fingerprint text not null check (target_fingerprint ~ '^[0-9a-f]{64}$'),
  support_reference text not null check (support_reference ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'),
  reason_code text not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  prepared_by text not null check (prepared_by ~ '^[0-9a-f]{64}$'),
  prepared_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  state text not null default 'prepared' check (state in ('prepared', 'succeeded')),
  executed_by text, executed_at timestamptz, result jsonb,
  audit_event_id uuid references ops.audit_event(id) on delete restrict,
  constraint owner_operation_reason check (
    (operation_type = 'archive_church' and reason_code = 'reviewed_archival')
    or (operation_type = 'restore_church' and reason_code = 'reviewed_restoration')
  ),
  constraint owner_operation_token_lifetime check (expires_at = prepared_at + interval '15 minutes'),
  constraint owner_operation_execution check (
    (state = 'prepared' and executed_by is null and executed_at is null and result is null and audit_event_id is null)
    or (state = 'succeeded' and executed_by = prepared_by and executed_by is not null
      and executed_at is not null and result is not null and audit_event_id is not null)
  )
);
create index owner_operation_church_history on ops.owner_operation(church_id, prepared_at desc);
alter table ops.owner_operation enable row level security;
alter table ops.owner_operation force row level security;
revoke all on table ops.owner_operation from public, anon, authenticated, service_role, orthodox_routes_church_operator;

-- The shared church lock serializes publication with the final future-work check.
create function ops.church_lifecycle_state(p_church_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'church_id', church.public_id, 'slug', church.slug, 'official_name', church.official_name,
    'status', church.status, 'content_version', church.content_version,
    'updated_at', church.updated_at, 'schedule_updated_at', church.schedule_updated_at,
    'administrator_ids', (select coalesce(jsonb_agg(jsonb_build_array(membership.public_id,
      membership.account_id, membership.status) order by membership.public_id), '[]'::jsonb)
      from app.church_admin_membership as membership where membership.church_id = church.id
        and membership.status in ('active', 'transferring')),
    'pending_request_ids', (select coalesce(jsonb_agg(request.public_id order by request.public_id), '[]'::jsonb)
      from app.church_archive_request as request where request.church_id = church.id and request.status = 'pending'),
    'pending_invite_ids', (select coalesce(jsonb_agg(invite.public_id order by invite.public_id), '[]'::jsonb)
      from app.church_admin_invite as invite where invite.church_id = church.id and invite.state = 'pending'),
    'passenger_requests', (select count(*) from app.passenger_request as request
      where request.church_id = church.id and request.status in ('active', 'partial', 'fulfilled', 'restore')
        and request.desired_arrival_at > now()),
    'driver_offers', (select count(*) from app.driver_offer_occurrence as offer
      where offer.church_id = church.id and offer.status in ('active', 'full') and offer.arrival_at > now()),
    'pending_responses', (select count(*) from app.ride_response as response
      join app.ride_condition_snapshot as snapshot on snapshot.id = response.conditions_snapshot_id
      where snapshot.church_id = church.id and response.status in ('await_driver', 'await_passenger')
        and response.expires_at > now() and snapshot.scheduled_arrival_at > now()),
    'agreements', (select count(*) from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      where snapshot.church_id = church.id and agreement.status in ('confirmed', 'change_pending')
        and snapshot.scheduled_arrival_at > now())
  ) from app.church as church where church.id = p_church_id;
$$;

create function ops.prepare_church_lifecycle(
  p_church_id uuid, p_operation_type text, p_support_reference text, p_reason_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  internal_church_id uuid;
  target jsonb;
  preview jsonb;
  operation ops.owner_operation%rowtype;
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  prepared_time timestamptz := clock_timestamp();
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'Separate operational authentication is required.';
  end if;
  if p_church_id is null or p_operation_type is null
    or p_operation_type not in ('archive_church', 'restore_church')
    or p_support_reference is null or p_support_reference !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'
    or p_reason_code is distinct from case p_operation_type
      when 'archive_church' then 'reviewed_archival' else 'reviewed_restoration' end then
    raise exception using errcode = '22023', message = 'Church lifecycle operation input is invalid.';
  end if;
  select church.id into internal_church_id from app.church as church where church.public_id = p_church_id;
  if internal_church_id is null then raise exception using errcode = 'P0002', message = 'Church is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || internal_church_id::text, 0));
  perform 1 from app.church as church where church.id = internal_church_id for update;
  target := ops.church_lifecycle_state(internal_church_id);
  if (p_operation_type = 'archive_church' and target->>'status' not in ('published', 'hidden', 'archive_requested'))
    or (p_operation_type = 'restore_church' and target->>'status' <> 'archived') then
    raise exception using errcode = '22023', message = 'Church lifecycle operation is unavailable.';
  end if;
  -- Deliberately exclude all membership/account IDs and private contacts from the operator preview.
  preview := (target - array['administrator_ids', 'pending_request_ids', 'pending_invite_ids', 'updated_at'])
    || jsonb_build_object('administrator_count', jsonb_array_length(target->'administrator_ids'),
      'pending_archival_requests', jsonb_array_length(target->'pending_request_ids'),
      'pending_invitations', jsonb_array_length(target->'pending_invite_ids'));
  insert into ops.owner_operation(operation_type, church_id, target_preview, target_fingerprint,
    support_reference, reason_code, token_hash, prepared_by, prepared_at, expires_at)
  values (p_operation_type, internal_church_id, preview,
    encode(extensions.digest(convert_to(target::text, 'UTF8'), 'sha256'), 'hex'),
    p_support_reference, p_reason_code,
    encode(extensions.digest(convert_to(token, 'UTF8'), 'sha256'), 'hex'), operator_id,
    prepared_time, prepared_time + interval '15 minutes') returning * into operation;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'preview', preview, 'token', token, 'expires_at', operation.expires_at);
end;
$$;

create function ops.execute_church_lifecycle(p_operation_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  operation ops.owner_operation%rowtype;
  target jsonb;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  new_status text;
  audit_id uuid;
  operation_result jsonb;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role')
    or p_operation_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  select * into operation from ops.owner_operation where id = p_operation_id;
  if not found then raise exception using errcode = '42501', message = 'Church operation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || operation.church_id::text, 0));
  perform 1 from app.church as church where church.id = operation.church_id for update;
  select * into operation from ops.owner_operation where id = p_operation_id for update;
  if operation.prepared_by <> operator_id
    or operation.token_hash <> encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex') then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  -- A consumed token may return only its immutable original result, never perform another transition.
  if operation.state = 'succeeded' then return operation.result; end if;
  if operation.expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  target := ops.church_lifecycle_state(operation.church_id);
  if operation.target_fingerprint is distinct from
    encode(extensions.digest(convert_to(target::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception using errcode = 'PT409', message = 'Church changed; prepare a new operation.';
  end if;
  if operation.operation_type = 'archive_church' then
    if (target->>'passenger_requests')::integer > 0 or (target->>'driver_offers')::integer > 0
      or (target->>'pending_responses')::integer > 0 or (target->>'agreements')::integer > 0 then
      raise exception using errcode = 'PT409', message = 'Future church transport must be resolved before archival.';
    end if;
    new_status := 'archived';
    update app.church_archive_request set status = 'resolved', resolved_at = clock_timestamp()
    where church_id = operation.church_id and status = 'pending';
  else
    if jsonb_array_length(target->'administrator_ids') = 0 then
      raise exception using errcode = 'PT409', message = 'Church administration must be resolved before restoration.';
    end if;
    new_status := 'published';
  end if;
  update app.church set status = new_status, content_version = content_version + 1,
    updated_at = clock_timestamp() where id = operation.church_id;
  operation_result := jsonb_build_object('operation_id', operation.id, 'church_id', target->>'church_id', 'status', new_status);
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('owner-operation:' || operation.id::text, 'operator', operator_id,
    operation.support_reference, operation.reason_code,
    case new_status when 'archived' then 'church.archived' else 'church.restored' end,
    'church', (target->>'church_id')::uuid, array['status', 'content_version']) returning id into audit_id;
  update ops.owner_operation set state = 'succeeded', executed_by = operator_id, executed_at = clock_timestamp(),
    result = operation_result, audit_event_id = audit_id where id = operation.id;
  return operation_result;
end;
$$;

revoke all on function ops.church_lifecycle_state(uuid),
  ops.prepare_church_lifecycle(uuid, text, text, text), ops.execute_church_lifecycle(uuid, text)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_lifecycle(uuid, text, text, text),
  ops.execute_church_lifecycle(uuid, text) to orthodox_routes_church_operator;
comment on table ops.owner_operation is
  'Inactive operational foundation: hashed 15-minute capability, login-bound prepare/execute, safe preview, immutable replay, and minimized audit. No application key may operate it.';
