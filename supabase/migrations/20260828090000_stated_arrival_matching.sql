-- Maps campaign: time compatibility judged on the arrival the driver stated.
--
-- The previous migration added the pickup detour to the driver's planned arrival before deciding
-- time. The owner has withdrawn that: a stated arrival is a target the driver commits to, and a
-- driver who needs longer to collect someone is expected to leave earlier. Adding the detour
-- treated the target as if it were a departure, which it is not.
--
-- The approved rule is therefore a direct comparison of two stated times:
--
--   the driver matches when their stated church arrival falls from sixty minutes before to
--   thirty minutes after the passenger's desired arrival, inclusive.
--
-- A passenger wanting 12:30 is suited by a driver stating 11:40 and not by one stating 13:30.
-- Two people who chose the same service occurrence remain compatible by definition.
--
-- The road measurement keeps both of its other jobs: it decides whether a pickup fits the
-- driver's approved added kilometres, and it supplies the approximate added minutes shown to
-- people. Those minutes are an explanation only and decide nothing.
--
-- This restores the shape the matching chain had before the detour was folded in. Time is once
-- again settled entirely by the cheap filter, before a single provider call is made, so no
-- candidate is measured for a slot it could never fill. The window bounds keep their named
-- functions, because the approved numbers deserve one readable home.

drop function if exists api.list_quality_matches(uuid);
drop view if exists app.quality_match_evaluated;
drop view if exists app.quality_match_candidate;

-- The detour allowance existed only to stop the cheap filter discarding candidates that a
-- measurement might rescue on the early side. Nothing can rescue a stated time, so it goes —
-- after the view that referenced it, which is what held it in place.
drop function if exists app.max_detour_duration(integer);

-- Every hard condition except the detour. Each one is deterministic and explainable; there is
-- no score, no weighting, and no learned model anywhere in this file.
create view app.quality_match_candidate
with (security_invoker = false) as
select
  request.id as request_id,
  request.public_id as request_public_id,
  request.author_account_id as passenger_account_id,
  occurrence.id as occurrence_id,
  occurrence.public_id as occurrence_public_id,
  occurrence.author_account_id as driver_account_id,
  occurrence.church_id,
  occurrence.origin_place_id,
  occurrence.max_detour_km,
  request.remaining_passengers,
  occurrence.total_seats - occurrence.confirmed_seats as available_seats,
  request.desired_arrival_at,
  occurrence.arrival_at,
  occurrence.departure_at,
  occurrence.timezone
from app.passenger_request as request
join app.driver_offer_occurrence as occurrence
  on occurrence.church_id = request.church_id
where request.status in ('active', 'partial')
  and request.remaining_passengers > 0
  and request.desired_arrival_at > clock_timestamp()
  and occurrence.status = 'active'
  and occurrence.arrival_at > clock_timestamp()
  and occurrence.total_seats > occurrence.confirmed_seats
  and request.author_account_id <> occurrence.author_account_id
  -- Enough seats for the passenger's entire remaining group. A driver with fewer seats is not
  -- an automatic suggestion; a partial arrangement stays possible by hand through the board.
  and occurrence.total_seats - occurrence.confirmed_seats >= request.remaining_passengers
  -- Children and the child seat are structured conditions, not free-text guesses.
  and (request.children_count = 0 or occurrence.children_allowed)
  and (not request.child_seat_required or occurrence.driver_child_seat_available)
  and (
    -- The same service occurrence passes time compatibility by definition.
    (
      request.service_occurrence_id is not null
      and request.service_occurrence_id = occurrence.service_occurrence_id
    )
    -- Otherwise the approved window, compared against the time the driver actually stated.
    -- Both edges are inclusive. Nothing about the pickup enters this decision: the stated
    -- arrival is a target, and a driver needing longer to collect someone leaves earlier.
    or occurrence.arrival_at between
      request.desired_arrival_at - app.arrival_window_earliest()
      and request.desired_arrival_at + app.arrival_window_latest()
  )
  and not app.accounts_are_blocked(request.author_account_id, occurrence.author_account_id);

revoke all on table app.quality_match_candidate from public, anon, authenticated, service_role;

comment on view app.quality_match_candidate is
  'Every deterministic hard condition except the road detour, evaluated live so a seat taken a moment ago is reflected immediately.';

