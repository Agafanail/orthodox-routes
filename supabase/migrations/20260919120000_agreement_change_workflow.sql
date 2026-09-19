-- Participant-proposed agreement changes keep the accepted snapshot active until the other
-- participant accepts. Acceptance swaps the immutable snapshot and capacity in one transaction.

alter table private.transport_operation
  drop constraint transport_operation_type,
  add constraint transport_operation_type check (operation_type in (
    'publish_passenger_request',
    'publish_driver_occurrence',
    'publish_driver_series',
    'cancel_passenger_request',
    'cancel_driver_occurrence',
    'stop_driver_series',
    'submit_passenger_response',
    'submit_driver_response',
    'answer_passenger_response',
    'confirm_ride_response',
    'decline_ride_response',
    'withdraw_ride_response',
    'cancel_ride_agreement',
    'restore_passenger_request',
    'propose_agreement_change',
    'resolve_agreement_change'
  ));

alter table app.agreement_event
  drop constraint agreement_event_type,
  add constraint agreement_event_type check (event_type in (
    'confirmed', 'change_proposed', 'change_accepted', 'change_declined',
    'change_expired', 'change_cancelled', 'cancelled', 'completed', 'no_outcome', 'archived'
  ));

create table app.agreement_change_proposal (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  agreement_id uuid not null references app.ride_agreement (id) on delete cascade,
  proposer_account_id uuid not null references app.account (id) on delete restrict,
  responder_account_id uuid not null references app.account (id) on delete restrict,
  proposed_snapshot_id uuid not null references app.ride_condition_snapshot (id) on delete restrict,
  proposed_driver_origin_place_id uuid not null references private.user_place (id) on delete restrict,
  state text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint agreement_change_distinct_participants check (proposer_account_id <> responder_account_id),
  constraint agreement_change_state check (state in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  constraint agreement_change_resolution check (
    (state = 'pending' and resolved_at is null) or (state <> 'pending' and resolved_at is not null)
  ),
  constraint agreement_change_expiry_order check (expires_at > created_at)
);

create unique index agreement_change_one_pending
  on app.agreement_change_proposal (agreement_id)
  where state = 'pending';

create index agreement_change_responder_pending
  on app.agreement_change_proposal (responder_account_id, expires_at)
  where state = 'pending';

alter table app.agreement_change_proposal enable row level security;
alter table app.agreement_change_proposal force row level security;
revoke all on table app.agreement_change_proposal from public, anon, authenticated, service_role;

create function app.enforce_agreement_change_proposal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  agreement app.ride_agreement%rowtype;
  snapshot app.ride_condition_snapshot%rowtype;
  origin_owner uuid;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.public_id <> old.public_id or new.agreement_id <> old.agreement_id
      or new.proposer_account_id <> old.proposer_account_id
      or new.responder_account_id <> old.responder_account_id
      or new.proposed_snapshot_id <> old.proposed_snapshot_id
      or new.proposed_driver_origin_place_id <> old.proposed_driver_origin_place_id
      or new.expires_at <> old.expires_at or new.created_at <> old.created_at
      or old.state <> 'pending' or new.state = 'pending'
    then
      raise exception using errcode = '55000', message = 'Agreement change proposals are immutable after resolution.';
    end if;
    return new;
  end if;

  select * into agreement from app.ride_agreement where id = new.agreement_id;
  select * into snapshot from app.ride_condition_snapshot where id = new.proposed_snapshot_id;
  select owner_account_id into origin_owner
  from private.user_place where id = new.proposed_driver_origin_place_id;

  if agreement.id is null or agreement.status <> 'confirmed'
    or new.proposer_account_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or new.responder_account_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or snapshot.passenger_request_id <> agreement.passenger_request_id
    or snapshot.driver_occurrence_id <> agreement.driver_occurrence_id
    or snapshot.church_id <> (select church_id from app.ride_condition_snapshot where id = agreement.active_snapshot_id)
    or not exists (
      select 1 from app.passenger_request_place as link
      where link.request_id = agreement.passenger_request_id
        and link.user_place_id = snapshot.selected_request_place_id
    )
    or origin_owner is distinct from agreement.driver_account_id
  then
    raise exception using errcode = '23514', message = 'Agreement change proposal relationships are inconsistent.';
  end if;
  return new;
end;
$$;

create trigger enforce_agreement_change_proposal
before insert or update on app.agreement_change_proposal
for each row execute function app.enforce_agreement_change_proposal();

-- Existing confirmation-time checks tied an agreement forever to its response snapshot. Updates
-- now permit only the snapshot and places from an accepted proposal; identity remains immutable.
create or replace function app.enforce_ride_agreement_relationships()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  response app.ride_response%rowtype;
  snapshot app.ride_condition_snapshot%rowtype;
  origin_owner uuid;
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id or new.public_id <> old.public_id or new.response_id <> old.response_id
    or new.driver_occurrence_id <> old.driver_occurrence_id or new.passenger_request_id <> old.passenger_request_id
    or new.driver_account_id <> old.driver_account_id or new.passenger_account_id <> old.passenger_account_id
    or new.confirmed_at <> old.confirmed_at
  ) then
    raise exception using errcode = '23514', message = 'Agreement identity and actors are immutable.';
  end if;

  select * into response from app.ride_response where id = new.response_id;
  select * into snapshot from app.ride_condition_snapshot where id = new.active_snapshot_id;
  if tg_op = 'INSERT' and new.driver_origin_place_id is null then
    select occurrence.origin_place_id into new.driver_origin_place_id
    from app.driver_offer_occurrence as occurrence
    where occurrence.id = new.driver_occurrence_id;
  end if;
  select owner_account_id into origin_owner from private.user_place where id = new.driver_origin_place_id;

  if response.status <> 'accepted'
    or response.driver_occurrence_id <> new.driver_occurrence_id
    or response.passenger_request_id <> new.passenger_request_id
    or response.driver_account_id <> new.driver_account_id
    or response.passenger_account_id <> new.passenger_account_id
    or snapshot.passenger_request_id <> new.passenger_request_id
    or snapshot.driver_occurrence_id <> new.driver_occurrence_id
    or snapshot.passenger_count <> new.confirmed_passenger_count
    or snapshot.selected_request_place_id <> new.selected_exact_place_id
    or origin_owner is distinct from new.driver_account_id
    or new.contact_visible_until > snapshot.scheduled_arrival_at + interval '30 days'
    or new.exact_data_delete_due_at > snapshot.scheduled_arrival_at + interval '30 days'
  then
    raise exception using errcode = '23514', message = 'Agreement relationships are inconsistent.';
  end if;

  if tg_op = 'INSERT' and (
    response.offered_passenger_count <> new.confirmed_passenger_count
    or response.conditions_snapshot_id <> new.active_snapshot_id
    or response.selected_request_place_id <> new.selected_exact_place_id
  ) then
    raise exception using errcode = '23514', message = 'Agreement confirmation does not match the accepted response.';
  end if;

  if tg_op = 'UPDATE' and (
    new.confirmed_passenger_count <> old.confirmed_passenger_count
    or new.active_snapshot_id <> old.active_snapshot_id
    or new.selected_exact_place_id <> old.selected_exact_place_id
    or new.driver_origin_place_id <> old.driver_origin_place_id
  ) and not exists (
    select 1 from app.agreement_change_proposal as proposal
    where proposal.agreement_id = new.id
      and proposal.state = 'accepted'
      and proposal.proposed_snapshot_id = new.active_snapshot_id
      and proposal.proposed_driver_origin_place_id = new.driver_origin_place_id
  ) then
    raise exception using errcode = '23514', message = 'Agreement conditions require an accepted proposal.';
  end if;
  return new;
