-- Keep attempt facts in the existing minimized, append-only audit, without a payload table.
do $$
declare
  constraint_extension record;
  prior_expression text;
begin
  for constraint_extension in select * from (values
    ('audit_event_action_type_check', 'action_type = ''owner.church_execution_attempt'''),
    ('audit_event_target_type_check', 'target_type = ''owner_operation'''),
    ('audit_event_target_shape', 'target_type = ''owner_operation'' and action_type = ''owner.church_execution_attempt'''),
    ('audit_event_changed_fields_check', 'action_type = ''owner.church_execution_attempt'' and cardinality(changed_fields) = 0')
  ) as additions(constraint_name, expression)
  loop
    select pg_get_expr(constraint_row.conbin, constraint_row.conrelid) into prior_expression
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'ops.audit_event'::regclass
      and constraint_row.conname = constraint_extension.constraint_name;
    if prior_expression is null then
      raise exception using errcode = '55000', message = 'The current audit constraint is unavailable.';
    end if;
    execute format('alter table ops.audit_event drop constraint %I', constraint_extension.constraint_name);
    execute format('alter table ops.audit_event add constraint %I check ((%s) or (%s))',
      constraint_extension.constraint_name, prior_expression, constraint_extension.expression);
  end loop;
end;
$$;
alter table ops.audit_event drop constraint audit_event_result_check;
alter table ops.audit_event add constraint audit_event_result_check check (
  result = 'success' or (action_type = 'owner.church_execution_attempt' and result in ('started', 'refused', 'error'))
);
alter table ops.audit_event add constraint audit_event_owner_attempt_shape check (
  action_type <> 'owner.church_execution_attempt' or
    (actor_kind = 'operator' and target_type = 'owner_operation' and cardinality(changed_fields) = 0)
);

-- A committed start survives a later client disconnect, cancellation, or transaction rollback.
create function ops.begin_church_lifecycle_attempt(p_operation_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  operation ops.owner_operation%rowtype;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  attempt_id uuid := gen_random_uuid();
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role')
    or p_operation_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  select * into operation from ops.owner_operation
  where id = p_operation_id and prepared_by = operator_id
    and token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
  if not found then raise exception using errcode = '42501', message = 'Church operation is unavailable.'; end if;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, result, changed_fields)
  values ('owner-attempt:' || attempt_id::text || ':started', 'operator', operator_id,
    operation.support_reference, operation.reason_code, 'owner.church_execution_attempt',
    'owner_operation', operation.id, 'started', array[]::text[]);
  return jsonb_build_object('operation_id', operation.id, 'attempt_id', attempt_id);
end;
$$;

-- Only the audited wrapper may reach the old transition; ordinary operator calls cannot bypass it.
alter function ops.execute_church_lifecycle(uuid, text) rename to apply_church_lifecycle;
revoke all on function ops.apply_church_lifecycle(uuid, text)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;

create function ops.execute_church_lifecycle(p_operation_id uuid, p_token text, p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  operation ops.owner_operation%rowtype;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  execution_result jsonb;
  outcome text := 'success';
  previous_outcome text;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role')
    or p_operation_id is null or p_attempt_id is null then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  select * into operation from ops.owner_operation where id = p_operation_id and prepared_by = operator_id;
  if not found or not exists (select 1 from ops.audit_event as started
    where started.event_key = 'owner-attempt:' || p_attempt_id::text || ':started'
      and started.action_type = 'owner.church_execution_attempt' and started.result = 'started'
      and started.target_id = p_operation_id and started.operator_fingerprint = operator_id
      and started.transaction_id <> pg_current_xact_id()::text) then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('owner-attempt:' || p_attempt_id::text, 0));
  select finished.result into previous_outcome from ops.audit_event as finished
  where finished.event_key = 'owner-attempt:' || p_attempt_id::text || ':finished';
  if previous_outcome is not null then
    if p_token is null or operation.token_hash <>
      encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex') then
      raise exception using errcode = '42501', message = 'Church operation is unavailable.';
    end if;
    if previous_outcome = 'success' then
      select completed.result into execution_result from ops.owner_operation as completed where completed.id = operation.id;
      return execution_result;
    end if;
    return jsonb_build_object('operation_id', operation.id, 'execution_result', previous_outcome);
  end if;
  begin
    execution_result := ops.apply_church_lifecycle(p_operation_id, p_token);
  exception when others then
    -- The inner subtransaction has rolled back all transition effects. Do not copy error text/context.
    outcome := case when sqlstate in ('PT409', '42501', '22023', 'P0002') then 'refused' else 'error' end;
    execution_result := jsonb_build_object('operation_id', operation.id, 'execution_result', outcome);
  end;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, result, changed_fields)
  values ('owner-attempt:' || p_attempt_id::text || ':finished', 'operator', operator_id,
    operation.support_reference, operation.reason_code, 'owner.church_execution_attempt',
    'owner_operation', operation.id, outcome, array[]::text[]);
  return execution_result;
end;
$$;

revoke all on function ops.begin_church_lifecycle_attempt(uuid, text),
  ops.execute_church_lifecycle(uuid, text, uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.begin_church_lifecycle_attempt(uuid, text),
  ops.execute_church_lifecycle(uuid, text, uuid) to orthodox_routes_church_operator;

-- An interrupted execution remains explicitly unfinished, never falsely classified as a refusal.
create or replace function ops.church_lifecycle_result(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  operation ops.owner_operation%rowtype;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  latest_attempt jsonb;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') or p_operation_id is null then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  select * into operation from ops.owner_operation where id = p_operation_id and prepared_by = operator_id;
  if not found then raise exception using errcode = '42501', message = 'Church operation is unavailable.'; end if;
  select jsonb_build_object('attempt_id', substring(started.event_key from 15 for 36),
    'state', coalesce(finished.result, 'unfinished')) into latest_attempt
  from ops.audit_event as started
  left join ops.audit_event as finished on finished.event_key =
    regexp_replace(started.event_key, ':started$', ':finished')
  where started.target_type = 'owner_operation' and started.target_id = operation.id
    and started.action_type = 'owner.church_execution_attempt' and started.result = 'started'
    and started.operator_fingerprint = operator_id
  order by started.occurred_at desc, started.id desc limit 1;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'church_id', operation.target_preview->>'church_id',
    'state', case when operation.state = 'succeeded' then 'succeeded'
      when operation.expires_at <= clock_timestamp() then 'expired' else 'prepared' end,
    'latest_attempt', latest_attempt);
end;
$$;
revoke all on function ops.church_lifecycle_result(uuid) from public, anon, authenticated, service_role;
grant execute on function ops.church_lifecycle_result(uuid) to orthodox_routes_church_operator;
