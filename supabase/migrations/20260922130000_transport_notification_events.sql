-- Authoritative transport transitions create notification history and delivery jobs in the same
-- transaction. Scheduled reminders use deterministic keys so an hourly scheduler is replay-safe.

alter table app.notification
  add column deduplication_key text,
  add constraint notification_deduplication_key check (
    deduplication_key is null
    or (
      char_length(deduplication_key) between 8 and 200
      and deduplication_key ~ '^[a-z][a-z0-9:_.-]+$'
    )
  );

create unique index notification_recipient_deduplication
  on app.notification (recipient_account_id, deduplication_key)
  where deduplication_key is not null;

create function app.create_notification_once(
  requested_recipient uuid,
  requested_deduplication_key text,
  requested_event_type text,
  requested_object_type text,
  requested_object_public_id uuid,
  requested_safe_route text,
  requested_localization_key text,
  requested_safe_parameters jsonb default '{}'::jsonb,
  requested_priority integer default 50,
  requested_outcome text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  existing_public_id uuid;
begin
  if requested_deduplication_key is null
    or char_length(requested_deduplication_key) not between 8 and 200
    or requested_deduplication_key !~ '^[a-z][a-z0-9:_.-]+$'
  then
    raise exception using errcode = '22023', message = 'Notification deduplication key is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    requested_recipient::text || ':notification:' || requested_deduplication_key, 0
  ));
  select notification.public_id into existing_public_id
  from app.notification as notification
  where notification.recipient_account_id = requested_recipient
    and notification.deduplication_key = requested_deduplication_key;
  if existing_public_id is not null then return existing_public_id; end if;

  existing_public_id := app.create_notification(
    requested_recipient, requested_event_type, requested_object_type,
    requested_object_public_id, requested_safe_route, requested_localization_key,
    requested_safe_parameters, requested_priority
  );
  update app.notification
  set deduplication_key = requested_deduplication_key,
      current_outcome_reference = requested_outcome
  where public_id = existing_public_id;
  return existing_public_id;
end;
$$;

create function app.notify_ride_response_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recipient_id uuid;
  event_name text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'await_driver' then
      recipient_id := new.driver_account_id;
      event_name := 'ride.response.received';
    elsif new.status = 'await_passenger' then
      recipient_id := new.passenger_account_id;
      event_name := 'ride.response.received';
    end if;
  elsif old.status is distinct from new.status then
    update app.notification
    set current_outcome_reference = new.status
    where object_type = 'ride_response' and object_public_id = new.public_id;

    if old.status = 'await_driver' and new.status = 'await_passenger' then
      recipient_id := new.passenger_account_id;
      event_name := 'ride.counteroffer.received';
    elsif new.status = 'declined' then
      recipient_id := case when old.status = 'await_driver'
        then new.passenger_account_id else new.driver_account_id end;
      event_name := 'ride.response.declined';
    elsif new.status = 'withdrawn' then
      recipient_id := case when old.status = 'await_driver'
        then new.driver_account_id else new.passenger_account_id end;
      event_name := 'ride.response.withdrawn';
    end if;
  end if;

  if recipient_id is not null and event_name is not null then
    perform app.create_notification_once(
      recipient_id,
      'ride_response:' || new.public_id::text || ':' || new.status,
      event_name, 'ride_response', new.public_id, '/trips',
      'notifications.' || replace(event_name, '.', '_'), '{}'::jsonb, 70, new.status
    );
  end if;
  return new;
end;
$$;

create trigger notify_ride_response_transition
after insert or update of status on app.ride_response
for each row execute function app.notify_ride_response_transition();

