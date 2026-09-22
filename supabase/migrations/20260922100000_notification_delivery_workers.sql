-- Provider-specific notification workers remain behind a provider-independent lease contract.
-- Resend webhook receipts are minimized, deduplicated, and cannot regress terminal delivery state.

alter table app.notification_delivery
  add column provider_event_at timestamptz;

create index notification_delivery_provider_reference
  on app.notification_delivery (provider_adapter, provider_reference)
  where provider_reference is not null;

create table ops.provider_webhook_receipt (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  provider_reference text not null,
  delivery_id uuid references app.notification_delivery (id) on delete set null,
  processed boolean not null default false,
  outcome_state text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  retention_due_at timestamptz not null default now() + interval '90 days',
  constraint provider_webhook_receipt_provider check (provider in ('resend')),
  constraint provider_webhook_receipt_event_id check (
    char_length(event_id) between 8 and 200 and event_id !~ '[[:cntrl:]]'
  ),
  constraint provider_webhook_receipt_event_type check (
    event_type in (
      'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
      'email.bounced', 'email.complained', 'email.suppressed', 'email.opened', 'email.clicked'
    )
  ),
  constraint provider_webhook_receipt_reference check (
    char_length(provider_reference) between 1 and 200 and provider_reference !~ '[[:cntrl:]]'
  ),
  constraint provider_webhook_receipt_outcome check (
    outcome_state is null
    or outcome_state in ('sent', 'delivered', 'temporary_failure', 'permanent_failure', 'ignored')
  ),
  constraint provider_webhook_receipt_retention check (retention_due_at > received_at),
  unique (provider, event_id)
);

create index provider_webhook_receipt_retention_due
  on ops.provider_webhook_receipt (retention_due_at);

alter table ops.provider_webhook_receipt enable row level security;
alter table ops.provider_webhook_receipt force row level security;
revoke all on table ops.provider_webhook_receipt from public, anon, authenticated, service_role;

