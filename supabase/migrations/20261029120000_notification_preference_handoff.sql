-- The selected single-job handoff rechecks current choices after all source-row
-- waits. Do not add preference locks to the producer/source/outbox lock graph.
do $$
declare definition text; anchor text; guard text; recovery_anchor text;
begin
  definition := pg_get_functiondef('api.notification_worker_claim_job_v3(uuid,text[])'::regprocedure);
  if position('-- Current notification preference handoff.' in definition) = 0 then
    if position('app.notification_email_destination_is_current' in definition) = 0
      or to_regprocedure('app.notification_requires_security_email(text)') is null then
      raise exception using errcode = '55000', message = 'Required notification source guards are missing.';
    end if;
    anchor := '  -- A separate statement observes the completed helper''s current write, not its outer snapshot.';
    if length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
      raise exception using errcode = '55000', message = 'Unexpected notification handoff definition.';
    end if;
    recovery_anchor := '    if recovery.state = ''claimed'' and recovery.lock_deadline > evaluated_at then continue; end if;';
    if length(definition) - length(replace(definition, recovery_anchor, '')) <> length(recovery_anchor) then
      raise exception using errcode = '55000', message = 'Unexpected notification recovery definition.';
    end if;
    definition := replace(definition, recovery_anchor, recovery_anchor || E'\n' || $recovery$
    -- Known acceptance is not an exhausted failure, even at the attempt ceiling.
    if current_delivery.sent_at is not null
      and current_delivery.state not in ('delivered', 'permanent_failure', 'suppressed') then
      update app.outbox_job as outbox set state = 'sent', lock_owner = null, lock_deadline = null,
        completed_at = coalesce(outbox.completed_at, evaluated_at), updated_at = evaluated_at, last_safe_error = null
        where outbox.id = recovery.id;
      update app.notification_delivery as target_delivery set state = 'sent', updated_at = evaluated_at
        where target_delivery.id = current_delivery.id;
      continue;
    end if;
$recovery$);
    guard := $guard$  -- Current notification preference handoff.
  -- The helper already holds the selected outbox/delivery locks. These are fresh
  -- statements in a VOLATILE function, after any Auth/contact/delivery row wait.
  select * into current_delivery from app.notification_delivery as target_delivery
    where target_delivery.public_id = (job->>'delivery_id')::uuid;
  if not found then return null; end if;
  evaluated_at := clock_timestamp();
  -- A recovered uncertain lease must never erase known provider acceptance or resend it.
  if current_delivery.sent_at is not null then
    update app.outbox_job as outbox set state = 'sent', lock_owner = null, lock_deadline = null,
      completed_at = coalesce(outbox.completed_at, evaluated_at), updated_at = evaluated_at, last_safe_error = null
      where outbox.public_id = (job->>'job_id')::uuid;
    update app.notification_delivery as target_delivery
      set state = case when current_delivery.state = 'delivered' then 'delivered' else 'sent' end,
        updated_at = evaluated_at where target_delivery.id = current_delivery.id;
    return null;
  end if;
  if not exists (
    select 1 from app.notification as notification
    join private.notification_preference as preference on preference.account_id = notification.recipient_account_id
    left join private.push_subscription as subscription on subscription.id = current_delivery.subscription_id
      and subscription.account_id = notification.recipient_account_id
    where notification.id = current_delivery.notification_id and (
      (current_delivery.channel = 'email' and (preference.ride_email_enabled
        or app.notification_requires_security_email(notification.event_type)))
      or (current_delivery.channel = 'web_push' and preference.web_push_enabled and subscription.state = 'active')
    )
  ) then
    update app.outbox_job as outbox set state = 'suppressed', lock_owner = null, lock_deadline = null,
      completed_at = evaluated_at, updated_at = evaluated_at, last_safe_error = 'preference_disabled'
      where outbox.public_id = (job->>'job_id')::uuid;
    update app.notification_delivery as target_delivery set state = 'suppressed',
      safe_failure_class = 'preference_disabled', updated_at = evaluated_at where target_delivery.id = current_delivery.id;
    return null;
  end if;
$guard$;
    execute replace(definition, anchor, guard || E'\n' || anchor);
  end if;
end;
$$;