create function app.notify_ride_agreement_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recipient_id uuid;
begin
  if tg_op = 'INSERT' then
    perform app.create_notification_once(
      new.passenger_account_id, 'ride_agreement:' || new.public_id::text || ':confirmed:passenger',
      'ride.confirmed', 'ride_agreement', new.public_id, '/trips',
      'notifications.ride_confirmed', '{}'::jsonb, 90, new.status
    );
    perform app.create_notification_once(
      new.driver_account_id, 'ride_agreement:' || new.public_id::text || ':confirmed:driver',
      'ride.confirmed', 'ride_agreement', new.public_id, '/trips',
      'notifications.ride_confirmed', '{}'::jsonb, 90, new.status
    );
  elsif old.status is distinct from new.status then
    update app.notification
    set current_outcome_reference = new.status
    where object_type = 'ride_agreement' and object_public_id = new.public_id;

    if new.status = 'cancelled' and old.status in ('confirmed', 'change_pending') then
      recipient_id := case when new.cancelled_by_account_id = new.driver_account_id
        then new.passenger_account_id else new.driver_account_id end;
      perform app.create_notification_once(
        recipient_id, 'ride_agreement:' || new.public_id::text || ':cancelled',
        'ride.cancelled', 'ride_agreement', new.public_id, '/trips',
        'notifications.ride_cancelled', '{}'::jsonb, 100, new.status
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger notify_ride_agreement_transition
after insert or update of status on app.ride_agreement
for each row execute function app.notify_ride_agreement_transition();

create function app.notify_agreement_change_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' and new.state = 'pending' then
    perform app.create_notification_once(
      new.responder_account_id, 'agreement_change:' || new.public_id::text || ':pending',
      'ride.change.proposed', 'agreement_change', new.public_id, '/trips',
      'notifications.ride_change_proposed', '{}'::jsonb, 90, new.state
    );
  elsif tg_op = 'UPDATE' and old.state = 'pending' and new.state <> 'pending' then
    update app.notification
    set current_outcome_reference = new.state
    where object_type = 'agreement_change' and object_public_id = new.public_id;
    event_name := 'ride.change.' || new.state;
    perform app.create_notification_once(
      new.proposer_account_id, 'agreement_change:' || new.public_id::text || ':' || new.state,
      event_name, 'agreement_change', new.public_id, '/trips',
      'notifications.' || replace(event_name, '.', '_'), '{}'::jsonb,
      case when new.state = 'accepted' then 90 else 80 end, new.state
    );
  end if;
  return new;
end;
$$;

create trigger notify_agreement_change_transition
after insert or update of state on app.agreement_change_proposal
for each row execute function app.notify_agreement_change_transition();

create function ops.enqueue_scheduled_transport_notifications(
  p_evaluated_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  agreement_row record;
  quality_match record;
  series record;
  match_count integer := 0;
  reminder_count integer := 0;
  outcome_count integer := 0;
  series_count integer := 0;
begin
  if p_evaluated_at is null then
    raise exception using errcode = '22023', message = 'The notification schedule time is required.';
  end if;

  for quality_match in
    select distinct evaluated.request_public_id, evaluated.occurrence_public_id,
      evaluated.passenger_account_id, evaluated.driver_account_id
    from app.quality_match_evaluated as evaluated
    where evaluated.within_detour
      and not exists (
        select 1 from app.ride_response as response
        where response.passenger_request_id = evaluated.request_id
          and response.driver_occurrence_id = evaluated.occurrence_id
      )
  loop
    perform app.create_notification_once(
      quality_match.passenger_account_id,
      'quality_match:' || quality_match.request_public_id::text || ':'
        || quality_match.occurrence_public_id::text || ':passenger',
      'ride.quality_match', 'quality_match', quality_match.request_public_id, '/trips',
      'notifications.ride_quality_match', jsonb_build_object(
        'request_id', quality_match.request_public_id,
        'occurrence_id', quality_match.occurrence_public_id
      ), 40, 'available'
    );
    perform app.create_notification_once(
      quality_match.driver_account_id,
      'quality_match:' || quality_match.request_public_id::text || ':'
        || quality_match.occurrence_public_id::text || ':driver',
      'ride.quality_match', 'quality_match', quality_match.occurrence_public_id, '/trips',
      'notifications.ride_quality_match', jsonb_build_object(
        'request_id', quality_match.request_public_id,
        'occurrence_id', quality_match.occurrence_public_id
      ), 40, 'available'
    );
    match_count := match_count + 2;
  end loop;

  for agreement_row in
    select ride_agreement.public_id, ride_agreement.passenger_account_id,
      ride_agreement.driver_account_id
    from app.ride_agreement as ride_agreement
    join app.driver_offer_occurrence as occurrence
      on occurrence.id = ride_agreement.driver_occurrence_id
    where ride_agreement.status in ('confirmed', 'change_pending')
      and occurrence.arrival_at > p_evaluated_at
      and occurrence.arrival_at <= p_evaluated_at + interval '24 hours'
  loop
    perform app.create_notification_once(
      agreement_row.passenger_account_id,
      'ride_agreement:' || agreement_row.public_id::text || ':reminder24h:passenger',
      'ride.reminder', 'ride_agreement', agreement_row.public_id, '/trips',
      'notifications.ride_reminder', '{}'::jsonb, 60, 'upcoming'
    );
    perform app.create_notification_once(
      agreement_row.driver_account_id,
      'ride_agreement:' || agreement_row.public_id::text || ':reminder24h:driver',
      'ride.reminder', 'ride_agreement', agreement_row.public_id, '/trips',
      'notifications.ride_reminder', '{}'::jsonb, 60, 'upcoming'
    );
    reminder_count := reminder_count + 2;
  end loop;

  for agreement_row in
    select ride_agreement.public_id, ride_agreement.passenger_account_id,
      ride_agreement.driver_account_id
    from app.ride_agreement as ride_agreement
    join app.driver_offer_occurrence as occurrence
      on occurrence.id = ride_agreement.driver_occurrence_id
    where ride_agreement.status in ('confirmed', 'change_pending', 'completed')
      and occurrence.arrival_at <= p_evaluated_at
  loop
    perform app.create_notification_once(
      agreement_row.passenger_account_id,
      'ride_agreement:' || agreement_row.public_id::text || ':outcome:passenger',
      'ride.outcome_requested', 'ride_agreement', agreement_row.public_id, '/trips',
      'notifications.ride_outcome_requested', '{}'::jsonb, 50, 'awaiting_outcome'
    );
    perform app.create_notification_once(
      agreement_row.driver_account_id,
      'ride_agreement:' || agreement_row.public_id::text || ':outcome:driver',
      'ride.outcome_requested', 'ride_agreement', agreement_row.public_id, '/trips',
      'notifications.ride_outcome_requested', '{}'::jsonb, 50, 'awaiting_outcome'
    );
    outcome_count := outcome_count + 2;
  end loop;

  for series in
    select offer.public_id, offer.author_account_id
    from app.driver_offer_series as offer
    where offer.status in ('active', 'ended')
      and offer.ends_on <= (p_evaluated_at at time zone offer.timezone)::date
  loop
    perform app.create_notification_once(
      series.author_account_id, 'driver_series:' || series.public_id::text || ':ended',
      'driver.series.ended', 'driver_series', series.public_id, '/trips',
      'notifications.driver_series_ended', '{}'::jsonb, 50, 'ended'
    );
    series_count := series_count + 1;
  end loop;

  return jsonb_build_object(
    'quality_match_recipients', match_count,
    'ride_reminder_recipients', reminder_count,
    'outcome_request_recipients', outcome_count,
    'series_expirations', series_count
  );
end;
$$;

create function api.notification_worker_enqueue_scheduled(
  p_evaluated_at timestamptz default clock_timestamp()
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enqueue_scheduled_transport_notifications(p_evaluated_at);
$$;

revoke all on function app.create_notification_once(uuid, text, text, text, uuid, text, text, jsonb, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function app.notify_ride_response_transition() from public, anon, authenticated, service_role;
revoke all on function app.notify_ride_agreement_transition() from public, anon, authenticated, service_role;
revoke all on function app.notify_agreement_change_transition() from public, anon, authenticated, service_role;
revoke all on function ops.enqueue_scheduled_transport_notifications(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function api.notification_worker_enqueue_scheduled(timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function api.notification_worker_enqueue_scheduled(timestamptz) to service_role;
