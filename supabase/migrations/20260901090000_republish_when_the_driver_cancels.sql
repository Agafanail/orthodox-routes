-- The passenger's request comes back on its own when the driver is the one who withdraws.
--
-- Until now every cancellation left the request waiting for the passenger to press «Опубликовать
-- снова». That is right when the passenger cancelled: they said they no longer need the ride, and
-- assuming otherwise would put a request back that nobody wants.
--
-- It is wrong when the driver cancelled. The passenger still needs to get to the church, may not
-- have noticed the withdrawal yet, and every hour their request sits closed is an hour other
-- drivers cannot offer to help. So a driver's cancellation puts the existing request back on the
-- board itself.
--
-- Three things stay as they are. No second request is created — the original one is restored, with
-- all its conditions, places and history. The cancelled agreement stays cancelled and its contacts
-- and exact places stay closed. And nothing is republished once the desired arrival has passed,
-- using the same expiry the rest of the domain already uses.

create or replace function app.cancel_ride_agreement_internal(
  requested_agreement_id uuid,
  cancelling_actor_id uuid,
  evaluated_at timestamptz
)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  agreement app.ride_agreement%rowtype;
  request app.passenger_request%rowtype;
  occurrence app.driver_offer_occurrence%rowtype;
  driver_withdrew boolean;
begin
  select * into agreement from app.ride_agreement where id = requested_agreement_id for update;
  if agreement.id is null or cancelling_actor_id not in (agreement.passenger_account_id, agreement.driver_account_id) then
    return false;
  end if;
  -- An already cancelled agreement returns false, so a second call changes nothing: no request is
  -- restored twice and no capacity is returned twice.
  if agreement.status = 'cancelled' then return false; end if;
  if agreement.status not in ('confirmed', 'change_pending') then return false; end if;
  select * into occurrence from app.driver_offer_occurrence where id = agreement.driver_occurrence_id for update;
  select * into request from app.passenger_request where id = agreement.passenger_request_id for update;

  -- Who ended it decides whether the request goes back by itself. The two accounts are always
  -- different, because a person cannot answer their own publication.
  driver_withdrew := cancelling_actor_id = agreement.driver_account_id;

  update app.ride_agreement set status = 'cancelled', cancelled_at = evaluated_at,
    cancelled_by_account_id = cancelling_actor_id where id = agreement.id;
  update app.driver_offer_occurrence
  set confirmed_seats = confirmed_seats - agreement.confirmed_passenger_count,
      status = case
        when status = 'cancelled' then 'cancelled'
        when arrival_at <= evaluated_at then 'completed'
        when confirmed_seats - agreement.confirmed_passenger_count = total_seats then 'full'
        else 'active'
      end,
      updated_at = evaluated_at
  where id = occurrence.id and confirmed_seats >= agreement.confirmed_passenger_count;
  if not found then
    raise exception using errcode = '23514', message = 'Agreement capacity cannot be returned safely.';
  end if;

  if request.status in ('active', 'partial') then
    -- Part of the group was still looking, so the request is already on the board either way.
    update app.passenger_request
    set remaining_passengers = least(total_passengers, remaining_passengers + agreement.confirmed_passenger_count),
        status = case
          when remaining_passengers + agreement.confirmed_passenger_count >= total_passengers then 'active'
          else 'partial'
        end,
        updated_at = evaluated_at
    where id = request.id;
  elsif request.status in ('fulfilled', 'restore') then
    update app.passenger_request
    set remaining_passengers = least(total_passengers, remaining_passengers + agreement.confirmed_passenger_count),
        status = case
          -- The moment has passed; nothing is republished, whoever cancelled.
          when desired_arrival_at <= evaluated_at then 'expired'
          -- The driver withdrew and the passenger still needs the ride they asked for.
          when driver_withdrew then case
            when remaining_passengers + agreement.confirmed_passenger_count >= total_passengers then 'active'
            else 'partial'
          end
          -- The passenger withdrew. Their own «Опубликовать снова» stays the only way back.
          else 'restore'
        end,
        closed_at = case when desired_arrival_at <= evaluated_at then evaluated_at else null end,
        updated_at = evaluated_at
    where id = request.id;
  end if;
  insert into app.agreement_event (agreement_id, actor_account_id, event_type)
  values (agreement.id, cancelling_actor_id, 'cancelled');
  return true;
end;
$$;

-- The passenger has to be told which of the two things happened, and by whom, so the projection
-- now says which side ended it. Only a name and a role: nothing about the cancelled agreement's
-- contacts or exact places is reopened by this.
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
    'cancelled_at', agreement.cancelled_at,
    'cancelled_by_role', case
      when agreement.cancelled_by_account_id = agreement.driver_account_id then 'driver'
      when agreement.cancelled_by_account_id = agreement.passenger_account_id then 'passenger'
      else null
    end
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
