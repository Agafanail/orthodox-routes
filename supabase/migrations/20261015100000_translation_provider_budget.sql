-- Reserve source characters before an external call. Failed/unknown outcomes are not refunded.
create table ops.translation_monthly_usage (
  month_start date primary key,
  reserved_characters bigint not null default 0 check (reserved_characters >= 0),
  updated_at timestamptz not null default now()
);
alter table ops.translation_monthly_usage enable row level security;
alter table ops.translation_monthly_usage force row level security;
revoke all on table ops.translation_monthly_usage from public, anon, authenticated, service_role;

alter table app.content_translation
  add column budget_reserved_attempt integer not null default 0,
  add constraint content_translation_reserved_attempt check (
    budget_reserved_attempt between 0 and attempt_count
  );
create index translation_glossary_pair_effective
  on app.translation_glossary_version (source_language, target_language, effective_at desc, id desc)
  where provider_reference is not null;

create function api.translation_worker_prepare(
  p_translation_id uuid, p_lease_token uuid, p_monthly_character_limit integer
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
  usage_month date := date_trunc('month', now() at time zone 'UTC')::date;
  current_usage bigint;
  source_characters integer;
  glossary_row app.translation_glossary_version%rowtype;
begin
  if p_translation_id is null or p_lease_token is null
    or p_monthly_character_limit is null or p_monthly_character_limit not between 1 and 100000000 then
    raise exception using errcode = '22023', message = 'Translation dispatch preparation is invalid.';
  end if;
  select * into translation_row from app.content_translation as translation
  where translation.id = p_translation_id for update;
  if translation_row.id is null or translation_row.status <> 'processing'
    or translation_row.translation_source <> 'machine'
    or translation_row.lease_token is distinct from p_lease_token
    or translation_row.lease_deadline <= clock_timestamp() then
    return jsonb_build_object('status', 'superseded');
  end if;
  select * into source_row from app.content_source as source
  where source.id = translation_row.content_source_id;
  if source_row.source_version <> translation_row.source_version or source_row.original_text is null then
    return jsonb_build_object('status', 'superseded');
  end if;
  if not (
    (source_row.object_type = 'church' and exists (
      select 1 from app.church as church
      where church.id = source_row.object_id and church.status = 'published'
    )) or (source_row.object_type = 'service_occurrence' and exists (
      select 1 from app.service_occurrence as service
      join app.church as church on church.id = service.church_id
      where service.id = source_row.object_id and service.status = 'scheduled'
        and service.starts_at >= now() and church.status = 'published'
    ))
  ) then
    -- No new dispatch can occur. Do not consume an unreserved attempt or refund an old reservation.
    update app.content_translation set
      status = case when budget_reserved_attempt = attempt_count and attempt_count >= 5
        then 'error' else 'pending' end,
      attempt_count = case when budget_reserved_attempt = attempt_count
        then attempt_count else attempt_count - 1 end,
      next_attempt_at = now() + interval '5 minutes', updated_at = clock_timestamp()
    where id = translation_row.id;
    return jsonb_build_object('status', 'superseded');
  end if;

  if translation_row.budget_reserved_attempt <> translation_row.attempt_count then
    source_characters := char_length(source_row.original_text);
    insert into ops.translation_monthly_usage (month_start) values (usage_month)
    on conflict do nothing;
    select usage.reserved_characters into current_usage
    from ops.translation_monthly_usage as usage where usage.month_start = usage_month for update;
    if translation_row.lease_deadline <= clock_timestamp() then
      return jsonb_build_object('status', 'superseded');
    end if;
    if current_usage + source_characters > p_monthly_character_limit then
      update app.content_translation set status = 'pending',
        attempt_count = attempt_count - 1, next_attempt_at = now() + interval '5 minutes',
        updated_at = clock_timestamp()
      where id = translation_row.id;
      return jsonb_build_object('status', 'deferred');
    end if;
    update ops.translation_monthly_usage set reserved_characters = reserved_characters + source_characters,
      updated_at = clock_timestamp() where month_start = usage_month;
    select * into glossary_row from app.translation_glossary_version as glossary
    where glossary.source_language = source_row.source_language
      and glossary.target_language = translation_row.target_language
      and glossary.provider_reference is not null and glossary.effective_at <= now()
      and glossary.id <= 2147483647
    order by glossary.effective_at desc, glossary.id desc limit 1;
    update app.content_translation set budget_reserved_attempt = attempt_count,
      glossary_version = glossary_row.id::integer, updated_at = clock_timestamp()
    where id = translation_row.id returning * into translation_row;
  else
    select * into glossary_row from app.translation_glossary_version as glossary
    where glossary.id = translation_row.glossary_version;
  end if;
  return jsonb_build_object(
    'status', 'reserved',
    'dispatch_deadline', translation_row.lease_deadline,
    'glossary', case when glossary_row.id is null then null else jsonb_build_object(
      'resource', glossary_row.provider_reference, 'version', glossary_row.id
    ) end
  );
end;
$$;

revoke all on function api.translation_worker_prepare(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function api.translation_worker_prepare(uuid, uuid, integer) to service_role;
comment on function api.translation_worker_prepare(uuid, uuid, integer) is
  'Service-only idempotent monthly character reservation and versioned glossary selection for a live lease.';

-- Release every expired lease, including content that is no longer public/eligible.
create or replace function api.translation_worker_claim(
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

  with expired as (
    select translation.id from app.content_translation as translation
    where translation.status = 'processing' and translation.lease_deadline <= now()
    order by translation.lease_deadline, translation.id
    for update of translation skip locked
    limit 50
  )
  update app.content_translation as translation
  set status = case when translation.attempt_count >= 5 then 'error' else 'pending' end,
    last_safe_error = 'lease_expired', updated_at = clock_timestamp()
  from expired where translation.id = expired.id;

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
            and service.starts_at >= now() and church.status = 'published'
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
