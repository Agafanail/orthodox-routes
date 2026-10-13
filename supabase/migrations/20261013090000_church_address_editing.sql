-- Church geography is updated with its public address; stale road measurements are discarded.
alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content',
  'create_one_off_service', 'cancel_one_off_service',
  'request_church_archival', 'cancel_church_archival_request', 'update_church_address'
));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

create function api.update_church_address(
  p_church_id uuid, p_address_display text, p_locality text, p_country_code text,
  p_lat double precision, p_lng double precision, p_expected_version integer, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  public_address text := btrim(coalesce(p_address_display, ''));
  normalized_address text := app.normalize_church_address(coalesce(p_address_display, ''));
  normalized_locality text := btrim(coalesce(p_locality, ''));
  normalized_country text := upper(btrim(coalesce(p_country_code, '')));
  requested_location extensions.geography(Point, 4326);
  fingerprint text;
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  changed boolean;
  recipient record;
  result jsonb;
begin
  if p_church_id is null or p_client_key is null or p_expected_version is null
    or p_expected_version < 1
    or char_length(public_address) not between 1 and 300 or public_address ~ '[[:cntrl:]]'
    or char_length(normalized_address) not between 1 and 300 or normalized_address ~ '[[:cntrl:]]'
    or char_length(normalized_locality) not between 1 and 120 or normalized_locality ~ '[[:cntrl:]]'
    or normalized_country !~ '^[A-Z]{2}$'
    or p_lat is null or p_lng is null or p_lat < -85 or p_lat > 85
    or p_lng < -180 or p_lng > 180 then
    raise exception using errcode = '22023', message = 'Church address input is invalid.';
  end if;
  requested_location := extensions.st_setsrid(
    extensions.st_makepoint(p_lng, p_lat), 4326
  )::extensions.geography;
  fingerprint := encode(extensions.digest(convert_to(normalized_address, 'UTF8'), 'sha256'), 'hex');
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'church_id', p_church_id, 'address_display', public_address,
    'normalized_address', normalized_address, 'locality', normalized_locality,
    'country_code', normalized_country, 'lat', p_lat, 'lng', p_lng,
    'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':update_church_address:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_church_address', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  -- Creation takes the same address lock, so a competing creation cannot pass deduplication.
  perform pg_advisory_xact_lock(hashtextextended('church-address:' || fingerprint, 0));
  select * into church_row from app.church as church
  where church.public_id = p_church_id for update;
  if not found or church_row.status not in ('published', 'hidden')
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church administration is unavailable.';
  end if;
  if church_row.content_version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Church content changed; reload it before editing.';
  end if;
  changed := church_row.address_display is distinct from public_address
    or church_row.locality is distinct from normalized_locality
    or church_row.country_code is distinct from normalized_country
    or church_row.location is distinct from requested_location;

  if changed and exists (
    select 1 from app.church as other_church
    where other_church.id <> church_row.id and not other_church.deduplication_exempt
      and coalesce(other_church.address_fingerprint,
        encode(extensions.digest(convert_to(
          app.normalize_church_address(other_church.address_display), 'UTF8'
        ), 'sha256'), 'hex')) = fingerprint
  ) and not (church_row.deduplication_exempt and church_row.address_fingerprint = fingerprint) then
    result := jsonb_build_object('status', 'potential_duplicate',
      'church_id', church_row.public_id, 'content_version', church_row.content_version);
  elsif changed then
    update app.church as church set
      address_display = public_address, locality = normalized_locality,
      country_code = normalized_country, location = requested_location,
      address_fingerprint = fingerprint,
      deduplication_exempt = case when church.address_fingerprint = fingerprint
        then church.deduplication_exempt else false end,
      content_version = church.content_version + 1, updated_at = clock_timestamp()
    where church.id = church_row.id returning * into church_row;
    delete from app.route_measurement where church_id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'church.address_updated');

    for recipient in
      select distinct affected.account_id from (
        select request.author_account_id as account_id
        from app.passenger_request as request
        where request.church_id = church_row.id
          and request.status in ('active', 'partial', 'fulfilled', 'restore')
          and request.desired_arrival_at > now()
        union
        select offer.author_account_id
        from app.driver_offer_occurrence as offer
        where offer.church_id = church_row.id
          and offer.status in ('active', 'full') and offer.arrival_at > now()
        union
        select response.passenger_account_id
        from app.ride_response as response
        join app.passenger_request as request on request.id = response.passenger_request_id
        where request.church_id = church_row.id
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select response.driver_account_id
        from app.ride_response as response
        join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
        where offer.church_id = church_row.id
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select agreement.passenger_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        where request.church_id = church_row.id
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
        union
        select agreement.driver_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        where request.church_id = church_row.id
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
      ) as affected
    loop
      perform app.create_notification_once(
        recipient.account_id,
        'church:' || church_row.public_id::text || ':address:' || church_row.content_version::text,
        'church.address.updated', 'church', church_row.public_id,
        '/trips', 'church.address.updated', '{}'::jsonb, 50
      );
    end loop;
    result := jsonb_build_object('status', 'saved', 'church_id', church_row.public_id,
      'content_version', church_row.content_version);
  else
    result := jsonb_build_object('status', 'saved', 'church_id', church_row.public_id,
      'content_version', church_row.content_version);
  end if;
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_church_address', p_client_key, input_digest, result);
  return result;
