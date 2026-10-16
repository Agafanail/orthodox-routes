-- Resolve an ambiguous operator-command outcome without requiring the consumed capability.
create function ops.church_lifecycle_result(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  operation ops.owner_operation%rowtype;
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') or p_operation_id is null then
    raise exception using errcode = '42501', message = 'Church operation is unavailable.';
  end if;
  select * into operation from ops.owner_operation
  where id = p_operation_id and prepared_by = operator_id;
  if not found then raise exception using errcode = '42501', message = 'Church operation is unavailable.'; end if;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'church_id', operation.target_preview->>'church_id',
    'state', case when operation.state = 'succeeded' then 'succeeded'
      when operation.expires_at <= clock_timestamp() then 'expired' else 'prepared' end);
end;
$$;
revoke all on function ops.church_lifecycle_result(uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.church_lifecycle_result(uuid) to orthodox_routes_church_operator;
