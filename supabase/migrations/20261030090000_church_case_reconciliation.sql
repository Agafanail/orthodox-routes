-- A separate legitimate membership lifecycle may resolve the page while a case is pending.
-- Reconcile metadata through the existing reviewed owner protocol; never invent a domain execution.
alter table ops.church_administration_case add column if not exists resolution_source text not null
  default 'owner_transition' check (resolution_source in ('owner_transition', 'observed_membership'));
do $$
declare item record; expression text;
begin
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'ops.church_administration_case'::regclass and conname = 'church_administration_case_resolution';
  if position('observed_membership' in expression) = 0 then
    alter table ops.church_administration_case drop constraint church_administration_case_resolution;
    execute 'alter table ops.church_administration_case add constraint church_administration_case_resolution check (' ||
      '(resolution_source = ''owner_transition'' and (' || expression || ')) or '
      '(resolution_source = ''observed_membership'' and state = ''resolved'' and decision is not null '
      'and prepared_operation_id is not null and executed_operation_id = prepared_operation_id '
      'and executed_operation_id is not null and replacement_membership_id is null and resolved_at is not null))';
  end if;
  for item in select * from (values
    ('ops.owner_operation'::regclass, 'owner_operation_operation_type_check', 'reconcile_church_administration_case',
      'operation_type = ''reconcile_church_administration_case'''),
    ('ops.owner_operation'::regclass, 'owner_operation_reason', 'reviewed_administration_reconciliation',
      'operation_type = ''reconcile_church_administration_case'' and reason_code = ''reviewed_administration_reconciliation'''),
    ('ops.audit_event'::regclass, 'audit_event_action_type_check', 'church.administration_case_reconciled',
      'action_type = ''church.administration_case_reconciled'''),
    ('ops.audit_event'::regclass, 'audit_event_changed_fields_check', 'church.administration_case_reconciled',
      'action_type = ''church.administration_case_reconciled'' and changed_fields = array[''administration_case'']::text[]')
  ) as additions(relation_id, constraint_name, marker, extension)
  loop
    select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
      where conrelid = item.relation_id and conname = item.constraint_name;
    if position(item.marker in expression) > 0 then continue; end if;
    execute format('alter table %s drop constraint %I', item.relation_id, item.constraint_name);
    execute format('alter table %s add constraint %I check ((%s) or (%s))',
      item.relation_id, item.constraint_name, expression, item.extension);
  end loop;
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'ops.audit_event'::regclass and conname = 'audit_event_operator_shape';
  if position('reviewed_administration_reconciliation' in expression) = 0 then
    if position('''reviewed_membership_replacement''' in expression) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected operational audit boundary.';
    end if;
    alter table ops.audit_event drop constraint audit_event_operator_shape;
    execute 'alter table ops.audit_event add constraint audit_event_operator_shape check (' ||
      replace(expression, '''reviewed_membership_replacement''',
        '''reviewed_membership_replacement'', ''reviewed_administration_reconciliation''') || ')';
  end if;
end; $$;

-- Protected source state only: it never leaves this ungranted fingerprint helper.
create or replace function ops.church_case_reconciliation_fingerprint(p_case_id uuid)
returns text language sql volatile security definer set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object('case', to_jsonb(support_case),
    'membership', to_jsonb(member), 'church', ops.church_lifecycle_state(support_case.church_id))::text,
    'UTF8'), 'sha256'), 'hex')
  from ops.church_administration_case as support_case join app.church_admin_membership as member
    on member.id = support_case.target_membership_id where support_case.id = p_case_id;
$$;

create or replace function ops.prepare_church_case_reconciliation(p_church_id uuid, p_case_id uuid, p_support_reference text)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare support_case ops.church_administration_case%rowtype; member app.church_admin_membership%rowtype;
  church_internal_id uuid; target jsonb; preview jsonb; operation ops.owner_operation%rowtype; selected_resolution text;
  capability text := encode(extensions.gen_random_bytes(32), 'hex'); prepared_time timestamptz;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'Separate operational authentication is required.';
  end if;
  if p_church_id is null or p_case_id is null or p_support_reference is null
    or p_support_reference !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$' then
    raise exception using errcode = '22023', message = 'Administration reconciliation input is invalid.';
  end if;
  select id into church_internal_id from app.church where public_id = p_church_id;
  if church_internal_id is null then raise exception using errcode = 'P0002', message = 'Administration case is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_internal_id::text, 0));
  perform 1 from app.church where id = church_internal_id for update;
  select * into support_case from ops.church_administration_case where id = p_case_id
    and church_id = church_internal_id and support_reference = p_support_reference for update;
  if not found then raise exception using errcode = 'P0002', message = 'Administration case is unavailable.'; end if;
  select * into strict member from app.church_admin_membership where id = support_case.target_membership_id;
  target := ops.church_lifecycle_state(church_internal_id);
  if support_case.state = 'resolved' or member.status <> 'ended'
    or (target->>'status' <> 'archived' and jsonb_array_length(target->'administrator_ids') = 0) then
    raise exception using errcode = 'PT409', message = 'Administration case is not ready for reconciliation.';
  end if;
  selected_resolution := case when target->>'status' = 'archived' then 'archive' else 'replacement' end;
  preview := (target - array['administrator_ids', 'pending_request_ids', 'pending_invite_ids', 'updated_at'])
    || jsonb_build_object('administration_case_id', support_case.id, 'membership_id', member.public_id,
      'resolution', selected_resolution, 'administrator_count', jsonb_array_length(target->'administrator_ids'),
      'pending_archival_requests', jsonb_array_length(target->'pending_request_ids'),
      'pending_invitations', jsonb_array_length(target->'pending_invite_ids'));
  prepared_time := clock_timestamp();
  insert into ops.owner_operation(operation_type, church_id, administration_case_id, target_preview,
    target_fingerprint, support_reference, reason_code, token_hash, prepared_by, prepared_at, expires_at)
  values ('reconcile_church_administration_case', church_internal_id, support_case.id, preview,
    ops.church_case_reconciliation_fingerprint(support_case.id), p_support_reference, 'reviewed_administration_reconciliation',
    encode(extensions.digest(convert_to(capability, 'UTF8'), 'sha256'), 'hex'), operator_id,
    prepared_time, prepared_time + interval '15 minutes') returning * into operation;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'preview', preview, 'token', capability, 'expires_at', operation.expires_at);