end;
$$;

create or replace function api.current_managed_churches()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'church_id', church.public_id,
    'slug', church.slug,
    'official_name', church.official_name,
    'description_source', church.description_source,
    'content_version', church.content_version,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone,
    'lat', extensions.st_y(church.location::extensions.geometry),
    'lng', extensions.st_x(church.location::extensions.geometry),
    'status', case when church.status = 'published' and exists (
      select 1 from app.church_archive_request as pending_request
      where pending_request.church_id = church.id and pending_request.status = 'pending'
    ) then 'archive_requested' else church.status end,
    'schedule_updated_at', church.schedule_updated_at,
    'membership_id', membership.public_id,
    'membership_status', membership.status,
    'archive_request', (
      select jsonb_build_object('request_id', archive_request.public_id,
        'status', archive_request.status, 'requested_at', archive_request.requested_at)
      from app.church_archive_request as archive_request
      where archive_request.church_id = church.id and archive_request.status = 'pending'
    ),
    'administrator_count', (
      select count(*) from app.church_admin_membership as counted
      where counted.church_id = church.id and counted.status in ('active', 'transferring')
    )
  ) order by church.official_name, church.public_id), '[]'::jsonb)
  from app.church_admin_membership as membership
  join app.church as church on church.id = membership.church_id
  where membership.account_id = app.current_actor_id()
    and membership.status in ('active', 'transferring');
$$;

