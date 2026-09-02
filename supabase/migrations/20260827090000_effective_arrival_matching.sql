-- Maps campaign: time compatibility measured at the church, after the pickup detour.
--
-- The approved rule changed. Previously a driver had to arrive no later than the passenger's
-- desired time, and the added minutes of the pickup detour were shown to people but decided
-- nothing. Both halves of that were wrong in practice: a driver arriving a few minutes late is
-- usually still useful, and a driver who looks perfectly timed can become useless once the
-- detour to collect this passenger is counted.
--
-- Time compatibility is now judged on the arrival the passenger actually experiences:
--
--   effective arrival = the driver's planned church arrival + the added minutes for the
--                       meeting point being considered
--
-- and a meeting point is time-compatible when that effective arrival is no more than an hour
-- earlier and no more than half an hour later than the passenger's desired arrival. Two people
-- who chose the same service occurrence are compatible by definition, exactly as before.
--
-- Because each meeting point carries its own detour, the window is decided per point. One point
-- can fail on time while another passes, and only the passing ones are offered.

-- ------------------------------------------------------------------ the approved window

-- How far before the passenger's desired arrival a driver may reach the church and still suit
-- them. Arriving early costs the passenger waiting time, which is why the allowance is wide.
create function app.arrival_window_earliest()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '60 minutes'; $$;

-- How far after it. Arriving late risks the service itself, which is why this side is tighter.
create function app.arrival_window_latest()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 minutes'; $$;

-- The longest a detour within the driver's own approved kilometre limit could plausibly take.
--
-- This is used only to keep the cheap prefilter from discarding a candidate that a measurement
-- would have rescued, never to decide a verdict. It therefore errs generously: five minutes per
-- kilometre is roughly twelve kilometres an hour, slower than dense city traffic, so a real
-- detour will always fit inside it. A driver who allows no detour gets no allowance.
create function app.max_detour_duration(max_detour_km integer)
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '5 minutes' * greatest(coalesce(max_detour_km, 0), 0); $$;

comment on function app.arrival_window_earliest() is
  'Approved rule: effective church arrival may precede the passenger''s desired arrival by at most this.';
comment on function app.arrival_window_latest() is
  'Approved rule: effective church arrival may follow the passenger''s desired arrival by at most this.';
comment on function app.max_detour_duration(integer) is
  'A deliberately generous upper bound on detour time, used only to widen the cheap prefilter.';

-- ------------------------------------------------------------------ rebuild the chain

drop function if exists api.list_quality_matches(uuid);
drop view if exists app.quality_match_evaluated;
drop view if exists app.quality_match_candidate;

-- Every hard condition except the detour and the final time window. Each one is deterministic
-- and explainable; there is no score, no weighting, and no learned model anywhere in this file.
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
  occurrence.timezone,
  -- Carried forward so the final stage can apply the window to custom times only.
  (
    request.service_occurrence_id is not null
    and request.service_occurrence_id = occurrence.service_occurrence_id
  ) as same_service
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
    -- Custom times cannot be decided here, because the decision needs the pickup detour and
    -- nothing has been measured yet. This stage only removes what no measurement could rescue.
    or (
      -- A detour only ever delays the driver, so an occurrence already past the late edge can
      -- never come back inside the window. Rejecting it here costs nothing and saves a call.
      occurrence.arrival_at <= request.desired_arrival_at + app.arrival_window_latest()
      -- On the early side the detour is precisely what can bring a driver into range, so the
      -- edge is pushed out by the longest detour this driver's own limit could take. Anything
      -- kept here is still judged properly once the road is measured.
      and occurrence.arrival_at >= request.desired_arrival_at
        - app.arrival_window_earliest()
        - app.max_detour_duration(occurrence.max_detour_km)
    )
  )
  and not app.accounts_are_blocked(request.author_account_id, occurrence.author_account_id);

revoke all on table app.quality_match_candidate from public, anon, authenticated, service_role;

comment on view app.quality_match_candidate is
  'Every deterministic hard condition except the road detour and the final arrival window, evaluated live so a seat taken a moment ago is reflected immediately.';

-- Joins each candidate to its cached measurements, then decides both remaining conditions per
-- meeting point: the detour in kilometres, and the arrival the passenger actually experiences.
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
  detour.duration_s - baseline.duration_s as added_duration_s,
  -- What the passenger actually experiences: the driver's planned arrival plus the time this
  -- particular pickup adds. Null until both legs are measured.
  candidate.arrival_at + make_interval(secs => detour.duration_s - baseline.duration_s)
    as effective_arrival_at,
  (baseline.id is not null and detour.id is not null) as measured,
  (
    baseline.id is not null and detour.id is not null
    and detour.distance_m - baseline.distance_m <= candidate.max_detour_km * 1000
  ) as within_detour,
  (
    -- The same service needs no window; the two people already chose one moment together.
    candidate.same_service
    or (
      baseline.id is not null and detour.id is not null
      and candidate.arrival_at + make_interval(secs => detour.duration_s - baseline.duration_s)
        between candidate.desired_arrival_at - app.arrival_window_earliest()
            and candidate.desired_arrival_at + app.arrival_window_latest()
    )
  ) as within_time
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
  'Each candidate meeting point with its measured detour and the church arrival the passenger would actually experience.';

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
    -- A meeting point is offered only when it satisfies both remaining conditions: the driver's
    -- approved detour in kilometres, and the arrival window measured after that detour.
    where visible.within_detour and visible.within_time
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

revoke all on function app.arrival_window_earliest() from public, anon, authenticated, service_role;
revoke all on function app.arrival_window_latest() from public, anon, authenticated, service_role;
revoke all on function app.max_detour_duration(integer) from public, anon, authenticated, service_role;
revoke all on function api.list_quality_matches(uuid) from public, anon, authenticated, service_role;
grant execute on function api.list_quality_matches(uuid) to authenticated;

comment on function api.list_quality_matches(uuid) is
  'Suggestions for the signed-in person: every meeting point that fits both the approved detour and the approved arrival window, smallest detour first.';
