-- Invitation state is private even when the recipient has not registered yet.
-- The clear token exists only in the protected delivery queue, never in an actor RPC result.

create table app.church_admin_invite (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  church_id uuid not null references app.church (id) on delete restrict,
  invite_email text not null,
  sender_account_id uuid not null references app.account (id) on delete restrict,
  transfer_membership_id uuid references app.church_admin_membership (id) on delete restrict,
  token_hash text not null,
  state text not null default 'pending',
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default clock_timestamp(),
  accepted_account_id uuid references app.account (id) on delete restrict,
  decided_at timestamptz,
  constraint church_admin_invite_email check (
    invite_email = lower(btrim(invite_email)) and char_length(invite_email) between 3 and 254
    and invite_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint church_admin_invite_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint church_admin_invite_state check (state in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'no_slot')),
  constraint church_admin_invite_lifecycle check (
    expires_at = issued_at + interval '7 days'
    and last_sent_at >= issued_at
    and ((state = 'pending') = (decided_at is null))
    and (state = 'accepted') = (accepted_account_id is not null)
  )
);

create unique index church_admin_invite_pending_email
  on app.church_admin_invite (church_id, invite_email) where state = 'pending';
create unique index church_admin_invite_pending_transfer
  on app.church_admin_invite (transfer_membership_id)
  where state = 'pending' and transfer_membership_id is not null;
create index church_admin_invite_pending_expiry
  on app.church_admin_invite (expires_at) where state = 'pending';

create table private.church_invite_mail (
  invite_id uuid primary key references app.church_admin_invite (id) on delete cascade,
  dispatch_id uuid not null default gen_random_uuid(),
  token_value text not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  provider_reference text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint church_invite_mail_token check (token_value ~ '^[0-9a-f]{64}$'),
  constraint church_invite_mail_state check (state in ('queued', 'claimed', 'sent', 'dead', 'cancelled')),
  constraint church_invite_mail_attempts check (attempt_count between 0 and 20),
  constraint church_invite_mail_lease check (
    (state = 'claimed') = (lease_token is not null and lease_until is not null)
  )
);

create index church_invite_mail_claimable on private.church_invite_mail (next_attempt_at)
  where state in ('queued', 'claimed');

alter table app.church_admin_invite enable row level security;
alter table app.church_admin_invite force row level security;
alter table private.church_invite_mail enable row level security;
alter table private.church_invite_mail force row level security;
revoke all on table app.church_admin_invite, private.church_invite_mail
  from public, anon, authenticated, service_role;

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type
  check (operation_type in ('create_church', 'invite_church_admin'));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create or replace function app.enforce_church_admin_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reserved_count integer;
begin
  if new.status not in ('active', 'transferring') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || new.church_id::text, 0));
  select count(*) into reserved_count
  from app.church_admin_membership as membership
  where membership.church_id = new.church_id
    and membership.status in ('active', 'transferring') and membership.id <> new.id;
  select reserved_count + count(*) into reserved_count
  from app.church_admin_invite as invite
  where invite.church_id = new.church_id and invite.state = 'pending'
    and invite.expires_at > clock_timestamp() and invite.transfer_membership_id is null;
  if reserved_count >= 3 then
    raise exception using errcode = '23514', message = 'A church can have at most three administrator places.';
  end if;
  return new;
end;
$$;

create function app.enforce_church_invite_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reserved_count integer;
  source_membership app.church_admin_membership%rowtype;
begin
  if new.state <> 'pending' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || new.church_id::text, 0));
  if new.transfer_membership_id is not null then
    select * into source_membership from app.church_admin_membership as membership
    where membership.id = new.transfer_membership_id;
    if not found or source_membership.church_id <> new.church_id
      or source_membership.account_id <> new.sender_account_id
      or source_membership.status not in ('active', 'transferring') then
      raise exception using errcode = '23514', message = 'Only the current member can offer their own place.';
    end if;
  else
    select count(*) into reserved_count from app.church_admin_membership as membership
    where membership.church_id = new.church_id and membership.status in ('active', 'transferring');
    select reserved_count + count(*) into reserved_count from app.church_admin_invite as invite
    where invite.church_id = new.church_id and invite.state = 'pending'
      and invite.expires_at > clock_timestamp() and invite.transfer_membership_id is null
      and invite.id <> new.id;
    if reserved_count >= 3 then
      raise exception using errcode = '23514', message = 'No administrator place is available.';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_church_invite_slot
before insert or update of state, church_id, transfer_membership_id on app.church_admin_invite
for each row execute function app.enforce_church_invite_slot();

