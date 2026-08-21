create function api.phone_worker_claim_delivery(
  p_attempt_id uuid,
  p_lease_token uuid
)
returns table (
  attempt_id uuid,
  phone_e164 text,
  verification_code text,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  with expired_delivery as (
    delete from ops.phone_verification_delivery as delivery
    using ops.phone_verification_attempt as attempt
    where delivery.attempt_id = p_attempt_id
      and delivery.attempt_id = attempt.id
      and attempt.state in ('queued', 'sent')
      and attempt.expires_at <= now()
    returning delivery.attempt_id
  ), expired_attempt as (
    update ops.phone_verification_attempt
    set state = 'expired', code_salt = null, code_digest = null
    where id = p_attempt_id
      and state in ('queued', 'sent')
      and expires_at <= now()
    returning id
  ), candidate as (
    select delivery.attempt_id
    from ops.phone_verification_delivery as delivery
    join ops.phone_verification_attempt as attempt on attempt.id = delivery.attempt_id
    cross join ops.security_policy as policy
    where delivery.attempt_id = p_attempt_id
      and p_lease_token is not null
      and (
        delivery.state = 'queued'
        or delivery.leased_at + make_interval(secs => policy.phone_delivery_lease_seconds) <= now()
      )
      and attempt.state = 'queued'
      and attempt.expires_at > now()
    for update of delivery skip locked
  ), leased as (
    update ops.phone_verification_delivery as delivery
    set state = 'leased', lease_token = p_lease_token, leased_at = now()
    from candidate
    where delivery.attempt_id = candidate.attempt_id
    returning delivery.attempt_id, delivery.code
  )
  select leased.attempt_id, attempt.phone_e164, leased.code, attempt.expires_at
  from leased
  join ops.phone_verification_attempt as attempt on attempt.id = leased.attempt_id;
$$;

create function api.phone_worker_complete_delivery(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_delivered boolean,
  p_provider_adapter text,
  p_provider_reference text default null
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.complete_phone_verification_delivery(
    p_attempt_id,
    p_lease_token,
    p_delivered,
    p_provider_adapter,
    p_provider_reference
  );
$$;

revoke all on function api.phone_worker_claim_delivery(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.phone_worker_complete_delivery(uuid, uuid, boolean, text, text)
  from public, anon, authenticated, service_role;

grant execute on function api.phone_worker_claim_delivery(uuid, uuid) to service_role;
grant execute on function api.phone_worker_complete_delivery(uuid, uuid, boolean, text, text) to service_role;

comment on function api.phone_worker_claim_delivery(uuid, uuid)
  is 'Service-role-only bridge that leases only the requested OTP delivery to the Next.js worker.';
comment on function api.phone_worker_complete_delivery(uuid, uuid, boolean, text, text)
  is 'Service-role-only bridge that records only a safe Bird acceptance result or failure.';
