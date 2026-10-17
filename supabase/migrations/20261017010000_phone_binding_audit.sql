-- Capture confirmed phone-binding facts, never OTP attempts or contact values.
do $$
declare
  addition record;
  prior_expression text;
begin
  for addition in select * from (values
    ('audit_event_action_type_check', 'account.phone_verified',
      'action_type in (''account.phone_verified'', ''account.phone_changed'')'),
    ('audit_event_target_type_check', '''account''', 'target_type = ''account'''),
    ('audit_event_target_shape', 'account.phone_verified',
      'target_type = ''account'' and action_type in (''account.phone_verified'', ''account.phone_changed'')'),
    ('audit_event_changed_fields_check', 'phone_verified_at',
      'action_type in (''account.phone_verified'', ''account.phone_changed'') and '
      'cardinality(changed_fields) between 2 and 3 and array_position(changed_fields, null) is null and '
      'changed_fields <@ array[''phone_e164'', ''phone_verified_at'', ''phone_changed_at'']::text[]')
  ) as extensions(constraint_name, marker, expression)
  loop
    select pg_get_expr(constraint_row.conbin, constraint_row.conrelid) into strict prior_expression
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'ops.audit_event'::regclass and constraint_row.conname = addition.constraint_name;
    if position(addition.marker in prior_expression) = 0 then
      execute format('alter table ops.audit_event drop constraint %I', addition.constraint_name);
      execute format('alter table ops.audit_event add constraint %I check ((%s) or (%s))',
        addition.constraint_name, prior_expression, addition.expression);
    end if;
  end loop;
end;
$$;

alter table ops.audit_event drop constraint if exists audit_event_phone_binding_shape;
alter table ops.audit_event add constraint audit_event_phone_binding_shape check (
  action_type not in ('account.phone_verified', 'account.phone_changed') or (
    actor_kind = 'account' and target_type = 'account' and result = 'success'
    and changed_fields = case when action_type = 'account.phone_changed'
      then array['phone_e164', 'phone_verified_at', 'phone_changed_at']::text[]
      else array['phone_e164', 'phone_verified_at']::text[] end
  )
);

create or replace function app.audit_verified_phone_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The source becomes verified only after its owner successfully swaps/binds the contact.
  insert into ops.audit_event (
    event_key, occurred_at, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields
  )
  select 'phone-binding:' || new.id::text, new.verified_at, 'account', new.account_id,
    case when new.purpose = 'phone_change' then 'account.phone_changed' else 'account.phone_verified' end,
    'account', account.public_id,
    case when new.purpose = 'phone_change'
      then array['phone_e164', 'phone_verified_at', 'phone_changed_at']::text[]
      else array['phone_e164', 'phone_verified_at']::text[] end
  from app.account as account where account.id = new.account_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;
create or replace trigger audit_verified_phone_binding after update of state on ops.phone_verification_attempt
  for each row when (old.state is distinct from new.state and new.state = 'verified')
  execute function app.audit_verified_phone_binding();
revoke all on function app.audit_verified_phone_binding() from public, anon, authenticated, service_role;

-- Existing verified attempts are actual source facts; their original transaction is unknown.
-- Do not infer old changes merely from the current contact row.
insert into ops.audit_event (
  event_key, occurred_at, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields, transaction_id
)
select 'phone-binding:' || attempt.id::text, attempt.verified_at, 'account', attempt.account_id,
  case when attempt.purpose = 'phone_change' then 'account.phone_changed' else 'account.phone_verified' end,
  'account', account.public_id,
  case when attempt.purpose = 'phone_change'
    then array['phone_e164', 'phone_verified_at', 'phone_changed_at']::text[]
    else array['phone_e164', 'phone_verified_at']::text[] end, null
from ops.phone_verification_attempt as attempt join app.account as account on account.id = attempt.account_id
where attempt.state = 'verified'
on conflict (event_key) do nothing;