create function app.expire_church_admin_invites(requested_church_id uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  expired_count integer;
begin
  update app.church_admin_invite as invite
  set state = 'expired', decided_at = clock_timestamp()
  where invite.church_id = requested_church_id and invite.state = 'pending'
    and invite.expires_at <= clock_timestamp();
  get diagnostics expired_count = row_count;
  update private.church_invite_mail as mail set state = 'cancelled', lease_token = null,
    lease_until = null, token_value = repeat('0', 64), updated_at = clock_timestamp()
  where mail.invite_id in (select invite.id from app.church_admin_invite as invite
    where invite.church_id = requested_church_id and invite.state = 'expired')
    and mail.state in ('queued', 'claimed');
  return expired_count;
end;
$$;

create function api.invite_church_admin(
  p_church_id uuid, p_email text, p_transfer_own_place boolean, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  target_church app.church%rowtype;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  current_member app.church_admin_membership%rowtype;
  target_member uuid;
  token_value text;
  input_digest text;
  existing_result jsonb;
  issued app.church_admin_invite%rowtype;
  result jsonb;
  issued_time timestamptz;
begin
  if p_church_id is null or p_client_key is null or p_transfer_own_place is null
    or char_length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Church invitation input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'email', normalized_email,
    'transfer_own_place', p_transfer_own_place
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':invite_church_admin:' || p_client_key::text, 0));
  existing_result := app.church_operation_result(actor_id, 'invite_church_admin', p_client_key, input_digest);
  if existing_result is not null then return existing_result; end if;

  select * into target_church from app.church as church where church.public_id = p_church_id;
  if not found or target_church.status not in ('published', 'hidden') then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || target_church.id::text, 0));
  perform app.expire_church_admin_invites(target_church.id);
  select * into current_member from app.church_admin_membership as membership
  where membership.church_id = target_church.id and membership.account_id = actor_id
    and membership.status in ('active', 'transferring');
  if not found then raise exception using errcode = '42501', message = 'Church administration is unavailable.'; end if;
  if exists (select 1 from private.account_contact as contact
    where contact.account_id = actor_id and contact.email_normalized = normalized_email) then
    raise exception using errcode = '22023', message = 'An administrator cannot invite themselves.';
  end if;
  select membership.id into target_member
  from app.church_admin_membership as membership
  join private.account_contact as contact on contact.account_id = membership.account_id
  where membership.church_id = target_church.id and membership.status in ('active', 'transferring')
    and contact.email_normalized = normalized_email;
  if target_member is not null then
    raise exception using errcode = '22023', message = 'The account already administers this church.';
  end if;
  if exists (select 1 from app.church_admin_invite as invite
    where invite.church_id = target_church.id and invite.invite_email = normalized_email
      and invite.state = 'pending') then
    raise exception using errcode = '23505', message = 'An invitation is already pending for this email.';
  end if;
  if p_transfer_own_place and exists (select 1 from app.church_admin_invite as invite
    where invite.transfer_membership_id = current_member.id and invite.state = 'pending') then
    raise exception using errcode = '23505', message = 'This administrator place is already being transferred.';
  end if;

  token_value := encode(extensions.gen_random_bytes(32), 'hex');
  issued_time := clock_timestamp();
  insert into app.church_admin_invite (
    church_id, invite_email, sender_account_id, transfer_membership_id,
    token_hash, issued_at, expires_at, last_sent_at
  ) values (
    target_church.id, normalized_email, actor_id,
    case when p_transfer_own_place then current_member.id else null end,
    encode(extensions.digest(convert_to(token_value, 'UTF8'), 'sha256'), 'hex'),
    issued_time, issued_time + interval '7 days', issued_time
  ) returning * into issued;
  insert into private.church_invite_mail (invite_id, token_value)
  values (issued.id, token_value);
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (target_church.id, actor_id, 'invite.issued');
  result := jsonb_build_object('status', 'pending', 'invite_id', issued.public_id,
    'expires_at', issued.expires_at, 'transfer_own_place', p_transfer_own_place);
  insert into private.church_operation (actor_account_id, operation_type, client_key, input_digest, result)
  values (actor_id, 'invite_church_admin', p_client_key, input_digest, result);
  return result;
end;
$$;

