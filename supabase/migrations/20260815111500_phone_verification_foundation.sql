create extension if not exists pgcrypto with schema extensions;

create table ops.security_policy (
  singleton boolean primary key default true,
  phone_code_ttl_seconds integer not null,
  phone_code_max_attempts smallint not null,
  phone_resend_delay_seconds integer not null,
  phone_delivery_lease_seconds integer not null,
  updated_at timestamptz not null default now(),
  constraint security_policy_singleton check (singleton),
  constraint security_policy_phone_code_ttl
    check (phone_code_ttl_seconds between 60 and 1800),
  constraint security_policy_phone_code_attempts
    check (phone_code_max_attempts between 1 and 10),
  constraint security_policy_phone_resend_delay
    check (phone_resend_delay_seconds between 30 and 600),
  constraint security_policy_phone_delivery_lease
    check (phone_delivery_lease_seconds between 30 and 300)
);

insert into ops.security_policy (
  singleton,
  phone_code_ttl_seconds,
  phone_code_max_attempts,
  phone_resend_delay_seconds,
  phone_delivery_lease_seconds
)
values (true, 600, 5, 60, 60);

create table ops.phone_verification_attempt (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.account (id) on delete cascade,
  client_key uuid not null,
  phone_e164 text not null,
  state text not null default 'queued',
  code_salt text,
  code_digest text,
  failed_code_attempts smallint not null default 0,
  provider_adapter text,
  provider_reference text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null,
  verified_at timestamptz,
  constraint phone_verification_phone_e164
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint phone_verification_provider_adapter
    check (
      provider_adapter is null
      or (
        char_length(provider_adapter) between 1 and 64
        and provider_adapter = btrim(provider_adapter)
        and provider_adapter !~ '[[:cntrl:]]'
      )
    ),
  constraint phone_verification_provider_reference
    check (
      provider_reference is null
      or (
        char_length(provider_reference) between 1 and 256
        and provider_reference = btrim(provider_reference)
        and provider_reference !~ '[[:cntrl:]]'
      )
    ),
  constraint phone_verification_state
    check (state in ('queued', 'sent', 'verified', 'superseded', 'expired', 'failed')),
  constraint phone_verification_code_material
    check (
      (state in ('queued', 'sent') and code_salt ~ '^[0-9a-f]{32}$' and code_digest ~ '^[0-9a-f]{64}$')
      or (state in ('verified', 'superseded', 'expired', 'failed') and code_salt is null and code_digest is null)
    ),
  constraint phone_verification_failed_attempts
    check (failed_code_attempts between 0 and 10),
  constraint phone_verification_time_order
    check (
      expires_at > requested_at
      and (sent_at is null or sent_at >= requested_at)
      and (verified_at is null or verified_at >= requested_at)
    ),
  constraint phone_verification_verified_state
    check ((state = 'verified') = (verified_at is not null))
);

create index phone_verification_attempt_account_requested
  on ops.phone_verification_attempt (account_id, requested_at desc);

create unique index phone_verification_attempt_client_key
  on ops.phone_verification_attempt (account_id, client_key);

create unique index phone_verification_attempt_active_account
  on ops.phone_verification_attempt (account_id)
  where state in ('queued', 'sent');

create table ops.phone_verification_delivery (
  attempt_id uuid primary key references ops.phone_verification_attempt (id) on delete cascade,
  code text not null,
  state text not null default 'queued',
  lease_token uuid,
  leased_at timestamptz,
  created_at timestamptz not null default now(),
  constraint phone_verification_delivery_code check (code ~ '^[0-9]{6}$'),
  constraint phone_verification_delivery_state check (state in ('queued', 'leased')),
  constraint phone_verification_delivery_lease
    check (
      (state = 'queued' and lease_token is null and leased_at is null)
      or (state = 'leased' and lease_token is not null and leased_at is not null)
    )
);

alter table ops.security_policy enable row level security;
alter table ops.security_policy force row level security;
alter table ops.phone_verification_attempt enable row level security;
alter table ops.phone_verification_attempt force row level security;
alter table ops.phone_verification_delivery enable row level security;
alter table ops.phone_verification_delivery force row level security;

revoke all on table ops.security_policy from public, anon, authenticated, service_role;
revoke all on table ops.phone_verification_attempt from public, anon, authenticated, service_role;
revoke all on table ops.phone_verification_delivery from public, anon, authenticated, service_role;

create function app.phone_code_digest(code_salt text, code_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(code_salt || ':' || code_value, 'UTF8'), 'sha256'), 'hex');
$$;

