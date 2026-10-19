-- Reviewed revocation of one exact outstanding grant; no new invitation or administrator assignment.
alter table ops.owner_operation add column if not exists target_invite_id uuid
  references app.church_admin_invite(id) on delete restrict;
do $$
declare item record; expression text;
begin
  for item in select * from (values
    ('ops.owner_operation', 'owner_operation_operation_type_check', 'cancel_church_invite',
      'operation_type = ''cancel_church_invite'''),
    ('ops.owner_operation', 'owner_operation_reason', 'reviewed_invite_cancellation',
      'operation_type = ''cancel_church_invite'' and reason_code = ''reviewed_invite_cancellation''')
  ) as additions(relation_name, constraint_name, marker, extension)
  loop
    select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
      where conrelid = item.relation_name::regclass and conname = item.constraint_name;
    if position(item.marker in expression) > 0 then continue; end if;
    execute format('alter table %s drop constraint %I', item.relation_name::regclass, item.constraint_name);
    execute format('alter table %s add constraint %I check ((%s) or (%s))',
      item.relation_name::regclass, item.constraint_name, expression, item.extension);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'ops.owner_operation'::regclass
    and conname = 'owner_operation_invite_target') then
    alter table ops.owner_operation add constraint owner_operation_invite_target
      check ((operation_type = 'cancel_church_invite') = (target_invite_id is not null));
  end if;
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'ops.audit_event'::regclass and conname = 'audit_event_operator_shape';
  if position('reviewed_invite_cancellation' in expression) = 0 then
    if position('''reviewed_membership_removal''' in expression) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected operational audit boundary.';
    end if;
    alter table ops.audit_event drop constraint audit_event_operator_shape;
    execute 'alter table ops.audit_event add constraint audit_event_operator_shape check (' ||
      replace(expression, '''reviewed_membership_removal''', '''reviewed_membership_removal'', ''reviewed_invite_cancellation''') || ')';
  end if;
end; $$;

create or replace function ops.prepare_church_invite_cancellation(
  p_church_id uuid, p_invite_id uuid, p_support_reference text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  church_internal_id uuid; invite_internal_id uuid; target jsonb; preview jsonb;
  operation ops.owner_operation%rowtype;
  capability text := encode(extensions.gen_random_bytes(32), 'hex');
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  prepared_time timestamptz;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'Separate operational authentication is required.';
  end if;
  if p_church_id is null or p_invite_id is null or p_support_reference is null
    or p_support_reference !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$' then
    raise exception using errcode = '22023', message = 'Church invitation operation input is invalid.';
  end if;
  select id into church_internal_id from app.church where public_id = p_church_id;
  if church_internal_id is null then raise exception using errcode = 'P0002', message = 'Church is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_internal_id::text, 0));
  perform 1 from app.church where id = church_internal_id for update;
  select id into invite_internal_id from app.church_admin_invite
    where church_id = church_internal_id and public_id = p_invite_id and state = 'pending';
  if invite_internal_id is null then raise exception using errcode = 'PT409', message = 'Invitation is unavailable.'; end if;
  target := ops.church_lifecycle_state(church_internal_id);
  preview := (target - array['administrator_ids', 'pending_request_ids', 'pending_invite_ids', 'updated_at'])
    || jsonb_build_object('invite_id', p_invite_id,
      'administrator_count', jsonb_array_length(target->'administrator_ids'),
      'pending_archival_requests', jsonb_array_length(target->'pending_request_ids'),
      'pending_invitations', jsonb_array_length(target->'pending_invite_ids'));
  prepared_time := clock_timestamp();
  insert into ops.owner_operation(operation_type, church_id, target_invite_id, target_preview,
    target_fingerprint, support_reference, reason_code, token_hash, prepared_by, prepared_at, expires_at)
  values ('cancel_church_invite', church_internal_id, invite_internal_id, preview,
    encode(extensions.digest(convert_to(target::text, 'UTF8'), 'sha256'), 'hex'), p_support_reference,
    'reviewed_invite_cancellation', encode(extensions.digest(convert_to(capability, 'UTF8'), 'sha256'), 'hex'),
    operator_id, prepared_time, prepared_time + interval '15 minutes') returning * into operation;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'preview', preview, 'token', capability, 'expires_at', operation.expires_at);
end; $$;

create or replace function ops.apply_church_invite_cancellation(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  operation ops.owner_operation%rowtype; invitation app.church_admin_invite%rowtype;
  church_public_id uuid; operation_result jsonb; audit_id uuid;
begin
  select * into strict operation from ops.owner_operation where id = p_operation_id;
  select public_id into strict church_public_id from app.church where id = operation.church_id;
  select * into invitation from app.church_admin_invite where id = operation.target_invite_id
    and church_id = operation.church_id and state = 'pending' for update;
  if operation.operation_type <> 'cancel_church_invite' or operation.state <> 'prepared' or not found then
    raise exception using errcode = 'PT409', message = 'Invitation is unavailable.';
  end if;
  update app.church_admin_invite set state = 'cancelled', decided_at = clock_timestamp() where id = invitation.id;
  -- The same terminal mail revocation as the ordinary cancel RPC; late acknowledgements cannot reclaim the grant.
  update private.church_invite_mail set state = 'cancelled', lease_token = null,
    lease_until = null, token_value = repeat('0', 64), updated_at = clock_timestamp()
    where invite_id = invitation.id and state in ('queued', 'claimed', 'sent');
  insert into app.church_admin_event(church_id, event_type) values (operation.church_id, 'invite.cancelled');
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('owner-operation:' || operation.id::text, 'operator', operation.prepared_by,
    operation.support_reference, operation.reason_code, 'invite.cancelled', 'church', church_public_id,
    array['administrator_invitation']) returning id into audit_id;
  operation_result := jsonb_build_object('operation_id', operation.id, 'church_id', church_public_id,
    'invite_id', invitation.public_id, 'status', 'cancelled');
  update ops.owner_operation set state = 'succeeded', executed_by = prepared_by, executed_at = clock_timestamp(),
    result = operation_result, audit_event_id = audit_id where id = operation.id;
  return operation_result;
end; $$;

do $$
declare definition text; original text := 'if operation.operation_type = ''hide_church'' then';
begin
  definition := pg_get_functiondef('ops.apply_church_lifecycle(uuid,text)'::regprocedure);
  if position('return ops.apply_church_invite_cancellation(operation.id)' in definition) = 0 then
    if position(original in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected protected church operation dispatcher.';
    end if;
    execute replace(definition, original,
      'if operation.operation_type = ''cancel_church_invite'' then return ops.apply_church_invite_cancellation(operation.id); end if; ' || original);
  end if;
end; $$;
revoke all on function ops.prepare_church_invite_cancellation(uuid,uuid,text), ops.apply_church_invite_cancellation(uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_invite_cancellation(uuid,uuid,text) to orthodox_routes_church_operator;