create function api.accept_church_admin_invite(p_invite_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  invitation app.church_admin_invite%rowtype;
  source_member app.church_admin_membership%rowtype;
  church_row app.church%rowtype;
  member_id uuid;
  other_admin record;
begin
  if p_invite_id is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Invitation is unavailable.';
  end if;
  select * into invitation from app.church_admin_invite as invite where invite.public_id = p_invite_id;
  if not found then raise exception using errcode = '42501', message = 'Invitation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || invitation.church_id::text, 0));
  select * into invitation from app.church_admin_invite as invite where invite.public_id = p_invite_id for update;
  if invitation.state = 'accepted' and invitation.accepted_account_id = actor_id then
    return jsonb_build_object('status', 'accepted', 'church_id',
      (select church.public_id from app.church as church where church.id = invitation.church_id));
  end if;
  if invitation.state <> 'pending'
    or invitation.token_hash <> encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    or not exists (select 1 from private.account_contact as contact
      join auth.users as identity on identity.id = contact.account_id
      where contact.account_id = actor_id and contact.email_normalized = invitation.invite_email
        and identity.email_confirmed_at is not null and lower(identity.email) = invitation.invite_email)
  then raise exception using errcode = '42501', message = 'Invitation is unavailable.';
  end if;
  if invitation.expires_at <= clock_timestamp() then
    perform app.expire_church_admin_invites(invitation.church_id);
    return jsonb_build_object('status', 'expired');
  end if;
  select * into church_row from app.church as church where church.id = invitation.church_id;
  if church_row.status not in ('published', 'hidden') then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  if exists (select 1 from app.church_admin_membership as membership
    where membership.church_id = invitation.church_id and membership.account_id = actor_id
      and membership.status in ('active', 'transferring')) then
    raise exception using errcode = '23505', message = 'The account already administers this church.';
  end if;
  if invitation.transfer_membership_id is not null then
    select * into source_member from app.church_admin_membership as membership
    where membership.id = invitation.transfer_membership_id for update;
    if not found or source_member.status not in ('active', 'transferring')
      or source_member.account_id <> invitation.sender_account_id then
      update app.church_admin_invite set state = 'no_slot', decided_at = clock_timestamp()
      where id = invitation.id;
      return jsonb_build_object('status', 'no_slot');
    end if;
  end if;
  update app.church_admin_invite set state = 'accepted', accepted_account_id = actor_id,
    decided_at = clock_timestamp() where id = invitation.id;
  if invitation.transfer_membership_id is not null then
    update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(),
      updated_at = clock_timestamp() where id = source_member.id;
  end if;
  insert into app.church_admin_membership (church_id, account_id, access_source)
  values (invitation.church_id, actor_id, 'invite') returning id into member_id;
  update private.church_invite_mail set state = 'cancelled', lease_token = null,
    lease_until = null, token_value = repeat('0', 64), updated_at = clock_timestamp()
  where invite_id = invitation.id and state in ('queued', 'claimed', 'sent');
  insert into app.church_admin_event (church_id, actor_account_id, subject_account_id, event_type)
  values (invitation.church_id, actor_id, actor_id,
    case when invitation.transfer_membership_id is null then 'membership.joined' else 'membership.transferred' end);
  for other_admin in select membership.account_id from app.church_admin_membership as membership
    where membership.church_id = invitation.church_id and membership.status in ('active', 'transferring')
      and membership.account_id <> actor_id
  loop
    perform app.create_notification_once(other_admin.account_id,
      'church-admin-joined:' || invitation.public_id::text,
      'church.admin.joined', 'church', church_row.public_id, '/churches/' || church_row.slug,
      'notifications.church_admin_joined', jsonb_build_object('church_id', church_row.public_id), 50);
  end loop;
  return jsonb_build_object('status', 'accepted', 'church_id', church_row.public_id,
    'membership_id', (select membership.public_id from app.church_admin_membership as membership
      where membership.id = member_id));
end;
$$;

create function api.cancel_church_admin_invite(p_invite_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  invitation app.church_admin_invite%rowtype;
begin
  select * into invitation from app.church_admin_invite as invite where invite.public_id = p_invite_id;
  if not found then raise exception using errcode = '42501', message = 'Invitation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || invitation.church_id::text, 0));
  if not exists (select 1 from app.church_admin_membership as membership
    where membership.church_id = invitation.church_id and membership.account_id = actor_id
      and membership.status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  update app.church_admin_invite set state = 'cancelled', decided_at = clock_timestamp()
  where id = invitation.id and state = 'pending';
  if not found then return false; end if;
  update private.church_invite_mail set state = 'cancelled', lease_token = null,
    lease_until = null, token_value = repeat('0', 64), updated_at = clock_timestamp()
  where invite_id = invitation.id and state in ('queued', 'claimed', 'sent');
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (invitation.church_id, actor_id, 'invite.cancelled');
  return true;
end;
$$;

create function api.resend_church_admin_invite(p_invite_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  invitation app.church_admin_invite%rowtype;
begin
  select * into invitation from app.church_admin_invite as invite where invite.public_id = p_invite_id;
  if not found then raise exception using errcode = '42501', message = 'Invitation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || invitation.church_id::text, 0));
  select * into invitation from app.church_admin_invite as invite where invite.id = invitation.id for update;
  if not exists (select 1 from app.church_admin_membership as membership
    where membership.church_id = invitation.church_id and membership.account_id = actor_id
      and membership.status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  if invitation.state <> 'pending' or invitation.expires_at <= clock_timestamp() then
    perform app.expire_church_admin_invites(invitation.church_id);
    return false;
  end if;
  if invitation.last_sent_at > clock_timestamp() - interval '10 minutes' then
    raise exception using errcode = '23514', message = 'The invitation can be resent after ten minutes.';
  end if;
  update app.church_admin_invite set last_sent_at = clock_timestamp() where id = invitation.id;
  update private.church_invite_mail set state = 'queued', dispatch_id = gen_random_uuid(),
    attempt_count = 0, next_attempt_at = clock_timestamp(), lease_token = null,
    lease_until = null, provider_reference = null, updated_at = clock_timestamp()
  where invite_id = invitation.id;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (invitation.church_id, actor_id, 'invite.resent');
  return true;
end;
$$;

create function api.decline_church_admin_invite(p_invite_id uuid, p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  invitation app.church_admin_invite%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'Invitation is unavailable.';
  end if;
  select * into invitation from app.church_admin_invite as invite where invite.public_id = p_invite_id;
  if not found then raise exception using errcode = '42501', message = 'Invitation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || invitation.church_id::text, 0));
  select * into invitation from app.church_admin_invite as invite where invite.id = invitation.id for update;
  if invitation.state <> 'pending'
    or invitation.token_hash <> encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
    or not exists (select 1 from private.account_contact as contact
      join auth.users as identity on identity.id = contact.account_id
      where contact.account_id = actor_id and contact.email_normalized = invitation.invite_email
        and identity.email_confirmed_at is not null and lower(identity.email) = invitation.invite_email)
  then raise exception using errcode = '42501', message = 'Invitation is unavailable.'; end if;
  if invitation.expires_at <= clock_timestamp() then
    perform app.expire_church_admin_invites(invitation.church_id);
    return false;
  end if;
  update app.church_admin_invite set state = 'declined', decided_at = clock_timestamp()
  where id = invitation.id;
  update private.church_invite_mail set state = 'cancelled', lease_token = null,
    lease_until = null, token_value = repeat('0', 64), updated_at = clock_timestamp()
  where invite_id = invitation.id and state in ('queued', 'claimed', 'sent');
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (invitation.church_id, actor_id, 'invite.declined');
  return true;
end;
$$;

create function api.leave_church_administration(p_church_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  church_row app.church%rowtype;
  current_member app.church_admin_membership%rowtype;
  other_admin record;
begin
  select * into church_row from app.church as church where church.public_id = p_church_id;
  if not found then raise exception using errcode = '42501', message = 'Church administration is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_row.id::text, 0));
  select * into current_member from app.church_admin_membership as membership
  where membership.church_id = church_row.id and membership.account_id = actor_id
    and membership.status in ('active', 'transferring') for update;
  if not found then raise exception using errcode = '42501', message = 'Church administration is unavailable.'; end if;
  if (select count(*) from app.church_admin_membership as membership
    where membership.church_id = church_row.id and membership.status in ('active', 'transferring')) <= 1 then
    raise exception using errcode = '23514', message = 'The final administrator must first transfer the page.';
  end if;
  if exists (select 1 from app.church_admin_invite as invite
    where invite.transfer_membership_id = current_member.id and invite.state = 'pending') then
    raise exception using errcode = '23514', message = 'Cancel the pending transfer before leaving.';
  end if;
  update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(),
    updated_at = clock_timestamp() where id = current_member.id;
  insert into app.church_admin_event (church_id, actor_account_id, subject_account_id, event_type)
  values (church_row.id, actor_id, actor_id, 'membership.left');
  for other_admin in select membership.account_id from app.church_admin_membership as membership
    where membership.church_id = church_row.id and membership.status in ('active', 'transferring')
  loop
    perform app.create_notification_once(other_admin.account_id,
      'church-admin-left:' || current_member.public_id::text,
      'church.admin.left', 'church', church_row.public_id, '/churches/' || church_row.slug,
      'notifications.church_admin_left', jsonb_build_object('church_id', church_row.public_id), 50);
  end loop;
  return true;
end;
$$;

create function api.church_invite_worker_claim(p_lease_token uuid, p_limit integer default 10)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  jobs jsonb;
begin
  if p_lease_token is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Invitation worker lease is invalid.';
  end if;
  update app.church_admin_invite as invite
  set state = 'expired', decided_at = clock_timestamp()
  where invite.state = 'pending' and invite.expires_at <= clock_timestamp();
  update private.church_invite_mail as mail
  set state = 'cancelled', token_value = repeat('0', 64),
    lease_token = null, lease_until = null, updated_at = clock_timestamp()
  where mail.state in ('queued', 'claimed') and exists (
    select 1 from app.church_admin_invite as invite
    where invite.id = mail.invite_id and invite.state = 'expired'
  );
  update private.church_invite_mail as mail
  set state = 'dead', token_value = repeat('0', 64),
    lease_token = null, lease_until = null, updated_at = clock_timestamp()
  where mail.state = 'claimed' and mail.attempt_count >= 5
    and mail.lease_until <= clock_timestamp();
  with selected as (
    select mail.invite_id
    from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.state = 'pending' and invite.expires_at > clock_timestamp()
      and mail.attempt_count < 5
      and ((mail.state = 'queued' and mail.next_attempt_at <= clock_timestamp())
        or (mail.state = 'claimed' and mail.lease_until <= clock_timestamp()))
    order by mail.next_attempt_at, mail.invite_id
    limit p_limit
    for update of mail skip locked
  ), claimed as (
    update private.church_invite_mail as mail
    set state = 'claimed', lease_token = p_lease_token,
      lease_until = clock_timestamp() + interval '2 minutes',
      attempt_count = mail.attempt_count + 1, updated_at = clock_timestamp()
    from selected where mail.invite_id = selected.invite_id
    returning mail.invite_id, mail.dispatch_id, mail.token_value, mail.attempt_count
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', claimed.dispatch_id, 'invite_id', invite.public_id,
    'destination_email', invite.invite_email, 'token', claimed.token_value,
    'church_name', church.official_name, 'church_slug', church.slug,
    'language', church.source_language, 'expires_at', invite.expires_at,
    'attempt_count', claimed.attempt_count
  )), '[]'::jsonb) into jobs
  from claimed
  join app.church_admin_invite as invite on invite.id = claimed.invite_id
  join app.church as church on church.id = invite.church_id;
  return jobs;
end;
$$;

create function api.church_invite_worker_complete(
  p_job_id uuid, p_lease_token uuid, p_outcome text, p_provider_reference text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed private.church_invite_mail%rowtype;
begin
  if p_job_id is null or p_lease_token is null
    or p_outcome not in ('sent', 'temporary_failure', 'permanent_failure')
    or (p_provider_reference is not null and (
      char_length(p_provider_reference) > 200 or p_provider_reference ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Invitation worker completion is invalid.';
  end if;
  select * into claimed from private.church_invite_mail as mail
  where mail.dispatch_id = p_job_id and mail.state = 'claimed'
    and mail.lease_token = p_lease_token and mail.lease_until > clock_timestamp()
  for update;
  if not found then return false; end if;
  update private.church_invite_mail as mail
  set state = case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'temporary_failure' and claimed.attempt_count < 5 then 'queued'
      else 'dead' end,
    next_attempt_at = case when p_outcome = 'temporary_failure' then
      clock_timestamp() + make_interval(mins => (2 ^ least(claimed.attempt_count, 5))::integer)
      else mail.next_attempt_at end,
    lease_token = null, lease_until = null,
    token_value = case when p_outcome = 'permanent_failure' or claimed.attempt_count >= 5
      then repeat('0', 64) else mail.token_value end,
    provider_reference = case when p_outcome = 'sent' then p_provider_reference else null end,
    updated_at = clock_timestamp()
  where mail.invite_id = claimed.invite_id;
  return true;
end;
$$;

revoke all on function app.enforce_church_invite_slot(), app.expire_church_admin_invites(uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.invite_church_admin(uuid, text, boolean, uuid),
  api.accept_church_admin_invite(uuid, text), api.cancel_church_admin_invite(uuid),
  api.resend_church_admin_invite(uuid), api.decline_church_admin_invite(uuid, text),
  api.leave_church_administration(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.invite_church_admin(uuid, text, boolean, uuid),
  api.accept_church_admin_invite(uuid, text), api.cancel_church_admin_invite(uuid),
  api.resend_church_admin_invite(uuid), api.decline_church_admin_invite(uuid, text),
  api.leave_church_administration(uuid) to authenticated;

revoke all on function api.church_invite_worker_claim(uuid, integer),
  api.church_invite_worker_complete(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.church_invite_worker_claim(uuid, integer),
  api.church_invite_worker_complete(uuid, uuid, text, text) to service_role;
