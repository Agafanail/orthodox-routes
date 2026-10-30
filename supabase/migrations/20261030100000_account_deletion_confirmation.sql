-- Purpose-bound deletion consent only. This does not close transport, delete data,
-- revoke Auth, resolve administration, configure mail or activate a public flow.
create table if not exists ops.deletion_request (
  id uuid primary key default gen_random_uuid(),
  subject_auth_id uuid not null references auth.users(id) on delete restrict,
  client_key uuid not null,
  state text not null default 'pending_email' check (state in ('pending_email', 'email_confirmed', 'closed')),
  email_binding_hash text,
  email_proof_hash text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  email_confirmed_at timestamptz,
  closed_at timestamptz,
  close_reason text check (close_reason in ('expired', 'identity_changed')),
  mail_state text not null default 'queued' check (mail_state in ('queued', 'claimed', 'sent', 'failed', 'closed')),
  mail_attempt_count integer not null default 0 check (mail_attempt_count between 0 and 5),
  mail_next_at timestamptz not null default clock_timestamp(),
  mail_job_id uuid unique,
  mail_lease_hash text,
  mail_lease_until timestamptz,
  unique (subject_auth_id, client_key),
  constraint deletion_confirmation_lifetime check (expires_at = created_at + interval '15 minutes'),
  constraint deletion_confirmation_state check (
    (state in ('pending_email', 'email_confirmed') and email_binding_hash ~ '^[0-9a-f]{64}$' and email_binding_hash is not null
      and (email_proof_hash is null or email_proof_hash ~ '^[0-9a-f]{64}$') and closed_at is null and close_reason is null
      and ((state = 'pending_email' and email_confirmed_at is null and mail_state <> 'closed')
        or (state = 'email_confirmed' and email_proof_hash is not null and email_confirmed_at is not null
          and email_confirmed_at >= created_at and email_confirmed_at < expires_at and mail_state = 'closed')))
    or (state = 'closed' and email_binding_hash is null and email_proof_hash is null and email_confirmed_at is null
      and closed_at is not null and close_reason is not null and mail_state = 'closed'
      and (close_reason <> 'expired' or closed_at >= expires_at))
  ),
  constraint deletion_confirmation_mail_lease check (
    (mail_state = 'claimed' and mail_job_id is not null and mail_lease_hash is not null
      and mail_lease_hash ~ '^[0-9a-f]{64}$' and mail_lease_until is not null and mail_lease_until <= expires_at and mail_attempt_count > 0)
    or (mail_state <> 'claimed' and mail_job_id is null and mail_lease_hash is null and mail_lease_until is null)
  )
);
create unique index if not exists deletion_request_one_active_subject on ops.deletion_request(subject_auth_id)
  where state in ('pending_email', 'email_confirmed');
create index if not exists deletion_confirmation_mail_due on ops.deletion_request(mail_next_at, created_at, id)
  where state = 'pending_email' and mail_state in ('queued', 'claimed');
create index if not exists deletion_confirmation_expiry on ops.deletion_request(expires_at, id) where state = 'pending_email';
create index if not exists deletion_confirmation_subject_history on ops.deletion_request(subject_auth_id, created_at, id);
alter table ops.deletion_request enable row level security;
alter table ops.deletion_request force row level security;
revoke all on table ops.deletion_request from public, anon, authenticated, service_role, orthodox_routes_church_operator;

