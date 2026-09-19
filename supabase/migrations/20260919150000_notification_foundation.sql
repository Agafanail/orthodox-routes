-- Durable in-app notification history, external-channel preferences, protected Web Push
-- subscriptions, and provider-independent delivery leasing.

create table app.notification (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  recipient_account_id uuid not null references app.account (id) on delete cascade,
  event_type text not null,
  object_type text not null,
  object_public_id uuid,
  safe_route text not null,
  localization_key text not null,
  safe_parameters jsonb not null default '{}'::jsonb,
  current_outcome_reference text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  retention_due_at timestamptz not null,
  constraint notification_event_type check (event_type ~ '^[a-z][a-z0-9_.]{1,79}$'),
  constraint notification_object_type check (object_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint notification_safe_route check (safe_route ~ '^/[a-z0-9][a-z0-9/_-]{0,239}$'),
  constraint notification_localization_key check (localization_key ~ '^[a-z][a-z0-9_.]{1,99}$'),
  constraint notification_outcome_safe check (
    current_outcome_reference is null
    or (char_length(current_outcome_reference) between 1 and 80 and current_outcome_reference !~ '[[:cntrl:]]')
  ),
  constraint notification_read_order check (read_at is null or read_at >= created_at),
  constraint notification_retention_order check (retention_due_at > created_at)
);

create index notification_recipient_timeline
  on app.notification (recipient_account_id, created_at desc, public_id desc);
create index notification_retention_due on app.notification (retention_due_at);

create table private.notification_preference (
  account_id uuid primary key references app.account (id) on delete cascade,
  ride_email_enabled boolean not null default true,
  web_push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.push_subscription (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  account_id uuid not null references app.account (id) on delete cascade,
  endpoint_value text not null,
  endpoint_fingerprint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  vapid_key_version integer not null,
  device_label text,
  state text not null default 'active',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_subscription_fingerprint check (endpoint_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint push_subscription_endpoint check (
    char_length(endpoint_value) between 12 and 2048 and endpoint_value ~ '^https://[^[:space:]]+$'
  ),
  constraint push_subscription_p256dh check (p256dh_key ~ '^[A-Za-z0-9_-]{32,256}={0,2}$'),
  constraint push_subscription_auth check (auth_key ~ '^[A-Za-z0-9_-]{16,128}={0,2}$'),
  constraint push_subscription_vapid_version check (vapid_key_version > 0),
  constraint push_subscription_device_label check (
    device_label is null or (char_length(device_label) between 1 and 80 and device_label !~ '[[:cntrl:]]')
  ),
  constraint push_subscription_state check (state in ('active', 'invalid', 'revoked')),
  constraint push_subscription_revoked_state check ((state = 'revoked') = (revoked_at is not null))
);

create index push_subscription_account_active
  on private.push_subscription (account_id, created_at desc) where state = 'active';

create table app.notification_delivery (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  notification_id uuid not null references app.notification (id) on delete cascade,
  channel text not null,
  subscription_id uuid references private.push_subscription (id) on delete set null,
  destination_version text not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_adapter text,
  provider_code text,
  provider_reference text,
  safe_failure_class text,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_channel check (channel in ('email', 'web_push')),
  constraint notification_delivery_subscription check (channel = 'web_push' or subscription_id is null),
  constraint notification_delivery_state check (
    state in ('queued', 'claimed', 'sent', 'delivered', 'temporary_failure', 'permanent_failure', 'suppressed')
  ),
  constraint notification_delivery_attempts check (attempt_count between 0 and 20),
  constraint notification_delivery_destination_version check (
    char_length(destination_version) between 1 and 128 and destination_version !~ '[[:cntrl:]]'
  ),
  unique (notification_id, channel, destination_version)
);

create index notification_delivery_retry
  on app.notification_delivery (next_attempt_at, created_at)
  where state in ('queued', 'temporary_failure');

create table private.notification_destination (
  delivery_id uuid primary key references app.notification_delivery (id) on delete cascade,
  destination_value text not null,
  p256dh_key text,
  auth_key text,
  created_at timestamptz not null default now(),
  constraint notification_destination_push_keys check (
    (p256dh_key is null and auth_key is null) or (p256dh_key is not null and auth_key is not null)
  )
);

create table app.outbox_job (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  job_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload_reference uuid not null unique references app.notification_delivery (id) on delete cascade,
  idempotency_key text not null unique,
  priority smallint not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  lock_owner uuid,
  lock_deadline timestamptz,
  last_safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint outbox_job_type check (job_type in ('notification_email', 'notification_web_push')),
  constraint outbox_aggregate_type check (aggregate_type = 'notification'),
  constraint outbox_priority check (priority between 0 and 100),
  constraint outbox_state check (state in ('queued', 'claimed', 'retry', 'sent', 'dead', 'suppressed')),
  constraint outbox_attempts check (attempt_count between 0 and 20),
  constraint outbox_lock_shape check (
    (state = 'claimed' and lock_owner is not null and lock_deadline is not null)
    or (state <> 'claimed' and lock_owner is null and lock_deadline is null)
  ),
  constraint outbox_completion_shape check ((state in ('sent', 'dead', 'suppressed')) = (completed_at is not null))
);

create index outbox_job_claimable
  on app.outbox_job (priority desc, available_at, created_at)
  where state in ('queued', 'retry', 'claimed');

create table private.notification_operation (
  actor_account_id uuid not null references app.account (id) on delete cascade,
  operation_type text not null,
  client_key uuid not null,
  input_digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_account_id, operation_type, client_key),
  constraint notification_operation_type check (operation_type in ('upsert_push_subscription', 'update_notification_preference')),
  constraint notification_operation_digest check (input_digest ~ '^[0-9a-f]{64}$')
);

create table ops.operational_alert (
  id bigint generated always as identity primary key,
  alert_type text not null,
  account_id uuid references app.account (id) on delete set null,
  safe_reference uuid,
  state text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint operational_alert_type check (alert_type ~ '^[a-z][a-z0-9_.]{1,79}$'),
  constraint operational_alert_state check (state in ('open', 'resolved')),
  constraint operational_alert_resolution check ((state = 'resolved') = (resolved_at is not null))
);

alter table app.notification enable row level security;
alter table app.notification force row level security;
alter table private.notification_preference enable row level security;
alter table private.notification_preference force row level security;
alter table private.push_subscription enable row level security;
alter table private.push_subscription force row level security;
alter table app.notification_delivery enable row level security;
alter table app.notification_delivery force row level security;
alter table private.notification_destination enable row level security;
alter table private.notification_destination force row level security;
alter table app.outbox_job enable row level security;
alter table app.outbox_job force row level security;
alter table private.notification_operation enable row level security;
alter table private.notification_operation force row level security;
alter table ops.operational_alert enable row level security;
alter table ops.operational_alert force row level security;

revoke all on table app.notification, private.notification_preference, private.push_subscription,
  app.notification_delivery, private.notification_destination, app.outbox_job,
  private.notification_operation, ops.operational_alert
from public, anon, authenticated, service_role;

create function app.notification_parameters_are_safe(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select key, value as content from jsonb_each(value) loop
    if item.key !~ '^[a-z][a-z0-9_]{0,39}$'
      or item.key ~* '(email|phone|contact|address|coordinate|latitude|longitude|note|route|token|secret)'
      or jsonb_typeof(item.content) not in ('string', 'number', 'boolean', 'null')
      or (jsonb_typeof(item.content) = 'string' and (
        char_length(item.content #>> '{}') > 160
        or (item.content #>> '{}') ~ '[[:cntrl:]]'
        or (item.content #>> '{}') ~* '(https?://|www\.|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|\+?[0-9][0-9 ()-]{6,}[0-9])'
      ))
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table app.notification
  add constraint notification_safe_parameters check (app.notification_parameters_are_safe(safe_parameters));

create function app.initialize_notification_preference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into private.notification_preference (account_id) values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$;

create trigger initialize_notification_preference
after insert on app.account
for each row execute function app.initialize_notification_preference();

insert into private.notification_preference (account_id)
select id from app.account on conflict (account_id) do nothing;

create function app.has_active_transport_commitment(requested_account_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from app.passenger_request as request
    where request.author_account_id = requested_account_id
      and request.status in ('active', 'partial') and request.desired_arrival_at > current_timestamp
  ) or exists (
    select 1 from app.driver_offer_occurrence as occurrence
    where occurrence.author_account_id = requested_account_id
      and occurrence.status in ('active', 'full') and occurrence.arrival_at > current_timestamp
  ) or exists (
    select 1 from app.ride_response as response
    join app.ride_condition_snapshot as snapshot on snapshot.id = response.conditions_snapshot_id
    where requested_account_id in (response.passenger_account_id, response.driver_account_id)
      and response.status in ('await_driver', 'await_passenger')
      and response.expires_at > current_timestamp and snapshot.scheduled_arrival_at > current_timestamp
  ) or exists (
    select 1 from app.ride_agreement as agreement
    join app.ride_condition_snapshot as snapshot on snapshot.id = agreement.active_snapshot_id
    where requested_account_id in (agreement.passenger_account_id, agreement.driver_account_id)
      and agreement.status in ('confirmed', 'change_pending')
      and snapshot.scheduled_arrival_at > current_timestamp
  );
$$;

create function app.has_effective_external_channel(
  requested_account_id uuid,
  requested_ride_email_enabled boolean default null,
  requested_web_push_enabled boolean default null,
  excluded_subscription_id uuid default null
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (
    coalesce(requested_ride_email_enabled, preference.ride_email_enabled)
    and identity.email_confirmed_at is not null
    and contact.email_normalized <> ''
  ) or (
    coalesce(requested_web_push_enabled, preference.web_push_enabled)
    and exists (
      select 1 from private.push_subscription as subscription
      where subscription.account_id = requested_account_id
        and subscription.state = 'active'
        and subscription.id is distinct from excluded_subscription_id
    )
  )
  from private.notification_preference as preference
  join private.account_contact as contact on contact.account_id = preference.account_id
  join auth.users as identity on identity.id = preference.account_id
  where preference.account_id = requested_account_id;
$$;

create or replace function app.require_transport_actor()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  if not coalesce((app.current_eligibility_result(actor_id)->>'eligible')::boolean, false) then
    raise exception using errcode = '42501', message = 'Current participation eligibility is required.';
  end if;
  if not coalesce(app.has_effective_external_channel(actor_id), false) then
    raise exception using errcode = '42501', message = 'An effective external notification channel is required.';
  end if;
  return actor_id;
end;
$$;

create function app.notification_operation_result(
  requested_actor uuid,
  requested_operation text,
  requested_key uuid,
  requested_digest text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  existing private.notification_operation%rowtype;
begin
  select * into existing from private.notification_operation as operation
  where operation.actor_account_id = requested_actor
    and operation.operation_type = requested_operation
    and operation.client_key = requested_key;
  if not found then return null; end if;
  if existing.input_digest <> requested_digest then
    raise exception using errcode = '22023', message = 'The idempotency key was already used for different input.';
  end if;
  return existing.result;
end;
$$;

create function app.create_notification(
  requested_recipient uuid,
  requested_event_type text,
  requested_object_type text,
  requested_object_public_id uuid,
  requested_safe_route text,
  requested_localization_key text,
  requested_safe_parameters jsonb default '{}'::jsonb,
  requested_priority integer default 50
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  notification_id uuid;
  notification_public_id uuid;
  delivery_id uuid;
  delivery_public_id uuid;
  email_value text;
  email_version text;
  subscription private.push_subscription%rowtype;
  preference private.notification_preference%rowtype;
begin
  if requested_priority not between 0 and 100 then
    raise exception using errcode = '22023', message = 'Notification priority is invalid.';
  end if;
  select * into preference from private.notification_preference
  where account_id = requested_recipient;
  if preference.account_id is null then
    raise exception using errcode = '23503', message = 'Notification recipient is unavailable.';
  end if;

  insert into app.notification (
    recipient_account_id, event_type, object_type, object_public_id, safe_route,
    localization_key, safe_parameters, retention_due_at
  ) values (
    requested_recipient, requested_event_type, requested_object_type,
    requested_object_public_id, requested_safe_route, requested_localization_key,
    requested_safe_parameters, clock_timestamp() + case
      when requested_event_type like 'account.security.%' then interval '24 months'
      else interval '12 months' end
  ) returning id, public_id into notification_id, notification_public_id;

  if preference.ride_email_enabled then
    select contact.email_normalized,
      app.transport_input_digest(jsonb_build_object(
        'email', contact.email_normalized, 'changed_at', contact.email_changed_at
      ))
    into email_value, email_version
    from private.account_contact as contact
    join auth.users as identity on identity.id = contact.account_id
    where contact.account_id = requested_recipient and identity.email_confirmed_at is not null;
    if email_value is not null then
      insert into app.notification_delivery (
        notification_id, channel, destination_version
      ) values (notification_id, 'email', email_version)
      returning id, public_id into delivery_id, delivery_public_id;
      insert into private.notification_destination (delivery_id, destination_value)
      values (delivery_id, email_value);
      insert into app.outbox_job (
        job_type, aggregate_type, aggregate_id, payload_reference,
        idempotency_key, priority
      ) values (
        'notification_email', 'notification', notification_id, delivery_id,
        notification_public_id::text || ':email:' || email_version, requested_priority
      );
    end if;
  end if;

  if preference.web_push_enabled then
    for subscription in select * from private.push_subscription
      where account_id = requested_recipient and state = 'active'
    loop
      insert into app.notification_delivery (
        notification_id, channel, subscription_id, destination_version
      ) values (notification_id, 'web_push', subscription.id, subscription.public_id::text)
      returning id, public_id into delivery_id, delivery_public_id;
      insert into private.notification_destination (delivery_id, destination_value, p256dh_key, auth_key)
      values (delivery_id, subscription.endpoint_value, subscription.p256dh_key, subscription.auth_key);
      insert into app.outbox_job (
        job_type, aggregate_type, aggregate_id, payload_reference,
        idempotency_key, priority
      ) values (
        'notification_web_push', 'notification', notification_id, delivery_id,
        notification_public_id::text || ':web_push:' || subscription.public_id::text,
        requested_priority
      );
    end loop;
  end if;
  return notification_public_id;
end;
$$;

create function api.current_notification_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id)
  select jsonb_build_object(
    'ride_email_enabled', preference.ride_email_enabled,
    'web_push_enabled', preference.web_push_enabled,
    'active_push_subscription_count', count(subscription.id)::integer,
    'has_active_transport_commitment', app.has_active_transport_commitment(actor.id),
    'has_effective_external_channel', app.has_effective_external_channel(actor.id)
  )
  from actor
  join private.notification_preference as preference on preference.account_id = actor.id
  left join private.push_subscription as subscription
    on subscription.account_id = actor.id and subscription.state = 'active'
  group by actor.id, preference.account_id;
$$;

create function api.current_notifications(
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (select app.current_actor_id() as id), selected as (
    select notification.*
    from app.notification as notification, actor
    where notification.recipient_account_id = actor.id
      and (p_before is null or notification.created_at < p_before)
    order by notification.created_at desc, notification.public_id desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notification_id', selected.public_id,
    'event_type', selected.event_type,
    'object_type', selected.object_type,
    'object_id', selected.object_public_id,
    'safe_route', selected.safe_route,
    'localization_key', selected.localization_key,
    'parameters', selected.safe_parameters,
    'current_outcome', selected.current_outcome_reference,
    'read_at', selected.read_at,
    'created_at', selected.created_at,
    'deliveries', coalesce(delivery.items, '[]'::jsonb)
  ) order by selected.created_at desc, selected.public_id desc), '[]'::jsonb)
  from selected
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'channel', item.channel, 'state', item.state, 'attempt_count', item.attempt_count
    ) order by item.channel, item.destination_version) as items
    from app.notification_delivery as item where item.notification_id = selected.id
  ) as delivery on true;
$$;

create function api.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
begin
  update app.notification set read_at = coalesce(read_at, clock_timestamp())
  where public_id = p_notification_id and recipient_account_id = actor_id;
  return found;
end;
$$;

create function api.upsert_push_subscription(
  p_endpoint text,
  p_p256dh_key text,
  p_auth_key text,
  p_vapid_key_version integer,
  p_device_label text,
  p_client_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  normalized_endpoint text := btrim(p_endpoint);
  fingerprint text := encode(extensions.digest(convert_to(normalized_endpoint, 'UTF8'), 'sha256'), 'hex');
  input jsonb := jsonb_build_object(
    'endpoint_fingerprint', fingerprint, 'p256dh_key', p_p256dh_key, 'auth_key', p_auth_key,
    'vapid_key_version', p_vapid_key_version, 'device_label', nullif(btrim(p_device_label), '')
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  existing private.push_subscription%rowtype;
  subscription_public_id uuid;
  result jsonb;
begin
  if p_client_key is null then raise exception using errcode = '22023', message = 'An idempotency key is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':upsert_push_subscription:' || p_client_key::text, 0));
  prior := app.notification_operation_result(actor_id, 'upsert_push_subscription', p_client_key, digest_value);
  if prior is not null then return prior; end if;

  select * into existing from private.push_subscription
  where endpoint_fingerprint = fingerprint for update;
  if existing.id is not null and existing.account_id <> actor_id then
    raise exception using errcode = '23505', message = 'The push subscription is unavailable.';
  end if;
  if normalized_endpoint !~ '^https://[^[:space:]]+$'
    or char_length(normalized_endpoint) not between 12 and 2048
    or p_p256dh_key !~ '^[A-Za-z0-9_-]{32,256}={0,2}$'
    or p_auth_key !~ '^[A-Za-z0-9_-]{16,128}={0,2}$'
    or p_vapid_key_version is null or p_vapid_key_version <= 0
    or (nullif(btrim(p_device_label), '') is not null and (
      char_length(btrim(p_device_label)) > 80 or btrim(p_device_label) ~ '[[:cntrl:]]'
    ))
  then
    raise exception using errcode = '22023', message = 'The push subscription is invalid.';
  end if;

  if existing.id is null then
    insert into private.push_subscription (
      account_id, endpoint_value, endpoint_fingerprint, p256dh_key, auth_key,
      vapid_key_version, device_label
    ) values (
      actor_id, normalized_endpoint, fingerprint, p_p256dh_key, p_auth_key,
      p_vapid_key_version, nullif(btrim(p_device_label), '')
    ) returning public_id into subscription_public_id;
  else
    update private.push_subscription
    set endpoint_value = normalized_endpoint, p256dh_key = p_p256dh_key, auth_key = p_auth_key,
        vapid_key_version = p_vapid_key_version, device_label = nullif(btrim(p_device_label), ''),
        state = 'active', revoked_at = null, updated_at = clock_timestamp()
    where id = existing.id returning public_id into subscription_public_id;
  end if;
  result := jsonb_build_object('subscription_id', subscription_public_id, 'state', 'active');
  insert into private.notification_operation values (
    actor_id, 'upsert_push_subscription', p_client_key, digest_value, result, now()
  );
  return result;
end;
$$;

create function api.update_notification_preference(
  p_ride_email_enabled boolean,
  p_web_push_enabled boolean,
  p_client_key uuid,
  p_revoke_subscription_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app.current_actor_id();
  input jsonb := jsonb_build_object(
    'ride_email_enabled', p_ride_email_enabled, 'web_push_enabled', p_web_push_enabled,
    'revoke_subscription_id', p_revoke_subscription_id
  );
  digest_value text := app.transport_input_digest(input);
  prior jsonb;
  excluded_id uuid;
  result jsonb;
begin
  if p_client_key is null or p_ride_email_enabled is null or p_web_push_enabled is null then
    raise exception using errcode = '22023', message = 'Notification preferences and an idempotency key are required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':update_notification_preference:' || p_client_key::text, 0));
  prior := app.notification_operation_result(actor_id, 'update_notification_preference', p_client_key, digest_value);
  if prior is not null then return prior; end if;
  perform 1 from private.notification_preference where account_id = actor_id for update;

  if p_revoke_subscription_id is not null then
    select id into excluded_id from private.push_subscription
    where public_id = p_revoke_subscription_id and account_id = actor_id and state = 'active'
    for update;
    if excluded_id is null then
      raise exception using errcode = 'P0002', message = 'The push subscription is unavailable.';
    end if;
  end if;
  if app.has_active_transport_commitment(actor_id)
    and not coalesce(app.has_effective_external_channel(
      actor_id, p_ride_email_enabled, p_web_push_enabled, excluded_id
    ), false)
  then
    raise exception using errcode = '23514', message = 'An active transport commitment requires an effective external channel.';
  end if;

  update private.notification_preference
  set ride_email_enabled = p_ride_email_enabled, web_push_enabled = p_web_push_enabled,
      updated_at = clock_timestamp()
  where account_id = actor_id;
  if excluded_id is not null then
    update private.push_subscription
    set state = 'revoked', revoked_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = excluded_id;
  end if;
  update app.outbox_job as job
  set state = 'suppressed', completed_at = clock_timestamp(), updated_at = clock_timestamp(),
      lock_owner = null, lock_deadline = null, last_safe_error = 'preference_disabled'
  from app.notification_delivery as delivery
  join app.notification as notification on notification.id = delivery.notification_id
  where job.payload_reference = delivery.id
    and notification.recipient_account_id = actor_id
    and job.state in ('queued', 'retry')
    and (
      (delivery.channel = 'email' and not p_ride_email_enabled)
      or (delivery.channel = 'web_push' and (
        not p_web_push_enabled or delivery.subscription_id = excluded_id
      ))
    );
  update app.notification_delivery as delivery
  set state = 'suppressed', safe_failure_class = 'preference_disabled', updated_at = clock_timestamp()
  from app.notification as notification
  where notification.id = delivery.notification_id
    and notification.recipient_account_id = actor_id
    and delivery.state in ('queued', 'temporary_failure')
    and (
      (delivery.channel = 'email' and not p_ride_email_enabled)
      or (delivery.channel = 'web_push' and (
        not p_web_push_enabled or delivery.subscription_id = excluded_id
      ))
    );
  result := api.current_notification_preferences();
  insert into private.notification_operation values (
    actor_id, 'update_notification_preference', p_client_key, digest_value, result, now()
  );
  return result;
end;
$$;

create function ops.claim_notification_jobs(p_lease_token uuid, p_limit integer default 10)
returns table (
  job_id uuid,
  delivery_id uuid,
  channel text,
  destination_value text,
  p256dh_key text,
  auth_key text,
  vapid_key_version integer,
  event_type text,
  localization_key text,
  safe_parameters jsonb,
  safe_route text,
  attempt_count integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  with candidate as (
    select job.id
    from app.outbox_job as job
    where p_lease_token is not null
      and (
        job.state in ('queued', 'retry') and job.available_at <= now()
        or job.state = 'claimed' and job.lock_deadline <= now()
      )
    order by job.priority desc, job.available_at, job.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update app.outbox_job as job
    set state = 'claimed', attempt_count = attempt_count + 1,
        lock_owner = p_lease_token, lock_deadline = now() + interval '60 seconds',
        updated_at = now()
    from candidate where job.id = candidate.id
    returning job.*
  ), claimed_delivery as (
    update app.notification_delivery as delivery
    set state = 'claimed', attempt_count = claimed.attempt_count,
        claimed_at = coalesce(delivery.claimed_at, now()), updated_at = now()
    from claimed where delivery.id = claimed.payload_reference
    returning delivery.*
  )
  select claimed.public_id, delivery.public_id, delivery.channel,
    destination.destination_value, destination.p256dh_key, destination.auth_key,
    subscription.vapid_key_version, notification.event_type, notification.localization_key,
    notification.safe_parameters, notification.safe_route, claimed.attempt_count
  from claimed
  join claimed_delivery as delivery on delivery.id = claimed.payload_reference
  join private.notification_destination as destination on destination.delivery_id = delivery.id
  join app.notification as notification on notification.id = delivery.notification_id
  left join private.push_subscription as subscription on subscription.id = delivery.subscription_id;
$$;

create function ops.complete_notification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_provider_adapter text,
  p_provider_code text default null,
  p_provider_reference text default null,
  p_safe_failure_class text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job app.outbox_job%rowtype;
  delivery app.notification_delivery%rowtype;
  notification app.notification%rowtype;
  finished_at timestamptz := clock_timestamp();
  exhausted boolean;
begin
  if p_outcome not in ('sent', 'temporary_failure', 'permanent_failure', 'suppressed')
    or p_provider_adapter is null or char_length(btrim(p_provider_adapter)) not between 1 and 64
    or btrim(p_provider_adapter) ~ '[[:cntrl:]]'
    or coalesce(char_length(p_provider_code), 0) > 80
    or coalesce(char_length(p_provider_reference), 0) > 200
    or coalesce(char_length(p_safe_failure_class), 0) > 80
  then
    raise exception using errcode = '22023', message = 'The notification delivery result is invalid.';
  end if;
  select * into job from app.outbox_job
  where public_id = p_job_id and state = 'claimed' and lock_owner = p_lease_token
  for update;
  if job.id is null then return false; end if;
  select * into delivery from app.notification_delivery where id = job.payload_reference for update;
  select * into notification from app.notification where id = delivery.notification_id;
  exhausted := p_outcome = 'temporary_failure' and job.attempt_count >= 5;

  if p_outcome = 'sent' then
    update app.outbox_job set state = 'sent', lock_owner = null, lock_deadline = null,
      completed_at = finished_at, updated_at = finished_at where id = job.id;
    update app.notification_delivery set state = 'sent', provider_adapter = btrim(p_provider_adapter),
      provider_code = nullif(btrim(p_provider_code), ''),
      provider_reference = nullif(btrim(p_provider_reference), ''), safe_failure_class = null,
      claimed_at = coalesce(claimed_at, finished_at), sent_at = finished_at,
      updated_at = finished_at where id = delivery.id;
    if delivery.subscription_id is not null then
      update private.push_subscription set last_success_at = finished_at, updated_at = finished_at
      where id = delivery.subscription_id;
    end if;
  elsif p_outcome = 'temporary_failure' and not exhausted then
    update app.outbox_job set state = 'retry', lock_owner = null, lock_deadline = null,
      available_at = finished_at + make_interval(mins => least(60, (power(2, attempt_count))::integer)),
      last_safe_error = nullif(btrim(p_safe_failure_class), ''), updated_at = finished_at
    where id = job.id;
    update app.notification_delivery set state = 'temporary_failure',
      provider_adapter = btrim(p_provider_adapter), provider_code = nullif(btrim(p_provider_code), ''),
      provider_reference = nullif(btrim(p_provider_reference), ''),
      safe_failure_class = nullif(btrim(p_safe_failure_class), ''), attempt_count = job.attempt_count,
      next_attempt_at = finished_at + make_interval(mins => least(60, (power(2, job.attempt_count))::integer)),
      claimed_at = coalesce(claimed_at, finished_at), updated_at = finished_at
    where id = delivery.id;
  else
    update app.outbox_job set state = case when p_outcome = 'suppressed' then 'suppressed' else 'dead' end,
      lock_owner = null, lock_deadline = null, completed_at = finished_at,
      last_safe_error = nullif(btrim(p_safe_failure_class), ''), updated_at = finished_at
    where id = job.id;
    update app.notification_delivery set state = case
        when p_outcome = 'suppressed' then 'suppressed' else 'permanent_failure' end,
      provider_adapter = btrim(p_provider_adapter), provider_code = nullif(btrim(p_provider_code), ''),
      provider_reference = nullif(btrim(p_provider_reference), ''),
      safe_failure_class = nullif(btrim(p_safe_failure_class), ''), attempt_count = job.attempt_count,
      claimed_at = coalesce(claimed_at, finished_at), updated_at = finished_at
    where id = delivery.id;
    if delivery.subscription_id is not null and p_outcome <> 'suppressed' then
      update private.push_subscription set state = 'invalid', last_failure_at = finished_at,
        updated_at = finished_at where id = delivery.subscription_id and state = 'active';
      if app.has_active_transport_commitment(notification.recipient_account_id)
        and not coalesce(app.has_effective_external_channel(notification.recipient_account_id), false)
      then
        perform app.create_notification(
          notification.recipient_account_id, 'account.external_channel_unavailable',
          'account', null, '/profile',
          'notifications.external_channel_unavailable', '{}'::jsonb, 90
        );
        insert into ops.operational_alert (alert_type, account_id, safe_reference)
        values ('notification.external_channel_unavailable', notification.recipient_account_id, delivery.public_id);
      end if;
    end if;
  end if;
  return true;
end;
$$;

create function ops.expire_notifications(p_evaluated_at timestamptz default clock_timestamp())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  delete from app.notification where retention_due_at <= p_evaluated_at;
  get diagnostics removed_count = row_count;
  return jsonb_build_object('expired_notifications', removed_count);
end;
$$;

create function api.notification_worker_claim_jobs(p_lease_token uuid, p_limit integer default 10)
returns table (
  job_id uuid, delivery_id uuid, channel text, destination_value text,
  p256dh_key text, auth_key text, vapid_key_version integer, event_type text,
  localization_key text, safe_parameters jsonb, safe_route text, attempt_count integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from ops.claim_notification_jobs(p_lease_token, p_limit);
$$;

create function api.notification_worker_complete_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_provider_adapter text,
  p_provider_code text default null,
  p_provider_reference text default null,
  p_safe_failure_class text default null
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.complete_notification_job(
    p_job_id, p_lease_token, p_outcome, p_provider_adapter,
    p_provider_code, p_provider_reference, p_safe_failure_class
  );
$$;

revoke all on function app.notification_parameters_are_safe(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.initialize_notification_preference() from public, anon, authenticated, service_role;
revoke all on function app.has_active_transport_commitment(uuid) from public, anon, authenticated, service_role;
revoke all on function app.has_effective_external_channel(uuid, boolean, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function app.require_transport_actor() from public, anon, authenticated, service_role;
revoke all on function app.notification_operation_result(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.create_notification(uuid, text, text, uuid, text, text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function ops.claim_notification_jobs(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function ops.complete_notification_job(uuid, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function ops.expire_notifications(timestamptz) from public, anon, authenticated, service_role;
revoke all on function api.current_notification_preferences() from public, anon, authenticated, service_role;
revoke all on function api.current_notifications(integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function api.mark_notification_read(uuid) from public, anon, authenticated, service_role;
revoke all on function api.upsert_push_subscription(text, text, text, integer, text, uuid) from public, anon, authenticated, service_role;
revoke all on function api.update_notification_preference(boolean, boolean, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function api.notification_worker_claim_jobs(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function api.notification_worker_complete_job(uuid, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function api.current_notification_preferences() to authenticated;
grant execute on function api.current_notifications(integer, timestamptz) to authenticated;
grant execute on function api.mark_notification_read(uuid) to authenticated;
grant execute on function api.upsert_push_subscription(text, text, text, integer, text, uuid) to authenticated;
grant execute on function api.update_notification_preference(boolean, boolean, uuid, uuid) to authenticated;
grant execute on function api.notification_worker_claim_jobs(uuid, integer) to service_role;
grant execute on function api.notification_worker_complete_job(uuid, uuid, text, text, text, text, text) to service_role;

comment on table app.notification is 'Always-enabled account-owned in-app notification history with privacy-safe structured content.';
comment on table private.notification_preference is 'Account-level ordinary ride email and Web Push intent without destinations.';
comment on table private.push_subscription is 'Protected per-device Web Push subscriptions; endpoint and key material never enter account reads.';
comment on table app.notification_delivery is 'Per-channel notification delivery state without destination material.';
comment on table app.outbox_job is 'Durable idempotent delivery work claimed with bounded leases and retries.';
comment on function api.update_notification_preference(boolean, boolean, uuid, uuid) is
  'Updates caller-owned ordinary notification preferences and optionally revokes one device while enforcing an effective external channel.';
comment on function api.notification_worker_claim_jobs(uuid, integer) is
  'Service-role-only bounded delivery lease returning privacy-minimized provider input.';
