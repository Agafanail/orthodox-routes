-- Only public church and concrete-service source fields enter the translation domain.
create table app.content_source (
  id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id uuid not null,
  field_name text not null,
  source_language text not null,
  original_text text,
  source_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_source_field_allowed check (
    (object_type = 'church' and field_name in ('official_name', 'description_source'))
    or (object_type = 'service_occurrence'
      and field_name in ('source_name', 'source_description'))
  ),
  constraint content_source_language_allowed check (source_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint content_source_version_positive check (source_version > 0),
  unique (object_type, object_id, field_name)
);
create index content_source_object_lookup on app.content_source (object_type, object_id);
alter table app.content_source enable row level security;
alter table app.content_source force row level security;
revoke all on table app.content_source from public, anon, authenticated, service_role;

create table app.content_translation (
  id uuid primary key default gen_random_uuid(),
  content_source_id uuid not null references app.content_source (id) on delete restrict,
  source_version integer not null,
  target_language text not null,
  translated_text text,
  translation_source text not null default 'machine',
  status text not null default 'pending',
  provider_name text,
  provider_model text,
  glossary_version integer,
  manual_editor_id uuid references app.account (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_translation_language_allowed check (target_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint content_translation_source_allowed check (translation_source in ('machine', 'manual')),
  constraint content_translation_status_allowed check (status in ('pending', 'ready', 'error', 'stale')),
  constraint content_translation_version_positive check (source_version > 0),
  constraint content_translation_ready_text check (
    status <> 'ready' or (translated_text is not null and char_length(translated_text) > 0)
  ),
  unique (content_source_id, source_version, target_language)
);
create index content_translation_pending_lookup
  on app.content_translation (created_at, id) where status = 'pending';
alter table app.content_translation enable row level security;
alter table app.content_translation force row level security;
revoke all on table app.content_translation from public, anon, authenticated, service_role;

create table app.translation_glossary_version (
  id bigint generated always as identity primary key,
  source_language text not null,
  target_language text not null,
  checksum text not null,
  provider_reference text,
  effective_at timestamptz not null default now(),
  constraint translation_glossary_source_language check (source_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint translation_glossary_target_language check (target_language in ('en', 'ru', 'it', 'ro', 'uk', 'de')),
  constraint translation_glossary_different_languages check (source_language <> target_language),
  constraint translation_glossary_checksum_safe check (checksum ~ '^[0-9a-f]{64}$')
);
alter table app.translation_glossary_version enable row level security;
alter table app.translation_glossary_version force row level security;
revoke all on table app.translation_glossary_version from public, anon, authenticated, service_role;

create function app.sync_content_source(
  p_object_type text, p_object_id uuid, p_field_name text,
  p_source_language text, p_original_text text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_row app.content_source%rowtype;
  target_language text;
begin
  if p_object_id is null or p_source_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de')
    or not (
      (p_object_type = 'church' and p_field_name in ('official_name', 'description_source'))
      or (p_object_type = 'service_occurrence'
        and p_field_name in ('source_name', 'source_description'))
    ) then
    raise exception using errcode = '22023', message = 'Translation source is not approved.';
  end if;
  select * into source_row from app.content_source as source
  where source.object_type = p_object_type and source.object_id = p_object_id
    and source.field_name = p_field_name for update;
  if source_row.id is null then
    insert into app.content_source (
      object_type, object_id, field_name, source_language, original_text
    ) values (
      p_object_type, p_object_id, p_field_name, p_source_language, p_original_text
    ) returning * into source_row;
  elsif source_row.original_text is distinct from p_original_text
    or source_row.source_language is distinct from p_source_language then
    update app.content_translation set status = 'stale', updated_at = clock_timestamp()
    where content_source_id = source_row.id and status <> 'stale';
    update app.content_source set original_text = p_original_text,
      source_language = p_source_language, source_version = source_version + 1,
      updated_at = clock_timestamp()
    where id = source_row.id returning * into source_row;
  else
    return;
  end if;
  if source_row.original_text is null then return; end if;
  foreach target_language in array array['en', 'ru', 'it', 'ro', 'uk', 'de']::text[] loop
    if target_language <> source_row.source_language then
      insert into app.content_translation (
        content_source_id, source_version, target_language
      ) values (source_row.id, source_row.source_version, target_language)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

create function app.sync_church_translation_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_content_source('church', new.id, 'official_name',
    new.source_language, new.official_name);
  perform app.sync_content_source('church', new.id, 'description_source',
    new.source_language, new.description_source);
  return new;
end;
$$;
create trigger church_translation_sources
  after insert or update of official_name, description_source, source_language on app.church
  for each row execute function app.sync_church_translation_sources();

create function app.sync_service_translation_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  church_language text;
begin
  select source_language into church_language from app.church where id = new.church_id;
  perform app.sync_content_source('service_occurrence', new.id, 'source_name',
    church_language, new.source_name);
  perform app.sync_content_source('service_occurrence', new.id, 'source_description',
    church_language, new.source_description);
  return new;
end;
$$;
create trigger service_translation_sources
  after insert or update of source_name, source_description on app.service_occurrence
  for each row execute function app.sync_service_translation_sources();

-- Backfill the approved source fields without exposing private ride records.
do $$
declare
  item record;
begin
  for item in select id, source_language, official_name, description_source from app.church loop
    perform app.sync_content_source('church', item.id, 'official_name',
      item.source_language, item.official_name);
    perform app.sync_content_source('church', item.id, 'description_source',
      item.source_language, item.description_source);
  end loop;
  for item in select service.id, church.source_language,
      service.source_name, service.source_description
    from app.service_occurrence as service
    join app.church as church on church.id = service.church_id loop
    perform app.sync_content_source('service_occurrence', item.id, 'source_name',
      item.source_language, item.source_name);
    perform app.sync_content_source('service_occurrence', item.id, 'source_description',
      item.source_language, item.source_description);
  end loop;
end;
$$;

revoke all on function app.sync_content_source(text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function app.sync_church_translation_sources()
  from public, anon, authenticated, service_role;
revoke all on function app.sync_service_translation_sources()
  from public, anon, authenticated, service_role;

create function api.published_church_translated_content(p_slug text, p_language text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') or p_language is null then
    raise exception using errcode = '22023', message = 'Unsupported content language.';
  end if;
  select jsonb_strip_nulls(jsonb_build_object(
    'church_id', church.public_id, 'slug', church.slug,
    'source_language', church.source_language,
    'official_name', church.official_name,
    'display_name', coalesce(name_translation.translated_text, church.official_name),
    'name_automatically_translated', name_translation.translation_source = 'machine',
    'original_description', church.description_source,
    'description', coalesce(description_translation.translated_text,
      church.description_source),
    'description_automatically_translated',
      description_translation.translation_source = 'machine',
    'schedule_updated_at', church.schedule_updated_at
  )) into result
  from app.church as church
  left join app.content_source as name_source
    on name_source.object_type = 'church' and name_source.object_id = church.id
      and name_source.field_name = 'official_name'
  left join app.content_translation as name_translation
    on name_translation.content_source_id = name_source.id
      and name_translation.source_version = name_source.source_version
      and name_translation.target_language = p_language
      and name_translation.status = 'ready'
  left join app.content_source as description_source
    on description_source.object_type = 'church' and description_source.object_id = church.id
      and description_source.field_name = 'description_source'
  left join app.content_translation as description_translation
    on description_translation.content_source_id = description_source.id
      and description_translation.source_version = description_source.source_version
      and description_translation.target_language = p_language
      and description_translation.status = 'ready'
  where church.slug = p_slug and church.status = 'published';
  return result;
end;
$$;

create function api.published_church_schedule_translated(
  p_church_id uuid, p_language text, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') or p_language is null then
    raise exception using errcode = '22023', message = 'Unsupported content language.';
  end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'service_id', service.public_id,
    'source_name', coalesce(name_translation.translated_text, service.source_name),
    'original_source_name', service.source_name,
    'name_automatically_translated', name_translation.translation_source = 'machine',
    'description', coalesce(description_translation.translated_text,
      service.source_description),
    'original_description', service.source_description,
    'description_automatically_translated',
      description_translation.translation_source = 'machine',
    'starts_at', service.starts_at, 'timezone', service.timezone,
    'status', service.status, 'time_changed', service.schedule_generation > 1,
    'version', service.version
  )) order by service.starts_at, service.public_id), '[]'::jsonb) into result
  from (
    select occurrence.* from app.service_occurrence as occurrence
    join app.church as church on church.id = occurrence.church_id
    where church.public_id = p_church_id and church.status = 'published'
      and occurrence.starts_at >= now()
    order by occurrence.starts_at, occurrence.public_id
    limit greatest(0, least(coalesce(p_limit, 50), 100))
  ) as service
  left join app.content_source as name_source
    on name_source.object_type = 'service_occurrence'
      and name_source.object_id = service.id and name_source.field_name = 'source_name'
  left join app.content_translation as name_translation
    on name_translation.content_source_id = name_source.id
      and name_translation.source_version = name_source.source_version
      and name_translation.target_language = p_language
      and name_translation.status = 'ready'
  left join app.content_source as description_source
    on description_source.object_type = 'service_occurrence'
      and description_source.object_id = service.id
      and description_source.field_name = 'source_description'
  left join app.content_translation as description_translation
    on description_translation.content_source_id = description_source.id
      and description_translation.source_version = description_source.source_version
      and description_translation.target_language = p_language
      and description_translation.status = 'ready';
  return result;
end;
$$;

revoke all on function api.published_church_translated_content(text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.published_church_translated_content(text, text)
  to anon, authenticated;
revoke all on function api.published_church_schedule_translated(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function api.published_church_schedule_translated(uuid, text, integer)
  to anon, authenticated;

comment on table app.content_source is
  'Versioned allowlisted church and concrete-service text; private ride content is excluded.';
comment on table app.content_translation is
  'Stored translations are version-bound; ready manual corrections take precedence and are never worker-overwritten.';
