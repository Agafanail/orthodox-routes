-- Resolve one published prepared object only inside the trusted server boundary. Storage paths,
-- hashes and byte counts never enter the anonymous/authenticated database response shape.
create function api.published_church_image_object(
  p_church_id uuid,
  p_image_id uuid,
  p_role text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'role', file->>'role',
    'objectKey', file->>'objectKey',
    'contentType', file->>'contentType',
    'width', (file->>'width')::integer,
    'height', (file->>'height')::integer,
    'byteLength', (file->>'byteLength')::integer,
    'sha256', file->>'sha256'
  )
  from app.church_image as image
  join app.church as church on church.id = image.church_id
  cross join lateral jsonb_array_elements(image.manifest->'files') as file
  where church.public_id = p_church_id
    and church.status = 'published'
    and image.public_id = p_image_id
    and image.status = 'current'
    and p_role in ('480', '960', '1600')
    and file->>'role' = p_role;
$$;

revoke all on function api.published_church_image_object(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function api.published_church_image_object(uuid, uuid, text) to service_role;

comment on function api.published_church_image_object(uuid, uuid, text) is
  'Service-only lookup for one current published prepared variant. The application proxies a checksum-verified private Storage object and never returns this metadata directly.';
