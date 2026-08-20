create function api.transport_church_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'church_id', church.public_id,
    'slug', church.slug,
    'official_name', church.official_name,
    'address', church.address_display,
    'locality', church.locality,
    'country_code', church.country_code,
    'timezone', church.timezone
  )
  from app.church as church
  where church.slug = p_slug and church.status = 'published';
$$;

create or replace function api.current_ride_responses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'response_id', response.public_id,
    'direction', response.direction,
    'status', response.status,
    'current_role', case when actor.id = response.passenger_account_id then 'passenger' else 'driver' end,
    'request_id', request.public_id,
    'occurrence_id', occurrence.public_id,
    'passenger_name', passenger.display_name,
    'driver_name', driver.display_name,
    'offered_passenger_count', response.offered_passenger_count,
    'selected_place', case when response.selected_request_place_id is null then null else jsonb_build_object(
      'place_id', place.public_id, 'public_area_label', place.public_area_label
    ) end,
    'expires_at', response.expires_at,
    'updated_at', response.updated_at
  ) order by response.updated_at desc), '[]'::jsonb)
  from app.ride_response as response
  join app.passenger_request as request on request.id = response.passenger_request_id
  join app.driver_offer_occurrence as occurrence on occurrence.id = response.driver_occurrence_id
  join app.account as passenger on passenger.id = response.passenger_account_id
  join app.account as driver on driver.id = response.driver_account_id
  left join private.user_place as place on place.id = response.selected_request_place_id,
  actor
  where actor.id in (response.passenger_account_id, response.driver_account_id);
$$;

create or replace function api.current_ride_agreements()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select coalesce(jsonb_agg(jsonb_build_object(
    'agreement_id', agreement.public_id,
    'status', agreement.status,
    'current_role', case when actor.id = agreement.passenger_account_id then 'passenger' else 'driver' end,
    'request_id', request.public_id,
    'occurrence_id', occurrence.public_id,
    'passenger_name', passenger.display_name,
    'driver_name', driver.display_name,
    'confirmed_passenger_count', agreement.confirmed_passenger_count,
    'scheduled_arrival_at', snapshot.scheduled_arrival_at,
    'timezone', snapshot.timezone,
    'contact_available', agreement.status in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
      and clock_timestamp() < agreement.contact_visible_until,
    'confirmed_at', agreement.confirmed_at,
    'cancelled_at', agreement.cancelled_at
  ) order by agreement.confirmed_at desc), '[]'::jsonb)
  from app.ride_agreement as agreement
  join app.passenger_request as request on request.id = agreement.passenger_request_id
  join app.driver_offer_occurrence as occurrence on occurrence.id = agreement.driver_occurrence_id
  join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
  join app.account as passenger on passenger.id = agreement.passenger_account_id
  join app.account as driver on driver.id = agreement.driver_account_id,
  actor
  where actor.id in (agreement.passenger_account_id, agreement.driver_account_id);
$$;

