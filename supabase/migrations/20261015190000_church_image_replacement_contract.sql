-- Only the trusted image processor may attest to cleaned bytes. No Storage access is granted here.
create function app.valid_church_image_manifest(p_manifest jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  roles text[] := array[]::text[];
  image_id text;
  master_width integer;
  master_height integer;
  width integer;
  height integer;
  edge integer;
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then return false; end if;
  if not (p_manifest ?& array['imageId', 'files'])
    or p_manifest - array['imageId', 'files'] <> '{}'::jsonb
    or jsonb_typeof(p_manifest->'files') <> 'array' then return false; end if;
  image_id := p_manifest->>'imageId';
  if image_id is null or image_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_array_length(p_manifest->'files') <> 4 then return false; end if;
  for item in select value from jsonb_array_elements(p_manifest->'files') loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    if not (item ?& array['role', 'objectKey', 'contentType', 'width', 'height', 'byteLength', 'sha256'])
      or item - array['role', 'objectKey', 'contentType', 'width', 'height', 'byteLength', 'sha256'] <> '{}'::jsonb
      or jsonb_typeof(item->'role') <> 'string' or item->>'role' not in ('master', '480', '960', '1600')
      or item->>'role' = any(roles)
      or item->>'objectKey' is distinct from image_id || '/' || (item->>'role') || '.webp'
      or item->>'contentType' is distinct from 'image/webp'
      or jsonb_typeof(item->'sha256') <> 'string' or item->>'sha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item->'width') <> 'number' or item->>'width' !~ '^[1-9][0-9]{0,4}$'
      or jsonb_typeof(item->'height') <> 'number' or item->>'height' !~ '^[1-9][0-9]{0,4}$'
      or jsonb_typeof(item->'byteLength') <> 'number' or item->>'byteLength' !~ '^[1-9][0-9]{0,7}$'
    then return false; end if;
    width := (item->>'width')::integer;
    height := (item->>'height')::integer;
    if width > 10000 or height > 10000 or width * height > 24000000
      or (item->>'byteLength')::integer > 16777216 then return false; end if;
    roles := array_append(roles, item->>'role');
    if item->>'role' = 'master' then master_width := width; master_height := height; end if;
  end loop;
  if master_width is null or master_height is null then return false; end if;
  for item in select value from jsonb_array_elements(p_manifest->'files') where value->>'role' <> 'master' loop
    width := (item->>'width')::integer;
    height := (item->>'height')::integer;
    edge := (item->>'role')::integer;
    if greatest(width, height) > edge or width > master_width or height > master_height
      or abs(width * master_height - height * master_width) > greatest(master_width, master_height)
    then return false; end if;
  end loop;
  return true;
end;
$$;

create table app.church_image (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique,
  church_id uuid not null references app.church (id) on delete restrict,
  manifest jsonb not null check (app.valid_church_image_manifest(manifest)),
  attribution text check (attribution is null or (
    char_length(attribution) between 1 and 1000 and btrim(attribution, E' \n\r') <> ''
    and translate(attribution, E'\n\r', '') !~ '[[:cntrl:]]'
  )),
  rights_confirmed_at timestamptz not null,
  uploader_account_id uuid references app.account (id) on delete set null,
  status text not null check (status in ('current', 'superseded')),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  check ((status = 'superseded') = (superseded_at is not null)),
  check (public_id::text = manifest->>'imageId')
);
create unique index church_image_one_current on app.church_image (church_id) where status = 'current';
create table private.church_image_replacement (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid references app.account (id) on delete set null,
  church_id uuid not null references app.church (id) on delete restrict,
  client_key uuid not null,
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  upload_sha256 text check (upload_sha256 ~ '^[0-9a-f]{64}$'),
  expected_content_version integer not null check (expected_content_version > 0),
  attribution text check (attribution is null or (
    char_length(attribution) between 1 and 1000 and btrim(attribution, E' \n\r') <> ''
    and translate(attribution, E'\n\r', '') !~ '[[:cntrl:]]'
  )),
  rights_confirmed_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'staged', 'succeeded')),
  image_public_id uuid unique,
  manifest jsonb check (manifest is null or app.valid_church_image_manifest(manifest)),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '30 minutes',
  unique (actor_account_id, client_key),
  check ((state = 'pending') = (manifest is null)),
  check ((manifest is null) = (image_public_id is null)),
  check (image_public_id::text = manifest->>'imageId'),
  check ((state = 'succeeded') = (result is not null)),
  check ((state = 'succeeded') = (upload_sha256 is null))
);
alter table app.church_image enable row level security;
alter table app.church_image force row level security;
alter table private.church_image_replacement enable row level security;
alter table private.church_image_replacement force row level security;
revoke all on table app.church_image, private.church_image_replacement from public, anon, authenticated, service_role;

