-- Maps campaign, checkpoint E: deterministic, explainable quality matching.
--
-- Matching answers one narrow question: if this driver is already going to this church, is
-- picking up this passenger reasonably on the way? It is a recommendation, never a booking.
--
-- The design deliberately separates two costs. Every hard condition except the detour is cheap
-- and is evaluated live in SQL on each read, so a seat taken a second ago is reflected at once.
-- Only the road measurement is expensive, so only it is cached — and the cache holds place
-- references and two integers, never provider route geometry.

-- ------------------------------------------------------------------ personal block

-- The approved matching rule requires that a mutual block suppress a suggestion. The relation
-- itself is already part of the approved target model; the complaint and blocking user flows
-- remain later roadmap work and no interface is added here.
create table app.personal_block (
  id uuid primary key default gen_random_uuid(),
  blocker_account_id uuid not null references app.account (id) on delete cascade,
  blocked_account_id uuid not null references app.account (id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint personal_block_distinct check (blocker_account_id <> blocked_account_id),
  constraint personal_block_end_order check (ended_at is null or ended_at >= created_at)
);

create unique index personal_block_active
  on app.personal_block (blocker_account_id, blocked_account_id)
  where ended_at is null;

alter table app.personal_block enable row level security;
alter table app.personal_block force row level security;
revoke all on table app.personal_block from public, anon, authenticated, service_role;

-- A block hides suggestions in both directions without telling either person about it.
create function app.accounts_are_blocked(first_account uuid, second_account uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from app.personal_block as block
    where block.ended_at is null
      and (
        (block.blocker_account_id = first_account and block.blocked_account_id = second_account)
        or (block.blocker_account_id = second_account and block.blocked_account_id = first_account)
      )
  );
$$;

-- ------------------------------------------------------------------ route measurements

-- One measured leg. `via_place_id` null is the baseline departure-to-church route; a non-null
-- value is the same route through one candidate meeting place. No geometry is stored, because
-- the driver never promised to follow the road a provider computed.
create table app.route_measurement (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app.church (id) on delete cascade,
  origin_place_id uuid not null references private.user_place (id) on delete cascade,
  via_place_id uuid references private.user_place (id) on delete cascade,
  distance_m integer not null,
  duration_s integer not null,
  provider_name text not null,
  measured_at timestamptz not null default now(),
  constraint route_measurement_distance check (distance_m between 0 and 5000000),
  constraint route_measurement_duration check (duration_s between 0 and 1000000),
  constraint route_measurement_provider check (provider_name ~ '^[a-z0-9-]{1,40}$'),
  unique nulls not distinct (church_id, origin_place_id, via_place_id)
);

create index route_measurement_freshness on app.route_measurement (measured_at);

alter table app.route_measurement enable row level security;
alter table app.route_measurement force row level security;
revoke all on table app.route_measurement from public, anon, authenticated, service_role;

comment on table app.route_measurement is
  'Derived road distance and duration for one leg. Holds no provider route geometry and no coordinates: only place references and two integers.';

-- Measurements older than this are recomputed rather than trusted.
create function app.route_measurement_max_age()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 days'; $$;

-- ------------------------------------------------------------------ cheap candidate rule

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
    -- Otherwise the approved one-hour rule: the driver arrives no later than the passenger's
    -- desired time and at most one hour earlier.
    or (
      occurrence.arrival_at <= request.desired_arrival_at
      and occurrence.arrival_at >= request.desired_arrival_at - interval '1 hour'
    )
  )
  and not app.accounts_are_blocked(request.author_account_id, occurrence.author_account_id);

revoke all on table app.quality_match_candidate from public, anon, authenticated, service_role;

comment on view app.quality_match_candidate is
  'Every deterministic hard condition except the road detour, evaluated live so a seat taken a moment ago is reflected immediately.';

-- ------------------------------------------------------------------ detour evaluation

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

-- ------------------------------------------------------------------ reader

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
    where visible.within_detour
  ),
  paired as (
    select
      ranked.request_public_id,
      ranked.occurrence_public_id,
      ranked.current_role,
      min(ranked.added_distance_m) as best_added_distance_m,
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
  ) order by paired.best_added_distance_m asc, paired.arrival_at asc), '[]'::jsonb)
  from paired;
$$;

-- ------------------------------------------------------------------ measurement bridge