do $$
declare item record; expression text;
begin
  for item in select * from (values
    ('audit_event_action_type_check', 'account.deletion_requested',
      'action_type in (''account.deletion_requested'', ''account.deletion_email_confirmed'')'),
    ('audit_event_target_type_check', 'deletion_request', 'target_type = ''deletion_request'''),
    ('audit_event_target_shape', 'deletion_request',
      'target_type = ''deletion_request'' and action_type in (''account.deletion_requested'', ''account.deletion_email_confirmed'')'),
    ('audit_event_changed_fields_check', 'deletion_confirmation',
      'action_type in (''account.deletion_requested'', ''account.deletion_email_confirmed'') and changed_fields = array[''deletion_confirmation'']::text[]')
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

-- Share the existing AMR/policy calculation. The zero-argument wrapper retains
-- its established statement-time semantics; new consent checks pass database
-- clock time after their source/request waits. No API accepts a client clock.
create or replace function app.require_recent_reauthentication_at(p_evaluated_at timestamptz)
returns void language plpgsql stable security invoker set search_path = ''
as $$
declare policy ops.security_policy%rowtype; authenticated_at bigint;
begin
  select * into strict policy from ops.security_policy where singleton;
  select max((entry.value ->> 'timestamp')::bigint) into authenticated_at
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as entry(value)
  where entry.value ->> 'method' in ('magiclink', 'otp', 'password', 'recovery', 'email_change');
  if p_evaluated_at is null or authenticated_at is null
    or to_timestamp(authenticated_at) + make_interval(secs => policy.sensitive_reauth_max_age_seconds) < p_evaluated_at then
    raise exception using errcode = '42501', message = 'Recent reauthentication is required.';
  end if;
end; $$;
create or replace function app.require_recent_reauthentication()
returns void language plpgsql stable security invoker set search_path = ''
as $$
begin
  perform app.require_recent_reauthentication_at(statement_timestamp());
end; $$;

-- Serialize the intent first, then lock Auth/account/contact in that order.
-- No application account is materialized for a pre-account Auth subject.
-- Only the hash leaves this helper, never the current mailbox or private source.
create or replace function app.lock_deletion_confirmation_email(p_subject_id uuid)
returns text language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
begin
  perform 1 from auth.users where id = p_subject_id for share;
  if not found then return null; end if;
  perform 1 from app.account where id = p_subject_id for share;
  perform 1 from private.account_contact where account_id = p_subject_id for share;
  return (select encode(extensions.digest(convert_to(jsonb_build_array(lower(btrim(identity.email)),
      extract(epoch from identity.email_confirmed_at), extract(epoch from contact.email_changed_at))::text, 'UTF8'), 'sha256'), 'hex')
    from auth.users as identity left join app.account as account on account.id = identity.id
    left join private.account_contact as contact on contact.account_id = identity.id
    where identity.id = p_subject_id and identity.deleted_at is null
      and app.current_email_is_verified(identity.id)
      and char_length(lower(btrim(identity.email))) between 3 and 254
      and lower(btrim(identity.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and identity.email !~ '[[:cntrl:]]'
      and (account.id is null or account.status in ('email_verified', 'active', 'restricted')));
end; $$;

create or replace function app.deletion_confirmation_ack(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('schema_version', 1, 'request_id', request.id,
    'status', case when request.state = 'pending_email' and request.expires_at > statement_timestamp() then 'awaiting_email'
      when request.state = 'email_confirmed' then 'email_confirmed' else 'unavailable' end,
    'expires_at', request.expires_at, 'email_confirmed_at', request.email_confirmed_at)
  from ops.deletion_request as request where request.id = p_request_id;
$$;

create or replace function app.close_deletion_confirmation(p_request_id uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('expired', 'identity_changed') then
    raise exception using errcode = '22023', message = 'Deletion confirmation is unavailable.';
  end if;
  update ops.deletion_request set state = 'closed', closed_at = clock_timestamp(), close_reason = p_reason,
    email_binding_hash = null, email_proof_hash = null, email_confirmed_at = null, mail_state = 'closed',
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null
  where id = p_request_id and (state = 'pending_email' or (state = 'email_confirmed' and p_reason = 'identity_changed'))
    and (p_reason <> 'expired' or expires_at <= clock_timestamp());
  return found;
end; $$;

create or replace function app.audit_deletion_confirmation(p_request_id uuid, p_action text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_action is null or p_action not in ('account.deletion_requested', 'account.deletion_email_confirmed') then
    raise exception using errcode = '22023', message = 'Deletion confirmation is unavailable.';
  end if;
  insert into ops.audit_event(event_key, actor_kind, actor_account_id, action_type, target_type, target_id, changed_fields)
  select 'deletion-confirmation:' || request.id::text || ':' || p_action,
    case when account.id is null then 'system' else 'account' end, account.id,
    p_action, 'deletion_request', request.id, array['deletion_confirmation']
  from ops.deletion_request as request left join app.account as account on account.id = request.subject_auth_id
  where request.id = p_request_id on conflict (event_key) do nothing;
end; $$;

create or replace function api.request_account_deletion_confirmation(p_client_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare actor_id uuid := app.current_actor_id(); current_binding text; request ops.deletion_request%rowtype;
  requested_time timestamptz;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion-confirmation:' || actor_id::text, 0));
  current_binding := app.lock_deletion_confirmation_email(actor_id);
  if current_binding is null then raise exception using errcode = '42501', message = 'Deletion confirmation is unavailable.'; end if;
  select * into request from ops.deletion_request where subject_auth_id = actor_id and client_key = p_client_key for update;
  if found then
    perform app.close_deletion_confirmation(request.id, 'expired');
    if request.email_binding_hash is distinct from current_binding then
      perform app.close_deletion_confirmation(request.id, 'identity_changed');
    end if;
    return app.deletion_confirmation_ack(request.id);
  end if;
  select * into request from ops.deletion_request where subject_auth_id = actor_id
    and state in ('pending_email', 'email_confirmed') for update;
  if found then
    if request.email_binding_hash is distinct from current_binding then
      perform app.close_deletion_confirmation(request.id, 'identity_changed');
    elsif not app.close_deletion_confirmation(request.id, 'expired') then
      -- Do not acknowledge a different successful idempotency key without recording it.
      raise exception using errcode = 'PT409', message = 'A deletion confirmation is already active.';
    end if;
  end if;
  perform app.require_recent_reauthentication_at(clock_timestamp());
  requested_time := clock_timestamp();
  insert into ops.deletion_request(subject_auth_id, client_key, email_binding_hash, created_at, expires_at, mail_next_at)
    values (actor_id, p_client_key, current_binding, requested_time, requested_time + interval '15 minutes', requested_time)
    returning * into request;
  perform app.audit_deletion_confirmation(request.id, 'account.deletion_requested');
  return app.deletion_confirmation_ack(request.id);
end; $$;

create or replace function api.current_account_deletion_confirmation()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select app.deletion_confirmation_ack(request.id) from ops.deletion_request as request
  where request.subject_auth_id = app.current_actor_id()
  order by request.created_at desc, request.id desc limit 1;
$$;

create or replace function app.export_deletion_confirmations(p_subject_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('request_id', request.id,
    'status', case when request.state = 'pending_email' and request.expires_at > statement_timestamp() then 'awaiting_email'
      when request.state = 'email_confirmed' then 'email_confirmed' else 'unavailable' end,
    'requested_at', request.created_at, 'confirmation_expires_at', request.expires_at,
    'email_confirmed_at', request.email_confirmed_at, 'closed_at', request.closed_at)
    order by request.created_at, request.id), '[]'::jsonb)
  from ops.deletion_request as request where request.subject_auth_id = p_subject_id;
$$;
do $$
declare definition text; anchor text := '''personal_blocks'', (';
begin
  definition := pg_get_functiondef('api.export_current_account_data()'::regprocedure);
  if position('app.export_deletion_confirmations(actor_id)' in definition) > 0 then return; end if;
  if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
    raise exception using errcode = '55000', message = 'Unexpected account export definition.';
  end if;
  execute replace(definition, anchor,
    '''deletion_confirmations'', app.export_deletion_confirmations(actor_id), ' || anchor);
end; $$;

create or replace function api.confirm_account_deletion_email(p_request_id uuid, p_email_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare actor_id uuid := app.current_actor_id(); current_binding text; request ops.deletion_request%rowtype;
  supplied_hash text; confirmed_time timestamptz;
begin
  if p_request_id is null or p_email_token is null or p_email_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unavailable');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion-confirmation:' || actor_id::text, 0));
  current_binding := app.lock_deletion_confirmation_email(actor_id);
  select * into request from ops.deletion_request where id = p_request_id and subject_auth_id = actor_id for update;
  if not found then return jsonb_build_object('status', 'unavailable'); end if;
  if request.state = 'pending_email' then
    if app.close_deletion_confirmation(request.id, 'expired') then return jsonb_build_object('status', 'unavailable'); end if;
  end if;
  if request.state in ('pending_email', 'email_confirmed') and (current_binding is null or current_binding is distinct from request.email_binding_hash) then
    perform app.close_deletion_confirmation(request.id, 'identity_changed');
    return jsonb_build_object('status', 'unavailable');
  end if;
  supplied_hash := encode(extensions.digest(convert_to(p_email_token, 'UTF8'), 'sha256'), 'hex');
  if request.state not in ('pending_email', 'email_confirmed') or request.email_proof_hash is distinct from supplied_hash then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if request.state = 'email_confirmed' then return app.deletion_confirmation_ack(request.id); end if;
  perform app.require_recent_reauthentication_at(clock_timestamp());
  confirmed_time := clock_timestamp();
  if confirmed_time >= request.expires_at then
    perform app.close_deletion_confirmation(request.id, 'expired'); return jsonb_build_object('status', 'unavailable');
  end if;
  update ops.deletion_request set state = 'email_confirmed', email_confirmed_at = confirmed_time, mail_state = 'closed',
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null where id = request.id;
  perform app.audit_deletion_confirmation(request.id, 'account.deletion_email_confirmed');
  return app.deletion_confirmation_ack(request.id);
end; $$;

create or replace function api.account_deletion_confirmation_mail_claim(p_lease_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare candidate ops.deletion_request%rowtype; request ops.deletion_request%rowtype; current_binding text;
  proof text; evaluated_at timestamptz; destination text; selected_language text;
begin
  if p_lease_token is null then return null; end if;
  -- Discover without a row lock; all source-locking paths use actor/Auth/account/contact/request order.
  select * into candidate from ops.deletion_request where state = 'pending_email' and expires_at > clock_timestamp()
    and mail_next_at <= clock_timestamp() and (mail_state = 'queued' or (mail_state = 'claimed' and mail_lease_until <= clock_timestamp()))
    order by mail_next_at, created_at, id limit 1;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion-confirmation:' || candidate.subject_auth_id::text, 0));
  current_binding := app.lock_deletion_confirmation_email(candidate.subject_auth_id);
  select * into request from ops.deletion_request where id = candidate.id for update;
  if not found then return null; end if;
  evaluated_at := clock_timestamp();
  if request.state <> 'pending_email' or request.mail_next_at > evaluated_at
    or not (request.mail_state = 'queued' or (request.mail_state = 'claimed' and request.mail_lease_until <= evaluated_at)) then return null; end if;
  if app.close_deletion_confirmation(request.id, 'expired') then return null; end if;
  if current_binding is null or current_binding is distinct from request.email_binding_hash then
    perform app.close_deletion_confirmation(request.id, 'identity_changed'); return null;
  end if;
  if request.mail_attempt_count >= 5 then
    update ops.deletion_request set mail_state = 'failed', mail_job_id = null, mail_lease_hash = null, mail_lease_until = null where id = request.id;
    return null;
  end if;
  select lower(btrim(identity.email)), coalesce(account.preferred_language, 'en') into destination, selected_language
    from auth.users as identity left join app.account as account on account.id = identity.id where identity.id = request.subject_auth_id;
  proof := encode(extensions.gen_random_bytes(32), 'hex');
  update ops.deletion_request set mail_state = 'claimed', mail_attempt_count = mail_attempt_count + 1,
    mail_job_id = gen_random_uuid(), mail_lease_hash = encode(extensions.digest(convert_to(p_lease_token::text, 'UTF8'), 'sha256'), 'hex'),
    mail_lease_until = least(evaluated_at + interval '45 seconds', expires_at),
    email_proof_hash = encode(extensions.digest(convert_to(proof, 'UTF8'), 'sha256'), 'hex')
    where id = request.id returning * into request;
  return jsonb_build_object('request_id', request.id, 'job_id', request.mail_job_id, 'attempt_count', request.mail_attempt_count,
    'destination_email', destination, 'language', selected_language, 'email_token', proof,
    'expires_at', request.expires_at, 'lease_until', request.mail_lease_until, 'evaluated_at', evaluated_at);
end; $$;

create or replace function api.account_deletion_confirmation_mail_complete(p_job_id uuid, p_lease_token uuid, p_outcome text)
returns boolean language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare request ops.deletion_request%rowtype; evaluated_at timestamptz;
begin
  if p_job_id is null or p_lease_token is null or p_outcome is null
    or p_outcome not in ('sent', 'temporary_failure', 'permanent_failure') then return false; end if;
  select * into request from ops.deletion_request where mail_job_id = p_job_id for update;
  if not found then return false; end if;
  evaluated_at := clock_timestamp();
  if app.close_deletion_confirmation(request.id, 'expired') then return false; end if;
  if request.state <> 'pending_email' or request.mail_state <> 'claimed' or request.mail_lease_until <= evaluated_at
    or request.mail_lease_hash is distinct from encode(extensions.digest(convert_to(p_lease_token::text, 'UTF8'), 'sha256'), 'hex') then return false; end if;
  update ops.deletion_request set mail_state = case when p_outcome = 'sent' then 'sent'
      when p_outcome = 'temporary_failure' and mail_attempt_count < 5 then 'queued' else 'failed' end,
    mail_next_at = evaluated_at + make_interval(secs => least(30 * (2 ^ (mail_attempt_count - 1))::integer, 240)),
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null where id = request.id;
  return true;
end; $$;

create or replace function api.expire_account_deletion_confirmations(p_limit integer default 100)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare candidate record; expired_count integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Deletion confirmation maintenance input is invalid.';
  end if;
  for candidate in select id from ops.deletion_request where state = 'pending_email' and expires_at <= clock_timestamp()
    order by expires_at, id limit p_limit for update skip locked
  loop
    if app.close_deletion_confirmation(candidate.id, 'expired') then expired_count := expired_count + 1; end if;
  end loop;
  return jsonb_build_object('expired_requests', expired_count);
end; $$;

revoke all on function app.require_recent_reauthentication_at(timestamptz), app.require_recent_reauthentication(),
  app.lock_deletion_confirmation_email(uuid), app.deletion_confirmation_ack(uuid), app.export_deletion_confirmations(uuid),
  app.close_deletion_confirmation(uuid,text), app.audit_deletion_confirmation(uuid,text),
  api.request_account_deletion_confirmation(uuid), api.current_account_deletion_confirmation(), api.confirm_account_deletion_email(uuid,text),
  api.account_deletion_confirmation_mail_claim(uuid), api.account_deletion_confirmation_mail_complete(uuid,uuid,text),
  api.expire_account_deletion_confirmations(integer) from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function api.request_account_deletion_confirmation(uuid), api.current_account_deletion_confirmation(),
  api.confirm_account_deletion_email(uuid,text) to authenticated;
grant execute on function api.account_deletion_confirmation_mail_claim(uuid), api.account_deletion_confirmation_mail_complete(uuid,uuid,text),
  api.expire_account_deletion_confirmations(integer) to service_role;