-- A route calculated before an address edit cannot be recorded after the edit commits.
create or replace function api.route_worker_pending_legs(
  p_church_id uuid default null, p_limit integer default 10
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with bounded as (select least(greatest(coalesce(p_limit, 10), 1), 50) as row_limit),
  needed as (
    select distinct evaluated.church_id, evaluated.origin_place_id,
      null::uuid as via_place_id
    from app.quality_match_evaluated as evaluated
    where evaluated.baseline_distance_m is null
    union
    select distinct evaluated.church_id, evaluated.origin_place_id,
      evaluated.place_id as via_place_id
    from app.quality_match_evaluated as evaluated
    where not evaluated.measured
  )
  select coalesce(jsonb_agg(leg order by leg->>'origin_place_id', leg->>'via_place_id'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'church_id', church.public_id,
      'church_version', church.content_version,
      'origin_place_id', origin_place.public_id,
      'via_place_id', via_place.public_id,
      'origin', jsonb_build_object(
        'lat', extensions.st_y(origin_place.exact_location::extensions.geometry),
        'lng', extensions.st_x(origin_place.exact_location::extensions.geometry)
      ),
      'destination', jsonb_build_object(
        'lat', extensions.st_y(church.location::extensions.geometry),
        'lng', extensions.st_x(church.location::extensions.geometry)
      ),
      'via', case when via_place.id is null then null else jsonb_build_object(
        'lat', extensions.st_y(via_place.exact_location::extensions.geometry),
        'lng', extensions.st_x(via_place.exact_location::extensions.geometry)
      ) end
    ) as leg
    from needed
    join app.church as church on church.id = needed.church_id
    join private.user_place as origin_place on origin_place.id = needed.origin_place_id
    left join private.user_place as via_place on via_place.id = needed.via_place_id
    where church.location is not null
      and origin_place.exact_location is not null
      and (needed.via_place_id is null or via_place.exact_location is not null)
      and (p_church_id is null or church.public_id = p_church_id)
    limit (select row_limit from bounded)
  ) as legs;
$$;

drop function api.route_worker_record_leg(uuid, uuid, uuid, integer, integer, text);
create function api.route_worker_record_leg(
  p_church_id uuid, p_church_version integer, p_origin_place_id uuid,
  p_via_place_id uuid, p_distance_m integer, p_duration_s integer, p_provider_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  church_row app.church%rowtype;
  internal_origin_id uuid;
  internal_via_id uuid;
begin
  if p_church_version is null or p_church_version < 1
    or p_distance_m is null or p_duration_s is null
    or p_distance_m not between 0 and 5000000 or p_duration_s not between 0 and 1000000
    or p_provider_name is null or p_provider_name !~ '^[a-z0-9-]{1,40}$' then
    raise exception using errcode = '22023', message = 'The route measurement is invalid.';
  end if;
  select * into church_row from app.church as church
  where church.public_id = p_church_id for share;
  if church_row.id is null then
    raise exception using errcode = 'P0002', message = 'The measured route reference is unavailable.';
  end if;
  if church_row.content_version <> p_church_version then
    return jsonb_build_object('status', 'stale');
  end if;
  select place.id into internal_origin_id from private.user_place as place
  where place.public_id = p_origin_place_id;
  if p_via_place_id is not null then
    select place.id into internal_via_id from private.user_place as place
    where place.public_id = p_via_place_id;
    if internal_via_id is null then
      raise exception using errcode = 'P0002', message = 'The measured place is unavailable.';
    end if;
  end if;
  if internal_origin_id is null then
    raise exception using errcode = 'P0002', message = 'The measured route reference is unavailable.';
  end if;
  insert into app.route_measurement (
    church_id, origin_place_id, via_place_id, distance_m, duration_s, provider_name, measured_at
  ) values (
    church_row.id, internal_origin_id, internal_via_id, p_distance_m, p_duration_s,
    p_provider_name, clock_timestamp()
  )
  on conflict (church_id, origin_place_id, via_place_id) do update
  set distance_m = excluded.distance_m,
      duration_s = excluded.duration_s,
      provider_name = excluded.provider_name,
      measured_at = excluded.measured_at;
  return jsonb_build_object('status', 'recorded');
end;
$$;

revoke all on function api.update_church_address(
  uuid, text, text, text, double precision, double precision, integer, uuid
) from public, anon, authenticated, service_role;
grant execute on function api.update_church_address(
  uuid, text, text, text, double precision, double precision, integer, uuid
) to authenticated;
revoke all on function api.route_worker_record_leg(
  uuid, integer, uuid, uuid, integer, integer, text
) from public, anon, authenticated, service_role;
grant execute on function api.route_worker_record_leg(
  uuid, integer, uuid, uuid, integer, integer, text
) to service_role;

comment on function api.update_church_address(
  uuid, text, text, text, double precision, double precision, integer, uuid
) is 'Edits church address/geography with deduplication, route-cache invalidation, and affected-rider notifications.';
comment on function api.route_worker_record_leg(
  uuid, integer, uuid, uuid, integer, integer, text
) is 'Records only route measurements for the unchanged church content version.';