create function ops.claim_notification_jobs_v2(
  p_lease_token uuid,
  p_limit integer default 10,
  p_channels text[] default array['email', 'web_push']::text[]
)
returns table (
  job_id uuid,
  delivery_id uuid,
  notification_id uuid,
  channel text,
  destination_value text,
  p256dh_key text,
  auth_key text,
  vapid_key_version integer,
  event_type text,
  localization_key text,
  safe_parameters jsonb,
  safe_route text,
  preferred_language text,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_lease_token is null
    or coalesce(cardinality(p_channels), 0) = 0
    or not p_channels <@ array['email', 'web_push']::text[]
  then
    raise exception using errcode = '22023', message = 'The notification worker lease is invalid.';
  end if;

  return query
  with candidate as (
    select job.id
    from app.outbox_job as job
    join app.notification_delivery as delivery on delivery.id = job.payload_reference
    where delivery.channel = any(p_channels)
      and (
        job.state in ('queued', 'retry') and job.available_at <= now()
        or job.state = 'claimed' and job.lock_deadline <= now()
      )
    order by job.priority desc, job.available_at, job.created_at
    for update of job skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update app.outbox_job as job
    set state = 'claimed', attempt_count = job.attempt_count + 1,
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
  select claimed.public_id, delivery.public_id, notification.public_id, delivery.channel,
    destination.destination_value, destination.p256dh_key, destination.auth_key,
    subscription.vapid_key_version, notification.event_type, notification.localization_key,
    notification.safe_parameters, notification.safe_route, account.preferred_language,
    claimed.attempt_count
  from claimed
  join claimed_delivery as delivery on delivery.id = claimed.payload_reference
  join private.notification_destination as destination on destination.delivery_id = delivery.id
  join app.notification as notification on notification.id = delivery.notification_id
  join app.account as account on account.id = notification.recipient_account_id
  left join private.push_subscription as subscription on subscription.id = delivery.subscription_id;
end;
$$;

create function ops.record_notification_provider_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_provider_reference text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt_id uuid;
  existing ops.provider_webhook_receipt%rowtype;
  delivery app.notification_delivery%rowtype;
  desired_state text;
  changed boolean := false;
  account_id uuid;
begin
  if p_provider <> 'resend'
    or p_event_id is null or char_length(p_event_id) not between 8 and 200 or p_event_id ~ '[[:cntrl:]]'
    or p_event_type not in (
      'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
      'email.bounced', 'email.complained', 'email.suppressed', 'email.opened', 'email.clicked'
    )
    or p_provider_reference is null or char_length(p_provider_reference) not between 1 and 200
    or p_provider_reference ~ '[[:cntrl:]]'
    or p_occurred_at is null or p_occurred_at > now() + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'The provider event is invalid.';
  end if;

  insert into ops.provider_webhook_receipt (
    provider, event_id, event_type, provider_reference, occurred_at
  ) values (
    p_provider, p_event_id, p_event_type, p_provider_reference, p_occurred_at
  ) on conflict (provider, event_id) do nothing
  returning id into receipt_id;

  if receipt_id is null then
    select * into existing from ops.provider_webhook_receipt
    where provider = p_provider and event_id = p_event_id;
    return jsonb_build_object(
      'duplicate', true,
      'matched', existing.delivery_id is not null,
      'outcome', existing.outcome_state
    );
  end if;

  select * into delivery
  from app.notification_delivery
  where channel = 'email'
    and provider_adapter like 'resend-%'
    and provider_reference = p_provider_reference
  order by created_at desc
  limit 1
  for update;

  desired_state := case
    when p_event_type = 'email.sent' then 'sent'
    when p_event_type = 'email.delivered' then 'delivered'
    when p_event_type = 'email.delivery_delayed' then 'temporary_failure'
    when p_event_type in ('email.failed', 'email.bounced', 'email.complained', 'email.suppressed')
      then 'permanent_failure'
    else 'ignored'
  end;

  if delivery.id is not null
    and desired_state <> 'ignored'
    and delivery.state not in ('delivered', 'permanent_failure', 'suppressed')
    and (delivery.provider_event_at is null or p_occurred_at >= delivery.provider_event_at)
  then
    update app.notification_delivery
    set state = desired_state,
        provider_event_at = p_occurred_at,
        delivered_at = case when desired_state = 'delivered' then p_occurred_at else delivered_at end,
        safe_failure_class = case
          when desired_state = 'permanent_failure' then 'provider_delivery_failed'
          when desired_state = 'temporary_failure' then 'provider_delivery_delayed'
          else null
        end,
        updated_at = clock_timestamp()
    where id = delivery.id;
    changed := true;

    if desired_state = 'permanent_failure' then
      select notification.recipient_account_id into account_id
      from app.notification as notification where notification.id = delivery.notification_id;
      insert into ops.operational_alert (alert_type, account_id, safe_reference)
      values ('notification.email_permanent_failure', account_id, delivery.public_id);
    end if;
  end if;

  update ops.provider_webhook_receipt
  set delivery_id = delivery.id,
      processed = delivery.id is not null,
      outcome_state = desired_state
  where id = receipt_id;

  return jsonb_build_object(
    'duplicate', false,
    'matched', delivery.id is not null,
    'outcome', desired_state,
    'state_changed', changed
  );
end;
$$;

create function ops.expire_provider_webhook_receipts(p_evaluated_at timestamptz default clock_timestamp())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  delete from ops.provider_webhook_receipt where retention_due_at <= p_evaluated_at;
  get diagnostics removed_count = row_count;
  return jsonb_build_object('expired_provider_webhook_receipts', removed_count);
end;
$$;

create function api.notification_worker_claim_jobs_v2(
  p_lease_token uuid,
  p_limit integer default 10,
  p_channels text[] default array['email', 'web_push']::text[]
)
returns table (
  job_id uuid, delivery_id uuid, notification_id uuid, channel text,
  destination_value text, p256dh_key text, auth_key text, vapid_key_version integer,
  event_type text, localization_key text, safe_parameters jsonb, safe_route text,
  preferred_language text, attempt_count integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from ops.claim_notification_jobs_v2(p_lease_token, p_limit, p_channels);
$$;

create function api.notification_worker_record_provider_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_provider_reference text,
  p_occurred_at timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.record_notification_provider_event(
    p_provider, p_event_id, p_event_type, p_provider_reference, p_occurred_at
  );
$$;

revoke all on function ops.claim_notification_jobs_v2(uuid, integer, text[]) from public, anon, authenticated, service_role;
revoke all on function ops.record_notification_provider_event(text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function ops.expire_provider_webhook_receipts(timestamptz) from public, anon, authenticated, service_role;
revoke all on function api.notification_worker_claim_jobs_v2(uuid, integer, text[]) from public, anon, authenticated, service_role;
revoke all on function api.notification_worker_record_provider_event(text, text, text, text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function api.notification_worker_claim_jobs_v2(uuid, integer, text[]) to service_role;
grant execute on function api.notification_worker_record_provider_event(text, text, text, text, timestamptz) to service_role;

comment on table ops.provider_webhook_receipt is
  'Minimized signed provider event receipts retained for duplicate and out-of-order delivery handling.';
