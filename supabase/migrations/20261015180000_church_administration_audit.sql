alter table ops.audit_event drop constraint audit_event_action_type_check;
alter table ops.audit_event add constraint audit_event_action_type_check check (action_type in (
  'agreement.confirmed', 'agreement.cancelled', 'agreement.completed', 'agreement.no_outcome',
  'agreement.archived', 'agreement.change_proposed', 'agreement.change_accepted',
  'agreement.change_declined', 'agreement.change_expired', 'agreement.change_cancelled',
  'personal_block.created', 'personal_block.ended', 'personal_block.reactivated',
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created', 'service.date_cancelled', 'service.date_rescheduled',
  'service.date_content_updated', 'service.future_dates_cancelled', 'translation.corrected',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));
alter table ops.audit_event drop constraint audit_event_target_type_check;
alter table ops.audit_event add constraint audit_event_target_type_check
  check (target_type in ('ride_agreement', 'personal_block', 'church'));
alter table ops.audit_event drop constraint audit_event_target_shape;
alter table ops.audit_event add constraint audit_event_target_shape check (
  (target_type = 'ride_agreement' and action_type like 'agreement.%')
  or (target_type = 'personal_block' and action_type like 'personal_block.%')
  or (target_type = 'church' and (
    action_type like 'church.%' or action_type like 'service.%'
    or action_type like 'translation.%' or action_type like 'membership.%'
    or action_type like 'invite.%' or action_type like 'archive.%'
  ))
);
alter table ops.audit_event drop constraint audit_event_changed_fields_check;
alter table ops.audit_event add constraint audit_event_changed_fields_check check (
  cardinality(changed_fields) between 1 and 3 and array_position(changed_fields, null) is null
  and changed_fields <@ array['status', 'active_snapshot_id', 'confirmed_passenger_count',
    'blocker_account_id', 'blocked_account_id', 'ended_at', 'content_version',
    'address_display', 'location', 'schedule_updated_at', 'administrator_membership',
    'administrator_invitation', 'archival_request', 'translation_content_version']::text[]
);

create or replace function app.church_audit_changed_fields(p_event_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_event_type = 'church.created' then array['status']::text[]
    when p_event_type = 'church.content_updated' then array['content_version']::text[]
    when p_event_type = 'church.address_updated' then array['address_display', 'location', 'content_version']::text[]
    when p_event_type like 'service.%' then array['schedule_updated_at']::text[]
    when p_event_type like 'membership.%' then array['administrator_membership']::text[]
    when p_event_type like 'invite.%' then array['administrator_invitation']::text[]
    when p_event_type like 'archive.%' then array['archival_request']::text[]
    when p_event_type = 'translation.corrected' then array['translation_content_version']::text[]
    else null end;
$$;

create or replace function app.audit_church_admin_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  church_public_id uuid;
begin
  select church.public_id into church_public_id from app.church as church
  where church.id = new.church_id;
  insert into ops.audit_event (
    event_key, occurred_at, actor_kind, actor_account_id, action_type,
    target_type, target_id, changed_fields
  ) values (
    'church-admin-event:' || new.id::text, new.occurred_at,
    case when new.actor_account_id is null then 'system' else 'account' end,
    new.actor_account_id, new.event_type, 'church', church_public_id,
    app.church_audit_changed_fields(new.event_type)
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;
create or replace trigger audit_church_admin_event after insert on app.church_admin_event
  for each row execute function app.audit_church_admin_event();

-- Reapplication safely repairs missing historical captures without rewriting existing facts.
insert into ops.audit_event (
  event_key, occurred_at, actor_kind, actor_account_id, action_type,
  target_type, target_id, changed_fields, transaction_id
)
select 'church-admin-event:' || event.id::text, event.occurred_at,
  case when event.actor_account_id is null then 'system' else 'account' end,
  event.actor_account_id, event.event_type, 'church', church.public_id,
  app.church_audit_changed_fields(event.event_type), null
from app.church_admin_event as event join app.church as church on church.id = event.church_id
where true
on conflict (event_key) do nothing;

revoke all on function app.church_audit_changed_fields(text) from public, anon, authenticated, service_role;
revoke all on function app.audit_church_admin_event() from public, anon, authenticated, service_role;