-- Joins each candidate to its cached measurements and derives the added distance and time.
-- A missing measurement leaves the verdict unestablished; it never becomes a negative claim.
create view app.quality_match_evaluated
with (security_invoker = false) as
select
  candidate.*,
  link.position as place_position,
  link.user_place_id as place_id,
  place.public_id as place_public_id,
  place.public_area_name,
  baseline.distance_m as baseline_distance_m,
  baseline.duration_s as baseline_duration_s,
  detour.distance_m - baseline.distance_m as added_distance_m,
  -- Shown to people as an approximate explanation of the detour. It is not a condition: the
  -- driver adjusts their own departure to keep the arrival they stated.
  detour.duration_s - baseline.duration_s as added_duration_s,
  (baseline.id is not null and detour.id is not null) as measured,
  (
    baseline.id is not null and detour.id is not null
    and detour.distance_m - baseline.distance_m <= candidate.max_detour_km * 1000
  ) as within_detour
from app.quality_match_candidate as candidate
join app.passenger_request_place as link on link.request_id = candidate.request_id
join private.user_place as place on place.id = link.user_place_id
left join app.route_measurement as baseline
  on baseline.church_id = candidate.church_id
 and baseline.origin_place_id = candidate.origin_place_id
 and baseline.via_place_id is null
 and baseline.measured_at > clock_timestamp() - app.route_measurement_max_age()
left join app.route_measurement as detour
  on detour.church_id = candidate.church_id
 and detour.origin_place_id = candidate.origin_place_id
 and detour.via_place_id = link.user_place_id
 and detour.measured_at > clock_timestamp() - app.route_measurement_max_age();

revoke all on table app.quality_match_evaluated from public, anon, authenticated, service_role;

comment on view app.quality_match_evaluated is
  'Each candidate meeting point with its measured detour in kilometres and the approximate minutes shown alongside it.';

-- What one person sees about their own suggestions. The counterpart is described only by data
-- that is already public: a safe name, capacity, structured conditions, and an approximate
-- area. Added kilometres and approximate minutes are concrete explanations, never a score.
create function api.list_quality_matches(p_church_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id),
  visible as (
    select evaluated.*,
      case when evaluated.passenger_account_id = actor.id then 'passenger' else 'driver' end as current_role
    from app.quality_match_evaluated as evaluated, actor
    where actor.id in (evaluated.passenger_account_id, evaluated.driver_account_id)
      and (p_church_id is null or evaluated.church_id = (
        select church.id from app.church as church where church.public_id = p_church_id
      ))
  ),
  ranked as (
    select visible.*,
      row_number() over (
        partition by visible.request_id, visible.occurrence_id
        order by visible.added_distance_m asc, visible.added_duration_s asc, visible.place_position asc
      ) as place_rank
    from visible
    -- The detour in kilometres is the only condition left to apply here; time was already
    -- settled before any road was measured.
    where visible.within_detour
  ),
  paired as (
    select
      ranked.request_public_id,
      ranked.occurrence_public_id,
      ranked.current_role,
      min(ranked.added_distance_m) as best_added_distance_m,
      min(ranked.added_duration_s) as best_added_duration_s,
      min(ranked.remaining_passengers) as remaining_passengers,
      min(ranked.available_seats) as available_seats,
      min(ranked.arrival_at) as arrival_at,
      min(ranked.departure_at) as departure_at,
      min(ranked.timezone) as timezone,
      jsonb_agg(jsonb_build_object(
        'place_id', ranked.place_public_id,
        'public_area_label', ranked.public_area_name,
        'position', ranked.place_position,
        'added_distance_m', ranked.added_distance_m,
        'added_duration_s', ranked.added_duration_s,
        'best', ranked.place_rank = 1
      ) order by ranked.place_rank) as places
    from ranked
    group by ranked.request_public_id, ranked.occurrence_public_id, ranked.current_role
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', paired.request_public_id,
    'occurrence_id', paired.occurrence_public_id,
    'current_role', paired.current_role,
    'passenger_count', paired.remaining_passengers,
    'available_seats', paired.available_seats,
    'departure_at', paired.departure_at,
    'arrival_at', paired.arrival_at,
    'timezone', paired.timezone,
    'added_distance_m', paired.best_added_distance_m,
    'added_duration_s', (paired.places -> 0 ->> 'added_duration_s')::integer,
    'places', paired.places
  -- Smallest added road distance first. Added estimated time is only a tie-break, never a
  -- condition of its own, and arrival time settles a remaining tie so the order is stable.
  ) order by paired.best_added_distance_m asc, paired.best_added_duration_s asc, paired.arrival_at asc), '[]'::jsonb)
  from paired;
$$;

revoke all on function api.list_quality_matches(uuid) from public, anon, authenticated, service_role;
grant execute on function api.list_quality_matches(uuid) to authenticated;

comment on function api.list_quality_matches(uuid) is
  'Suggestions for the signed-in person: every meeting point within the approved detour, smallest first, for drivers whose stated arrival falls inside the approved window.';
