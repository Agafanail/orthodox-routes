-- Shared target rules: ordinary callers still cannot supply an actor.
create or replace function app.resolve_complaint_target(p_target_type text, p_target_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  available boolean := false;
  categories text[];
begin
  if p_target_type is null or p_target_id is null then return null; end if;
  if p_target_type = 'church' then
    select exists (select 1 from app.church as church
      where church.public_id = p_target_id and church.status = 'published') into available;
    categories := array['incorrect_information', 'duplicate', 'not_orthodox_or_missing',
      'rights_infringement', 'dangerous_or_illegal', 'other']::text[];
  elsif p_target_type = 'passenger_request' then
    select exists (select 1 from app.passenger_request as request
      join app.church as church on church.id = request.church_id
      where request.public_id = p_target_id and (
        (church.status = 'published' and request.status in ('active', 'partial')
          and request.remaining_passengers > 0 and request.desired_arrival_at > clock_timestamp())
        or (request.author_account_id = p_actor_id and request.status not in ('draft', 'verification')
          and request.desired_arrival_at + interval '30 days' > clock_timestamp())
      )) into available;
  elsif p_target_type = 'driver_occurrence' then
    select exists (select 1 from app.driver_offer_occurrence as occurrence
      join app.church as church on church.id = occurrence.church_id
      where occurrence.public_id = p_target_id and (
        (church.status = 'published' and occurrence.status = 'active'
          and occurrence.total_seats > occurrence.confirmed_seats and occurrence.arrival_at > clock_timestamp())
        or (occurrence.author_account_id = p_actor_id and occurrence.status not in ('draft', 'verification')
          and occurrence.arrival_at + interval '30 days' > clock_timestamp())
      )) into available;
  elsif p_target_type = 'ride_agreement' then
    select exists (select 1 from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      where agreement.public_id = p_target_id
        and p_actor_id in (agreement.passenger_account_id, agreement.driver_account_id)
        and snapshot.scheduled_arrival_at + interval '30 days' > clock_timestamp()) into available;
    categories := array['no_show', 'dangerous_behavior', 'unwanted_contact', 'money_or_fraud', 'other']::text[];
  else return null;
  end if;
  if not available then return null; end if;
  if categories is null then
    categories := array['public_private_details', 'paid_transport', 'spam_or_fraud',
      'harassment_or_danger', 'false_ride_information', 'other']::text[];
  end if;
  return jsonb_build_object('schema_version', 1, 'target_type', p_target_type,
    'target_id', p_target_id, 'categories', categories);
end;
$$;
revoke all on function app.resolve_complaint_target(text, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function api.complaint_target_context(p_target_type text, p_target_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.resolve_complaint_target(p_target_type, p_target_id, auth.uid()); $$;

-- A verified email draft is still NOT a received complaint or a successful delivery.
create table private.complaint_email_draft (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,
  reporter_account_id uuid references app.account(id) on delete cascade,
  target_type text, target_public_id uuid, category text,
  description text, reply_email text, language text,
  resume_hash text, email_token_hash text, input_digest text,
  state text not null default 'pending_email' check (state in ('pending_email', 'email_verified', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null, verified_at timestamptz, expired_at timestamptz,
  constraint complaint_draft_target check (target_type in ('church', 'passenger_request', 'driver_occurrence', 'ride_agreement')),
  constraint complaint_draft_category check (case
    when target_type = 'church' then category in ('incorrect_information', 'duplicate', 'not_orthodox_or_missing',
      'rights_infringement', 'dangerous_or_illegal', 'other')
    when target_type in ('passenger_request', 'driver_occurrence') then category in ('public_private_details',
      'paid_transport', 'spam_or_fraud', 'harassment_or_danger', 'false_ride_information', 'other')
    when target_type = 'ride_agreement' then category in ('no_show', 'dangerous_behavior', 'unwanted_contact', 'money_or_fraud', 'other')
    else target_type is null and category is null end),
  constraint complaint_draft_description check (char_length(description) between 1 and 4000
    and description ~ '[^[:space:]]' and translate(description, E'\n\r', '') !~ '[[:cntrl:]]'),
  constraint complaint_draft_email check (reply_email = lower(btrim(reply_email)) and char_length(reply_email) <= 254
    and reply_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and reply_email !~ '[[:cntrl:]]'),
  constraint complaint_draft_language check (language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint complaint_draft_hashes check (resume_hash ~ '^[0-9a-f]{64}$' and email_token_hash ~ '^[0-9a-f]{64}$'
    and input_digest ~ '^[0-9a-f]{64}$' and resume_hash <> email_token_hash),
  constraint complaint_draft_lifetime check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'
    and (expired_at is null or expired_at >= expires_at)),
  constraint complaint_draft_state_shape check (
    (state in ('pending_email', 'email_verified') and target_type is not null and target_public_id is not null
      and category is not null and description is not null and reply_email is not null and language is not null
      and resume_hash is not null and email_token_hash is not null and input_digest is not null and expired_at is null
      and ((state = 'pending_email' and verified_at is null)
        or (state = 'email_verified' and verified_at >= created_at and verified_at < expires_at and verified_at is not null)))
    or (state = 'expired' and reporter_account_id is null and target_type is null and target_public_id is null
      and category is null and description is null and reply_email is null and language is null
      and resume_hash is null and email_token_hash is null and input_digest is null
      and verified_at is null and expired_at is not null)
  )
);
create unique index complaint_email_token_unique on private.complaint_email_draft(email_token_hash) where email_token_hash is not null;
create unique index complaint_resume_unique on private.complaint_email_draft(resume_hash) where resume_hash is not null;
create index complaint_draft_due on private.complaint_email_draft(expires_at) where state <> 'expired';
create index complaint_draft_actor on private.complaint_email_draft(reporter_account_id) where reporter_account_id is not null;
alter table private.complaint_email_draft enable row level security;
alter table private.complaint_email_draft force row level security;
revoke all on private.complaint_email_draft from public, anon, authenticated, service_role;

create or replace function app.expire_complaint_email_draft(p_draft_id uuid, p_evaluated_at timestamptz default clock_timestamp())
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update private.complaint_email_draft set state = 'expired', expired_at = p_evaluated_at,
    reporter_account_id = null, target_type = null, target_public_id = null, category = null,
    description = null, reply_email = null, language = null, resume_hash = null, email_token_hash = null,
    input_digest = null, verified_at = null
  where id = p_draft_id and state <> 'expired' and expires_at <= p_evaluated_at;
  return found;
end;
$$;
revoke all on function app.expire_complaint_email_draft(uuid, timestamptz) from public, anon, authenticated, service_role;

create function api.prepare_complaint_email_draft(
  p_target_type text, p_target_id uuid, p_reporter_account_id uuid,
  p_category text, p_description text, p_reply_email text, p_language text,
  p_client_key uuid, p_resume_token text, p_email_token text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  context jsonb;
  draft private.complaint_email_draft%rowtype;
  normalized_email text := lower(btrim(p_reply_email));
  normalized_description text := btrim(p_description);
  resume_digest text;
  email_digest text;
  request_digest text;
  created_time timestamptz;
  target_deadline timestamptz;
begin
  if p_client_key is null or p_resume_token is null or p_email_token is null
    or p_resume_token !~ '^[0-9a-f]{64}$' or p_email_token !~ '^[0-9a-f]{64}$' or p_resume_token = p_email_token
    or normalized_email is null or char_length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or normalized_email ~ '[[:cntrl:]]'
    or normalized_description is null or char_length(normalized_description) not between 1 and 4000
    or normalized_description !~ '[^[:space:]]' or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    or p_language is null or p_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') or p_category is null then
    raise exception using errcode = '22023', message = 'Complaint email draft input is invalid.';
  end if;
  resume_digest := encode(extensions.digest(convert_to(p_resume_token, 'UTF8'), 'sha256'), 'hex');
  email_digest := encode(extensions.digest(convert_to(p_email_token, 'UTF8'), 'sha256'), 'hex');
  request_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id, 'reporter_account_id', p_reporter_account_id,
    'category', p_category, 'description', normalized_description, 'reply_email', normalized_email,
    'language', p_language, 'email_hash', email_digest
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('complaint-email-draft:' || p_client_key::text, 0));
  select * into draft from private.complaint_email_draft as item where item.client_key = p_client_key for update;
  if found then
    if draft.resume_hash is distinct from resume_digest or draft.input_digest is distinct from request_digest then
      raise exception using errcode = '22023', message = 'Complaint email draft input does not match the prior request.';
    end if;
    perform app.expire_complaint_email_draft(draft.id);
    select * into strict draft from private.complaint_email_draft as item where item.id = draft.id;
    return jsonb_build_object('draft_id', draft.id, 'status', draft.state, 'expires_at', draft.expires_at);
  end if;
  if p_reporter_account_id is not null and not exists (select 1 from app.account where id = p_reporter_account_id) then
    raise exception using errcode = '42501', message = 'Complaint target is unavailable.';
  end if;
  context := app.resolve_complaint_target(p_target_type, p_target_id, p_reporter_account_id);
  if context is null or not ((context->'categories') ? p_category) then
    raise exception using errcode = '42501', message = 'Complaint target is unavailable.';
  end if;
  if p_target_type = 'passenger_request' then
    select desired_arrival_at + interval '30 days' into target_deadline from app.passenger_request where public_id = p_target_id;
  elsif p_target_type = 'driver_occurrence' then
    select arrival_at + interval '30 days' into target_deadline from app.driver_offer_occurrence where public_id = p_target_id;
  elsif p_target_type = 'ride_agreement' then
    select snapshot.scheduled_arrival_at + interval '30 days' into target_deadline
    from app.ride_agreement as agreement join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
    where agreement.public_id = p_target_id;
  end if;
  created_time := clock_timestamp();
  if p_target_type <> 'church' and (target_deadline is null or target_deadline <= created_time) then
    raise exception using errcode = '42501', message = 'Complaint target is unavailable.';
  end if;
  insert into private.complaint_email_draft (
    client_key, reporter_account_id, target_type, target_public_id, category, description, reply_email, language,
    resume_hash, email_token_hash, input_digest, created_at, expires_at
  ) values (p_client_key, p_reporter_account_id, p_target_type, p_target_id, p_category,
    normalized_description, normalized_email, p_language, resume_digest, email_digest, request_digest,
    created_time, least(created_time + interval '15 minutes', target_deadline)) returning * into draft;
  return jsonb_build_object('draft_id', draft.id, 'status', draft.state, 'expires_at', draft.expires_at);
end;
$$;

create function api.verify_complaint_email_draft(p_email_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare draft private.complaint_email_draft%rowtype; evaluated_at timestamptz;
begin
  if p_email_token is null or p_email_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into draft from private.complaint_email_draft as item
  where item.email_token_hash = encode(extensions.digest(convert_to(p_email_token, 'UTF8'), 'sha256'), 'hex') for update;
  if not found then return null; end if;
  evaluated_at := clock_timestamp();
  if app.expire_complaint_email_draft(draft.id, evaluated_at) then
    return jsonb_build_object('draft_id', draft.id, 'status', 'expired', 'expires_at', draft.expires_at);
  end if;
  if draft.state = 'pending_email' then
    update private.complaint_email_draft set state = 'email_verified', verified_at = evaluated_at
    where id = draft.id returning * into draft;
  end if;
  return jsonb_build_object('draft_id', draft.id, 'status', draft.state, 'expires_at', draft.expires_at);
end;
$$;

create function api.expire_complaint_email_drafts(p_limit integer default 50)
returns integer language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare item record; expired_count integer := 0;
begin
  for item in select id from private.complaint_email_draft
    where state <> 'expired' and expires_at <= clock_timestamp() order by expires_at, id
    limit least(greatest(coalesce(p_limit, 50), 1), 100) for update skip locked
  loop
    if app.expire_complaint_email_draft(item.id) then expired_count := expired_count + 1; end if;
  end loop;
  return expired_count;
end;
$$;

revoke all on function api.prepare_complaint_email_draft(text, uuid, uuid, text, text, text, text, uuid, text, text),
  api.verify_complaint_email_draft(text), api.expire_complaint_email_drafts(integer) from public, anon, authenticated, service_role;
grant execute on function api.prepare_complaint_email_draft(text, uuid, uuid, text, text, text, text, uuid, text, text),
  api.verify_complaint_email_draft(text), api.expire_complaint_email_drafts(integer) to service_role;

-- Export only the caller's own unexpired input, never either capability or its digest.
create function app.export_complaint_email_drafts(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'draft_id', draft.id, 'target_type', draft.target_type, 'target_id', draft.target_public_id,
    'category', draft.category, 'description', draft.description, 'reply_email', draft.reply_email,
    'language', draft.language, 'status', draft.state, 'created_at', draft.created_at,
    'expires_at', draft.expires_at, 'verified_at', draft.verified_at
  ) order by draft.created_at, draft.id), '[]'::jsonb)
  from private.complaint_email_draft as draft
  where draft.reporter_account_id = p_actor_id and draft.state <> 'expired' and draft.expires_at > clock_timestamp();
$$;
revoke all on function app.export_complaint_email_drafts(uuid) from public, anon, authenticated, service_role;
do $$
declare definition text; original_field text := '''personal_blocks'', (';
begin
  definition := pg_get_functiondef('api.export_current_account_data()'::regprocedure);
  if position('app.export_complaint_email_drafts(actor_id)' in definition) > 0 then return; end if;
  if position(original_field in definition) = 0 then
    raise exception using errcode = '55000', message = 'Unexpected account export definition.';
  end if;
  execute replace(definition, original_field,
    '''complaint_email_drafts'', app.export_complaint_email_drafts(actor_id), ' || original_field);
end;
$$;
