create table ops.audit_event (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) between 1 and 180 and event_key !~ '[[:cntrl:]]'),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_kind text not null check (actor_kind in ('account', 'system')),
  actor_account_id uuid references app.account (id) on delete set null,
  action_type text not null check (action_type in (
    'agreement.confirmed', 'agreement.cancelled', 'agreement.completed', 'agreement.no_outcome',
    'agreement.archived', 'agreement.change_proposed', 'agreement.change_accepted',
    'agreement.change_declined', 'agreement.change_expired', 'agreement.change_cancelled',
    'personal_block.created', 'personal_block.ended', 'personal_block.reactivated'
  )),
  target_type text not null check (target_type in ('ride_agreement', 'personal_block')),
  target_id uuid not null,
  result text not null default 'success' check (result = 'success'),
  changed_fields text[] not null check (
    cardinality(changed_fields) between 1 and 3 and array_position(changed_fields, null) is null
    and changed_fields <@ array['status', 'active_snapshot_id', 'confirmed_passenger_count',
      'blocker_account_id', 'blocked_account_id', 'ended_at']::text[]
  ),
  transaction_id text default pg_current_xact_id()::text check (transaction_id ~ '^[0-9]+$'),
  schema_version integer not null default 1 check (schema_version = 1),
  constraint audit_event_actor_shape check (actor_kind = 'account' or actor_account_id is null),
  constraint audit_event_target_shape check (
    (target_type = 'ride_agreement' and action_type like 'agreement.%')
    or (target_type = 'personal_block' and action_type like 'personal_block.%')
  )
);
create index audit_event_target_history on ops.audit_event (target_type, target_id, occurred_at, id);
create index audit_event_actor_history on ops.audit_event (actor_account_id, occurred_at, id)
  where actor_account_id is not null;
alter table ops.audit_event enable row level security;
alter table ops.audit_event force row level security;
revoke all on table ops.audit_event from public, anon, authenticated, service_role;

create function app.prevent_audit_event_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- FK-driven account deletion may clear an actor reference, but cannot rewrite the event.
  if new is not distinct from old or (
    old.actor_account_id is not null and new.actor_account_id is null
    and (to_jsonb(new) - 'actor_account_id') = (to_jsonb(old) - 'actor_account_id')
  ) then return new; end if;
  raise exception using errcode = '55000', message = 'Audit events cannot be rewritten.';
end;
$$;
create trigger prevent_audit_event_rewrite before update on ops.audit_event
  for each row execute function app.prevent_audit_event_rewrite();

create function app.audit_agreement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_public_id uuid;
begin
  select agreement.public_id into agreement_public_id from app.ride_agreement as agreement
  where agreement.id = new.agreement_id;
  insert into ops.audit_event (
    event_key, occurred_at, actor_kind, actor_account_id, action_type,
    target_type, target_id, changed_fields
  ) values (
    'agreement-event:' || new.id::text, new.created_at,
    case when new.actor_account_id is null then 'system' else 'account' end,
    new.actor_account_id, 'agreement.' || new.event_type, 'ride_agreement', agreement_public_id,
    case when new.event_type in ('confirmed', 'change_accepted')
      then array['status', 'active_snapshot_id', 'confirmed_passenger_count']::text[]
      else array['status']::text[] end
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;
create trigger audit_agreement_event after insert on app.agreement_event
  for each row execute function app.audit_agreement_event();

create function app.audit_personal_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into ops.audit_event (
      event_key, occurred_at, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields
    ) values (
      'personal-block:' || new.id::text || ':created', new.created_at, 'account',
      new.blocker_account_id, 'personal_block.created', 'personal_block', new.id,
      array['blocker_account_id', 'blocked_account_id']::text[]
    ) on conflict (event_key) do nothing;
  elsif old.ended_at is not null and new.ended_at is null then
    insert into ops.audit_event (
      event_key, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields
    ) values (
      'personal-block-reactivated:' || gen_random_uuid()::text, 'account', new.blocker_account_id,
      'personal_block.reactivated', 'personal_block', new.id, array['ended_at']::text[]
    );
  end if;
  if new.ended_at is not null and (tg_op = 'INSERT' or old.ended_at is distinct from new.ended_at) then
    insert into ops.audit_event (
      event_key, occurred_at, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields
    ) values (
      'personal-block:' || new.id::text || ':ended:'
        || to_char(new.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      new.ended_at, 'account', new.blocker_account_id, 'personal_block.ended',
      'personal_block', new.id, array['ended_at']::text[]
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger audit_personal_block after insert or update on app.personal_block
  for each row execute function app.audit_personal_block();

-- Install capture first, then backfill only facts already present in the source history.
-- Historical transaction IDs are unknown; never present the migration TX as the original TX.
insert into ops.audit_event (
  event_key, occurred_at, actor_kind, actor_account_id, action_type,
  target_type, target_id, changed_fields, transaction_id
)
select 'agreement-event:' || event.id::text, event.created_at,
  case when event.actor_account_id is null then 'system' else 'account' end,
  event.actor_account_id, 'agreement.' || event.event_type, 'ride_agreement', agreement.public_id,
  case when event.event_type in ('confirmed', 'change_accepted')
    then array['status', 'active_snapshot_id', 'confirmed_passenger_count']::text[]
    else array['status']::text[] end, null
from app.agreement_event as event join app.ride_agreement as agreement on agreement.id = event.agreement_id
where true
on conflict (event_key) do nothing;
insert into ops.audit_event (
  event_key, occurred_at, actor_kind, actor_account_id, action_type,
  target_type, target_id, changed_fields, transaction_id
)
select 'personal-block:' || block.id::text || ':created', block.created_at,
  'account', block.blocker_account_id, 'personal_block.created', 'personal_block', block.id,
  array['blocker_account_id', 'blocked_account_id']::text[], null
from app.personal_block as block where true on conflict (event_key) do nothing;
insert into ops.audit_event (
  event_key, occurred_at, actor_kind, actor_account_id, action_type,
  target_type, target_id, changed_fields, transaction_id
)
select 'personal-block:' || block.id::text || ':ended:'
    || to_char(block.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
  block.ended_at, 'account', block.blocker_account_id, 'personal_block.ended', 'personal_block', block.id,
  array['ended_at']::text[], null
from app.personal_block as block where block.ended_at is not null on conflict (event_key) do nothing;

revoke all on function app.prevent_audit_event_rewrite() from public, anon, authenticated, service_role;
revoke all on function app.audit_agreement_event() from public, anon, authenticated, service_role;
revoke all on function app.audit_personal_block() from public, anon, authenticated, service_role;
comment on table ops.audit_event is
  'Restricted minimized transition audit: identifiers and field names only, no contacts, geography, comments, tokens, or payload copies. Retention and owner-case operations follow separately.';
