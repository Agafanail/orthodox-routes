-- Reviewed exclusion only: no new administrator grant, final-seat removal, or account/session mutation.
alter table ops.owner_operation add column if not exists target_membership_id uuid
  references app.church_admin_membership(id) on delete restrict;
do $$ begin
if not exists (select 1 from pg_constraint where conrelid = 'ops.owner_operation'::regclass
  and conname = 'owner_operation_operation_type_check' and position('remove_church_admin' in pg_get_expr(conbin, conrelid)) > 0) then
alter table ops.owner_operation drop constraint owner_operation_operation_type_check;
alter table ops.owner_operation add constraint owner_operation_operation_type_check
  check (operation_type in ('archive_church', 'restore_church', 'hide_church', 'remove_church_admin'));
end if;
if not exists (select 1 from pg_constraint where conrelid = 'ops.owner_operation'::regclass
  and conname = 'owner_operation_reason' and position('reviewed_membership_removal' in pg_get_expr(conbin, conrelid)) > 0) then
alter table ops.owner_operation drop constraint owner_operation_reason;
alter table ops.owner_operation add constraint owner_operation_reason check (
  (operation_type = 'archive_church' and reason_code = 'reviewed_archival')
  or (operation_type = 'restore_church' and reason_code = 'reviewed_restoration')
  or (operation_type = 'hide_church' and reason_code = 'reviewed_hiding')
  or (operation_type = 'remove_church_admin' and reason_code = 'reviewed_membership_removal')
);
end if;
if not exists (select 1 from pg_constraint where conrelid = 'ops.owner_operation'::regclass
  and conname = 'owner_operation_membership_target') then
alter table ops.owner_operation add constraint owner_operation_membership_target
  check ((operation_type = 'remove_church_admin') = (target_membership_id is not null));
end if;
end; $$;

do $$
declare item record; expression text;
begin
  for item in select * from (values
    ('ops.audit_event', 'audit_event_operator_shape', 'reviewed_membership_removal',
      '''reviewed_hiding''', '''reviewed_hiding'', ''reviewed_membership_removal'''),
    ('ops.audit_event', 'audit_event_action_type_check', 'membership.removed', null, null),
    ('app.church_admin_event', 'church_admin_event_type', 'membership.removed', null, null)
  ) as additions(relation_name, constraint_name, marker, original, replacement)
  loop
    select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
      where conrelid = item.relation_name::regclass and conname = item.constraint_name;
    if position(item.marker in expression) > 0 then continue; end if;
    if item.original is not null then
      if position(item.original in expression) = 0 then
        raise exception using errcode = '55000', message = 'Unexpected operational audit boundary.';
      end if;
      expression := replace(expression, item.original, item.replacement);
    else
      expression := format('(%s) or %I = %L', expression,
        case when item.relation_name = 'ops.audit_event' then 'action_type' else 'event_type' end, item.marker);
    end if;
    execute format('alter table %s drop constraint %I', item.relation_name::regclass, item.constraint_name);
    execute format('alter table %s add constraint %I check (%s)', item.relation_name::regclass, item.constraint_name, expression);
  end loop;
end; $$;

create or replace function ops.prepare_church_admin_removal(
  p_church_id uuid, p_membership_id uuid, p_support_reference text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  church_internal_id uuid; membership_internal_id uuid; target jsonb; preview jsonb;
  operation ops.owner_operation%rowtype;
  capability text := encode(extensions.gen_random_bytes(32), 'hex');
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  prepared_time timestamptz;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'Separate operational authentication is required.';
  end if;
  if p_church_id is null or p_membership_id is null or p_support_reference is null
    or p_support_reference !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$' then
    raise exception using errcode = '22023', message = 'Church administration operation input is invalid.';
  end if;
  select id into church_internal_id from app.church where public_id = p_church_id;
  if church_internal_id is null then raise exception using errcode = 'P0002', message = 'Church is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_internal_id::text, 0));
  perform 1 from app.church where id = church_internal_id for update;
  select id into membership_internal_id from app.church_admin_membership
    where church_id = church_internal_id and public_id = p_membership_id and status in ('active', 'transferring');
  target := ops.church_lifecycle_state(church_internal_id);
  if membership_internal_id is null or jsonb_array_length(target->'administrator_ids') <= 1
    or exists (select 1 from app.church_admin_invite where transfer_membership_id = membership_internal_id and state = 'pending') then
    raise exception using errcode = 'PT409', message = 'Resolve the remaining administrator or pending transfer first.';
  end if;
  preview := (target - array['administrator_ids', 'pending_request_ids', 'pending_invite_ids', 'updated_at'])
    || jsonb_build_object('membership_id', p_membership_id,
      'administrator_count', jsonb_array_length(target->'administrator_ids'),
      'pending_archival_requests', jsonb_array_length(target->'pending_request_ids'),
      'pending_invitations', jsonb_array_length(target->'pending_invite_ids'));
  prepared_time := clock_timestamp();
  insert into ops.owner_operation(operation_type, church_id, target_membership_id, target_preview,
    target_fingerprint, support_reference, reason_code, token_hash, prepared_by, prepared_at, expires_at)
  values ('remove_church_admin', church_internal_id, membership_internal_id, preview,
    encode(extensions.digest(convert_to(target::text, 'UTF8'), 'sha256'), 'hex'), p_support_reference,
    'reviewed_membership_removal', encode(extensions.digest(convert_to(capability, 'UTF8'), 'sha256'), 'hex'),
    operator_id, prepared_time, prepared_time + interval '15 minutes') returning * into operation;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'preview', preview, 'token', capability, 'expires_at', operation.expires_at);