create function api.request_phone_verification(p_phone_e164 text, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_phone text := nullif(btrim(p_phone_e164), '');
  account_phone text;
  account_phone_verified_at timestamptz;
  policy ops.security_policy%rowtype;
  last_requested_at timestamptz;
  idempotent_attempt ops.phone_verification_attempt%rowtype;
  requested_time timestamptz := clock_timestamp();
  attempt_id uuid;
  code_bytes bytea;
  code_number bigint;
  verification_code text;
  code_salt text;
begin
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'A phone verification idempotency key is required.';
  end if;

  if normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'Phone must use normalized E.164 format.';
  end if;

  if not exists (
    select 1
    from auth.users as identity
    join app.account as account on account.id = identity.id
    where identity.id = actor_id
      and identity.email_confirmed_at is not null
      and account.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active account with verified email is required.';
  end if;

  select contact.phone_e164, contact.phone_verified_at
  into account_phone, account_phone_verified_at
  from private.account_contact as contact
  where contact.account_id = actor_id
  for update;

  delete from ops.phone_verification_delivery as delivery
  using ops.phone_verification_attempt as attempt
  where delivery.attempt_id = attempt.id
    and attempt.account_id = actor_id
    and attempt.state in ('queued', 'sent')
    and attempt.expires_at <= requested_time;

  update ops.phone_verification_attempt
  set state = 'expired', code_salt = null, code_digest = null
  where account_id = actor_id
    and state in ('queued', 'sent')
    and expires_at <= requested_time;

  select *
  into idempotent_attempt
  from ops.phone_verification_attempt
  where account_id = actor_id
    and client_key = p_client_key;

  if found then
    if idempotent_attempt.phone_e164 <> normalized_phone then
      raise exception using errcode = '22023', message = 'The idempotency key was already used for different phone input.';
    end if;

    return jsonb_build_object(
      'attempt_id', idempotent_attempt.id,
      'status', idempotent_attempt.state,
      'last_digits', right(idempotent_attempt.phone_e164, 4),
      'expires_at', idempotent_attempt.expires_at,
      'resend_after', idempotent_attempt.requested_at + make_interval(secs => (
        select phone_resend_delay_seconds from ops.security_policy where singleton
      ))
    );
  end if;

  if account_phone_verified_at is not null then
    if account_phone = normalized_phone then
      return jsonb_build_object(
        'status', 'already_verified',
        'last_digits', right(normalized_phone, 4),
        'verified_at', account_phone_verified_at
      );
    end if;

    raise exception using errcode = '42501', message = 'Verified phone replacement requires the protected contact-change flow.';
  end if;

  select * into strict policy from ops.security_policy where singleton;

  select attempt.requested_at
  into last_requested_at
  from ops.phone_verification_attempt as attempt
  where attempt.account_id = actor_id
  order by attempt.requested_at desc
  limit 1;

  if last_requested_at is not null
    and last_requested_at + make_interval(secs => policy.phone_resend_delay_seconds) > requested_time
  then
    return jsonb_build_object(
      'status', 'rate_limited',
      'retry_at', last_requested_at + make_interval(secs => policy.phone_resend_delay_seconds)
    );
  end if;

  delete from ops.phone_verification_delivery as delivery
  using ops.phone_verification_attempt as attempt
  where delivery.attempt_id = attempt.id
    and attempt.account_id = actor_id;

  update ops.phone_verification_attempt
  set state = 'superseded',
      code_salt = null,
      code_digest = null
  where account_id = actor_id
    and state in ('queued', 'sent');

  code_bytes := extensions.gen_random_bytes(4);
  code_number := (
    get_byte(code_bytes, 0)::bigint * 16777216
    + get_byte(code_bytes, 1)::bigint * 65536
    + get_byte(code_bytes, 2)::bigint * 256
    + get_byte(code_bytes, 3)::bigint
  ) % 1000000;
  verification_code := lpad(code_number::text, 6, '0');
  code_salt := encode(extensions.gen_random_bytes(16), 'hex');

  update private.account_contact
  set phone_e164 = normalized_phone,
      phone_verified_at = null,
      phone_changed_at = case
        when phone_e164 is distinct from normalized_phone then requested_time
        else phone_changed_at
      end
  where account_id = actor_id;

  insert into ops.phone_verification_attempt (
    account_id,
    client_key,
    phone_e164,
    code_salt,
    code_digest,
    requested_at,
    expires_at
  )
  values (
    actor_id,
    p_client_key,
    normalized_phone,
    code_salt,
    app.phone_code_digest(code_salt, verification_code),
    requested_time,
    requested_time + make_interval(secs => policy.phone_code_ttl_seconds)
  )
  returning id into attempt_id;

  insert into ops.phone_verification_delivery (attempt_id, code)
  values (attempt_id, verification_code);

  return jsonb_build_object(
    'attempt_id', attempt_id,
    'status', 'queued',
    'last_digits', right(normalized_phone, 4),
    'expires_at', requested_time + make_interval(secs => policy.phone_code_ttl_seconds),
    'resend_after', requested_time + make_interval(secs => policy.phone_resend_delay_seconds)
  );
end;
$$;

create function api.current_phone_verification()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  result jsonb;
  evaluated_time timestamptz := clock_timestamp();
begin
  delete from ops.phone_verification_delivery as delivery
  using ops.phone_verification_attempt as attempt
  where delivery.attempt_id = attempt.id
    and attempt.account_id = actor_id
    and attempt.state in ('queued', 'sent')
    and attempt.expires_at <= evaluated_time;

  update ops.phone_verification_attempt
  set state = 'expired', code_salt = null, code_digest = null
  where account_id = actor_id
    and state in ('queued', 'sent')
    and expires_at <= evaluated_time;

  select jsonb_build_object(
    'attempt_id', attempt.id,
    'status', attempt.state,
    'last_digits', right(attempt.phone_e164, 4),
    'failed_attempts', attempt.failed_code_attempts,
    'requested_at', attempt.requested_at,
    'sent_at', attempt.sent_at,
    'expires_at', attempt.expires_at
  )
  into result
  from ops.phone_verification_attempt as attempt
  where attempt.account_id = actor_id
  order by attempt.requested_at desc
  limit 1;

  return result;
end;
$$;

create function api.verify_phone_code(p_attempt_id uuid, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  attempt ops.phone_verification_attempt%rowtype;
  policy ops.security_policy%rowtype;
  new_failed_attempts smallint;
  verified_time timestamptz := clock_timestamp();
begin
  select *
  into attempt
  from ops.phone_verification_attempt
  where id = p_attempt_id
    and account_id = actor_id
  for update;

  if not found then
    return jsonb_build_object('status', 'invalid_attempt');
  end if;

  if attempt.state = 'queued' then
    return jsonb_build_object('status', 'delivery_pending');
  end if;

  if attempt.state <> 'sent' then
    return jsonb_build_object('status', attempt.state);
  end if;

  select * into strict policy from ops.security_policy where singleton;

  if attempt.expires_at <= verified_time then
    update ops.phone_verification_attempt
    set state = 'expired', code_salt = null, code_digest = null
    where id = attempt.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if p_code is null
    or p_code !~ '^[0-9]{6}$'
    or app.phone_code_digest(attempt.code_salt, p_code) <> attempt.code_digest
  then
    new_failed_attempts := attempt.failed_code_attempts + 1;

    update ops.phone_verification_attempt
    set failed_code_attempts = new_failed_attempts,
        state = case when new_failed_attempts >= policy.phone_code_max_attempts then 'failed' else state end,
        code_salt = case when new_failed_attempts >= policy.phone_code_max_attempts then null else code_salt end,
        code_digest = case when new_failed_attempts >= policy.phone_code_max_attempts then null else code_digest end
    where id = attempt.id;

    return jsonb_build_object(
      'status', case when new_failed_attempts >= policy.phone_code_max_attempts then 'attempts_exhausted' else 'invalid_code' end,
      'attempts_remaining', greatest(policy.phone_code_max_attempts - new_failed_attempts, 0)
    );
  end if;

  begin
    update private.account_contact
    set phone_e164 = attempt.phone_e164,
        phone_verified_at = verified_time
    where account_id = actor_id
      and phone_verified_at is null;
  exception
    when unique_violation then
      update ops.phone_verification_attempt
      set state = 'failed', code_salt = null, code_digest = null
      where id = attempt.id;
      return jsonb_build_object('status', 'phone_in_use');
  end;

  if not found then
    return jsonb_build_object('status', 'account_unavailable');
  end if;

  update ops.phone_verification_attempt
  set state = 'verified',
      code_salt = null,
      code_digest = null,
      verified_at = verified_time
  where id = attempt.id;

  return jsonb_build_object(
    'status', 'verified',
    'account', api.current_account()
  );
end;
$$;

create function ops.claim_phone_verification_deliveries(
  p_lease_token uuid,
  p_limit integer default 10
)
returns table (
  attempt_id uuid,
  phone_e164 text,
  verification_code text,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  with expired_delivery as (
    delete from ops.phone_verification_delivery as delivery
    using ops.phone_verification_attempt as attempt
    where delivery.attempt_id = attempt.id
      and attempt.state in ('queued', 'sent')
      and attempt.expires_at <= now()
    returning delivery.attempt_id
  ), expired_attempt as (
    update ops.phone_verification_attempt
    set state = 'expired', code_salt = null, code_digest = null
    where state in ('queued', 'sent')
      and expires_at <= now()
    returning id
  ), candidate as (
    select delivery.attempt_id
    from ops.phone_verification_delivery as delivery
    join ops.phone_verification_attempt as attempt on attempt.id = delivery.attempt_id
    cross join ops.security_policy as policy
    where p_lease_token is not null
      and (
        delivery.state = 'queued'
        or delivery.leased_at + make_interval(secs => policy.phone_delivery_lease_seconds) <= now()
      )
      and attempt.state = 'queued'
      and attempt.expires_at > now()
    order by delivery.created_at
    for update of delivery skip locked
    limit greatest(least(coalesce(p_limit, 10), 50), 1)
  ), leased as (
    update ops.phone_verification_delivery as delivery
    set state = 'leased', lease_token = p_lease_token, leased_at = now()
    from candidate
    where delivery.attempt_id = candidate.attempt_id
    returning delivery.attempt_id, delivery.code
  )
  select leased.attempt_id, attempt.phone_e164, leased.code, attempt.expires_at
  from leased
  join ops.phone_verification_attempt as attempt on attempt.id = leased.attempt_id;
$$;

create function ops.complete_phone_verification_delivery(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_delivered boolean,
  p_provider_adapter text,
  p_provider_reference text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  completion_time timestamptz := clock_timestamp();
begin
  if p_provider_adapter is null
    or char_length(btrim(p_provider_adapter)) not between 1 and 64
    or p_provider_adapter ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'Provider adapter identifier is invalid.';
  end if;

  perform 1
  from ops.phone_verification_delivery as delivery
  where delivery.attempt_id = p_attempt_id
    and delivery.state = 'leased'
    and delivery.lease_token = p_lease_token
  for update;

  if not found then return false; end if;

  if p_delivered then
    update ops.phone_verification_attempt
    set state = 'sent',
        sent_at = completion_time,
        provider_adapter = btrim(p_provider_adapter),
        provider_reference = nullif(btrim(p_provider_reference), '')
    where id = p_attempt_id
      and state = 'queued'
      and expires_at > completion_time;

    if not found then
      update ops.phone_verification_attempt
      set state = 'expired', code_salt = null, code_digest = null
      where id = p_attempt_id
        and state = 'queued'
        and expires_at <= completion_time;
      delete from ops.phone_verification_delivery where attempt_id = p_attempt_id;
      return false;
    end if;
  else
    update ops.phone_verification_attempt
    set state = 'failed',
        code_salt = null,
        code_digest = null,
        provider_adapter = btrim(p_provider_adapter),
        provider_reference = nullif(btrim(p_provider_reference), '')
    where id = p_attempt_id
      and state = 'queued';
  end if;

  delete from ops.phone_verification_delivery where attempt_id = p_attempt_id;
  return true;
end;
$$;

revoke all on function app.phone_code_digest(text, text) from public, anon, authenticated, service_role;
revoke all on function api.request_phone_verification(text, uuid) from public, anon, authenticated, service_role;
revoke all on function api.current_phone_verification() from public, anon, authenticated, service_role;
revoke all on function api.verify_phone_code(uuid, text) from public, anon, authenticated, service_role;
revoke all on function ops.claim_phone_verification_deliveries(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function ops.complete_phone_verification_delivery(uuid, uuid, boolean, text, text) from public, anon, authenticated, service_role;

grant execute on function api.request_phone_verification(text, uuid) to authenticated;
grant execute on function api.current_phone_verification() to authenticated;
grant execute on function api.verify_phone_code(uuid, text) to authenticated;

comment on table ops.security_policy is 'Version-controlled security defaults; production limits still require the approved operational review.';
comment on table ops.phone_verification_attempt is 'Protected application-owned phone verification lifecycle without recoverable terminal OTP material.';
comment on table ops.phone_verification_delivery is 'Restricted transient OTP delivery material removed when the worker records delivery outcome.';
comment on function api.request_phone_verification(text, uuid) is 'Idempotently queues verification for the authenticated account without returning the OTP.';
comment on function api.verify_phone_code(uuid, text) is 'Verifies one delivered code and atomically binds a unique verified phone to the caller.';
comment on function ops.claim_phone_verification_deliveries(uuid, integer) is 'Restricted lease contract for a future least-privilege SMS worker; no application role has execute permission.';
