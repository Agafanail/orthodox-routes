alter table private.transport_operation drop constraint transport_operation_type;
alter table private.transport_operation add constraint transport_operation_type check (operation_type in (
  'publish_passenger_request', 'publish_driver_occurrence', 'publish_driver_series',
  'cancel_passenger_request', 'cancel_driver_occurrence', 'stop_driver_series',
  'submit_passenger_response', 'submit_driver_response', 'answer_passenger_response',
  'confirm_ride_response', 'decline_ride_response', 'withdraw_ride_response',
  'cancel_ride_agreement', 'restore_passenger_request',
  'propose_agreement_change', 'resolve_agreement_change', 'set_ride_counterparty_block'
));

create function app.ride_interaction_counterparty(
  p_actor_id uuid, p_interaction_type text, p_interaction_id uuid
)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  counterpart_id uuid;
begin
  if p_actor_id is null or p_interaction_id is null
    or p_interaction_type is null or p_interaction_type not in ('response', 'agreement') then
    raise exception using errcode = '22023', message = 'The interaction reference is invalid.';
  end if;
  if p_interaction_type = 'response' then
    select case when response.passenger_account_id = p_actor_id then response.driver_account_id
      else response.passenger_account_id end into counterpart_id
    from app.ride_response as response
    where response.public_id = p_interaction_id and response.status <> 'draft'
      and p_actor_id in (response.passenger_account_id, response.driver_account_id);
  else
    select case when agreement.passenger_account_id = p_actor_id then agreement.driver_account_id
      else agreement.passenger_account_id end into counterpart_id
    from app.ride_agreement as agreement
    where agreement.public_id = p_interaction_id
      and p_actor_id in (agreement.passenger_account_id, agreement.driver_account_id);
  end if;
  if counterpart_id is null then
    raise exception using errcode = 'P0002', message = 'The interaction is unavailable.';
  end if;
  return counterpart_id;
end;
$$;

create function api.my_ride_counterparty_block(p_interaction_type text, p_interaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  counterpart_id uuid := app.ride_interaction_counterparty(actor_id, p_interaction_type, p_interaction_id);
begin
  return jsonb_build_object('blocked', exists (
    select 1 from app.personal_block as block where block.blocker_account_id = actor_id
      and block.blocked_account_id = counterpart_id and block.ended_at is null
  ));
end;
$$;

create function api.set_ride_counterparty_block(
  p_interaction_type text, p_interaction_id uuid, p_blocked boolean, p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  counterpart_id uuid;
  digest_value text := app.transport_input_digest(jsonb_build_object(
    'interaction_type', p_interaction_type, 'interaction_id', p_interaction_id, 'blocked', p_blocked
  ));
  prior jsonb;
  result jsonb;
begin
  if p_blocked is null or p_client_key is null then
    raise exception using errcode = '22023', message = 'A complete block action is required.';
  end if;
  -- Confirmed-user authority is required, but no new external notification channel/commitment.
  if not coalesce((app.current_eligibility_result(actor_id)->>'eligible')::boolean, false) then
    raise exception using errcode = '42501', message = 'Current participation eligibility is required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    actor_id::text || ':set_ride_counterparty_block:' || p_client_key::text, 0
  ));
  prior := app.transport_operation_result(actor_id, 'set_ride_counterparty_block', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  counterpart_id := app.ride_interaction_counterparty(actor_id, p_interaction_type, p_interaction_id);
  perform app.lock_personal_block_pair(actor_id, counterpart_id);
  if p_blocked then
    insert into app.personal_block (blocker_account_id, blocked_account_id)
    values (actor_id, counterpart_id)
    on conflict (blocker_account_id, blocked_account_id) where ended_at is null do nothing;
  else
    update app.personal_block set ended_at = clock_timestamp()
    where blocker_account_id = actor_id and blocked_account_id = counterpart_id and ended_at is null;
  end if;
  result := jsonb_build_object('blocked', p_blocked);
  insert into private.transport_operation values (
    actor_id, 'set_ride_counterparty_block', p_client_key, digest_value, result, now()
  );
  return result;
end;
$$;

revoke all on function app.ride_interaction_counterparty(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.my_ride_counterparty_block(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.set_ride_counterparty_block(text, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.my_ride_counterparty_block(text, uuid) to authenticated;
grant execute on function api.set_ride_counterparty_block(text, uuid, boolean, uuid) to authenticated;
comment on function api.set_ride_counterparty_block(text, uuid, boolean, uuid) is
  'Actor-derived, interaction-scoped private block state with idempotent retries and future-commitment protection.';
