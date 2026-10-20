-- Auth remains canonical. A copied address is not a verified current binding merely
-- because that same identity has some confirmed email. Do not repair/retarget it here.
create or replace function app.current_email_is_verified(p_account_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users as identity where identity.id = p_account_id
    and identity.email_confirmed_at is not null and nullif(btrim(identity.email), '') is not null
    and (not exists (select 1 from app.account as account where account.id = p_account_id)
      or exists (select 1 from private.account_contact as contact where contact.account_id = p_account_id
        and contact.email_normalized = lower(btrim(identity.email)))));
$$;
revoke all on function app.current_email_is_verified(uuid) from public, anon, authenticated, service_role;

create or replace function app.notification_email_destination_is_current(p_delivery_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from app.notification_delivery as delivery
    join app.notification as notification on notification.id = delivery.notification_id
    join private.notification_destination as destination on destination.delivery_id = delivery.id
    join private.account_contact as contact on contact.account_id = notification.recipient_account_id
    join auth.users as identity on identity.id = contact.account_id
    where delivery.id = p_delivery_id and delivery.channel = 'email'
      and identity.email_confirmed_at is not null
      and contact.email_normalized = lower(btrim(identity.email))
      and destination.destination_value = contact.email_normalized);
$$;
revoke all on function app.notification_email_destination_is_current(uuid) from public, anon, authenticated, service_role;

do $$
declare definition text; signature text; anchor text;
begin
  definition := pg_get_functiondef('app.current_eligibility_result(uuid)'::regprocedure);
  if position('app.current_email_is_verified(actor_id)' in definition) = 0 then
    anchor := 'select coalesce(identity.email_confirmed_at is not null, false)
  into email_verified
  from auth.users as identity
  where identity.id = actor_id;';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected email eligibility definition.'; end if;
    execute replace(definition, anchor, 'email_verified := app.current_email_is_verified(actor_id);');
  end if;
  definition := pg_get_functiondef('app.has_effective_external_channel(uuid,boolean,boolean,uuid)'::regprocedure);
  if position('contact.email_normalized = lower(btrim(identity.email))' in definition) = 0 then
    anchor := 'and identity.email_confirmed_at is not null';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected email channel definition.'; end if;
    execute replace(definition, anchor, anchor || ' and contact.email_normalized = lower(btrim(identity.email))');
  end if;
  definition := pg_get_functiondef('app.create_notification(uuid,text,text,uuid,text,text,jsonb,integer)'::regprocedure);
  if position('contact.email_normalized = lower(btrim(identity.email))' in definition) = 0 then
    anchor := 'where contact.account_id = requested_recipient and identity.email_confirmed_at is not null';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected notification email definition.'; end if;
    execute replace(definition, anchor, anchor || ' and contact.email_normalized = lower(btrim(identity.email))');
  end if;
  foreach signature in array array['ops.claim_notification_jobs(uuid,integer)', 'ops.claim_notification_jobs_v2(uuid,integer,text[])'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('app.notification_email_destination_is_current' in definition) = 0 then
      anchor := 'and job.attempt_count < 5';
      if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected notification email claim definition.'; end if;
      execute replace(definition, anchor, anchor || '
      and not exists (select 1 from app.notification_delivery as email_delivery where email_delivery.id = job.payload_reference
        and email_delivery.channel = ''email'' and not app.notification_email_destination_is_current(email_delivery.id))');
    end if;
  end loop;
  definition := pg_get_functiondef('api.notification_worker_claim_job_v3(uuid,text[])'::regprocedure);
  if position('app.notification_email_destination_is_current' in definition) = 0 then
    anchor := 'if job is null then return null; end if;';
    if position(anchor in definition) = 0 then raise exception using errcode = '55000', message = 'Unexpected notification email bridge definition.'; end if;
    execute replace(definition, anchor, anchor || '
  if job->>''channel'' = ''email'' then
    -- Pin current source rows, then re-read in a fresh statement after any row waits.
    perform 1 from app.notification_delivery as delivery
      join app.notification as notification on notification.id = delivery.notification_id
      join auth.users as identity on identity.id = notification.recipient_account_id
      join private.account_contact as contact on contact.account_id = identity.id
      where delivery.public_id = (job->>''delivery_id'')::uuid for share of identity, contact;
    if not found or not app.notification_email_destination_is_current(
      (select delivery.id from app.notification_delivery as delivery where delivery.public_id = (job->>''delivery_id'')::uuid))
    then return null; end if;
  end if;');
  end if;
end;
$$;
