-- Translation leases are restricted to current, public church content and never contain ride-private data.
alter table app.content_translation drop constraint content_translation_status_allowed;
alter table app.content_translation add constraint content_translation_status_allowed
  check (status in ('pending', 'processing', 'ready', 'error', 'stale'));
alter table app.content_translation
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column lease_token uuid,
  add column lease_deadline timestamptz,
  add column last_safe_error text,
  add constraint content_translation_attempt_count check (attempt_count between 0 and 5),
  add constraint content_translation_lease_shape check (
    (status = 'processing') = (lease_token is not null and lease_deadline is not null)
  ),
  add constraint content_translation_safe_error check (
    last_safe_error is null or last_safe_error in (
      'temporary_failure', 'permanent_failure', 'invalid_output', 'lease_expired'
    )
  );
create index content_translation_worker_claimable
  on app.content_translation (next_attempt_at, created_at, id)
  where status = 'pending';
create index content_translation_expired_leases
  on app.content_translation (lease_deadline, id)
  where status = 'processing';

create function app.clear_terminal_translation_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'processing' then
    new.lease_token := null;
    new.lease_deadline := null;
  end if;
  return new;
end;
$$;
create trigger clear_terminal_translation_lease
  before update on app.content_translation
  for each row execute function app.clear_terminal_translation_lease();
revoke all on function app.clear_terminal_translation_lease()
  from public, anon, authenticated, service_role;