create function api.prepare_church_image_replacement(
  p_church_id uuid, p_expected_version integer, p_upload_sha256 text,
  p_rights_confirmed boolean, p_attribution text, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_eligible_actor();
  attribution_text text := nullif(btrim(p_attribution, E' \n\r'), '');
  digest text;
  replacement private.church_image_replacement%rowtype;
  church_row app.church%rowtype;
begin
  if p_church_id is null or p_expected_version is null or p_expected_version < 1
    or p_upload_sha256 is null or p_upload_sha256 !~ '^[0-9a-f]{64}$'
    or p_rights_confirmed is distinct from true or p_client_key is null
    or (attribution_text is not null and (char_length(attribution_text) > 1000
      or translate(attribution_text, E'\n\r', '') ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'Church photograph input is invalid.';
  end if;
  digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'expected_version', p_expected_version,
    'upload_sha256', p_upload_sha256, 'attribution', attribution_text, 'rights_confirmed', true
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':church-image:' || p_client_key::text, 0));
  select * into replacement from private.church_image_replacement as operation
  where operation.actor_account_id = actor_id and operation.client_key = p_client_key;
  if found then
    if replacement.input_digest <> digest then
      raise exception using errcode = '23505', message = 'The operation key was already used with different input.';
    end if;
    if replacement.state = 'succeeded' then return replacement.result; end if;
    replacement := app.lock_church_image_replacement(replacement.id);
    return jsonb_build_object('status', 'prepared', 'replacement_id', replacement.id,
      'expires_at', replacement.expires_at);
  end if;
  select * into church_row from app.church where public_id = p_church_id;
  if not found then raise exception using errcode = '42501', message = 'Church administration is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_row.id::text, 0));
  select * into church_row from app.church where id = church_row.id for update;
  if church_row.status not in ('published', 'hidden', 'archive_requested') or not exists (
    select 1 from app.church_admin_membership where church_id = church_row.id
      and account_id = actor_id and status in ('active', 'transferring')
  ) then raise exception using errcode = '42501', message = 'Church administration is unavailable.'; end if;
  if church_row.content_version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'Church content changed; reload it before editing.';
  end if;
  insert into private.church_image_replacement (
    actor_account_id, church_id, client_key, input_digest, upload_sha256,
    expected_content_version, attribution, rights_confirmed_at
  ) values (actor_id, church_row.id, p_client_key, digest, p_upload_sha256,
    p_expected_version, attribution_text, clock_timestamp()) returning * into replacement;
  return jsonb_build_object('status', 'prepared', 'replacement_id', replacement.id,
    'expires_at', replacement.expires_at);
end;
$$;

create function app.lock_church_image_replacement(p_replacement_id uuid)
returns private.church_image_replacement
language plpgsql
volatile
set search_path = ''
as $$
declare
  replacement private.church_image_replacement%rowtype;
  church_row app.church%rowtype;
begin
  select * into replacement from private.church_image_replacement where id = p_replacement_id;
  if not found then raise exception using errcode = '42501', message = 'Church photograph preparation is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || replacement.church_id::text, 0));
  select * into church_row from app.church where id = replacement.church_id for update;
  select * into replacement from private.church_image_replacement where id = p_replacement_id for update;
  -- A committed result remains replayable without reapplying an old image or authorizing a new action.
  if replacement.state = 'succeeded' then return replacement; end if;
  if replacement.expires_at <= clock_timestamp() then
    raise exception using errcode = '55000', message = 'Church photograph preparation expired.';
  end if;
  if church_row.status not in ('published', 'hidden', 'archive_requested')
    or not coalesce((app.current_eligibility_result(replacement.actor_account_id)->>'eligible')::boolean, false)
    or not exists (select 1 from app.church_admin_membership
      where church_id = church_row.id and account_id = replacement.actor_account_id
        and status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  if church_row.content_version <> replacement.expected_content_version then
    raise exception using errcode = 'PT409', message = 'Church content changed; reload it before editing.';
  end if;
  return replacement;
end;
$$;

create function api.inspect_church_image_replacement(p_replacement_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  replacement private.church_image_replacement := app.lock_church_image_replacement(p_replacement_id);
begin
  return jsonb_build_object('state', replacement.state, 'expires_at', replacement.expires_at,
    'manifest', replacement.manifest, 'result', replacement.result);
end;
$$;

create function api.stage_church_image_replacement(p_replacement_id uuid, p_upload_sha256 text, p_manifest jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  replacement private.church_image_replacement := app.lock_church_image_replacement(p_replacement_id);
begin
  if replacement.state = 'succeeded' then return false; end if;
  if p_upload_sha256 is distinct from replacement.upload_sha256
    or not app.valid_church_image_manifest(p_manifest) then
    raise exception using errcode = '22023', message = 'Prepared church photograph is invalid.';
  end if;
  if replacement.state = 'staged' then
    if replacement.manifest is distinct from p_manifest then
      raise exception using errcode = '23505', message = 'A different photograph was already prepared.';
    end if;
    return true;
  end if;
  update private.church_image_replacement set state = 'staged', manifest = p_manifest,
    image_public_id = (p_manifest->>'imageId')::uuid where id = replacement.id;
  return true;
end;
$$;

-- Called only after the trusted application has uploaded every immutable cleaned object successfully.
create function api.complete_church_image_replacement(p_replacement_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  replacement private.church_image_replacement := app.lock_church_image_replacement(p_replacement_id);
  operation_result jsonb;
  church_public_id uuid;
  next_version integer;
begin
  if replacement.state = 'succeeded' then return replacement.result; end if;
  if replacement.state <> 'staged' then
    raise exception using errcode = '55000', message = 'Church photograph has not been prepared.';
  end if;
  update app.church_image set status = 'superseded', superseded_at = clock_timestamp()
  where church_id = replacement.church_id and status = 'current';
  insert into app.church_image (public_id, church_id, manifest, attribution,
    rights_confirmed_at, uploader_account_id, status)
  values (replacement.image_public_id, replacement.church_id, replacement.manifest,
    replacement.attribution, replacement.rights_confirmed_at, replacement.actor_account_id, 'current');
  update app.church set content_version = content_version + 1, updated_at = clock_timestamp()
  where id = replacement.church_id returning public_id, content_version into church_public_id, next_version;
  insert into app.church_admin_event (church_id, actor_account_id, event_type)
  values (replacement.church_id, replacement.actor_account_id, 'church.content_updated');
  operation_result := jsonb_build_object('status', 'saved', 'church_id', church_public_id,
    'image_id', replacement.image_public_id, 'content_version', next_version);
  update private.church_image_replacement set state = 'succeeded', result = operation_result,
    upload_sha256 = null where id = replacement.id;
  return operation_result;
end;
$$;

create function api.published_church_image(p_church_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('image_id', image.public_id, 'attribution', image.attribution,
    'variants', (select jsonb_agg(jsonb_build_object('role', file->>'role', 'content_type', 'image/webp',
      'width', (file->>'width')::integer, 'height', (file->>'height')::integer)
      order by (file->>'role')::integer)
      from jsonb_array_elements(image.manifest->'files') as file where file->>'role' <> 'master')))
  from app.church_image as image join app.church as church on church.id = image.church_id
  where church.public_id = p_church_id and church.status = 'published' and image.status = 'current';
$$;

revoke all on function app.valid_church_image_manifest(jsonb), app.lock_church_image_replacement(uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.prepare_church_image_replacement(uuid, integer, text, boolean, text, uuid),
  api.stage_church_image_replacement(uuid, text, jsonb), api.complete_church_image_replacement(uuid),
  api.inspect_church_image_replacement(uuid),
  api.published_church_image(uuid) from public, anon, authenticated, service_role;
grant execute on function api.prepare_church_image_replacement(uuid, integer, text, boolean, text, uuid) to authenticated;
grant execute on function api.stage_church_image_replacement(uuid, text, jsonb),
  api.complete_church_image_replacement(uuid), api.inspect_church_image_replacement(uuid) to service_role;
grant execute on function api.published_church_image(uuid) to anon, authenticated;
comment on table private.church_image_replacement is
  'Short-lived actor-derived image intent. Staged manifests retain cleanup keys; only trusted application completion may attest to uploaded cleaned objects. Storage integration/cleanup follow separately.';
