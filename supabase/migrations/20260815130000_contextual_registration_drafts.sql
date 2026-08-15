alter table ops.security_policy
  add column contextual_draft_ttl_seconds integer not null default 86400,
  add column contextual_draft_max_payload_bytes integer not null default 16384,
  add column contextual_draft_rate_window_seconds integer not null default 3600,
  add column contextual_draft_create_limit integer not null default 20,
  add column contextual_draft_email_limit integer not null default 40,
  add constraint security_policy_contextual_draft_ttl
    check (contextual_draft_ttl_seconds between 900 and 604800),
  add constraint security_policy_contextual_draft_payload
    check (contextual_draft_max_payload_bytes between 1024 and 65536),
  add constraint security_policy_contextual_draft_rate_window
    check (contextual_draft_rate_window_seconds between 60 and 86400),
  add constraint security_policy_contextual_draft_rate_limits
    check (
      contextual_draft_create_limit between 1 and 1000
      and contextual_draft_email_limit between 1 and 1000
    );

create table ops.contextual_draft_rate_limit (
  rate_key text not null,
  operation text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null,
  primary key (rate_key, operation),
  constraint contextual_draft_rate_key check (rate_key ~ '^[0-9a-f]{64}$'),
  constraint contextual_draft_rate_operation check (operation in ('create', 'attach_email')),
  constraint contextual_draft_rate_count check (request_count > 0)
);

create index contextual_draft_rate_limit_updated
  on ops.contextual_draft_rate_limit (updated_at);

alter table ops.contextual_draft_rate_limit enable row level security;
alter table ops.contextual_draft_rate_limit force row level security;
revoke all on table ops.contextual_draft_rate_limit from public, anon, authenticated, service_role;

create table private.contextual_draft (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  client_key uuid not null unique,
  resume_token_digest text,
  intended_email_salt text,
  intended_email_digest text,
  action_type text not null,
  payload_version smallint not null,
  payload jsonb,
  payload_fingerprint text not null,
  state text not null default 'open',
  account_id uuid references app.account (id) on delete restrict,
  result_type text,
  result_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint contextual_draft_resume_token_digest
    check (resume_token_digest is null or resume_token_digest ~ '^[0-9a-f]{64}$'),
  constraint contextual_draft_email_material
    check (
      (intended_email_salt is null and intended_email_digest is null)
      or (
        intended_email_salt ~ '^[0-9a-f]{32}$'
        and intended_email_digest ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint contextual_draft_action_type
    check (action_type in ('passenger_request', 'driver_offer', 'ride_response', 'church_create', 'church_admin_invite')),
  constraint contextual_draft_payload_version check (payload_version = 1),
  constraint contextual_draft_payload_shape
    check (payload is null or (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536)),
  constraint contextual_draft_payload_fingerprint
    check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint contextual_draft_state
    check (state in ('open', 'claimed', 'completed', 'cancelled', 'expired')),
  constraint contextual_draft_state_shape
    check (
      (state = 'open' and account_id is null and payload is not null and claimed_at is null and completed_at is null and cancelled_at is null)
      or (state = 'claimed' and account_id is not null and payload is not null and claimed_at is not null and completed_at is null and cancelled_at is null)
      or (state = 'completed' and account_id is not null and payload is null and claimed_at is not null and completed_at is not null and cancelled_at is null)
      or (state = 'cancelled' and payload is null and completed_at is null and cancelled_at is not null)
      or (state = 'expired' and payload is null and completed_at is null and cancelled_at is null)
    ),
  constraint contextual_draft_result_shape
    check (
      (state = 'completed' and result_type is not null and result_id is not null)
      or (state <> 'completed' and result_type is null and result_id is null)
    ),
  constraint contextual_draft_time_order
    check (
      expires_at > created_at
      and (claimed_at is null or claimed_at >= created_at)
      and (completed_at is null or completed_at >= created_at)
      and (cancelled_at is null or cancelled_at >= created_at)
    )
);

create unique index contextual_draft_resume_token_unique
  on private.contextual_draft (resume_token_digest)
  where resume_token_digest is not null;

create index contextual_draft_account_state
  on private.contextual_draft (account_id, state, created_at desc)
  where account_id is not null;

alter table private.contextual_draft enable row level security;
alter table private.contextual_draft force row level security;
revoke all on table private.contextual_draft from public, anon, authenticated, service_role;

create function app.contextual_draft_token_digest(resume_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(resume_token, 'UTF8'), 'sha256'), 'hex');
$$;

create function app.contextual_draft_email_digest(email_salt text, normalized_email text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(email_salt || ':' || normalized_email, 'UTF8'), 'sha256'), 'hex');
$$;