-- Service-role-only bridge. It returns the coordinates the application needs to ask a route
-- provider for a distance, and nothing else. It is never granted to `authenticated`, because a
-- signed-in person must not be able to read another person's exact point through it.
create function api.route_worker_pending_legs(
  p_church_id uuid default null,
  p_limit integer default 10
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with bounded as (select least(greatest(coalesce(p_limit, 10), 1), 50) as row_limit),
  needed as (
    select distinct
      evaluated.church_id,
      evaluated.origin_place_id,
      null::uuid as via_place_id
    from app.quality_match_evaluated as evaluated
    where evaluated.baseline_distance_m is null
    union
    select distinct
      evaluated.church_id,
      evaluated.origin_place_id,
      evaluated.place_id as via_place_id
    from app.quality_match_evaluated as evaluated
    where not evaluated.measured
  )
  select coalesce(jsonb_agg(leg order by leg->>'origin_place_id', leg->>'via_place_id'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'church_id', church.public_id,
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

-- Records one measured leg. It accepts only two integers and a provider name: any geometry the
-- provider returned is discarded by the application before this call.
create function api.route_worker_record_leg(
  p_church_id uuid,
  p_origin_place_id uuid,
  p_via_place_id uuid,
  p_distance_m integer,
  p_duration_s integer,
  p_provider_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  internal_church_id uuid;
  internal_origin_id uuid;
  internal_via_id uuid;
begin
  if p_distance_m is null or p_duration_s is null
    or p_distance_m not between 0 and 5000000 or p_duration_s not between 0 and 1000000
    or p_provider_name is null or p_provider_name !~ '^[a-z0-9-]{1,40}$'
  then
    raise exception using errcode = '22023', message = 'The route measurement is invalid.';
  end if;

  select church.id into internal_church_id from app.church as church where church.public_id = p_church_id;
  select place.id into internal_origin_id from private.user_place as place where place.public_id = p_origin_place_id;
  if p_via_place_id is not null then
    select place.id into internal_via_id from private.user_place as place where place.public_id = p_via_place_id;
    if internal_via_id is null then
      raise exception using errcode = 'P0002', message = 'The measured place is unavailable.';
    end if;
  end if;
  if internal_church_id is null or internal_origin_id is null then
    raise exception using errcode = 'P0002', message = 'The measured route reference is unavailable.';
  end if;

  insert into app.route_measurement (
    church_id, origin_place_id, via_place_id, distance_m, duration_s, provider_name, measured_at
  ) values (
    internal_church_id, internal_origin_id, internal_via_id, p_distance_m, p_duration_s,
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

-- ------------------------------------------------------------------ retention

create or replace function ops.expire_route_measurements(p_evaluated_at timestamptz default clock_timestamp())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from app.route_measurement
  where measured_at <= p_evaluated_at - app.route_measurement_max_age();
  get diagnostics removed = row_count;
  return jsonb_build_object('removed_measurements', removed);
end;
$$;

-- ------------------------------------------------------------------ grants

revoke all on function app.accounts_are_blocked(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app.route_measurement_max_age() from public, anon, authenticated, service_role;
revoke all on function api.list_quality_matches(uuid) from public, anon, authenticated, service_role;
revoke all on function api.route_worker_pending_legs(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function api.route_worker_record_leg(uuid, uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function ops.expire_route_measurements(timestamptz) from public, anon, authenticated, service_role;

grant execute on function api.list_quality_matches(uuid) to authenticated;
grant execute on function api.route_worker_pending_legs(uuid, integer) to service_role;
grant execute on function api.route_worker_record_leg(uuid, uuid, uuid, integer, integer, text) to service_role;

comment on function api.list_quality_matches(uuid) is
  'Suggestions for the current actor only. Explains a match with seats, a compatible place, added kilometres, and approximate added minutes; it never returns a score and never returns counterpart exact geography.';
comment on function api.route_worker_pending_legs(uuid, integer) is
  'Service-role-only bridge returning only the coordinates needed to measure a road distance for candidates that already passed every cheap condition.';
comment on function api.route_worker_record_leg(uuid, uuid, uuid, integer, integer, text) is
  'Service-role-only bridge recording only a distance, a duration, and a provider name. Provider route geometry is discarded before this call.';
comment on table app.personal_block is
  'Mutual block used by matching. The complaint and blocking user flows remain later roadmap work.';
