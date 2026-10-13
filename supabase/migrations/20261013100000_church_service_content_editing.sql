-- Editing source text does not change the concrete service time or linked ride snapshots.
alter table private.church_operation drop constraint church_operation_type;
alter table private.church_operation add constraint church_operation_type check (operation_type in (
  'create_church', 'invite_church_admin', 'update_church_content', 'update_church_address',
  'create_one_off_service', 'cancel_one_off_service', 'update_one_off_service_content',
  'request_church_archival', 'cancel_church_archival_request'
));

alter table app.church_admin_event drop constraint church_admin_event_type;
alter table app.church_admin_event add constraint church_admin_event_type check (event_type in (
  'church.created', 'church.content_updated', 'church.address_updated',
  'service.created', 'service.cancelled', 'service.content_updated',
  'membership.joined', 'membership.transferred', 'membership.left',
  'invite.issued', 'invite.resent', 'invite.cancelled', 'invite.declined', 'invite.expired',
  'archive.requested', 'archive.request_cancelled'
));

-- Publishing holds the same church/service lock order as an administrator edit. This keeps
-- a new listing's service-name snapshot and the edit's affected-recipient scan atomic.
create or replace function app.assert_transport_reference(
  requested_church_public_id uuid,
  requested_service_public_id uuid,
  requested_time timestamptz
)
returns table (church_id uuid, service_id uuid, service_name text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  resolved_church_id uuid;
begin
  select church.id into resolved_church_id
  from app.church as church
  where church.public_id = requested_church_public_id and church.status = 'published'
  for share;
  if resolved_church_id is null then
    raise exception using errcode = 'P0002', message = 'The church is unavailable.';
  end if;

  church_id := resolved_church_id;
  service_id := null;
  service_name := null;
  if requested_service_public_id is not null then
    select service.id, service.source_name
    into service_id, service_name
    from app.service_occurrence as service
    where service.public_id = requested_service_public_id
      and service.church_id = resolved_church_id
      and service.status = 'scheduled'
      and service.starts_at = requested_time
    for share;
    if service_id is null then
      raise exception using errcode = '22023', message = 'The service occurrence does not match the requested ride.';
    end if;
  end if;
  return next;
end;
$$;

create function api.preview_one_off_service_edit(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  impact jsonb;
  service_row app.service_occurrence%rowtype;
begin
  impact := api.preview_one_off_service_cancellation(p_service_id);
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id;
  return impact || jsonb_build_object(
    'source_name', service_row.source_name,
    'source_description', service_row.source_description,
    'starts_at', service_row.starts_at,
    'timezone', service_row.timezone
  );
end;
$$;

create function api.update_one_off_service_content(
  p_service_id uuid, p_source_name text, p_source_description text,
  p_expected_version integer, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  normalized_name text := btrim(coalesce(p_source_name, ''));
  normalized_description text := nullif(btrim(p_source_description), '');
  input_digest text;
  existing_result jsonb;
  church_row app.church%rowtype;
  service_row app.service_occurrence%rowtype;
  recipient record;
  result jsonb;
begin
  if p_service_id is null or p_client_key is null or p_expected_version is null
    or p_expected_version < 1
    or char_length(normalized_name) not between 1 and 160
    or normalized_name ~ '[[:cntrl:]]'
    or (normalized_description is not null and (
      char_length(normalized_description) > 4000
      or translate(normalized_description, E'\n\r', '') ~ '[[:cntrl:]]'
    )) then
    raise exception using errcode = '22023', message = 'Service content input is invalid.';
  end if;
  input_digest := encode(extensions.digest(convert_to(jsonb_build_object(
    'service_id', p_service_id, 'source_name', normalized_name,
    'source_description', normalized_description, 'expected_version', p_expected_version
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':update_one_off_service_content:' || p_client_key::text, 0
  ));
  existing_result := app.church_operation_result(
    actor_id, 'update_one_off_service_content', p_client_key, input_digest
  );
  if existing_result is not null then return existing_result; end if;

  select church.* into church_row from app.church as church
  join app.service_occurrence as service on service.church_id = church.id
  where service.public_id = p_service_id for update of church;
  select * into service_row from app.service_occurrence as service
  where service.public_id = p_service_id for update;
  if church_row.id is null or church_row.status <> 'published'
    or service_row.source_kind <> 'one_off'
    or not exists (
      select 1 from app.church_admin_membership as membership
      where membership.church_id = church_row.id and membership.account_id = actor_id
        and membership.status in ('active', 'transferring')
    ) then
    raise exception using errcode = '42501', message = 'Church schedule administration is unavailable.';
  end if;
  if service_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'Service changed; reload it before editing.';
  end if;
  if service_row.status <> 'scheduled' or service_row.starts_at <= now() then
    raise exception using errcode = '22023', message = 'Service cannot be edited.';
  end if;

  if service_row.source_name is distinct from normalized_name
    or service_row.source_description is distinct from normalized_description then
    update app.service_occurrence as service
    set source_name = normalized_name, source_description = normalized_description,
      version = service.version + 1, updated_at = clock_timestamp()
    where service.id = service_row.id returning * into service_row;
    update app.church set schedule_updated_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = church_row.id;
    insert into app.church_admin_event (church_id, actor_account_id, event_type)
    values (church_row.id, actor_id, 'service.content_updated');

    for recipient in
      select distinct affected.account_id from (
        select request.author_account_id as account_id
        from app.passenger_request as request
        where request.service_occurrence_id = service_row.id
          and request.status in ('active', 'partial', 'fulfilled', 'restore')
          and request.desired_arrival_at > now()
        union
        select offer.author_account_id
        from app.driver_offer_occurrence as offer
        where offer.service_occurrence_id = service_row.id
          and offer.status in ('active', 'full') and offer.arrival_at > now()
        union
        select response.passenger_account_id
        from app.ride_response as response
        join app.passenger_request as request on request.id = response.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select response.driver_account_id
        from app.ride_response as response
        join app.passenger_request as request on request.id = response.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = response.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and response.status in ('await_driver', 'await_passenger')
          and response.expires_at > now()
        union
        select agreement.passenger_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
        union
        select agreement.driver_account_id
        from app.ride_agreement as agreement
        join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
        join app.passenger_request as request on request.id = agreement.passenger_request_id
        join app.driver_offer_occurrence as offer on offer.id = agreement.driver_occurrence_id
        where (request.service_occurrence_id = service_row.id
          or offer.service_occurrence_id = service_row.id)
          and agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > now()
      ) as affected
    loop
      perform app.create_notification_once(
        recipient.account_id,
        'service:' || service_row.public_id::text || ':content:' || service_row.version::text,
        'church.service.updated', 'service_occurrence', service_row.public_id,
        '/trips', 'church.service.updated', '{}'::jsonb, 50
      );
    end loop;
  end if;
  result := jsonb_build_object('status', 'saved',
    'service_id', service_row.public_id, 'version', service_row.version);
  insert into private.church_operation (
    actor_account_id, operation_type, client_key, input_digest, result
  ) values (actor_id, 'update_one_off_service_content', p_client_key, input_digest, result);
  return result;
end;
$$;

revoke all on function api.preview_one_off_service_edit(uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.preview_one_off_service_edit(uuid) to authenticated;
revoke all on function api.update_one_off_service_content(uuid, text, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.update_one_off_service_content(uuid, text, text, integer, uuid)
  to authenticated;

comment on function api.update_one_off_service_content(uuid, text, text, integer, uuid) is
  'Edits future one-off service source text, preserves ride snapshots, and notifies affected participants.';
