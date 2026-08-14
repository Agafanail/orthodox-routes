create table app.account (
  id uuid primary key references auth.users (id) on delete restrict,
  public_id uuid not null default gen_random_uuid() unique,
  display_name text not null,
  preferred_language text not null,
  status text not null default 'active',
  adult_declared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint account_display_name_length
    check (char_length(display_name) between 1 and 80),
  constraint account_display_name_trimmed
    check (display_name = regexp_replace(display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g')),
  constraint account_display_name_safe
    check (display_name !~ '[[:cntrl:]]'),
  constraint account_preferred_language
    check (preferred_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint account_status
    check (status in ('email_verified', 'active', 'restricted', 'deleting', 'deleted')),
  constraint account_deleted_state
    check ((status = 'deleted') = (deleted_at is not null)),
  constraint account_timestamp_order
    check (updated_at >= created_at and (deleted_at is null or deleted_at >= created_at))
);

create table private.account_contact (
  account_id uuid primary key references app.account (id) on delete cascade,
  email_normalized text not null unique,
  phone_e164 text,
  phone_verified_at timestamptz,
  email_changed_at timestamptz,
  phone_changed_at timestamptz,
  constraint account_contact_email_normalized
    check (
      email_normalized = lower(btrim(email_normalized))
      and email_normalized <> ''
      and email_normalized !~ '[[:cntrl:]]'
    ),
  constraint account_contact_phone_e164
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint account_contact_phone_verification
    check (phone_verified_at is null or phone_e164 is not null)
);

create unique index account_contact_verified_phone_unique
  on private.account_contact (phone_e164)
  where phone_verified_at is not null;

create table app.legal_document_version (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  version text not null,
  language_codes text[] not null,
  effective_at timestamptz not null,
  status text not null default 'draft',
  content_hash text not null,
  created_at timestamptz not null default now(),
  constraint legal_document_type
    check (document_type in ('terms', 'privacy_policy')),
  constraint legal_document_version_safe
    check (
      char_length(version) between 1 and 64
      and version = btrim(version)
      and version !~ '[[:cntrl:]]'
    ),
  constraint legal_document_languages
    check (
      cardinality(language_codes) > 0
      and language_codes <@ array['en', 'ru', 'it', 'ro', 'uk', 'de']::text[]
    ),
  constraint legal_document_status
    check (status in ('draft', 'published', 'retired')),
  constraint legal_document_content_hash
    check (content_hash ~ '^[0-9a-f]{64}$'),
  unique (document_type, version),
  unique (document_type, effective_at)
);

create table app.legal_acceptance (
  account_id uuid not null references app.account (id) on delete cascade,
  document_version_id uuid not null references app.legal_document_version (id) on delete restrict,
  acceptance_type text not null,
  accepted_at timestamptz not null default now(),
  privacy_document_version_id uuid references app.legal_document_version (id) on delete restrict,
  evidence_language text not null,
  evidence_context text not null,
  primary key (account_id, document_version_id, acceptance_type),
  constraint legal_acceptance_type
    check (acceptance_type = 'terms_explicit'),
  constraint legal_acceptance_language
    check (evidence_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint legal_acceptance_context
    check (evidence_context = 'account_foundation_v1')
);

alter table app.account enable row level security;
alter table app.account force row level security;
alter table private.account_contact enable row level security;
alter table private.account_contact force row level security;
alter table app.legal_document_version enable row level security;
alter table app.legal_document_version force row level security;
alter table app.legal_acceptance enable row level security;
alter table app.legal_acceptance force row level security;

revoke all on table app.account from public, anon, authenticated, service_role;
revoke all on table private.account_contact from public, anon, authenticated, service_role;
revoke all on table app.legal_document_version from public, anon, authenticated, service_role;
revoke all on table app.legal_acceptance from public, anon, authenticated, service_role;

create function app.normalize_display_name(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

create function app.current_actor_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  return actor_id;
end;
$$;

create function app.current_legal_document_id(
  requested_document_type text,
  evaluated_at timestamptz default now()
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select document.id
  from app.legal_document_version as document
  where document.document_type = requested_document_type
    and document.status = 'published'
    and document.effective_at <= evaluated_at
  order by document.effective_at desc
  limit 1;
$$;

create function app.enforce_account_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception using errcode = '23514', message = 'Account identity is immutable.';
  end if;

  return new;
end;
$$;

create trigger enforce_account_identity_immutable
before update of id on app.account
for each row execute function app.enforce_account_identity_immutable();

create function app.current_eligibility_result(actor_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  email_verified boolean := false;
  account_exists boolean := false;
  account_status text;
  phone_verified boolean := false;
  adult_declared boolean := false;
  current_terms_id uuid;
  current_terms_version text;
  current_terms_accepted boolean := false;
  reasons text[] := array[]::text[];
begin
  select coalesce(identity.email_confirmed_at is not null, false)
  into email_verified
  from auth.users as identity
  where identity.id = actor_id;

  email_verified := coalesce(email_verified, false);

  select
    true,
    account.status,
    account.adult_declared_at is not null,
    contact.phone_verified_at is not null
  into account_exists, account_status, adult_declared, phone_verified
  from app.account as account
  left join private.account_contact as contact on contact.account_id = account.id
  where account.id = actor_id;

  account_exists := coalesce(account_exists, false);
  adult_declared := coalesce(adult_declared, false);
  phone_verified := coalesce(phone_verified, false);

  current_terms_id := app.current_legal_document_id('terms', now());
  if current_terms_id is not null then
    select document.version
    into current_terms_version
    from app.legal_document_version as document
    where document.id = current_terms_id;

    if account_exists then
      select exists (
        select 1
        from app.legal_acceptance as acceptance
        where acceptance.account_id = actor_id
          and acceptance.document_version_id = current_terms_id
          and acceptance.acceptance_type = 'terms_explicit'
      ) into current_terms_accepted;
    end if;
  end if;

  if not email_verified then reasons := array_append(reasons, 'email_not_verified'); end if;
  if not account_exists then reasons := array_append(reasons, 'account_missing'); end if;
  if account_exists and account_status <> 'active' then
    reasons := array_append(reasons, 'account_state_not_permitted');
  end if;
  if account_exists and not phone_verified then
    reasons := array_append(reasons, 'phone_not_verified');
  end if;
  if account_exists and not adult_declared then
    reasons := array_append(reasons, 'adult_declaration_missing');
  end if;
  if current_terms_id is null then
    reasons := array_append(reasons, 'current_terms_unavailable');
  elsif account_exists and not current_terms_accepted then
    reasons := array_append(reasons, 'current_terms_not_accepted');
  end if;

  return jsonb_build_object(
    'eligible', cardinality(reasons) = 0,
    'reasons', to_jsonb(reasons),
    'email_verified', email_verified,
    'account_exists', account_exists,
    'account_status', account_status,
    'account_state_permitted', account_exists and account_status = 'active',
    'phone_verified', phone_verified,
    'adult_declared', adult_declared,
    'current_terms_version', current_terms_version,
    'current_terms_accepted', current_terms_accepted
  );
end;
$$;

create function api.current_eligibility()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_eligibility_result(app.current_actor_id());
$$;

create function api.current_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  result jsonb;
begin
  select jsonb_build_object(
    'public_id', account.public_id,
    'display_name', account.display_name,
    'preferred_language', account.preferred_language,
    'status', account.status,
    'adult_declared_at', account.adult_declared_at,
    'created_at', account.created_at,
    'updated_at', account.updated_at,
    'email', contact.email_normalized,
    'phone', contact.phone_e164,
    'phone_verified_at', contact.phone_verified_at,
    'email_changed_at', contact.email_changed_at,
    'phone_changed_at', contact.phone_changed_at,
    'eligibility', app.current_eligibility_result(actor_id)
  )
  into result
  from app.account as account
  join private.account_contact as contact on contact.account_id = account.id
  where account.id = actor_id;

  return result;
end;
$$;

create function api.create_account(
  p_display_name text,
  p_preferred_language text,
  p_phone_e164 text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_name text := app.normalize_display_name(p_display_name);
  normalized_email text;
  normalized_phone text := nullif(btrim(p_phone_e164), '');
begin
  select lower(btrim(identity.email))
  into normalized_email
  from auth.users as identity
  where identity.id = actor_id
    and identity.email_confirmed_at is not null
    and nullif(btrim(identity.email), '') is not null;

  if normalized_email is null then
    raise exception using errcode = '42501', message = 'A verified email identity is required.';
  end if;

  if normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or normalized_name ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'Display name is invalid.';
  end if;

  if p_preferred_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') then
    raise exception using errcode = '22023', message = 'Preferred language is invalid.';
  end if;

  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'Phone must use normalized E.164 format.';
  end if;

  if exists (select 1 from app.account as account where account.id = actor_id) then
    raise exception using errcode = '23505', message = 'An application account already exists.';
  end if;

  insert into app.account (id, display_name, preferred_language, status)
  values (actor_id, normalized_name, p_preferred_language, 'active');

  insert into private.account_contact (account_id, email_normalized, phone_e164)
  values (actor_id, normalized_email, normalized_phone);

  return api.current_account();
end;
$$;

create function api.update_current_account_profile(
  p_display_name text,
  p_preferred_language text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_name text := app.normalize_display_name(p_display_name);
begin
  if normalized_name is null
    or char_length(normalized_name) not between 1 and 80
    or normalized_name ~ '[[:cntrl:]]'
  then
    raise exception using errcode = '22023', message = 'Display name is invalid.';
  end if;

  if p_preferred_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') then
    raise exception using errcode = '22023', message = 'Preferred language is invalid.';
  end if;

  update app.account
  set display_name = normalized_name,
      preferred_language = p_preferred_language,
      updated_at = now()
  where id = actor_id
    and status in ('active', 'restricted');

  if not found then
    raise exception using errcode = 'P0002', message = 'Application account is unavailable.';
  end if;

  return api.current_account();
end;
$$;

create function api.declare_adult()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  update app.account
  set adult_declared_at = coalesce(adult_declared_at, now()),
      updated_at = case when adult_declared_at is null then now() else updated_at end
  where id = actor_id
    and status in ('active', 'restricted');

  if not found then
    raise exception using errcode = 'P0002', message = 'Application account is unavailable.';
  end if;

  return api.current_account();
end;
$$;

create function api.accept_current_terms()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  terms_id uuid := app.current_legal_document_id('terms', now());
  privacy_id uuid := app.current_legal_document_id('privacy_policy', now());
  account_language text;
  acceptance_time timestamptz;
begin
  if terms_id is null then
    raise exception using errcode = 'P0002', message = 'No current Terms version is available.';
  end if;

  select account.preferred_language
  into account_language
  from app.account as account
  where account.id = actor_id
    and account.status in ('active', 'restricted');

  if account_language is null then
    raise exception using errcode = 'P0002', message = 'Application account is unavailable.';
  end if;

  insert into app.legal_acceptance (
    account_id,
    document_version_id,
    acceptance_type,
    privacy_document_version_id,
    evidence_language,
    evidence_context
  )
  values (
    actor_id,
    terms_id,
    'terms_explicit',
    privacy_id,
    account_language,
    'account_foundation_v1'
  )
  on conflict (account_id, document_version_id, acceptance_type)
  do update set document_version_id = excluded.document_version_id
  returning accepted_at into acceptance_time;

  return jsonb_build_object(
    'document_version_id', terms_id,
    'accepted_at', acceptance_time,
    'eligibility', app.current_eligibility_result(actor_id)
  );
end;
$$;

revoke all on function app.normalize_display_name(text) from public, anon, authenticated, service_role;
revoke all on function app.current_actor_id() from public, anon, authenticated, service_role;
revoke all on function app.current_legal_document_id(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.enforce_account_identity_immutable() from public, anon, authenticated, service_role;
revoke all on function app.current_eligibility_result(uuid) from public, anon, authenticated, service_role;

revoke all on function api.current_eligibility() from public, anon, authenticated, service_role;
revoke all on function api.current_account() from public, anon, authenticated, service_role;
revoke all on function api.create_account(text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.update_current_account_profile(text, text) from public, anon, authenticated, service_role;
revoke all on function api.declare_adult() from public, anon, authenticated, service_role;
revoke all on function api.accept_current_terms() from public, anon, authenticated, service_role;

grant usage on schema api to authenticated;
grant execute on function api.current_eligibility() to authenticated;
grant execute on function api.current_account() to authenticated;
grant execute on function api.create_account(text, text, text) to authenticated;
grant execute on function api.update_current_account_profile(text, text) to authenticated;
grant execute on function api.declare_adult() to authenticated;
grant execute on function api.accept_current_terms() to authenticated;

comment on table app.account is 'Application accounts linked immutably to verified Supabase Auth identities.';
comment on table private.account_contact is 'Protected account contacts; phone verification is not user-writable.';
comment on table app.legal_document_version is 'Versioned legal-document metadata; no production legal copy is seeded here.';
comment on table app.legal_acceptance is 'Auditable explicit Terms acceptances for specific document versions.';
comment on function api.current_eligibility() is 'Authoritative participation eligibility for the authenticated account.';