end; $$;

create or replace function ops.apply_church_case_reconciliation(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare operation ops.owner_operation%rowtype; support_case ops.church_administration_case%rowtype;
  member app.church_admin_membership%rowtype; target jsonb; selected_resolution text; operation_result jsonb; audit_id uuid;
begin
  select * into strict operation from ops.owner_operation where id = p_operation_id;
  select * into support_case from ops.church_administration_case where id = operation.administration_case_id for update;
  if not found or operation.operation_type <> 'reconcile_church_administration_case' or operation.state <> 'prepared'
    or support_case.state = 'resolved' or support_case.church_id <> operation.church_id
    or support_case.support_reference <> operation.support_reference then
    raise exception using errcode = 'PT409', message = 'Administration case changed; prepare a new operation.';
  end if;
  -- The case lock is an additional wait after the native dispatcher checks.
  if operation.expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  if operation.target_fingerprint is distinct from ops.church_case_reconciliation_fingerprint(support_case.id) then
    raise exception using errcode = 'PT409', message = 'Administration case changed; prepare a new operation.';
  end if;
  select * into strict member from app.church_admin_membership where id = support_case.target_membership_id;
  target := ops.church_lifecycle_state(operation.church_id);
  if member.status <> 'ended' or (target->>'status' <> 'archived' and jsonb_array_length(target->'administrator_ids') = 0) then
    raise exception using errcode = 'PT409', message = 'Administration case is not ready for reconciliation.';
  end if;
  selected_resolution := case when target->>'status' = 'archived' then 'archive' else 'replacement' end;
  update ops.church_administration_case set state = 'resolved', resolution_source = 'observed_membership',
    decision = selected_resolution, prepared_operation_id = operation.id, executed_operation_id = operation.id,
    replacement_membership_id = null, resolved_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = support_case.id;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('owner-operation:' || operation.id::text, 'operator', operation.prepared_by,
    operation.support_reference, operation.reason_code, 'church.administration_case_reconciled',
    'church', (target->>'church_id')::uuid, array['administration_case']) returning id into audit_id;
  operation_result := jsonb_build_object('operation_id', operation.id, 'church_id', target->>'church_id',
    'administration_case_id', support_case.id, 'membership_id', member.public_id,
    'resolution', selected_resolution, 'status', 'reconciled');
  update ops.owner_operation set state = 'succeeded', executed_by = prepared_by, executed_at = clock_timestamp(),
    result = operation_result, audit_event_id = audit_id where id = operation.id;
  return operation_result;
end; $$;

do $$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('ops.apply_church_lifecycle(uuid,text)'::regprocedure);
  if position('return ops.apply_church_case_reconciliation(operation.id)' in definition) = 0 then
    anchor := 'case when operation.operation_type = ''replace_church_admin'' then';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected church fingerprint boundary.'; end if;
    definition := replace(definition, anchor,
      'case when operation.operation_type = ''reconcile_church_administration_case'' then ops.church_case_reconciliation_fingerprint(operation.administration_case_id) when operation.operation_type = ''replace_church_admin'' then');
    anchor := 'if operation.operation_type = ''hide_church'' then';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected church operation dispatcher.'; end if;
    execute replace(definition, anchor,
      'if operation.operation_type = ''reconcile_church_administration_case'' then return ops.apply_church_case_reconciliation(operation.id); end if; ' || anchor);
  end if;
  definition := pg_get_functiondef('ops.complete_church_administration_case()'::regprocedure);
  if position('-- Reconciliation records its own observed-state result.' in definition) = 0 then
    anchor := 'if old.state <> ''prepared'' or new.state <> ''succeeded'' or new.administration_case_id is null then return new; end if;';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected case completion boundary.'; end if;
    execute replace(definition, anchor, anchor || '
  -- Reconciliation records its own observed-state result.
  if new.operation_type = ''reconcile_church_administration_case'' then
    if not exists (select 1 from ops.church_administration_case where id = new.administration_case_id
      and church_id = new.church_id and support_reference = new.support_reference and state = ''resolved''
      and resolution_source = ''observed_membership'' and prepared_operation_id = new.id and executed_operation_id = new.id) then
      raise exception using errcode = ''PT409'', message = ''Administration reconciliation is incomplete.'';
    end if;
    return new;
  end if;');
  end if;
end; $$;
revoke all on function ops.church_case_reconciliation_fingerprint(uuid),
  ops.prepare_church_case_reconciliation(uuid,uuid,text), ops.apply_church_case_reconciliation(uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_case_reconciliation(uuid,uuid,text) to orthodox_routes_church_operator;