create function api.publish_contextual_passenger_response(
  p_occurrence_id uuid,
  p_church_id uuid,
  p_service_occurrence_id uuid,
  p_desired_arrival_at timestamptz,
  p_timezone text,
  p_total_passengers integer,
  p_children_count integer,
  p_child_seat_required boolean,
  p_return_required boolean,
  p_public_note text,
  p_places jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_result jsonb;
begin
  request_result := api.publish_passenger_request(
    p_church_id, p_service_occurrence_id, p_desired_arrival_at, p_timezone,
    p_total_passengers, p_children_count, p_child_seat_required, p_return_required,
    p_public_note, p_places, p_client_key
  );
  return api.submit_passenger_response(
    (request_result->>'request_id')::uuid,
    p_occurrence_id,
    p_client_key
  );
end;
$$;

create function api.publish_contextual_driver_response(
  p_request_id uuid,
  p_place_id uuid,
  p_offered_passenger_count integer,
  p_church_id uuid,
  p_service_occurrence_id uuid,
  p_departure_at timestamptz,
  p_arrival_at timestamptz,
  p_timezone text,
  p_total_seats integer,
  p_max_detour_km integer,
  p_children_allowed boolean,
  p_driver_child_seat_available boolean,
  p_return_available boolean,
  p_public_note text,
  p_exact_origin_label text,
  p_public_origin_area text,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  occurrence_result jsonb;
begin
  occurrence_result := api.publish_driver_occurrence(
    p_church_id, p_service_occurrence_id, p_departure_at, p_arrival_at, p_timezone,
    p_total_seats, p_max_detour_km, p_children_allowed, p_driver_child_seat_available,
    p_return_available, p_public_note, p_exact_origin_label, p_public_origin_area, p_client_key
  );
  return api.submit_driver_response(
    p_request_id,
    (occurrence_result->>'occurrence_id')::uuid,
    p_place_id,
    p_offered_passenger_count,
    p_client_key
  );
end;
$$;

create function api.complete_contextual_transport_draft(
  p_draft_id uuid,
  p_result_type text,
  p_result_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  draft private.contextual_draft%rowtype;
  result_owned boolean := false;
begin
  select * into draft
  from private.contextual_draft
  where public_id = p_draft_id
    and auth_user_id = actor_id
    and account_id = actor_id
    and state = 'claimed'
    and expires_at > clock_timestamp()
  for update;

  if draft.id is null then
    raise exception using errcode = 'P0002', message = 'The contextual draft is unavailable.';
  end if;

  if draft.action_type = 'passenger_request' and p_result_type = 'passenger_request' then
    select exists (
      select 1 from app.passenger_request as request
      where request.public_id = p_result_id and request.author_account_id = actor_id
    ) into result_owned;
  elsif draft.action_type = 'driver_offer' and p_result_type = 'driver_occurrence' then
    select exists (
      select 1 from app.driver_offer_occurrence as occurrence
      where occurrence.public_id = p_result_id and occurrence.author_account_id = actor_id
    ) into result_owned;
  elsif draft.action_type = 'driver_offer' and p_result_type = 'driver_series' then
    select exists (
      select 1 from app.driver_offer_series as series
      where series.public_id = p_result_id and series.author_account_id = actor_id
    ) into result_owned;
  elsif draft.action_type = 'ride_response' and p_result_type = 'ride_response' then
    select exists (
      select 1 from app.ride_response as response
      join private.transport_operation as operation
        on operation.actor_account_id = actor_id
       and operation.client_key = draft.public_id
       and operation.operation_type in ('submit_passenger_response', 'submit_driver_response')
       and operation.result->>'response_id' = response.public_id::text
      where response.public_id = p_result_id
        and actor_id in (response.passenger_account_id, response.driver_account_id)
    ) into result_owned;
  end if;

  if not result_owned or not app.complete_contextual_draft(actor_id, draft.id, p_result_type, p_result_id) then
    raise exception using errcode = '42501', message = 'The contextual publication result is unavailable.';
  end if;

  return jsonb_build_object(
    'draft_id', p_draft_id,
    'result_type', p_result_type,
    'result_id', p_result_id,
    'status', 'completed'
  );
end;
$$;

revoke all on function api.transport_church_by_slug(text) from public, anon, authenticated, service_role;
revoke all on function api.complete_contextual_transport_draft(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.transport_church_by_slug(text) to anon, authenticated;
grant execute on function api.complete_contextual_transport_draft(uuid, text, uuid) to authenticated;
grant execute on function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) to authenticated;
grant execute on function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid) to authenticated;

comment on function api.transport_church_by_slug(text) is 'Safe published church identity required to bind the Core application to server-owned transport state.';
comment on function api.complete_contextual_transport_draft(uuid, text, uuid) is 'Marks an owned claimed Core transport draft complete only after verifying the actor owns the referenced published result.';
comment on function api.publish_contextual_passenger_response(uuid, uuid, uuid, timestamptz, text, integer, integer, boolean, boolean, text, jsonb, uuid) is 'Atomically publishes the current passenger source and sends the response begun before registration.';
comment on function api.publish_contextual_driver_response(uuid, uuid, integer, uuid, uuid, timestamptz, timestamptz, text, integer, integer, boolean, boolean, boolean, text, text, text, uuid) is 'Atomically publishes the current driver source and sends the response begun before registration.';
