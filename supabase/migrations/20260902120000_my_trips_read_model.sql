-- Account-scoped My Trips is a read boundary over the existing transport domain.
-- It deliberately adds no lifecycle or mutation workflow. In particular, the current schema can
-- store change_pending but cannot identify which participant must answer a proposed change, so
-- those agreements stay upcoming without claiming that the current actor must act.
-- Read-time response expiry removes pending actions before lifecycle cleanup without changing
-- stored statuses. Driver responses may offer fewer seats than the passenger initially requested.

create index passenger_request_author_timeline
  on app.passenger_request (author_account_id, desired_arrival_at desc);

create index driver_occurrence_author_timeline
  on app.driver_offer_occurrence (author_account_id, arrival_at desc);

create index driver_series_author_timeline
  on app.driver_offer_series (author_account_id, created_at desc);

create function api.current_my_trips()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select app.current_actor_id() as id
  ),
  driver_response_children as (
    select
      response.driver_occurrence_id,
      count(*) filter (where response.status <> 'accepted')::integer as response_count,
      count(*) filter (where response.status in ('await_driver', 'await_passenger')
        and timing.is_future)::integer as pending_response_count,
      count(*) filter (where
        response.status = 'await_driver'
        and timing.is_future
        and request.status in ('active', 'partial')
        and request.remaining_passengers > 0
        and occurrence.status = 'active'
        and occurrence.total_seats > occurrence.confirmed_seats
      )::integer as action_required_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'object_id', response.public_id,
        'object_kind', 'ride_response',
        'current_role', 'driver',
        'status', response.status,
        'action_required', response.status = 'await_driver'
          and timing.is_future
          and request.status in ('active', 'partial')
          and request.remaining_passengers > 0
          and occurrence.status = 'active'
          and occurrence.total_seats > occurrence.confirmed_seats,
        'direction', response.direction,
        'counterparty_name', passenger.display_name,
        'offered_passenger_count', response.offered_passenger_count,
        'updated_at', response.updated_at
      ) order by response.updated_at desc, response.public_id)
        filter (where response.status <> 'accepted'), '[]'::jsonb) as responses
    from app.ride_response as response
    join app.account as passenger on passenger.id = response.passenger_account_id
    join app.passenger_request as request on request.id = response.passenger_request_id
    join app.driver_offer_occurrence as occurrence on occurrence.id = response.driver_occurrence_id
    join app.ride_condition_snapshot as snapshot on snapshot.id = response.conditions_snapshot_id
    cross join lateral (
      select least(response.expires_at, snapshot.scheduled_arrival_at,
        request.desired_arrival_at, occurrence.arrival_at) > current_timestamp as is_future
    ) as timing
    cross join actor
    where response.driver_account_id = actor.id
    group by response.driver_occurrence_id
  ),
  driver_agreement_children as (
    select
      agreement.driver_occurrence_id,
      count(*)::integer as agreement_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'object_id', agreement.public_id,
        'object_kind', 'ride_agreement',
        'current_role', 'driver',
        'status', agreement.status,
        'action_required', false,
        'counterparty_name', passenger.display_name,
        'confirmed_passenger_count', agreement.confirmed_passenger_count,
        'scheduled_at', snapshot.scheduled_arrival_at,
        'cancelled_by_role', case
          when agreement.cancelled_by_account_id = agreement.driver_account_id then 'driver'
          when agreement.cancelled_by_account_id = agreement.passenger_account_id then 'passenger'
          else null
        end
      ) order by snapshot.scheduled_arrival_at, agreement.public_id), '[]'::jsonb) as agreements,
      bool_or(
        agreement.status in ('confirmed', 'change_pending')
        and snapshot.scheduled_arrival_at > current_timestamp
      ) as has_upcoming_agreement
    from app.ride_agreement as agreement
    join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
    join app.account as passenger on passenger.id = agreement.passenger_account_id
    cross join actor
    where agreement.driver_account_id = actor.id
    group by agreement.driver_occurrence_id
  ),
  passenger_request_items as (
    select
      case
        when request.status in ('cancelled', 'expired') or request.desired_arrival_at <= current_timestamp then 'history'
        else 'listings'
      end as primary_section,
      'passenger_request'::text as object_kind,
      request.public_id as object_id,
      request.desired_arrival_at as sort_at,
      jsonb_build_object(
        'object_id', request.public_id,
        'object_kind', 'passenger_request',
        'primary_section', case
          when request.status in ('cancelled', 'expired') or request.desired_arrival_at <= current_timestamp then 'history'
          else 'listings'
        end,
        'current_role', 'passenger',
        'status', request.status,
        'action_required', false,
        'scheduled_at', request.desired_arrival_at,
        'timezone', request.timezone,
        'church', jsonb_build_object(
          'church_id', church.public_id,
          'slug', church.slug,
          'official_name', church.official_name,
          'locality', church.locality,
          'country_code', church.country_code
        ),
        'counts', jsonb_build_object(
          'total_passengers', request.total_passengers,
          'remaining_passengers', request.remaining_passengers
        )
      ) as item
    from app.passenger_request as request
    join app.church as church on church.id = request.church_id
    cross join actor
    where request.author_account_id = actor.id
      and request.status <> 'fulfilled'
  ),
  passenger_response_items as (
    select
      case
        when response.status in ('declined', 'withdrawn', 'expired', 'stale')
          or not timing.is_future then 'history'
        when response.status = 'await_passenger' then 'needs_response'
        else 'listings'
      end as primary_section,
      'ride_response'::text as object_kind,
      response.public_id as object_id,
      snapshot.scheduled_arrival_at as sort_at,
      jsonb_build_object(
        'object_id', response.public_id,
        'object_kind', 'ride_response',
        'primary_section', case
          when response.status in ('declined', 'withdrawn', 'expired', 'stale')
            or not timing.is_future then 'history'
          when response.status = 'await_passenger' then 'needs_response'
          else 'listings'
        end,
        'current_role', 'passenger',
        'status', response.status,
        'action_required', response.status = 'await_passenger' and timing.is_future,
        'scheduled_at', snapshot.scheduled_arrival_at,
        'timezone', snapshot.timezone,
        'church', jsonb_build_object(
          'church_id', church.public_id,
          'slug', church.slug,
          'official_name', church.official_name,
          'locality', church.locality,
          'country_code', church.country_code
        ),
        'counterparty_name', driver.display_name,
        'source_ids', jsonb_build_object(
          'request_id', request.public_id,
          'occurrence_id', occurrence.public_id
        ),
        'counts', jsonb_build_object(
          'offered_passenger_count', response.offered_passenger_count
        )
      ) as item
    from app.ride_response as response
    join app.ride_condition_snapshot as snapshot on snapshot.id = response.conditions_snapshot_id
    join app.passenger_request as request on request.id = response.passenger_request_id
    join app.driver_offer_occurrence as occurrence on occurrence.id = response.driver_occurrence_id
    join app.church as church on church.id = snapshot.church_id
    join app.account as driver on driver.id = response.driver_account_id
    cross join lateral (
      select least(response.expires_at, snapshot.scheduled_arrival_at,
        request.desired_arrival_at, occurrence.arrival_at) > current_timestamp as is_future
    ) as timing
    cross join actor
    where response.passenger_account_id = actor.id
      and response.status <> 'accepted'
  ),
  passenger_agreement_items as (
    select
      case
        when agreement.status in ('confirmed', 'change_pending')
          and snapshot.scheduled_arrival_at > current_timestamp then 'upcoming'
        else 'history'
      end as primary_section,
      'ride_agreement'::text as object_kind,
      agreement.public_id as object_id,
      snapshot.scheduled_arrival_at as sort_at,
      jsonb_build_object(
        'object_id', agreement.public_id,
        'object_kind', 'ride_agreement',
        'primary_section', case
          when agreement.status in ('confirmed', 'change_pending')
            and snapshot.scheduled_arrival_at > current_timestamp then 'upcoming'
          else 'history'
        end,
        'current_role', 'passenger',
        'status', agreement.status,
        'action_required', false,
        'scheduled_at', snapshot.scheduled_arrival_at,
        'timezone', snapshot.timezone,
        'church', jsonb_build_object(
          'church_id', church.public_id,
          'slug', church.slug,
          'official_name', church.official_name,
          'locality', church.locality,
          'country_code', church.country_code
        ),
        'counterparty_name', driver.display_name,
        'source_ids', jsonb_build_object(
          'request_id', request.public_id,
          'occurrence_id', occurrence.public_id
        ),
        'counts', jsonb_build_object(
          'confirmed_passenger_count', agreement.confirmed_passenger_count
        ),
        'cancelled_by_role', case
          when agreement.cancelled_by_account_id = agreement.driver_account_id then 'driver'
          when agreement.cancelled_by_account_id = agreement.passenger_account_id then 'passenger'
          else null
        end
      ) as item
    from app.ride_agreement as agreement
    join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
    join app.passenger_request as request on request.id = agreement.passenger_request_id
    join app.driver_offer_occurrence as occurrence on occurrence.id = agreement.driver_occurrence_id
    join app.church as church on church.id = snapshot.church_id
    join app.account as driver on driver.id = agreement.driver_account_id
    cross join actor
    where agreement.passenger_account_id = actor.id
  ),
  driver_occurrence_items as (
    select
      case
        when occurrence.status in ('cancelled', 'completed', 'expired')
          or occurrence.arrival_at <= current_timestamp then 'history'
        when coalesce(response_children.action_required_count, 0) > 0 then 'needs_response'
        when coalesce(agreement_children.has_upcoming_agreement, false) then 'upcoming'
        else 'listings'
      end as primary_section,
      'driver_occurrence'::text as object_kind,
      occurrence.public_id as object_id,
      occurrence.arrival_at as sort_at,
      jsonb_build_object(
        'object_id', occurrence.public_id,
        'object_kind', 'driver_occurrence',
        'primary_section', case
          when occurrence.status in ('cancelled', 'completed', 'expired')
            or occurrence.arrival_at <= current_timestamp then 'history'
          when coalesce(response_children.action_required_count, 0) > 0 then 'needs_response'
          when coalesce(agreement_children.has_upcoming_agreement, false) then 'upcoming'
          else 'listings'
        end,
        'current_role', 'driver',
        'status', occurrence.status,
        'action_required', occurrence.status not in ('cancelled', 'completed', 'expired')
          and occurrence.arrival_at > current_timestamp
          and coalesce(response_children.action_required_count, 0) > 0,
        'scheduled_at', occurrence.arrival_at,
        'timezone', occurrence.timezone,
        'church', jsonb_build_object(
          'church_id', church.public_id,
          'slug', church.slug,
          'official_name', church.official_name,
          'locality', church.locality,
          'country_code', church.country_code
        ),
        'series_id', series.public_id,
        'counts', jsonb_build_object(
          'total_seats', occurrence.total_seats,
          'confirmed_seats', occurrence.confirmed_seats,
          'available_seats', occurrence.total_seats - occurrence.confirmed_seats,
          'response_count', coalesce(response_children.response_count, 0),
          'pending_response_count', coalesce(response_children.pending_response_count, 0),
          'action_required_count', coalesce(response_children.action_required_count, 0),
          'agreement_count', coalesce(agreement_children.agreement_count, 0)
        ),
        'children', jsonb_build_object(
          'responses', coalesce(response_children.responses, '[]'::jsonb),
          'agreements', coalesce(agreement_children.agreements, '[]'::jsonb)
        )
      ) as item
    from app.driver_offer_occurrence as occurrence
    join app.church as church on church.id = occurrence.church_id
    left join app.driver_offer_series as series on series.id = occurrence.series_id
    left join driver_response_children as response_children
      on response_children.driver_occurrence_id = occurrence.id
    left join driver_agreement_children as agreement_children
      on agreement_children.driver_occurrence_id = occurrence.id
    cross join actor
    where occurrence.author_account_id = actor.id
  ),
  driver_series_items as (
    select
      case when series.status in ('stopped', 'ended')
        or series.ends_on < (current_timestamp at time zone series.timezone)::date
        then 'history' else 'listings' end as primary_section,
      'driver_series'::text as object_kind,
      series.public_id as object_id,
      series.ends_on::timestamp at time zone series.timezone as sort_at,
      jsonb_build_object(
        'object_id', series.public_id,
        'object_kind', 'driver_series',
        'primary_section', case when series.status in ('stopped', 'ended')
          or series.ends_on < (current_timestamp at time zone series.timezone)::date
          then 'history' else 'listings' end,
        'current_role', 'driver',
        'status', series.status,
        'action_required', false,
        'scheduled_at', null,
        'timezone', series.timezone,
        'starts_on', series.starts_on,
        'ends_on', series.ends_on,
        'church', jsonb_build_object(
          'church_id', church.public_id,
          'slug', church.slug,
          'official_name', church.official_name,
          'locality', church.locality,
          'country_code', church.country_code
        ),
        'counts', jsonb_build_object(
          'occurrence_count', count(occurrence.id)::integer,
          'active_occurrence_count', count(occurrence.id)
            filter (where occurrence.status in ('active', 'full') and occurrence.arrival_at > current_timestamp)::integer
        )
      ) as item
    from app.driver_offer_series as series
    join app.church as church on church.id = series.church_id
    left join app.driver_offer_occurrence as occurrence on occurrence.series_id = series.id
    cross join actor
    where series.author_account_id = actor.id
    group by series.id, church.id
  ),
  all_items as (
    select * from passenger_request_items
    union all select * from passenger_response_items
    union all select * from passenger_agreement_items
    union all select * from driver_occurrence_items
    union all select * from driver_series_items
  )
  select jsonb_build_object(
    'needs_response', coalesce((
      select jsonb_agg(item order by sort_at, object_kind, object_id)
      from all_items where primary_section = 'needs_response'
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(item order by sort_at, object_kind, object_id)
      from all_items where primary_section = 'upcoming'
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(item order by sort_at nulls last, object_kind, object_id)
      from all_items where primary_section = 'listings'
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(item order by sort_at desc nulls last, object_kind, object_id)
      from all_items where primary_section = 'history'
    ), '[]'::jsonb)
  );
$$;

revoke all on function api.current_my_trips() from public, anon, authenticated, service_role;
grant execute on function api.current_my_trips() to authenticated;

comment on function api.current_my_trips() is
  'Returns the authenticated account My Trips projection with one primary section per top-level object and aggregated driver occurrences.';
