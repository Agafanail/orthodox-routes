-- Manual corrections belong to a current equal administrator and a current source version.
alter table app.content_translation
  add column content_version integer not null default 1,
  add constraint content_translation_content_version_positive check (content_version > 0);

alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'update_one_off_service_time', 'create_recurring_service', 'cancel_recurring_service_date',
  'reschedule_recurring_service_date', 'update_recurring_service_date_content',
  'cancel_recurring_service_future', 'correct_church_content_translation',
  'request_church_archival', 'cancel_church_archival_request'
));
alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated', 'service.rescheduled',
  'service.series_created', 'service.date_cancelled', 'service.date_rescheduled',
  'service.date_content_updated', 'service.future_dates_cancelled', 'translation.corrected',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function app.managed_translation_target(
  p_object_type text, p_object_public_id uuid, p_field_name text
)
returns table (
  target_church_id uuid, target_source_id uuid, target_source_version integer,
  target_source_language text, target_original_text text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  church_status text;
begin
  if p_object_type = 'church' and p_field_name in ('official_name', 'description_source') then
    select church.id, source.id, source.source_version,
      source.source_language, source.original_text, church.status
    into target_church_id, target_source_id, target_source_version,
      target_source_language, target_original_text, church_status
    from app.church as church
    join app.content_source as source on source.object_type = 'church'
      and source.object_id = church.id and source.field_name = p_field_name
    where church.public_id = p_object_public_id;
  elsif p_object_type = 'service_occurrence'
    and p_field_name in ('source_name', 'source_description') then
    select church.id, source.id, source.source_version,
      source.source_language, source.original_text, church.status
    into target_church_id, target_source_id, target_source_version,
      target_source_language, target_original_text, church_status
    from app.service_occurrence as service
    join app.church as church on church.id = service.church_id
    join app.content_source as source on source.object_type = 'service_occurrence'
      and source.object_id = service.id and source.field_name = p_field_name
    where service.public_id = p_object_public_id;
  end if;
  if target_church_id is null or church_status not in ('published', 'hidden', 'archive_requested')
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = target_church_id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church translation administration is unavailable.';
  end if;
  return next;
end;
$$;

create function api.managed_church_translation_source(
  p_object_type text, p_object_public_id uuid, p_field_name text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target record;
  translations jsonb;
begin
  select * into target from app.managed_translation_target(
    p_object_type, p_object_public_id, p_field_name
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'target_language', translation.target_language,
    'status', translation.status,
    'translation_source', translation.translation_source,
    'translated_text', translation.translated_text,
    'content_version', translation.content_version
  ) order by translation.target_language), '[]'::jsonb)
  into translations
  from app.content_translation as translation
  where translation.content_source_id = target.target_source_id
    and translation.source_version = target.target_source_version;
  return jsonb_build_object(
    'object_type', p_object_type, 'object_id', p_object_public_id,
    'field_name', p_field_name, 'source_language', target.target_source_language,
    'original_text', target.target_original_text,
    'source_version', target.target_source_version,
    'translations', translations
  );
end;
$$;

create function api.correct_church_content_translation(
  p_object_type text, p_object_public_id uuid, p_field_name text,
  p_target_language text, p_translated_text text,
  p_expected_source_version integer, p_expected_translation_version integer,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  normalized_text text := nullif(btrim(p_translated_text), '');
  input_digest text;
  existing_result jsonb;
  target record;
  translation_row app.content_translation%rowtype;
  result jsonb;
begin
  if p_object_public_id is null or p_client_key is null
    or p_expected_source_version is null or p_expected_source_version < 1
    or p_expected_translation_version is null or p_expected_translation_version < 1
    or p_target_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de')
    or p_target_language is null or normalized_text is null
    or char_length(normalized_text) > 8000
    or translate(normalized_text, E'\n\r', '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Translation correction input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'object_type', p_object_type, 'object_id', p_object_public_id,
    'field_name', p_field_name, 'target_language', p_target_language,
    'translated_text', normalized_text,
    'expected_source_version', p_expected_source_version,
    'expected_translation_version', p_expected_translation_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':correct_church_content_translation:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'correct_church_content_translation', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;
  select * into target from app.managed_translation_target(
    p_object_type, p_object_public_id, p_field_name
  );
  perform 1 from app.church as church where church.id = target.target_church_id for update;
  select * into target from app.managed_translation_target(
    p_object_type, p_object_public_id, p_field_name
  );
  if target.target_source_version <> p_expected_source_version
    or target.target_original_text is null then
    raise exception using errcode = '40001', message = 'Source changed; reload it before correcting.';
  end if;
  if target.target_source_language = p_target_language then
    raise exception using errcode = '22023', message = 'The original language cannot be corrected as a translation.';
  end if;
  select * into translation_row from app.content_translation as translation
  where translation.content_source_id = target.target_source_id
    and translation.source_version = target.target_source_version
    and translation.target_language = p_target_language for update;
  if translation_row.id is null then
    raise exception using errcode = '22023', message = 'Translation target is unavailable.';
  end if;
  if translation_row.content_version <> p_expected_translation_version then
    raise exception using errcode = '40001', message = 'Translation changed; reload it before correcting.';
  end if;
  if translation_row.translation_source <> 'manual'
    or translation_row.status <> 'ready'
    or translation_row.translated_text is distinct from normalized_text then
    update app.content_translation set translated_text = normalized_text,
      translation_source = 'manual', status = 'ready',
      provider_name = null, provider_model = null, glossary_version = null,
      manual_editor_id = actor_id, content_version = content_version + 1,
      updated_at = clock_timestamp()
    where id = translation_row.id returning * into translation_row;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (target.target_church_id, actor_id, 'translation.corrected');
  end if;
  result := jsonb_build_object(
    'status', 'saved', 'object_type', p_object_type,
    'object_id', p_object_public_id, 'field_name', p_field_name,
    'target_language', p_target_language,
    'source_version', target.target_source_version,
    'translation_version', translation_row.content_version
  );
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'correct_church_content_translation', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function app.managed_translation_target(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function api.managed_church_translation_source(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function api.managed_church_translation_source(text, uuid, text)
  to authenticated;
revoke all on function api.correct_church_content_translation(text, uuid, text, text, text, integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.correct_church_content_translation(text, uuid, text, text, text, integer, integer, uuid)
  to authenticated;

comment on function api.correct_church_content_translation(text, uuid, text, text, text, integer, integer, uuid) is
  'Version-checked manual correction of an allowlisted church or service translation by a current administrator.';