end;
$$;

-- Contact visibility may move with an accepted schedule. All contact values remain immutable.
create or replace function app.enforce_agreement_contact_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  agreement app.ride_agreement%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Agreement contacts must be anonymized through lifecycle processing.';
  end if;
  select * into agreement from app.ride_agreement where id = new.agreement_id;
  if agreement.id is null
    or new.participant_account_id not in (agreement.passenger_account_id, agreement.driver_account_id)
    or new.visible_until > agreement.contact_visible_until
  then
    raise exception using errcode = '23514', message = 'Agreement contact relationships are inconsistent.';
  end if;
  if tg_op = 'UPDATE' then
    if new.agreement_id <> old.agreement_id
      or new.participant_account_id <> old.participant_account_id
      or new.email_verified_at <> old.email_verified_at or new.phone_verified_at <> old.phone_verified_at
      or new.created_at <> old.created_at or old.deleted_at is not null
      or (
        new.visible_until <> old.visible_until
        and (
          new.deleted_at is distinct from old.deleted_at
          or new.email_normalized <> old.email_normalized
          or new.phone_e164 <> old.phone_e164
          or new.visible_until <> agreement.contact_visible_until
        )
      )
      or (
        new.visible_until = old.visible_until
        and (
          new.deleted_at is distinct from old.deleted_at
          or new.email_normalized <> old.email_normalized
          or new.phone_e164 <> old.phone_e164
        )
        and (new.deleted_at is null or agreement.status <> 'archived')
      )
    then
      raise exception using errcode = '55000', message = 'Agreement contact snapshots are immutable outside controlled lifecycle updates.';
    end if;
  end if;
  return new;
