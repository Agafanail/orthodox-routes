create function api.export_current_account_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  legal_acceptances jsonb;
  notifications jsonb;
  places jsonb;
  push_subscriptions jsonb;
begin
  if not exists (
    select 1 from app.account as account
    where account.id = actor_id and account.status in ('active', 'restricted')
  ) then
    raise exception using errcode = 'P0002', message = 'Application account is unavailable.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_type', document.document_type,
    'version', document.version,
    'acceptance_type', acceptance.acceptance_type,
    'accepted_at', acceptance.accepted_at,
    'evidence_language', acceptance.evidence_language,
    'privacy_policy_version', privacy_document.version
  ) order by acceptance.accepted_at, document.document_type, document.version), '[]'::jsonb)
  into legal_acceptances
  from app.legal_acceptance as acceptance
  join app.legal_document_version as document on document.id = acceptance.document_version_id
  left join app.legal_document_version as privacy_document
    on privacy_document.id = acceptance.privacy_document_version_id
  where acceptance.account_id = actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'notification_id', notification.public_id,
    'event_type', notification.event_type,
    'object_type', notification.object_type,
    'object_id', notification.object_public_id,
    'safe_route', notification.safe_route,
    'localization_key', notification.localization_key,
    'parameters', notification.safe_parameters,
    'current_outcome', notification.current_outcome_reference,
    'read_at', notification.read_at,
    'created_at', notification.created_at,
    'deliveries', coalesce(delivery.items, '[]'::jsonb)
  ) order by notification.created_at, notification.public_id), '[]'::jsonb)
  into notifications
  from app.notification as notification
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'channel', item.channel,
      'state', item.state,
      'attempt_count', item.attempt_count,
      'sent_at', item.sent_at,
      'delivered_at', item.delivered_at
    ) order by item.channel, item.destination_version) as items
    from app.notification_delivery as item
    where item.notification_id = notification.id
  ) as delivery on true
  where notification.recipient_account_id = actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'place_id', place.public_id,
    'exact_address', place.exact_address,
    'normalized_address', place.normalized_address,
    'locality', place.locality,
    'country_code', place.country_code,
    'exact_lat', case when place.exact_location is null then null
      else extensions.st_y(place.exact_location::extensions.geometry) end,
    'exact_lng', case when place.exact_location is null then null
      else extensions.st_x(place.exact_location::extensions.geometry) end,
    'public_area_name', place.public_area_name,
    'public_center_lat', case when place.public_center is null then null
      else extensions.st_y(place.public_center::extensions.geometry) end,
    'public_center_lng', case when place.public_center is null then null
      else extensions.st_x(place.public_center::extensions.geometry) end,
    'public_radius_m', place.public_radius_m,
    'source_kind', place.source_kind,
    'provider_place_id', place.provider_place_id,
    'saved', place.saved,
    'saved_label', place.saved_label,
    'created_at', place.created_at,
    'retention_due_at', place.retention_due_at,
    'anonymized_at', place.anonymized_at
  ) order by place.created_at, place.public_id), '[]'::jsonb)
  into places
  from private.user_place as place
  where place.owner_account_id = actor_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'subscription_id', subscription.public_id,
    'device_label', subscription.device_label,
    'state', subscription.state,
    'vapid_key_version', subscription.vapid_key_version,
    'last_success_at', subscription.last_success_at,
    'last_failure_at', subscription.last_failure_at,
    'created_at', subscription.created_at,
    'updated_at', subscription.updated_at,
    'revoked_at', subscription.revoked_at
  ) order by subscription.created_at, subscription.public_id), '[]'::jsonb)
  into push_subscriptions
  from private.push_subscription as subscription
  where subscription.account_id = actor_id;

  return jsonb_build_object(
    'schema_version', 1,
    'generated_at', statement_timestamp(),
    'account', api.current_account(),
    'legal_acceptances', legal_acceptances,
    'notification_preferences', api.current_notification_preferences(),
    'notifications', notifications,
    'push_subscriptions', push_subscriptions,
    'places', places,
    'owned_transport', api.current_transport_items(),
    'ride_responses', api.current_ride_responses(),
    'ride_agreements', api.current_ride_agreements(),
    'my_trips', api.current_my_trips()
  );
end;
$$;

revoke all on function api.export_current_account_data()
  from public, anon, authenticated, service_role;
grant execute on function api.export_current_account_data() to authenticated;

comment on function api.export_current_account_data() is
  'Complete account-owned export without provider secrets, protected delivery destinations, or counterpart contact snapshots.';