end; $$;

-- Called only inside the existing authenticated, locked, capability/freshness-checked attempt wrapper.
create or replace function ops.apply_church_admin_removal(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  operation ops.owner_operation%rowtype; member app.church_admin_membership%rowtype;
  church_row app.church%rowtype; recipient record; operation_result jsonb; audit_id uuid;
begin
  select * into strict operation from ops.owner_operation where id = p_operation_id;
  select * into strict church_row from app.church where id = operation.church_id;
  select * into member from app.church_admin_membership where id = operation.target_membership_id
    and church_id = operation.church_id and status in ('active', 'transferring') for update;
  if operation.operation_type <> 'remove_church_admin' or operation.state <> 'prepared' or not found
    or (select count(*) from app.church_admin_membership where church_id = operation.church_id
      and status in ('active', 'transferring')) <= 1
    or exists (select 1 from app.church_admin_invite where transfer_membership_id = member.id and state = 'pending') then
    raise exception using errcode = 'PT409', message = 'Resolve the remaining administrator or pending transfer first.';
  end if;
  update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(),
    updated_at = clock_timestamp() where id = member.id;
  -- Do not pretend the removed account voluntarily acted. The operator audit is correlated by transaction.
  insert into app.church_admin_event(church_id, subject_account_id, event_type)
    values (church_row.id, member.account_id, 'membership.removed');
  for recipient in select account_id from app.church_admin_membership where church_id = church_row.id
    and (status in ('active', 'transferring') or id = member.id)
  loop
    perform app.create_notification_once(recipient.account_id, 'church-admin-removed:' || operation.id::text,
      'church.admin.removed', 'church', church_row.public_id, '/churches/' || church_row.slug,
      'notifications.church_admin_removed', jsonb_build_object('church_id', church_row.public_id), 50);
  end loop;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('owner-operation:' || operation.id::text, 'operator', operation.prepared_by,
    operation.support_reference, operation.reason_code, 'membership.removed', 'church', church_row.public_id,
    array['administrator_membership']) returning id into audit_id;
  operation_result := jsonb_build_object('operation_id', operation.id, 'church_id', church_row.public_id,
    'membership_id', member.public_id, 'status', 'removed');
  update ops.owner_operation set state = 'succeeded', executed_by = prepared_by, executed_at = clock_timestamp(),
    result = operation_result, audit_event_id = audit_id where id = operation.id;
  return operation_result;
end; $$;

-- Dispatch only after the shared lock, token/session, expiry, replay, and exact-state checks.
do $$
declare definition text; original text := 'if operation.operation_type = ''hide_church'' then';
begin
  definition := pg_get_functiondef('ops.apply_church_lifecycle(uuid,text)'::regprocedure);
  if position('return ops.apply_church_admin_removal(operation.id)' in definition) = 0 then
    if position(original in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected protected church operation dispatcher.';
    end if;
    execute replace(definition, original,
      'if operation.operation_type = ''remove_church_admin'' then return ops.apply_church_admin_removal(operation.id); end if; ' || original);
  end if;
end; $$;
revoke all on function ops.prepare_church_admin_removal(uuid,uuid,text), ops.apply_church_admin_removal(uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_admin_removal(uuid,uuid,text) to orthodox_routes_church_operator;
