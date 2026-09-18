-- Explicit, participant-only detail read for an existing agreement. Never use this RPC to
-- prefetch a list: it composes the existing on-demand contact and exact-place boundaries.
-- No proposal author can be inferred from change_pending; its workflow remains separate.
create function api.get_my_trip_details(p_agreement_id uuid)
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
  select * into agreement
  from app.ride_agreement where public_id = p_agreement_id;
  if agreement.id is null
    or actor_id not in (agreement.passenger_account_id, agreement.driver_account_id)
  then
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
      'church_id', church.public_id,
      'slug', church.slug,
      'official_name', church.official_name,
      'locality', church.locality,
      'country_code', church.country_code
    ),
    'counterparty', jsonb_build_object(
      'name', counterparty.display_name,
      'role', case when actor_id = agreement.driver_account_id then 'passenger' else 'driver' end
    ),
    'counts', jsonb_build_object(
      'confirmed_passenger_count', snapshot.passenger_count,
      -- This is current unfilled need, not part of the immutable accepted conditions.
      'remaining_passengers', case when detail_visible then request.remaining_passengers else null end
    ),
    'meeting_area', meeting.public_area_name,
    'cancelled_by_role', case
      when agreement.cancelled_by_account_id = agreement.driver_account_id then 'driver'
      when agreement.cancelled_by_account_id = agreement.passenger_account_id then 'passenger'
      else null
    end,
    'conditions', case when detail_visible then jsonb_build_object(
      'children_count', snapshot.children_count,
      'child_seat_required', snapshot.child_seat_required,
      'children_allowed', snapshot.children_allowed,
      'driver_child_seat_available', snapshot.driver_child_seat_available,
      'passenger_return_required', snapshot.passenger_return_required,
      'driver_return_available', snapshot.driver_return_available,
      'max_detour_km', snapshot.max_detour_km
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
  where snapshot.id = agreement.active_snapshot_id;

  return result;
end;
$$;

revoke all on function api.get_my_trip_details(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_my_trip_details(uuid) to authenticated;

comment on function api.get_my_trip_details(uuid) is
  'On-demand participant agreement details from accepted conditions, with existing bounded disclosure; never for list prefetch.';