create function api.translation_worker_claim(
  p_lease_token uuid, p_limit integer default 10, p_translation_id uuid default null
)
returns table (
  claimed_translation_id uuid, claimed_source_id uuid, claimed_source_version integer,
  claimed_source_language text, claimed_target_language text, claimed_field_name text,
  claimed_original_text text, claimed_attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_lease_token is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'Translation worker claim is invalid.';
  end if;

  with exhausted as (
    select translation.id from app.content_translation as translation
    where translation.status = 'processing' and translation.lease_deadline <= now()
      and translation.attempt_count >= 5
    order by translation.lease_deadline, translation.id
    for update of translation skip locked
    limit 50
  )
  update app.content_translation as translation
  set status = 'error', last_safe_error = 'lease_expired', updated_at = clock_timestamp()
  from exhausted where translation.id = exhausted.id;

  return query
  with candidate as (
    select translation.id
    from app.content_translation as translation
    join app.content_source as source on source.id = translation.content_source_id
    where (p_translation_id is null or translation.id = p_translation_id)
      and translation.translation_source = 'machine'
      and translation.attempt_count < 5
      and (
        (translation.status = 'pending' and translation.next_attempt_at <= now())
        or (translation.status = 'processing' and translation.lease_deadline <= now())
      )
      and translation.source_version = source.source_version
      and source.original_text is not null
      and source.source_language <> translation.target_language
      and (
        (source.object_type = 'church' and exists (
          select 1 from app.church as church
          where church.id = source.object_id and church.status = 'published'
        ))
        or (source.object_type = 'service_occurrence' and exists (
          select 1 from app.service_occurrence as service
          join app.church as church on church.id = service.church_id
          where service.id = source.object_id and service.status = 'scheduled'
            and service.starts_at >= now()
            and church.status = 'published'
        ))
      )
    order by translation.next_attempt_at, translation.created_at, translation.id
    for update of translation skip locked
    limit p_limit
  ), leased as (
    update app.content_translation as translation
    set status = 'processing', lease_token = p_lease_token,
      lease_deadline = now() + interval '60 seconds',
      attempt_count = translation.attempt_count + 1, updated_at = clock_timestamp()
    from candidate where translation.id = candidate.id
    returning translation.*
  )
  select leased.id, source.id, source.source_version, source.source_language,
    leased.target_language, source.field_name, source.original_text, leased.attempt_count
  from leased join app.content_source as source on source.id = leased.content_source_id;
end;
$$;

create function api.translation_worker_complete(
  p_translation_id uuid, p_lease_token uuid, p_outcome text,
  p_translated_text text default null, p_provider_name text default null,
  p_provider_model text default null, p_glossary_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  translation_row app.content_translation%rowtype;
  source_row app.content_source%rowtype;
  normalized_text text := nullif(btrim(p_translated_text), '');
  safe_outcome text := p_outcome;
  result_status text;
begin
  if p_translation_id is null or p_lease_token is null
    or p_outcome not in ('success', 'temporary_failure', 'permanent_failure')
    or p_outcome is null then
    raise exception using errcode = '22023', message = 'Translation worker completion is invalid.';
  end if;
  select * into translation_row from app.content_translation as translation
  where translation.id = p_translation_id for update;
  if translation_row.id is null then
    raise exception using errcode = '42501', message = 'Translation worker target is unavailable.';
  end if;
  if translation_row.status <> 'processing'
    or translation_row.lease_token is distinct from p_lease_token
    or translation_row.lease_deadline <= now() then
    return jsonb_build_object('status', 'superseded');
  end if;
  select * into source_row from app.content_source as source
  where source.id = translation_row.content_source_id;
  if source_row.source_version <> translation_row.source_version
    or source_row.original_text is null then
    update app.content_translation set status = 'stale', updated_at = clock_timestamp()
    where id = translation_row.id;
    return jsonb_build_object('status', 'superseded');
  end if;

  if safe_outcome = 'success' and (
    normalized_text is null
    or (source_row.field_name in ('official_name', 'source_name') and (
      char_length(normalized_text) > case when source_row.field_name = 'official_name' then 200 else 160 end
      or normalized_text ~ '[[:cntrl:]]'
    ))
    or (source_row.field_name in ('description_source', 'source_description') and (
      char_length(normalized_text) > 4000
      or translate(normalized_text, E'\n\r', '') ~ '[[:cntrl:]]'
    ))
    or p_provider_name is null or p_provider_name !~ '^[a-z][a-z0-9-]{1,39}$'
    or (p_provider_model is not null and (
      char_length(p_provider_model) > 80 or p_provider_model ~ '[[:cntrl:]]'
    ))
    or (p_glossary_version is not null and p_glossary_version < 1)
  ) then
    safe_outcome := 'invalid_output';
  end if;

  if safe_outcome = 'success' then
    update app.content_translation set translated_text = normalized_text,
      status = 'ready', translation_source = 'machine',
      provider_name = p_provider_name, provider_model = p_provider_model,
      glossary_version = p_glossary_version, manual_editor_id = null,
      content_version = content_version + 1, last_safe_error = null,
      updated_at = clock_timestamp()
    where id = translation_row.id;
    result_status := 'ready';
  elsif safe_outcome = 'permanent_failure' or translation_row.attempt_count >= 5 then
    update app.content_translation set status = 'error', last_safe_error = safe_outcome,
      updated_at = clock_timestamp()
    where id = translation_row.id;
    result_status := 'error';
  else
    update app.content_translation set status = 'pending', last_safe_error = safe_outcome,
      next_attempt_at = now() + (
        least(60, power(2, translation_row.attempt_count))::integer * interval '1 minute'
      ), updated_at = clock_timestamp()
    where id = translation_row.id;
    result_status := 'retry';
  end if;
  return jsonb_build_object('status', result_status, 'attempt_count', translation_row.attempt_count);
end;
$$;

revoke all on function api.translation_worker_claim(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.translation_worker_complete(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function api.translation_worker_claim(uuid, integer, uuid) to service_role;
grant execute on function api.translation_worker_complete(uuid, uuid, text, text, text, text, integer)
  to service_role;

comment on function api.translation_worker_claim(uuid, integer, uuid) is
  'Service-role-only bounded lease for current approved public church translations.';
comment on function api.translation_worker_complete(uuid, uuid, text, text, text, text, integer) is
  'Lease-checked translation completion that never overwrites manual or stale content.';
