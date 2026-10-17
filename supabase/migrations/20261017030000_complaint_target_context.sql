-- Read-only context for a future complaint form. This neither submits nor verifies a complaint.
create or replace function api.complaint_target_context(p_target_type text, p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  available boolean := false;
  categories text[];
begin
  if p_target_type is null or p_target_id is null then return null; end if;
  if p_target_type = 'church' then
    select exists (select 1 from app.church as church
      where church.public_id = p_target_id and church.status = 'published') into available;
    categories := array['incorrect_information', 'duplicate', 'not_orthodox_or_missing',
      'rights_infringement', 'dangerous_or_illegal', 'other']::text[];
  elsif p_target_type = 'passenger_request' then
    select exists (select 1 from app.passenger_request as request
      join app.church as church on church.id = request.church_id
      where request.public_id = p_target_id and (
        (church.status = 'published' and request.status in ('active', 'partial')
          and request.remaining_passengers > 0 and request.desired_arrival_at > clock_timestamp())
        or (request.author_account_id = actor_id and request.status not in ('draft', 'verification')
          and request.desired_arrival_at + interval '30 days' > clock_timestamp())
      )) into available;
  elsif p_target_type = 'driver_occurrence' then
    select exists (select 1 from app.driver_offer_occurrence as occurrence
      join app.church as church on church.id = occurrence.church_id
      where occurrence.public_id = p_target_id and (
        (church.status = 'published' and occurrence.status = 'active'
          and occurrence.total_seats > occurrence.confirmed_seats and occurrence.arrival_at > clock_timestamp())
        or (occurrence.author_account_id = actor_id and occurrence.status not in ('draft', 'verification')
          and occurrence.arrival_at + interval '30 days' > clock_timestamp())
      )) into available;
  elsif p_target_type = 'ride_agreement' then
    -- Reporting has its own 30-day window; contact closure or longer safe history cannot extend it.
    select exists (select 1 from app.ride_agreement as agreement
      join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
      where agreement.public_id = p_target_id
        and actor_id in (agreement.passenger_account_id, agreement.driver_account_id)
        and snapshot.scheduled_arrival_at + interval '30 days' > clock_timestamp()) into available;
    categories := array['no_show', 'dangerous_behavior', 'unwanted_contact', 'money_or_fraud', 'other']::text[];
  else
    return null;
  end if;
  if not available then return null; end if;
  if categories is null then
    categories := array['public_private_details', 'paid_transport', 'spam_or_fraud',
      'harassment_or_danger', 'false_ride_information', 'other']::text[];
  end if;
  return jsonb_build_object('schema_version', 1, 'target_type', p_target_type,
    'target_id', p_target_id, 'categories', categories);
end;
$$;
revoke all on function api.complaint_target_context(text, uuid) from public, anon, authenticated, service_role;
grant execute on function api.complaint_target_context(text, uuid) to anon, authenticated;
comment on function api.complaint_target_context(text, uuid) is
  'Minimal existing-visibility complaint context; no private payload, submission, email verification, or moderation effect.';
