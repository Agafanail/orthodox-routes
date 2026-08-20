create table private.contextual_registration_profile (
  draft_id uuid primary key references private.contextual_draft (id) on delete cascade,
  display_name text not null,
  phone_e164 text not null,
  preferred_language text not null,
  created_at timestamptz not null default now(),
  constraint contextual_registration_display_name
    check (
      char_length(display_name) between 1 and 80
      and display_name = regexp_replace(display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g')
      and display_name !~ '[[:cntrl:]]'
    ),
  constraint contextual_registration_phone check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint contextual_registration_language
    check (preferred_language in ('en', 'ru', 'it', 'ro', 'uk', 'de'))
);

alter table private.contextual_registration_profile enable row level security;
alter table private.contextual_registration_profile force row level security;
revoke all on table private.contextual_registration_profile from public, anon, authenticated, service_role;

alter table private.contextual_draft
  add column auth_user_id uuid references auth.users (id) on delete restrict;

update private.contextual_draft
set auth_user_id = account_id
where account_id is not null;

alter table private.contextual_draft
  drop constraint contextual_draft_state_shape,
  add constraint contextual_draft_actor_account_alignment
    check (account_id is null or account_id = auth_user_id),
  add constraint contextual_draft_state_shape
    check (
      (state = 'open' and auth_user_id is null and account_id is null and payload is not null and claimed_at is null and completed_at is null and cancelled_at is null)
      or (state = 'claimed' and auth_user_id is not null and payload is not null and claimed_at is not null and completed_at is null and cancelled_at is null)
      or (state = 'completed' and auth_user_id is not null and account_id is not null and payload is null and claimed_at is not null and completed_at is not null and cancelled_at is null)
      or (state = 'cancelled' and payload is null and completed_at is null and cancelled_at is not null)
      or (state = 'expired' and payload is null and completed_at is null and cancelled_at is null)
    );

create index contextual_draft_auth_user_state
  on private.contextual_draft (auth_user_id, state, created_at desc)
  where auth_user_id is not null;

create function api.create_contextual_registration(
  p_action_type text,
  p_payload jsonb,
  p_payload_version smallint,
  p_client_key uuid,
  p_resume_token text,
  p_rate_key text,
  p_display_name text default null,
  p_phone_e164 text default null,
  p_preferred_language text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result jsonb;
  internal_draft_id uuid;
  normalized_name text;
  normalized_phone text := nullif(btrim(p_phone_e164), '');
  existing private.contextual_registration_profile%rowtype;
begin
  if p_display_name is null and p_phone_e164 is null and p_preferred_language is null then
    return api.create_contextual_draft(
      p_action_type,
      p_payload,
      p_payload_version,
      p_client_key,
      p_resume_token,
      p_rate_key
    );
  end if;

  normalized_name := app.normalize_display_name(p_display_name);
  if normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or normalized_name ~ '[[:cntrl:]]'
    or normalized_phone is null
    or normalized_phone !~ '^\+[1-9][0-9]{7,14}$'
    or p_preferred_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de')
  then
    raise exception using errcode = '22023', message = 'Contextual registration profile is invalid.';
  end if;

  result := api.create_contextual_draft(
    p_action_type,
    p_payload,
    p_payload_version,
    p_client_key,
    p_resume_token,
    p_rate_key
  );
  if result->>'status' <> 'open' then return result; end if;

  select draft.id into strict internal_draft_id
  from private.contextual_draft as draft
  where draft.public_id = (result->>'draft_id')::uuid;

  insert into private.contextual_registration_profile (
    draft_id,
    display_name,
    phone_e164,
    preferred_language
  )
  values (internal_draft_id, normalized_name, normalized_phone, p_preferred_language)
  on conflict (draft_id) do nothing;

  select * into strict existing
  from private.contextual_registration_profile as profile
  where profile.draft_id = internal_draft_id;

  if existing.display_name <> normalized_name
    or existing.phone_e164 <> normalized_phone
    or existing.preferred_language <> p_preferred_language
  then
    raise exception using errcode = '22023', message = 'The idempotency key was already used for different registration input.';
  end if;

  return result;
end;
$$;

create or replace function app.expire_contextual_draft(draft_id uuid, evaluated_at timestamptz)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  expired boolean;
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
  expired := found;

  if expired then
    delete from private.contextual_registration_profile as profile
    where profile.draft_id = $1;
  end if;
  return expired;
end;
$$;

create or replace function api.claim_contextual_draft(p_resume_token text)
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
        auth_user_id = actor_id,
        account_id = case when exists (
          select 1 from app.account as account where account.id = actor_id
        ) then actor_id else null end,
        claimed_at = evaluated_time,
        intended_email_salt = null,
        intended_email_digest = null
    where id = draft.id;
    delete from private.contextual_registration_profile as profile
    using private.contextual_draft as owned
    where profile.draft_id = owned.id
      and owned.id = draft.id
      and owned.account_id = actor_id;
  elsif draft.state <> 'claimed' or draft.auth_user_id <> actor_id then
    return null;
  end if;

  return api.current_contextual_draft(draft.public_id);
end;
$$;

create or replace function api.current_contextual_draft(p_draft_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  draft private.contextual_draft%rowtype;
  registration_profile jsonb;
begin
  select * into draft
  from private.contextual_draft
  where public_id = p_draft_id
    and auth_user_id = actor_id
  for update;

  if not found then return null; end if;
  perform app.expire_contextual_draft(draft.id, clock_timestamp());
  update private.contextual_draft as owned
  set account_id = actor_id
  where owned.id = draft.id
    and owned.state = 'claimed'
    and owned.account_id is null
    and exists (select 1 from app.account as account where account.id = actor_id);
  if found then
    delete from private.contextual_registration_profile as profile
    where profile.draft_id = draft.id;
  end if;
  select * into draft from private.contextual_draft where id = draft.id;
  select jsonb_build_object(
    'display_name', profile.display_name,
    'phone', profile.phone_e164,
    'preferred_language', profile.preferred_language
  )
  into registration_profile
  from private.contextual_registration_profile as profile
  where profile.draft_id = draft.id;

  return jsonb_build_object(
    'draft_id', draft.public_id,
    'action_type', draft.action_type,
    'payload_version', draft.payload_version,
    'payload', draft.payload,
    'registration_profile', registration_profile,
    'status', draft.state,
    'created_at', draft.created_at,
    'expires_at', draft.expires_at,
    'eligibility', app.current_eligibility_result(actor_id)
  );
end;
$$;

create or replace function api.cancel_contextual_draft(p_draft_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  cancelled_time timestamptz := clock_timestamp();
  internal_draft_id uuid;
begin
  update private.contextual_draft
  set state = 'cancelled',
      payload = null,
      resume_token_digest = null,
      intended_email_salt = null,
      intended_email_digest = null,
      cancelled_at = cancelled_time
  where public_id = p_draft_id
    and auth_user_id = actor_id
    and state = 'claimed'
  returning id into internal_draft_id;

  if not found then return null; end if;
  delete from private.contextual_registration_profile where draft_id = internal_draft_id;
  return jsonb_build_object('draft_id', p_draft_id, 'status', 'cancelled');
end;
$$;

create or replace function app.complete_contextual_draft(
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
  completed boolean;
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
    and auth_user_id = actor_id
    and account_id = actor_id
    and state = 'claimed'
    and expires_at > completed_time;
  completed := found;

  if completed then
    delete from private.contextual_registration_profile as profile
    where profile.draft_id = $2;
  end if;
  return completed;
end;
$$;

create function api.clear_contextual_registration_profile(p_draft_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  delete from private.contextual_registration_profile as profile
  using private.contextual_draft as draft
  where profile.draft_id = draft.id
    and draft.public_id = p_draft_id
    and draft.auth_user_id = actor_id
    and draft.state = 'claimed';
  return found;
end;
$$;

create function api.link_contextual_draft_account(p_draft_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  update private.contextual_draft as draft
  set account_id = actor_id
  where draft.public_id = p_draft_id
    and draft.auth_user_id = actor_id
    and draft.account_id is null
    and draft.state = 'claimed'
    and exists (select 1 from app.account as account where account.id = actor_id);

  if found then return true; end if;
  return exists (
    select 1 from private.contextual_draft as draft
    where draft.public_id = p_draft_id
      and draft.auth_user_id = actor_id
      and draft.account_id = actor_id
      and draft.state = 'claimed'
  );
end;
$$;

create function api.materialize_contextual_account(
  p_draft_id uuid,
  p_display_name text,
  p_preferred_language text,
  p_phone_e164 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  draft private.contextual_draft%rowtype;
  account_result jsonb;
begin
  select * into draft
  from private.contextual_draft
  where public_id = p_draft_id
    and auth_user_id = actor_id
    and state = 'claimed'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Contextual draft is unavailable.';
  end if;

  if exists (select 1 from app.account as account where account.id = actor_id) then
    update private.contextual_draft
    set account_id = actor_id
    where id = draft.id
      and account_id is null;
    delete from private.contextual_registration_profile as profile
    where profile.draft_id = draft.id;
    return api.current_account();
  end if;

  account_result := api.create_account(p_display_name, p_preferred_language, p_phone_e164);
  update private.contextual_draft
  set account_id = actor_id
  where id = draft.id;
  delete from private.contextual_registration_profile as profile
  where profile.draft_id = draft.id;
  return account_result;
end;
$$;

revoke all on function api.create_contextual_draft(text, jsonb, smallint, uuid, text, text) from service_role;
revoke all on function api.create_contextual_registration(text, jsonb, smallint, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.clear_contextual_registration_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function api.link_contextual_draft_account(uuid) from public, anon, authenticated, service_role;
revoke all on function api.materialize_contextual_account(uuid, text, text, text) from public, anon, authenticated, service_role;

grant execute on function api.create_contextual_registration(text, jsonb, smallint, uuid, text, text, text, text, text) to service_role;
grant execute on function api.materialize_contextual_account(uuid, text, text, text) to authenticated;

comment on table private.contextual_registration_profile is 'Short-lived protected registration fields kept outside action payloads and cleared after account creation or draft termination.';
comment on function api.create_contextual_registration(text, jsonb, smallint, uuid, text, text, text, text, text) is 'Atomically creates an action-only draft with optional separate protected account profile input.';
comment on function api.clear_contextual_registration_profile(uuid) is 'Clears short-lived registration profile input for the current draft owner after account materialization.';
comment on function api.link_contextual_draft_account(uuid) is 'Links a pre-account Auth-owned draft to the matching materialized application account.';
comment on function api.materialize_contextual_account(uuid, text, text, text) is 'Atomically creates or links the current actor account to an owned contextual draft and clears temporary profile data.';