end;
$$;

create function api.propose_agreement_change(
  p_agreement_id uuid,
  p_changes jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('agreement', p_agreement_id, 'changes', p_changes);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  agreement app.ride_agreement%rowtype;
  active app.ride_condition_snapshot%rowtype;
  proposed app.ride_condition_snapshot%rowtype;
  responder_id uuid;
  meeting_id uuid;
  origin_id uuid;
  proposal_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'At least one agreement change is required.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_changes) as key
    where key not in (
      'scheduled_at', 'timezone', 'meeting_place_id', 'driver_origin_place_id',
      'passenger_count', 'children_count', 'child_seat_required', 'children_allowed',
      'driver_child_seat_available', 'passenger_return_required',
      'driver_return_available', 'max_detour_km'
    )
  ) then
    raise exception using errcode = '22023', message = 'The agreement change contains an unsupported field.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':propose_agreement_change:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'propose_agreement_change', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  select * into agreement from app.ride_agreement
  where public_id = p_agreement_id for update;
  if agreement.id is null or agreement.status <> 'confirmed'
    or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id)
  then
    raise exception using errcode = 'P0002', message = 'The ride agreement is unavailable.';
  end if;
  select * into active from app.ride_condition_snapshot where id = agreement.active_snapshot_id;
  if active.scheduled_arrival_at <= clock_timestamp() then
    raise exception using errcode = 'P0002', message = 'The ride agreement is unavailable.';
  end if;
  perform app.assert_response_participants_eligible(agreement.passenger_account_id, agreement.driver_account_id);

  proposed := active;
  proposed.id := gen_random_uuid();
  proposed.created_at := clock_timestamp();
  if p_changes ? 'scheduled_at' then proposed.scheduled_arrival_at := (p_changes->>'scheduled_at')::timestamptz; end if;
  if p_changes ? 'timezone' then proposed.timezone := p_changes->>'timezone'; end if;
  if p_changes ? 'passenger_count' then proposed.passenger_count := (p_changes->>'passenger_count')::smallint; end if;
  if p_changes ? 'children_count' then proposed.children_count := (p_changes->>'children_count')::smallint; end if;
  if p_changes ? 'child_seat_required' then proposed.child_seat_required := (p_changes->>'child_seat_required')::boolean; end if;
  if p_changes ? 'children_allowed' then proposed.children_allowed := (p_changes->>'children_allowed')::boolean; end if;
  if p_changes ? 'driver_child_seat_available' then proposed.driver_child_seat_available := (p_changes->>'driver_child_seat_available')::boolean; end if;
  if p_changes ? 'passenger_return_required' then proposed.passenger_return_required := (p_changes->>'passenger_return_required')::boolean; end if;
  if p_changes ? 'driver_return_available' then proposed.driver_return_available := (p_changes->>'driver_return_available')::boolean; end if;
  if p_changes ? 'max_detour_km' then proposed.max_detour_km := (p_changes->>'max_detour_km')::smallint; end if;

  meeting_id := active.selected_request_place_id;
  if p_changes ? 'meeting_place_id' then
    select place.id into meeting_id from private.user_place as place
    join app.passenger_request_place as link on link.user_place_id = place.id
    where place.public_id = (p_changes->>'meeting_place_id')::uuid
      and link.request_id = agreement.passenger_request_id
      and place.owner_account_id = agreement.passenger_account_id;
  end if;
  origin_id := agreement.driver_origin_place_id;
  if p_changes ? 'driver_origin_place_id' then
    select place.id into origin_id from private.user_place as place
    where place.public_id = (p_changes->>'driver_origin_place_id')::uuid
      and place.owner_account_id = agreement.driver_account_id;
  end if;
  proposed.selected_request_place_id := meeting_id;

  if meeting_id is null or origin_id is null
    or proposed.scheduled_arrival_at <= clock_timestamp()
    or proposed.scheduled_arrival_at > clock_timestamp() + interval '8 weeks'
    or not exists (select 1 from pg_timezone_names where name = proposed.timezone)
    or proposed.passenger_count not between 1 and 55
    or proposed.children_count not between 0 and proposed.passenger_count
    or proposed.max_detour_km not in (0, 2, 5, 10, 15, 20)
    or (proposed.children_count > 0 and not proposed.children_allowed)
    or (proposed.child_seat_required and not proposed.driver_child_seat_available)
  then
    raise exception using errcode = '22023', message = 'The proposed agreement conditions are invalid.';
  end if;
  if proposed.passenger_count > active.passenger_count + (
    select remaining_passengers from app.passenger_request where id = agreement.passenger_request_id
  ) or proposed.passenger_count > active.passenger_count + (
    select total_seats - confirmed_seats from app.driver_offer_occurrence where id = agreement.driver_occurrence_id
  ) then
    raise exception using errcode = '22023', message = 'The proposed passenger count exceeds available capacity.';
  end if;
  if row(proposed.passenger_count, proposed.scheduled_arrival_at, proposed.timezone,
      proposed.children_count, proposed.child_seat_required, proposed.children_allowed,
      proposed.driver_child_seat_available, proposed.passenger_return_required,
      proposed.driver_return_available, proposed.max_detour_km, meeting_id, origin_id)
    is not distinct from
    row(active.passenger_count, active.scheduled_arrival_at, active.timezone,
      active.children_count, active.child_seat_required, active.children_allowed,
      active.driver_child_seat_available, active.passenger_return_required,
      active.driver_return_available, active.max_detour_km,
      active.selected_request_place_id, agreement.driver_origin_place_id)
  then
    raise exception using errcode = '22023', message = 'The proposed agreement conditions are unchanged.';
  end if;

  insert into app.ride_condition_snapshot (
    id, passenger_request_id, driver_occurrence_id, church_id, selected_request_place_id,
    passenger_count, scheduled_arrival_at, timezone, children_count, child_seat_required,
    children_allowed, driver_child_seat_available, passenger_return_required,
    driver_return_available, max_detour_km, request_content_version,
    occurrence_conditions_version, created_at
  ) values (
    proposed.id, proposed.passenger_request_id, proposed.driver_occurrence_id,
    proposed.church_id, proposed.selected_request_place_id, proposed.passenger_count,
    proposed.scheduled_arrival_at, proposed.timezone, proposed.children_count,
    proposed.child_seat_required, proposed.children_allowed,
    proposed.driver_child_seat_available, proposed.passenger_return_required,
    proposed.driver_return_available, proposed.max_detour_km,
    proposed.request_content_version, proposed.occurrence_conditions_version,
    proposed.created_at
  );
  responder_id := case when actor_id = agreement.passenger_account_id
    then agreement.driver_account_id else agreement.passenger_account_id end;
  insert into app.agreement_change_proposal (
    agreement_id, proposer_account_id, responder_account_id, proposed_snapshot_id,
    proposed_driver_origin_place_id, expires_at
  ) values (
    agreement.id, actor_id, responder_id, proposed.id, origin_id, active.scheduled_arrival_at
  ) returning public_id into proposal_public_id;
  update app.ride_agreement set status = 'change_pending' where id = agreement.id;
  insert into app.agreement_event (agreement_id, actor_account_id, event_type)
  values (agreement.id, actor_id, 'change_proposed');

  result := jsonb_build_object(
    'agreement_id', agreement.public_id, 'proposal_id', proposal_public_id,
    'status', 'change_pending', 'expires_at', active.scheduled_arrival_at
  );
  insert into private.transport_operation values (
    actor_id, 'propose_agreement_change', p_client_key, digest_value, result, now()
  );
  return result;
