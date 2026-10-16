-- Technical reconciliation of expired, uncommitted image uploads only. This does not set a
-- retention period for published/superseded photographs or erase their database history.
alter table private.church_image_replacement
  add column cleanup_lease_token uuid,
  add column cleanup_lease_expires_at timestamptz,
  add column cleanup_next_at timestamptz not null default clock_timestamp(),
  add column cleanup_checked_at timestamptz,
  add constraint church_image_cleanup_lease_pair check (
    (cleanup_lease_token is null) = (cleanup_lease_expires_at is null)
  );
create index church_image_abandoned_cleanup_due
  on private.church_image_replacement (cleanup_next_at, expires_at)
  where state = 'staged';

create function api.church_image_cleanup_claim(p_lease_token uuid, p_limit integer default 10)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_lease_token is null or p_limit is null or p_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'Image cleanup claim is invalid.';
  end if;
  with candidates as (
    select operation.id
    from private.church_image_replacement as operation
    where operation.state = 'staged' and operation.expires_at <= clock_timestamp()
      and operation.cleanup_next_at <= clock_timestamp()
      and (operation.cleanup_lease_expires_at is null
        or operation.cleanup_lease_expires_at <= clock_timestamp())
      and not exists (select 1 from app.church_image as image
        where image.public_id = operation.image_public_id)
    order by operation.cleanup_next_at, operation.expires_at, operation.id
    for update of operation skip locked
    limit p_limit
  ), leased as (
    update private.church_image_replacement as operation
    set cleanup_lease_token = p_lease_token,
      cleanup_lease_expires_at = clock_timestamp() + interval '2 minutes'
    from candidates where operation.id = candidates.id
      and operation.state = 'staged' and operation.expires_at <= clock_timestamp()
    returning operation.id, operation.image_public_id, operation.manifest
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'replacement_id', leased.id, 'image_id', leased.image_public_id,
    'object_keys', (select jsonb_agg(file->>'objectKey')
      from jsonb_array_elements(leased.manifest->'files') as file)
  )), '[]'::jsonb) into claimed from leased;
  return claimed;
end;
$$;

create function api.church_image_cleanup_complete(
  p_replacement_id uuid, p_lease_token uuid, p_success boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_replacement_id is null or p_lease_token is null or p_success is null then
    raise exception using errcode = '22023', message = 'Image cleanup completion is invalid.';
  end if;
  update private.church_image_replacement as operation
  set cleanup_lease_token = null, cleanup_lease_expires_at = null,
    cleanup_checked_at = case when p_success then clock_timestamp() else cleanup_checked_at end,
    cleanup_next_at = clock_timestamp() + case when p_success then interval '24 hours' else interval '5 minutes' end
  where operation.id = p_replacement_id and operation.state = 'staged'
    and operation.expires_at <= clock_timestamp()
    and operation.cleanup_lease_token = p_lease_token
    and operation.cleanup_lease_expires_at > clock_timestamp()
    and not exists (select 1 from app.church_image as image
      where image.public_id = operation.image_public_id);
  return found;
end;
$$;

revoke all on function api.church_image_cleanup_claim(uuid, integer),
  api.church_image_cleanup_complete(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function api.church_image_cleanup_claim(uuid, integer),
  api.church_image_cleanup_complete(uuid, uuid, boolean) to service_role;

comment on function api.church_image_cleanup_complete(uuid, uuid, boolean) is
  'Checks only expired uncommitted objects. Daily rechecks catch late writes after ambiguous upload timeouts; manifests remain for reconciliation pending approved retention.';
