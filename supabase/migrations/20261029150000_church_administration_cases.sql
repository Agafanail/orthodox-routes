-- Restricted support-assisted final-seat resolution. No account deletion or operator is activated.
create table if not exists ops.church_administration_case (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app.church(id) on delete restrict,
  target_membership_id uuid not null unique references app.church_admin_membership(id) on delete restrict,
  reason_code text not null default 'support_assisted_account_deletion'
    check (reason_code = 'support_assisted_account_deletion'),
  support_reference text not null check (support_reference ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'),
  state text not null default 'needs_administrator'
    check (state in ('needs_administrator', 'replacement_pending', 'archive_pending', 'resolved')),
  decision text check (decision in ('replacement', 'archive')),
  prepared_operation_id uuid references ops.owner_operation(id) on delete restrict,
  executed_operation_id uuid references ops.owner_operation(id) on delete restrict,
  replacement_membership_id uuid references app.church_admin_membership(id) on delete restrict,
  created_by text not null check (created_by ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  constraint church_administration_case_resolution check (
    (state = 'needs_administrator' and decision is null and prepared_operation_id is null
      and executed_operation_id is null and replacement_membership_id is null and resolved_at is null)
    or (state in ('replacement_pending', 'archive_pending') and decision is not null and prepared_operation_id is not null
      and decision = case state when 'replacement_pending' then 'replacement' else 'archive' end
      and executed_operation_id is null and replacement_membership_id is null and resolved_at is null)
    or (state = 'resolved' and decision is not null and prepared_operation_id is not null and prepared_operation_id = executed_operation_id
      and executed_operation_id is not null and resolved_at is not null
      and ((decision = 'replacement') = (replacement_membership_id is not null)))
  )
);
alter table ops.church_administration_case enable row level security;
alter table ops.church_administration_case force row level security;
revoke all on table ops.church_administration_case from public, anon, authenticated, service_role, orthodox_routes_church_operator;
alter table ops.owner_operation add column if not exists administration_case_id uuid
  references ops.church_administration_case(id) on delete set null;

do $$
declare item record; expression text;
begin
  for item in select * from (values
    ('audit_event_action_type_check', 'church.administration_case_opened',
      'action_type in (''church.administration_case_opened'', ''church.administration_case_resolved'')'),
    ('audit_event_changed_fields_check', 'administration_case',
      'action_type in (''church.administration_case_opened'', ''church.administration_case_resolved'') and '
      'changed_fields in (array[''administration_case'']::text[], array[''administration_case'', ''administrator_membership'']::text[])')
  ) as additions(constraint_name, marker, extension)
  loop
    select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
      where conrelid = 'ops.audit_event'::regclass and conname = item.constraint_name;
    if position(item.marker in expression) > 0 then continue; end if;
    execute format('alter table ops.audit_event drop constraint %I', item.constraint_name);
    execute format('alter table ops.audit_event add constraint %I check ((%s) or (%s))',
      item.constraint_name, expression, item.extension);
  end loop;
end; $$;

-- Called only after native preparation has taken the church slot/church locks.
-- Preparation records a reviewed case/decision; it does not end any membership.
create or replace function ops.bind_church_administration_case(p_operation_id uuid, p_membership_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare operation ops.owner_operation%rowtype; member app.church_admin_membership%rowtype;
  support_case ops.church_administration_case%rowtype; selected_decision text;
begin
  select * into strict operation from ops.owner_operation where id = p_operation_id and state = 'prepared';
  if operation.operation_type not in ('archive_church', 'replace_church_admin') then
    raise exception using errcode = '22023', message = 'Administration resolution is unavailable.';
  end if;
  select * into member from app.church_admin_membership where public_id = p_membership_id
    and church_id = operation.church_id and status in ('active', 'transferring');
  if not found or (select count(*) from app.church_admin_membership where church_id = operation.church_id
      and status in ('active', 'transferring')) <> 1
    or exists (select 1 from app.church_admin_invite where transfer_membership_id = member.id and state = 'pending') then
    raise exception using errcode = 'PT409', message = 'Final administration or pending transfer must be resolved first.';
  end if;
  select * into support_case from ops.church_administration_case where target_membership_id = member.id for update;
  if found then
    if support_case.state = 'resolved' or support_case.support_reference <> operation.support_reference then
      raise exception using errcode = 'PT409', message = 'Administration case requires review.';
    end if;
  else
    insert into ops.church_administration_case(church_id, target_membership_id, support_reference, created_by)
      values (operation.church_id, member.id, operation.support_reference, operation.prepared_by)
      returning * into support_case;
    insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
      action_type, target_type, target_id, changed_fields)
    values ('administration-case:' || support_case.id::text || ':opened', 'operator', operation.prepared_by,
      operation.support_reference, operation.reason_code, 'church.administration_case_opened',
      'church', (operation.target_preview->>'church_id')::uuid, array['administration_case']);
  end if;
  selected_decision := case operation.operation_type when 'replace_church_admin' then 'replacement' else 'archive' end;
  update ops.church_administration_case set decision = selected_decision,
    state = case selected_decision when 'replacement' then 'replacement_pending' else 'archive_pending' end,
    prepared_operation_id = operation.id, updated_at = clock_timestamp() where id = support_case.id;
  update ops.owner_operation set administration_case_id = support_case.id,
    target_preview = target_preview || jsonb_build_object('administration_case_id', support_case.id,
      'membership_id', member.public_id) where id = operation.id returning * into operation;
  return operation.target_preview;
end; $$;

create or replace function ops.prepare_church_administration_replacement(
  p_church_id uuid, p_membership_id uuid, p_replacement_account_id uuid, p_support_reference text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare prepared jsonb; preview jsonb;
begin
  prepared := ops.prepare_church_admin_replacement(p_church_id, p_membership_id, p_replacement_account_id, p_support_reference);
  preview := ops.bind_church_administration_case((prepared->>'operation_id')::uuid, p_membership_id);
  return prepared || jsonb_build_object('preview', preview);
end; $$;

create or replace function ops.prepare_church_administration_archival(
  p_church_id uuid, p_membership_id uuid, p_support_reference text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare prepared jsonb; preview jsonb;
begin
  prepared := ops.prepare_church_lifecycle(p_church_id, 'archive_church', p_support_reference, 'reviewed_archival');
  preview := ops.bind_church_administration_case((prepared->>'operation_id')::uuid, p_membership_id);
  return prepared || jsonb_build_object('preview', preview);
end; $$;

-- Native execution still owns capability/session/expiry/fingerprint and future-work checks.
-- This trigger completes the linked case in the SAME inner transaction, before success can commit.
create or replace function ops.complete_church_administration_case()
returns trigger language plpgsql volatile security definer set search_path = ''
as $$
declare support_case ops.church_administration_case%rowtype; member app.church_admin_membership%rowtype;
  incoming_member uuid; church_public_id uuid; church_slug text;
begin
  if old.state <> 'prepared' or new.state <> 'succeeded' or new.administration_case_id is null then return new; end if;
  select * into support_case from ops.church_administration_case where id = new.administration_case_id for update;
  if not found or support_case.state not in ('replacement_pending', 'archive_pending')
    or support_case.prepared_operation_id <> new.id or support_case.church_id <> new.church_id
    or support_case.support_reference <> new.support_reference then
    raise exception using errcode = 'PT409', message = 'Administration case changed; prepare a new operation.';
  end if;
  select * into strict member from app.church_admin_membership where id = support_case.target_membership_id for update;
  select public_id, slug into strict church_public_id, church_slug from app.church where id = new.church_id;
  if support_case.decision = 'replacement' and new.operation_type = 'replace_church_admin' then
    select id into incoming_member from app.church_admin_membership where church_id = new.church_id
      and public_id = (new.result->>'replacement_membership_id')::uuid
      and account_id = new.replacement_account_id and status = 'active';
    if member.status <> 'ended' or new.target_membership_id <> member.id or incoming_member is null then
      raise exception using errcode = 'PT409', message = 'Administration replacement is incomplete.';
    end if;
  elsif support_case.decision = 'archive' and new.operation_type = 'archive_church' then
    if not exists (select 1 from app.church where id = new.church_id and status = 'archived')
      or member.status not in ('active', 'transferring')
      or (select count(*) from app.church_admin_membership where church_id = new.church_id
        and status in ('active', 'transferring')) <> 1 then
      raise exception using errcode = 'PT409', message = 'Administration archival is incomplete.';
    end if;
    update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = member.id;
    insert into app.church_admin_event(church_id, subject_account_id, event_type)
      values (new.church_id, member.account_id, 'membership.removed');
    perform app.create_notification_once(member.account_id, 'church-admin-case-resolved:' || support_case.id::text,
      'church.admin.case_resolved', 'church', church_public_id,
      case when length(church_slug) <= 231 then '/churches/' || church_slug else '/churches' end,
      'notifications.church_admin_removed', jsonb_build_object('church_id', church_public_id), 50);
  else
    raise exception using errcode = 'PT409', message = 'Administration decision does not match the operation.';
  end if;
  update ops.church_administration_case set state = 'resolved', executed_operation_id = new.id,
    replacement_membership_id = incoming_member, resolved_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = support_case.id;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('administration-case:' || support_case.id::text || ':resolved', 'operator', new.prepared_by,
    new.support_reference, new.reason_code, 'church.administration_case_resolved', 'church', church_public_id,
    array['administration_case', 'administrator_membership']);
  -- Preserve native first-execution/replay result shapes; success cannot commit before case resolution.
  return new;
end; $$;
create or replace trigger complete_church_administration_case before update of state on ops.owner_operation
  for each row execute function ops.complete_church_administration_case();

revoke all on function ops.bind_church_administration_case(uuid,uuid), ops.complete_church_administration_case(),
  ops.prepare_church_administration_replacement(uuid,uuid,uuid,text), ops.prepare_church_administration_archival(uuid,uuid,text)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_administration_replacement(uuid,uuid,uuid,text),
  ops.prepare_church_administration_archival(uuid,uuid,text) to orthodox_routes_church_operator;
