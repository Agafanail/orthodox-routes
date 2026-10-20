-- Preserve old claim signatures; the new application bridge leases exactly one job.
do $$
declare definition text; signature text; anchor text;
begin
  foreach signature in array array['ops.claim_notification_jobs(uuid,integer)', 'ops.claim_notification_jobs_v2(uuid,integer,text[])'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('lock_deadline = now() + interval ''60 seconds''' in definition) > 0 then
      definition := replace(definition, 'lock_deadline = now() + interval ''60 seconds''',
      'lock_deadline = clock_timestamp() + interval ''60 seconds''');
    elsif position('lock_deadline = clock_timestamp() + interval ''60 seconds''' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected notification claim definition.';
    end if;
    if position('job.attempt_count < 5' in definition) = 0 then
      anchor := case when signature like '%_v2(%' then 'where delivery.channel = any(p_channels)' else 'where p_lease_token is not null' end;
      if position(anchor in definition) = 0 or position('from claimed where delivery.id = claimed.payload_reference' in definition) = 0 then
        raise exception using errcode = '55000', message = 'Unexpected notification claim filter.';
      end if;
      definition := replace(definition, anchor, anchor || '
      and job.attempt_count < 5
      and not exists (select 1 from app.notification_delivery as terminal_delivery where terminal_delivery.id = job.payload_reference
        and terminal_delivery.state in (''delivered'', ''permanent_failure'', ''suppressed''))');
      definition := replace(definition, 'from claimed where delivery.id = claimed.payload_reference',
        'from claimed where delivery.id = claimed.payload_reference and delivery.state not in (''delivered'', ''permanent_failure'', ''suppressed'')');
    end if;
    execute definition;
  end loop;

  definition := pg_get_functiondef('ops.complete_notification_job(uuid,uuid,text,text,text,text,text)'::regprocedure);
  if position('job.lock_deadline <= finished_at' in definition) = 0 then
    if position('finished_at timestamptz := clock_timestamp();' in definition) = 0
      or position('select * into delivery from app.notification_delivery where id = job.payload_reference for update;' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected notification completion definition.';
    end if;
    definition := replace(definition, 'finished_at timestamptz := clock_timestamp();', 'finished_at timestamptz;');
    definition := replace(definition, 'if p_outcome not in', 'if p_outcome is null or p_outcome not in');
    definition := replace(definition,
      'select * into delivery from app.notification_delivery where id = job.payload_reference for update;',
      'select * into delivery from app.notification_delivery where id = job.payload_reference for update;
  finished_at := clock_timestamp();
  if job.lock_deadline is null or job.lock_deadline <= finished_at then return false; end if;
  if delivery.state in (''delivered'', ''permanent_failure'', ''suppressed'') then return false; end if;');
    execute definition;
  end if;
end;
$$;

alter function ops.claim_notification_jobs_v2(uuid,integer,text[]) set lock_timeout = '5s';
alter function ops.claim_notification_jobs(uuid,integer) set lock_timeout = '5s';
alter function ops.complete_notification_job(uuid,uuid,text,text,text,text,text) set lock_timeout = '5s';

create or replace function api.notification_worker_claim_job_v3(p_lease_token uuid, p_channels text[])
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  job jsonb; deadline timestamptz;
  recovery record;
  current_delivery app.notification_delivery%rowtype;
  evaluated_at timestamptz;
begin
  if p_lease_token is null or coalesce(cardinality(p_channels), 0) not between 1 and 2
    or array_position(p_channels, null) is not null or not p_channels <@ array['email', 'web_push']::text[] then
    raise exception using errcode = '22023', message = 'The notification worker lease is invalid.';
  end if;
  -- Bounded recovery never changes subscription validity/preferences or a ride transaction.
  for recovery in
    select outbox.id, outbox.payload_reference, outbox.state, outbox.lock_deadline
    from app.outbox_job as outbox join app.notification_delivery as candidate_delivery on candidate_delivery.id = outbox.payload_reference
    where candidate_delivery.channel = any(p_channels)
      and ((outbox.state in ('queued', 'retry') and outbox.available_at <= clock_timestamp())
        or (outbox.state = 'claimed' and outbox.lock_deadline <= clock_timestamp()))
      and (outbox.attempt_count >= 5 or candidate_delivery.state in ('delivered', 'permanent_failure', 'suppressed'))
    order by outbox.priority desc, outbox.available_at, outbox.id limit 50 for update of outbox skip locked
  loop
    select * into current_delivery from app.notification_delivery as target_delivery where target_delivery.id = recovery.payload_reference for update;
    evaluated_at := clock_timestamp();
    if recovery.state = 'claimed' and recovery.lock_deadline > evaluated_at then continue; end if;
    update app.outbox_job as outbox set state = case
        when current_delivery.state = 'delivered' then 'sent'
        when current_delivery.state = 'suppressed' then 'suppressed' else 'dead' end,
      lock_owner = null, lock_deadline = null, completed_at = evaluated_at, updated_at = evaluated_at,
      last_safe_error = case when current_delivery.state in ('delivered', 'permanent_failure', 'suppressed')
        then 'delivery_terminal' else 'delivery_attempts_exhausted' end
    where outbox.id = recovery.id;
    if current_delivery.state not in ('delivered', 'permanent_failure', 'suppressed') then
      update app.notification_delivery as target_delivery set state = 'permanent_failure',
        safe_failure_class = 'delivery_attempts_exhausted', updated_at = evaluated_at where target_delivery.id = current_delivery.id;
      insert into ops.operational_alert(alert_type, account_id, safe_reference)
        select 'notification.delivery_attempts_exhausted', recipient.recipient_account_id, current_delivery.public_id
        from app.notification as recipient where recipient.id = current_delivery.notification_id;
    end if;
  end loop;
  select to_jsonb(claimed) into job from ops.claim_notification_jobs_v2(p_lease_token, 1, p_channels) as claimed;
  if job is null then return null; end if;
  -- A separate statement observes the completed helper's current write, not its outer snapshot.
  select outbox.lock_deadline into deadline from app.outbox_job as outbox where outbox.public_id = (job->>'job_id')::uuid;
  return job || jsonb_build_object('lease_until', deadline, 'evaluated_at', clock_timestamp());
end;
$$;
revoke all on function api.notification_worker_claim_job_v3(uuid,text[]) from public, anon, authenticated, service_role;
grant execute on function api.notification_worker_claim_job_v3(uuid,text[]) to service_role;
