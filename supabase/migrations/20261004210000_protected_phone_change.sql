alter table ops.security_policy
  add column sensitive_reauth_max_age_seconds integer not null default 900,
  add constraint security_policy_sensitive_reauth_age
    check (sensitive_reauth_max_age_seconds between 300 and 3600);

alter table ops.phone_verification_attempt
  add column purpose text not null default 'initial_binding',
  add constraint phone_verification_purpose
    check (purpose in ('initial_binding', 'phone_change'));

create function app.require_recent_reauthentication()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  policy ops.security_policy%rowtype;
  authenticated_at bigint;
begin
  select * into strict policy from ops.security_policy where singleton;

  select max((entry.value ->> 'timestamp')::bigint)
  into authenticated_at
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as entry(value)
  where entry.value ->> 'method' in ('magiclink', 'otp', 'password', 'recovery', 'email_change');

  if authenticated_at is null
    or to_timestamp(authenticated_at) + make_interval(secs => policy.sensitive_reauth_max_age_seconds)
      < statement_timestamp()
  then
    raise exception using errcode = '42501', message = 'Recent reauthentication is required.';
  end if;
end;
$$;

create function api.request_phone_change(p_phone_e164 text, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_phone text := nullif(btrim(p_phone_e164), '');
  current_phone text;
  current_phone_verified_at timestamptz;
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
    raise exception using errcode = '22023', message = 'A phone change idempotency key is required.';
  end if;
  if normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'Phone must use normalized E.164 format.';
  end if;

  perform app.require_recent_reauthentication();

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
  into current_phone, current_phone_verified_at
  from private.account_contact as contact
  where contact.account_id = actor_id
  for update;

  if current_phone_verified_at is null then
    raise exception using errcode = '42501', message = 'A verified current phone is required.';
  end if;
  delete from ops.phone_verification_delivery as delivery
  using ops.phone_verification_attempt as attempt
  where delivery.attempt_id = attempt.id
    and attempt.account_id = actor_id
    and attempt.state in ('queued', 'sent')
    and attempt.expires_at <= requested_time;
  update ops.phone_verification_attempt
  set state = 'expired', code_salt = null, code_digest = null
  where account_id = actor_id and state in ('queued', 'sent') and expires_at <= requested_time;

  select * into idempotent_attempt
  from ops.phone_verification_attempt
  where account_id = actor_id and client_key = p_client_key;
  if found then
    if idempotent_attempt.purpose <> 'phone_change'
      or idempotent_attempt.phone_e164 <> normalized_phone
    then
      raise exception using errcode = '22023', message = 'The idempotency key was already used for different phone input.';
    end if;
    return jsonb_build_object(
      'attempt_id', idempotent_attempt.id,
      'purpose', idempotent_attempt.purpose,
      'status', idempotent_attempt.state,
      'last_digits', right(idempotent_attempt.phone_e164, 4),
      'expires_at', idempotent_attempt.expires_at,
      'resend_after', idempotent_attempt.requested_at
        + make_interval(secs => (select phone_resend_delay_seconds from ops.security_policy where singleton))
    );
  end if;

  if current_phone = normalized_phone then
    return jsonb_build_object(
      'status', 'already_verified', 'last_digits', right(current_phone, 4),
      'verified_at', current_phone_verified_at
    );
  end if;
  if exists (
    select 1 from private.account_contact as contact
    where contact.phone_e164 = normalized_phone
      and contact.phone_verified_at is not null
      and contact.account_id <> actor_id
  ) then
    return jsonb_build_object('status', 'phone_in_use');
  end if;

  select * into strict policy from ops.security_policy where singleton;
  select attempt.requested_at into last_requested_at
  from ops.phone_verification_attempt as attempt
  where attempt.account_id = actor_id
  order by attempt.requested_at desc limit 1;
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
  where delivery.attempt_id = attempt.id and attempt.account_id = actor_id;
  update ops.phone_verification_attempt
  set state = 'superseded', code_salt = null, code_digest = null
  where account_id = actor_id and state in ('queued', 'sent');

  code_bytes := extensions.gen_random_bytes(4);
  code_number := (
    get_byte(code_bytes, 0)::bigint * 16777216
    + get_byte(code_bytes, 1)::bigint * 65536
    + get_byte(code_bytes, 2)::bigint * 256
    + get_byte(code_bytes, 3)::bigint
  ) % 1000000;
  verification_code := lpad(code_number::text, 6, '0');
  code_salt := encode(extensions.gen_random_bytes(16), 'hex');

  insert into ops.phone_verification_attempt (
    account_id, client_key, phone_e164, purpose, code_salt, code_digest,
    requested_at, expires_at
  ) values (
    actor_id, p_client_key, normalized_phone, 'phone_change', code_salt,
    app.phone_code_digest(code_salt, verification_code), requested_time,
    requested_time + make_interval(secs => policy.phone_code_ttl_seconds)
  ) returning id into attempt_id;
  insert into ops.phone_verification_delivery (attempt_id, code)
  values (attempt_id, verification_code);

  return jsonb_build_object(
    'attempt_id', attempt_id, 'purpose', 'phone_change', 'status', 'queued',
    'last_digits', right(normalized_phone, 4),
    'expires_at', requested_time + make_interval(secs => policy.phone_code_ttl_seconds),
    'resend_after', requested_time + make_interval(secs => policy.phone_resend_delay_seconds)
  );
end;
$$;

create or replace function api.current_phone_verification()
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
  where account_id = actor_id and state in ('queued', 'sent') and expires_at <= evaluated_time;

  select jsonb_build_object(
    'attempt_id', attempt.id,
    'purpose', attempt.purpose,
    'status', attempt.state,
    'last_digits', right(attempt.phone_e164, 4),
    'requested_at', attempt.requested_at,
    'sent_at', attempt.sent_at,
    'expires_at', attempt.expires_at
  ) into result
  from ops.phone_verification_attempt as attempt
  where attempt.account_id = actor_id
  order by attempt.requested_at desc limit 1;
  return result;
end;
$$;

create or replace function api.verify_phone_code(p_attempt_id uuid, p_code text)
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
  account_public_id uuid;
begin
  select * into attempt from ops.phone_verification_attempt
  where id = p_attempt_id and account_id = actor_id for update;
  if not found then return jsonb_build_object('status', 'invalid_attempt'); end if;
  if attempt.state = 'queued' then return jsonb_build_object('status', 'delivery_pending'); end if;
  if attempt.state <> 'sent' then return jsonb_build_object('status', attempt.state); end if;
  select * into strict policy from ops.security_policy where singleton;
  if attempt.expires_at <= verified_time then
    update ops.phone_verification_attempt set state = 'expired', code_salt = null, code_digest = null
    where id = attempt.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$'
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
      'status', case when new_failed_attempts >= policy.phone_code_max_attempts
        then 'attempts_exhausted' else 'invalid_code' end,
      'attempts_remaining', greatest(policy.phone_code_max_attempts - new_failed_attempts, 0)
    );
  end if;

  begin
    if attempt.purpose = 'initial_binding' then
      update private.account_contact
      set phone_e164 = attempt.phone_e164, phone_verified_at = verified_time
      where account_id = actor_id and phone_verified_at is null;
    elsif attempt.purpose = 'phone_change' then
      update private.account_contact
      set phone_e164 = attempt.phone_e164,
          phone_verified_at = verified_time,
          phone_changed_at = verified_time
      where account_id = actor_id and phone_verified_at is not null
        and phone_e164 is distinct from attempt.phone_e164;
    end if;
  exception when unique_violation then
    update ops.phone_verification_attempt
    set state = 'failed', code_salt = null, code_digest = null where id = attempt.id;
    return jsonb_build_object('status', 'phone_in_use');
  end;
  if not found then return jsonb_build_object('status', 'account_unavailable'); end if;

  update ops.phone_verification_attempt
  set state = 'verified', code_salt = null, code_digest = null, verified_at = verified_time
  where id = attempt.id;

  if attempt.purpose = 'phone_change' then
    select public_id into account_public_id from app.account where id = actor_id;
    perform app.create_notification_once(
      actor_id, 'account:' || account_public_id::text || ':phone_changed:' || attempt.id::text,
      'account.phone_changed', 'account', account_public_id, '/profile',
      'notifications.account_phone_changed', '{}'::jsonb, 100, 'completed'
    );
  end if;

  return jsonb_build_object(
    'status', 'verified', 'purpose', attempt.purpose, 'account', api.current_account()
  );
end;
$$;

revoke all on function app.require_recent_reauthentication()
  from public, anon, authenticated, service_role;
revoke all on function api.request_phone_change(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.request_phone_change(text, uuid) to authenticated;

comment on function app.require_recent_reauthentication() is
  'Rejects sensitive operations unless a non-refresh authentication method in the signed JWT is recent.';
comment on function api.request_phone_change(text, uuid) is
  'Starts a recent-authenticated phone replacement while preserving the verified current phone until success.';