end;
$$;

create function api.resolve_agreement_change(
  p_proposal_id uuid,
  p_accept boolean,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.require_transport_actor();
  input jsonb := jsonb_build_object('proposal', p_proposal_id, 'accept', p_accept);
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  proposal app.agreement_change_proposal%rowtype;
  agreement app.ride_agreement%rowtype;
  active app.ride_condition_snapshot%rowtype;
  proposed app.ride_condition_snapshot%rowtype;
  request app.passenger_request%rowtype;
  occurrence app.driver_offer_occurrence%rowtype;
  capacity_delta integer;
  evaluated_at timestamptz := clock_timestamp();
  result jsonb;
begin
  if p_client_key is null or p_accept is null then
    raise exception using errcode = '22023', message = 'A decision and idempotency key are required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':resolve_agreement_change:' || p_client_key::text, 0));
  prior := app.transport_operation_result(actor_id, 'resolve_agreement_change', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  select * into proposal from app.agreement_change_proposal
  where public_id = p_proposal_id for update;
  if proposal.id is null or proposal.state <> 'pending' or proposal.responder_account_id <> actor_id then
    raise exception using errcode = 'P0002', message = 'The agreement change proposal is unavailable.';
  end if;
  select * into agreement from app.ride_agreement where id = proposal.agreement_id for update;
  select * into active from app.ride_condition_snapshot where id = agreement.active_snapshot_id;
  select * into proposed from app.ride_condition_snapshot where id = proposal.proposed_snapshot_id;

  if agreement.status <> 'change_pending' or proposal.expires_at <= evaluated_at then
    update app.agreement_change_proposal
    set state = 'expired', resolved_at = evaluated_at where id = proposal.id;
    if agreement.status = 'change_pending' then
      update app.ride_agreement set status = 'confirmed' where id = agreement.id;
    end if;
    insert into app.agreement_event (agreement_id, actor_account_id, event_type)
    values (agreement.id, actor_id, 'change_expired');
    result := jsonb_build_object('agreement_id', agreement.public_id,
      'proposal_id', proposal.public_id, 'status', 'expired');
  elsif not p_accept then
    update app.agreement_change_proposal
    set state = 'declined', resolved_at = evaluated_at where id = proposal.id;
    update app.ride_agreement set status = 'confirmed' where id = agreement.id;
    insert into app.agreement_event (agreement_id, actor_account_id, event_type)
    values (agreement.id, actor_id, 'change_declined');
    result := jsonb_build_object('agreement_id', agreement.public_id,
      'proposal_id', proposal.public_id, 'status', 'declined');
  else
    perform app.assert_response_participants_eligible(agreement.passenger_account_id, agreement.driver_account_id);
    select * into request from app.passenger_request where id = agreement.passenger_request_id for update;
    select * into occurrence from app.driver_offer_occurrence where id = agreement.driver_occurrence_id for update;
    capacity_delta := proposed.passenger_count - active.passenger_count;
    if proposed.scheduled_arrival_at <= evaluated_at
      or proposed.passenger_count > active.passenger_count + request.remaining_passengers
      or proposed.passenger_count > active.passenger_count + occurrence.total_seats - occurrence.confirmed_seats
      or request.status not in ('active', 'partial', 'fulfilled')
      or occurrence.status not in ('active', 'full')
    then
      raise exception using errcode = '23514', message = 'The proposed agreement conditions are no longer available.';
    end if;

    update app.driver_offer_occurrence
    set confirmed_seats = confirmed_seats + capacity_delta,
        status = case when confirmed_seats + capacity_delta = total_seats then 'full' else 'active' end,
        updated_at = evaluated_at
    where id = occurrence.id;
    update app.passenger_request
    set remaining_passengers = remaining_passengers - capacity_delta,
        status = case when remaining_passengers - capacity_delta = 0 then 'fulfilled' else 'partial' end,
        closed_at = null,
        updated_at = evaluated_at
    where id = request.id;

    -- The proposal must be accepted first so the agreement integrity trigger can verify the swap.
    update app.agreement_change_proposal
    set state = 'accepted', resolved_at = evaluated_at where id = proposal.id;
    update app.ride_agreement
    set confirmed_passenger_count = proposed.passenger_count,
        active_snapshot_id = proposed.id,
        selected_exact_place_id = proposed.selected_request_place_id,
        driver_origin_place_id = proposal.proposed_driver_origin_place_id,
        status = 'confirmed',
        contact_visible_until = proposed.scheduled_arrival_at + interval '30 days',
        exact_data_delete_due_at = proposed.scheduled_arrival_at + interval '30 days'
    where id = agreement.id;
    update private.agreement_contact_snapshot
    set visible_until = proposed.scheduled_arrival_at + interval '30 days'
    where agreement_id = agreement.id and deleted_at is null;
    insert into app.agreement_event (agreement_id, actor_account_id, event_type)
    values (agreement.id, actor_id, 'change_accepted');
    result := jsonb_build_object(
      'agreement_id', agreement.public_id, 'proposal_id', proposal.public_id,
      'status', 'accepted', 'confirmed_passenger_count', proposed.passenger_count
    );
  end if;

  insert into private.transport_operation values (
    actor_id, 'resolve_agreement_change', p_client_key, digest_value, result, now()
  );
  return result;
end;
$$;

create function app.close_pending_agreement_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  closed_count integer;
  event_name text;
begin
  if old.status = 'change_pending' and new.status in ('cancelled', 'completed', 'outcome', 'no_outcome', 'archived') then
    update app.agreement_change_proposal
    set state = case when new.status = 'cancelled' then 'cancelled' else 'expired' end,
        resolved_at = clock_timestamp()
    where agreement_id = new.id and state = 'pending';
    get diagnostics closed_count = row_count;
    if closed_count > 0 then
      event_name := case when new.status = 'cancelled' then 'change_cancelled' else 'change_expired' end;
      insert into app.agreement_event (agreement_id, actor_account_id, event_type)
      values (new.id, new.cancelled_by_account_id, event_name);
    end if;
  end if;
  return new;
end;
$$;

create trigger close_pending_agreement_change
after update of status on app.ride_agreement
for each row execute function app.close_pending_agreement_change();

-- Preserve the existing read model as an internal base, then annotate only participant-safe
-- proposal metadata. Exact proposed places remain exclusive to the on-demand detail RPC.
alter function api.current_my_trips() set schema app;
alter function app.current_my_trips() rename to current_my_trips_base;
revoke all on function app.current_my_trips_base() from public, anon, authenticated, service_role;

create function api.current_my_trips()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  base jsonb := app.current_my_trips_base();
  output jsonb := jsonb_build_object(
    'needs_response', '[]'::jsonb, 'upcoming', '[]'::jsonb,
    'listings', '[]'::jsonb, 'history', '[]'::jsonb
  );
  section_name text;
  target_section text;
  item jsonb;
  child jsonb;
  children jsonb;
  proposal record;
  child_action boolean;
begin
  foreach section_name in array array['needs_response', 'upcoming', 'listings', 'history'] loop
    for item in select value from jsonb_array_elements(base->section_name) loop
      target_section := section_name;
      if item->>'object_kind' = 'ride_agreement' then
        select change.public_id, change.proposer_account_id, change.responder_account_id, change.expires_at
        into proposal
        from app.agreement_change_proposal as change
        join app.ride_agreement as agreement on agreement.id = change.agreement_id
        where agreement.public_id = (item->>'object_id')::uuid and change.state = 'pending';
        if proposal.public_id is not null then
          item := item || jsonb_build_object(
            'proposal_id', proposal.public_id,
            'proposed_by_role', case when proposal.proposer_account_id = actor_id
              then item->>'current_role' else case when item->>'current_role' = 'driver' then 'passenger' else 'driver' end end,
            'awaiting_role', case when proposal.responder_account_id = actor_id
              then item->>'current_role' else case when item->>'current_role' = 'driver' then 'passenger' else 'driver' end end,
            'action_required', proposal.responder_account_id = actor_id and proposal.expires_at > current_timestamp,
            'change_expires_at', proposal.expires_at
          );
          if proposal.responder_account_id = actor_id and proposal.expires_at > current_timestamp then
            target_section := 'needs_response';
            item := jsonb_set(item, '{primary_section}', '"needs_response"'::jsonb);
          end if;
        end if;
      elsif item->>'object_kind' = 'driver_occurrence' then
        children := '[]'::jsonb;
        child_action := false;
        for child in select value from jsonb_array_elements(item#>'{children,agreements}') loop
          select change.public_id, change.proposer_account_id, change.responder_account_id, change.expires_at
          into proposal
          from app.agreement_change_proposal as change
          join app.ride_agreement as agreement on agreement.id = change.agreement_id
          where agreement.public_id = (child->>'object_id')::uuid and change.state = 'pending';
          if proposal.public_id is not null then
            child := child || jsonb_build_object(
              'proposal_id', proposal.public_id,
              'proposed_by_role', case when proposal.proposer_account_id = actor_id then 'driver' else 'passenger' end,
              'awaiting_role', case when proposal.responder_account_id = actor_id then 'driver' else 'passenger' end,
              'action_required', proposal.responder_account_id = actor_id and proposal.expires_at > current_timestamp,
              'change_expires_at', proposal.expires_at
            );
            child_action := child_action or (proposal.responder_account_id = actor_id and proposal.expires_at > current_timestamp);
          end if;
          children := children || jsonb_build_array(child);
        end loop;
        item := jsonb_set(item, '{children,agreements}', children);
        if child_action then
          target_section := 'needs_response';
          item := jsonb_set(jsonb_set(item, '{primary_section}', '"needs_response"'::jsonb),
            '{action_required}', 'true'::jsonb);
        end if;
      end if;
      output := jsonb_set(output, array[target_section], (output->target_section) || jsonb_build_array(item));
    end loop;
  end loop;
  return output;
end;
$$;

create or replace function api.get_my_trip_details(p_agreement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  agreement app.ride_agreement%rowtype;
  detail_visible boolean;
  result jsonb;
begin
  select * into agreement from app.ride_agreement where public_id = p_agreement_id;
  if agreement.id is null or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id) then
    return null;
  end if;
  detail_visible := agreement.status in ('confirmed', 'change_pending', 'completed', 'outcome', 'no_outcome')
    and clock_timestamp() < agreement.exact_data_delete_due_at;

  select jsonb_build_object(
    'agreement_id', agreement.public_id,
    'status', agreement.status,
    'current_role', case when actor_id = agreement.driver_account_id then 'driver' else 'passenger' end,
    'scheduled_at', snapshot.scheduled_arrival_at,
    'timezone', snapshot.timezone,
    'church', jsonb_build_object(
      'church_id', church.public_id, 'slug', church.slug, 'official_name', church.official_name,
      'locality', church.locality, 'country_code', church.country_code
    ),
    'counterparty', jsonb_build_object(
      'name', counterparty.display_name,
      'role', case when actor_id = agreement.driver_account_id then 'passenger' else 'driver' end
    ),
    'counts', jsonb_build_object(
      'confirmed_passenger_count', snapshot.passenger_count,
      'remaining_passengers', case when detail_visible then request.remaining_passengers else null end
    ),
    'meeting_area', meeting.public_area_name,
    'cancelled_by_role', case
      when agreement.cancelled_by_account_id = agreement.driver_account_id then 'driver'
      when agreement.cancelled_by_account_id = agreement.passenger_account_id then 'passenger'
      else null end,
    'conditions', case when detail_visible then jsonb_build_object(
      'children_count', snapshot.children_count, 'child_seat_required', snapshot.child_seat_required,
      'children_allowed', snapshot.children_allowed,
      'driver_child_seat_available', snapshot.driver_child_seat_available,
      'passenger_return_required', snapshot.passenger_return_required,
      'driver_return_available', snapshot.driver_return_available,
      'max_detour_km', snapshot.max_detour_km
    ) else null end,
    'change', case when detail_visible and change.id is not null then jsonb_build_object(
      'proposal_id', change.public_id,
      'proposed_by_role', case when change.proposer_account_id = agreement.driver_account_id then 'driver' else 'passenger' end,
      'awaiting_role', case when change.responder_account_id = agreement.driver_account_id then 'driver' else 'passenger' end,
      'action_required', change.responder_account_id = actor_id and change.expires_at > clock_timestamp(),
      'expires_at', change.expires_at,
      'scheduled_at', proposed.scheduled_arrival_at,
      'timezone', proposed.timezone,
      'counts', jsonb_build_object('confirmed_passenger_count', proposed.passenger_count),
      'conditions', jsonb_build_object(
        'children_count', proposed.children_count, 'child_seat_required', proposed.child_seat_required,
        'children_allowed', proposed.children_allowed,
        'driver_child_seat_available', proposed.driver_child_seat_available,
        'passenger_return_required', proposed.passenger_return_required,
        'driver_return_available', proposed.driver_return_available,
        'max_detour_km', proposed.max_detour_km
      ),
      'places', jsonb_build_object(
        'meeting_place', app.exact_place_shape(proposed_meeting.*),
        'departure_place', app.exact_place_shape(proposed_origin.*)
      )
    ) else null end,
    'contacts', api.get_agreement_contacts(agreement.public_id),
    'places', api.get_agreement_exact_place(agreement.public_id)
  ) into result
  from app.ride_condition_snapshot as snapshot
  join app.church as church on church.id = snapshot.church_id
  join app.passenger_request as request on request.id = agreement.passenger_request_id
  join app.account as counterparty on counterparty.id = case
    when actor_id = agreement.driver_account_id then agreement.passenger_account_id
    else agreement.driver_account_id end
  join private.user_place as meeting on meeting.id = agreement.selected_exact_place_id
  left join app.agreement_change_proposal as change
    on change.agreement_id = agreement.id and change.state = 'pending'
  left join app.ride_condition_snapshot as proposed on proposed.id = change.proposed_snapshot_id
  left join private.user_place as proposed_meeting on proposed_meeting.id = proposed.selected_request_place_id
  left join private.user_place as proposed_origin on proposed_origin.id = change.proposed_driver_origin_place_id
  where snapshot.id = agreement.active_snapshot_id;
  return result;
end;
$$;

revoke all on function app.enforce_agreement_change_proposal() from public, anon, authenticated, service_role;
revoke all on function app.enforce_ride_agreement_relationships() from public, anon, authenticated, service_role;
revoke all on function app.enforce_agreement_contact_snapshot() from public, anon, authenticated, service_role;
revoke all on function app.close_pending_agreement_change() from public, anon, authenticated, service_role;
revoke all on function app.current_my_trips_base() from public, anon, authenticated, service_role;
revoke all on function api.propose_agreement_change(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function api.resolve_agreement_change(uuid, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function api.current_my_trips() from public, anon, authenticated, service_role;
revoke all on function api.get_my_trip_details(uuid) from public, anon, authenticated, service_role;
grant execute on function api.propose_agreement_change(uuid, jsonb, uuid) to authenticated;
grant execute on function api.resolve_agreement_change(uuid, boolean, uuid) to authenticated;
grant execute on function api.current_my_trips() to authenticated;
grant execute on function api.get_my_trip_details(uuid) to authenticated;

comment on table app.agreement_change_proposal is
  'One participant-proposed immutable agreement snapshot awaiting the other participant decision.';
comment on function api.propose_agreement_change(uuid, jsonb, uuid) is
  'Proposes participant-visible agreement conditions while leaving the active snapshot and capacity unchanged.';
comment on function api.resolve_agreement_change(uuid, boolean, uuid) is
  'Lets only the designated counterparty accept or decline a pending agreement change atomically.';
comment on function api.current_my_trips() is
  'Returns account-scoped My Trips with participant-safe pending-change action metadata.';
comment on function api.get_my_trip_details(uuid) is
  'Returns participant-only accepted and pending agreement details with bounded disclosure.';