create function app.contextual_draft_payload_fingerprint(
  requested_action_type text,
  requested_payload_version smallint,
  requested_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(requested_action_type || ':' || requested_payload_version::text || ':' || requested_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create function app.contextual_draft_contains_account_material(input_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  entry record;
  item jsonb;
begin
  if jsonb_typeof(input_value) = 'object' then
    for entry in select pair.key, pair.value from jsonb_each(input_value) as pair
    loop
      if entry.key ~* '(email|phone|contact|password|token|secret)' then return true; end if;
      if jsonb_typeof(entry.value) in ('object', 'array')
        and app.contextual_draft_contains_account_material(entry.value)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(input_value) = 'array' then
    for item in select element.value from jsonb_array_elements(input_value) as element
    loop
      if jsonb_typeof(item) in ('object', 'array')
        and app.contextual_draft_contains_account_material(item)
      then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create function app.expire_contextual_draft(draft_id uuid, evaluated_at timestamptz)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  update private.contextual_draft
  set state = 'expired',
      payload = null,
      resume_token_digest = null,
      intended_email_salt = null,
      intended_email_digest = null
  where id = draft_id
    and state in ('open', 'claimed')
    and expires_at <= evaluated_at;

  return found;
end;
$$;

create function app.consume_contextual_draft_rate_limit(
  requested_rate_key text,
  requested_operation text,
  evaluated_at timestamptz
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  policy ops.security_policy%rowtype;
  allowed_count integer;
  window_interval interval;
begin
  if requested_rate_key is null or requested_rate_key !~ '^[0-9a-f]{64}$'
    or requested_operation not in ('create', 'attach_email')
  then
    return false;
  end if;

  select * into strict policy from ops.security_policy where singleton;
  allowed_count := case requested_operation
    when 'create' then policy.contextual_draft_create_limit
    else policy.contextual_draft_email_limit
  end;
  window_interval := make_interval(secs => policy.contextual_draft_rate_window_seconds);

  insert into ops.contextual_draft_rate_limit (
    rate_key,
    operation,
    window_started_at,
    request_count,
    updated_at
  )
  values (requested_rate_key, requested_operation, evaluated_at, 1, evaluated_at)
  on conflict (rate_key, operation) do update
  set window_started_at = case
        when ops.contextual_draft_rate_limit.window_started_at + window_interval <= evaluated_at
          then evaluated_at
        else ops.contextual_draft_rate_limit.window_started_at
      end,
      request_count = case
        when ops.contextual_draft_rate_limit.window_started_at + window_interval <= evaluated_at
          then 1
        else ops.contextual_draft_rate_limit.request_count + 1
      end,
      updated_at = evaluated_at
  where ops.contextual_draft_rate_limit.window_started_at + window_interval <= evaluated_at
     or ops.contextual_draft_rate_limit.request_count < allowed_count;

  return found;
end;
$$;

create function api.create_contextual_draft(
  p_action_type text,
  p_payload jsonb,
  p_payload_version smallint,
  p_client_key uuid,
  p_resume_token text,
  p_rate_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  policy ops.security_policy%rowtype;
  token_digest text;
  fingerprint text;
  existing private.contextual_draft%rowtype;
  created private.contextual_draft%rowtype;
  created_time timestamptz := clock_timestamp();
begin
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'A contextual draft idempotency key is required.';
  end if;

  if p_resume_token is null or p_resume_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A valid contextual draft capability is required.';
  end if;

  if p_action_type is null
    or p_action_type not in ('passenger_request', 'driver_offer', 'ride_response', 'church_create', 'church_admin_invite')
    or p_payload_version is distinct from 1
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception using errcode = '22023', message = 'Contextual draft input is invalid.';
  end if;

  select * into strict policy from ops.security_policy where singleton;
  if pg_column_size(p_payload) > policy.contextual_draft_max_payload_bytes then
    raise exception using errcode = '22023', message = 'Contextual draft payload is too large.';
  end if;

  if app.contextual_draft_contains_account_material(p_payload) then
    raise exception using errcode = '22023', message = 'Account or contact material does not belong in an action draft.';
  end if;

  token_digest := app.contextual_draft_token_digest(p_resume_token);
  fingerprint := app.contextual_draft_payload_fingerprint(p_action_type, p_payload_version, p_payload);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_client_key::text, 0)
  );

  select * into existing
  from private.contextual_draft
  where client_key = p_client_key;

  if found then
    if existing.resume_token_digest is null then
      return jsonb_build_object('status', 'unavailable');
    end if;

    if existing.resume_token_digest <> token_digest
      or existing.payload_fingerprint <> fingerprint
      or existing.action_type <> p_action_type
      or existing.payload_version <> p_payload_version
    then
      raise exception using errcode = '22023', message = 'The idempotency key was already used for different draft input.';
    end if;

    if app.expire_contextual_draft(existing.id, created_time) then
      return jsonb_build_object(
        'draft_id', existing.public_id,
        'status', 'expired',
        'expires_at', existing.expires_at
      );
    end if;

    return jsonb_build_object(
      'draft_id', existing.public_id,
      'status', existing.state,
      'expires_at', existing.expires_at
    );
  end if;

  if not app.consume_contextual_draft_rate_limit(p_rate_key, 'create', created_time) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into private.contextual_draft (
    client_key,
    resume_token_digest,
    action_type,
    payload_version,
    payload,
    payload_fingerprint,
    created_at,
    expires_at
  )
  values (
    p_client_key,
    token_digest,
    p_action_type,
    p_payload_version,
    p_payload,
    fingerprint,
    created_time,
    created_time + make_interval(secs => policy.contextual_draft_ttl_seconds)
  )
  returning * into created;

  return jsonb_build_object(
    'draft_id', created.public_id,
    'status', created.state,
    'expires_at', created.expires_at
  );
end;
$$;

create function api.attach_contextual_draft_email(p_resume_token text, p_email text, p_rate_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  token_digest text;
  draft private.contextual_draft%rowtype;
  email_salt text;
  evaluated_time timestamptz := clock_timestamp();
begin
  if p_resume_token is null or p_resume_token !~ '^[0-9a-f]{64}$'
    or normalized_email is null
    or char_length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    return jsonb_build_object('status', 'invalid');
  end if;

  token_digest := app.contextual_draft_token_digest(p_resume_token);
  select * into draft
  from private.contextual_draft
  where resume_token_digest = token_digest
  for update;

  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if app.expire_contextual_draft(draft.id, evaluated_time) then
    return jsonb_build_object('status', 'expired');
  end if;
  if draft.state <> 'open' then return jsonb_build_object('status', 'unavailable'); end if;

  if draft.intended_email_digest is not null then
    if app.contextual_draft_email_digest(draft.intended_email_salt, normalized_email) = draft.intended_email_digest then
      return jsonb_build_object('status', 'attached', 'draft_id', draft.public_id);
    end if;
    return jsonb_build_object('status', 'email_mismatch');
  end if;

  if not app.consume_contextual_draft_rate_limit(p_rate_key, 'attach_email', evaluated_time) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  email_salt := encode(extensions.gen_random_bytes(16), 'hex');
  update private.contextual_draft
  set intended_email_salt = email_salt,
      intended_email_digest = app.contextual_draft_email_digest(email_salt, normalized_email)
  where id = draft.id;

  return jsonb_build_object('status', 'attached', 'draft_id', draft.public_id);
end;
$$;

create function api.current_contextual_draft(p_draft_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  draft private.contextual_draft%rowtype;
begin
  select * into draft
  from private.contextual_draft
  where public_id = p_draft_id
    and account_id = actor_id
  for update;

  if not found then return null; end if;
  perform app.expire_contextual_draft(draft.id, clock_timestamp());

  select * into draft from private.contextual_draft where id = draft.id;
  return jsonb_build_object(
    'draft_id', draft.public_id,
    'action_type', draft.action_type,
    'payload_version', draft.payload_version,
    'payload', draft.payload,
    'status', draft.state,
    'created_at', draft.created_at,
    'expires_at', draft.expires_at,
    'eligibility', app.current_eligibility_result(actor_id)
  );
end;
$$;

create function api.claim_contextual_draft(p_resume_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_email text;
  token_digest text;
  draft private.contextual_draft%rowtype;
  evaluated_time timestamptz := clock_timestamp();
begin
  if p_resume_token is null or p_resume_token !~ '^[0-9a-f]{64}$' then return null; end if;

  select lower(btrim(identity.email))
  into normalized_email
  from auth.users as identity
  where identity.id = actor_id
    and identity.email_confirmed_at is not null;

  if normalized_email is null then return null; end if;

  token_digest := app.contextual_draft_token_digest(p_resume_token);
  select * into draft
  from private.contextual_draft
  where resume_token_digest = token_digest
  for update;

  if not found then return null; end if;
  if app.expire_contextual_draft(draft.id, evaluated_time) then
    return jsonb_build_object('draft_id', draft.public_id, 'status', 'expired');
  end if;

  if draft.state = 'open' then
    if draft.intended_email_digest is null
      or app.contextual_draft_email_digest(draft.intended_email_salt, normalized_email) <> draft.intended_email_digest
    then
      return null;
    end if;

    update private.contextual_draft
    set state = 'claimed',
        account_id = actor_id,
        claimed_at = evaluated_time,
        intended_email_salt = null,
        intended_email_digest = null
    where id = draft.id;
  elsif draft.state <> 'claimed' or draft.account_id <> actor_id then
    return null;
  end if;

  return api.current_contextual_draft(draft.public_id);
end;
$$;

create function api.cancel_contextual_draft(p_draft_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  cancelled_time timestamptz := clock_timestamp();
begin
  update private.contextual_draft
  set state = 'cancelled',
      payload = null,
      resume_token_digest = null,
      intended_email_salt = null,
      intended_email_digest = null,
      cancelled_at = cancelled_time
  where public_id = p_draft_id
    and account_id = actor_id
    and state = 'claimed';

  if not found then return null; end if;
  return jsonb_build_object('draft_id', p_draft_id, 'status', 'cancelled');
end;
$$;

create function app.complete_contextual_draft(
  actor_id uuid,
  draft_id uuid,
  completed_result_type text,
  completed_result_id uuid
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  completed_time timestamptz := clock_timestamp();
begin
  if completed_result_type is null
    or char_length(btrim(completed_result_type)) not between 1 and 64
    or completed_result_type ~ '[[:cntrl:]]'
    or completed_result_id is null
  then
    raise exception using errcode = '22023', message = 'Contextual draft completion result is invalid.';
  end if;

  update private.contextual_draft
  set state = 'completed',
      payload = null,
      resume_token_digest = null,
      intended_email_salt = null,
      intended_email_digest = null,
      result_type = btrim(completed_result_type),
      result_id = completed_result_id,
      completed_at = completed_time
  where id = draft_id
    and account_id = actor_id
    and state = 'claimed'
    and expires_at > completed_time;

  return found;
end;
$$;

revoke all on function app.contextual_draft_token_digest(text) from public, anon, authenticated, service_role;
revoke all on function app.contextual_draft_email_digest(text, text) from public, anon, authenticated, service_role;
revoke all on function app.contextual_draft_payload_fingerprint(text, smallint, jsonb) from public, anon, authenticated, service_role;
revoke all on function app.contextual_draft_contains_account_material(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.expire_contextual_draft(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.consume_contextual_draft_rate_limit(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.complete_contextual_draft(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

revoke all on function api.create_contextual_draft(text, jsonb, smallint, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function api.attach_contextual_draft_email(text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.claim_contextual_draft(text) from public, anon, authenticated, service_role;
revoke all on function api.current_contextual_draft(uuid) from public, anon, authenticated, service_role;
revoke all on function api.cancel_contextual_draft(uuid) from public, anon, authenticated, service_role;

grant usage on schema api to service_role;
grant execute on function api.create_contextual_draft(text, jsonb, smallint, uuid, text, text) to service_role;
grant execute on function api.attach_contextual_draft_email(text, text, text) to service_role;
grant execute on function api.claim_contextual_draft(text) to authenticated;
grant execute on function api.current_contextual_draft(uuid) to authenticated;
grant execute on function api.cancel_contextual_draft(uuid) to authenticated;

comment on table private.contextual_draft is 'Protected incomplete useful actions; contact/account fields are stored separately and payload is cleared on terminal state.';
comment on table ops.contextual_draft_rate_limit is 'Privacy-preserving server-derived rate buckets for contextual registration mutations.';
comment on function api.create_contextual_draft(text, jsonb, smallint, uuid, text, text) is 'Idempotently stores a bounded protected action draft through a rate-limited server-only boundary.';
comment on function api.attach_contextual_draft_email(text, text, text) is 'Rate-limits and binds a draft capability to a salted intended-email digest before the magic link is sent.';
comment on function api.claim_contextual_draft(text) is 'Claims a draft only for the matching verified email identity and never publishes the action.';
comment on function app.complete_contextual_draft(uuid, uuid, text, uuid) is 'Ungranted internal completion primitive for a future atomic explicit Publish or Send operation.';
