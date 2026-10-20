-- Additive lease timing for the bounded application runner; preserve the existing API/ACL.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('api.church_invite_worker_claim(uuid,integer)'::regprocedure);
  if position('''evaluated_at''' in definition) > 0 then return; end if;
  if position('select mail.invite_id' in definition) = 0
    or position('lease_until = clock_timestamp() + interval ''2 minutes''' in definition) = 0
    or position('returning mail.invite_id, mail.dispatch_id, mail.token_value, mail.attempt_count' in definition) = 0
    or position('''attempt_count'', claimed.attempt_count' in definition) = 0 then
    raise exception using errcode = '55000', message = 'Unexpected invitation claim definition.';
  end if;
  definition := replace(definition, 'select mail.invite_id', 'select mail.invite_id, invite.expires_at as invite_expires_at');
  definition := replace(definition, 'lease_until = clock_timestamp() + interval ''2 minutes''',
    'lease_until = least(clock_timestamp() + interval ''2 minutes'', selected.invite_expires_at)');
  definition := replace(definition, 'returning mail.invite_id, mail.dispatch_id, mail.token_value, mail.attempt_count',
    'returning mail.invite_id, mail.dispatch_id, mail.token_value, mail.attempt_count, mail.lease_until');
  definition := replace(definition, '''attempt_count'', claimed.attempt_count',
    '''attempt_count'', claimed.attempt_count, ''lease_until'', claimed.lease_until, ''evaluated_at'', clock_timestamp()');
  execute definition;
end;
$$;

alter function api.church_invite_worker_claim(uuid,integer) set lock_timeout = '5s';

-- Reject unsafe mailboxes before reserving a seat; legacy invalid recipients are handled by
-- bounded permanent mail completion, not by changing their invitation/membership state.
do $$
declare definition text; marker text := 'or char_length(normalized_email) not between 3 and 254';
begin
  definition := pg_get_functiondef('api.invite_church_admin(uuid,text,boolean,uuid)'::regprocedure);
  if position('normalized_email ~ ''[[:cntrl:]]''' in definition) > 0 then return; end if;
  if position(marker in definition) = 0 then
    raise exception using errcode = '55000', message = 'Unexpected invitation preparation definition.';
  end if;
  execute replace(definition, marker, marker || E'\n    or normalized_email ~ ''[[:cntrl:]]''');
end;
$$;

create or replace function api.church_invite_worker_complete(
  p_job_id uuid, p_lease_token uuid, p_outcome text, p_provider_reference text default null
)
returns boolean language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  claimed private.church_invite_mail%rowtype;
  invitation app.church_admin_invite%rowtype;
  target_invite uuid;
  evaluated_at timestamptz;
begin
  if p_job_id is null or p_lease_token is null or p_outcome is null
    or p_outcome not in ('sent', 'temporary_failure', 'permanent_failure')
    or (p_provider_reference is not null and p_provider_reference !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception using errcode = '22023', message = 'Invitation worker completion is invalid.';
  end if;
  select mail.invite_id into target_invite from private.church_invite_mail as mail where mail.dispatch_id = p_job_id;
  if not found then return false; end if;
  -- Same invitation-before-mail order as acceptance, resend, cancellation, and expiry.
  select * into invitation from app.church_admin_invite as invite where invite.id = target_invite for share;
  if not found then return false; end if;
  select * into claimed from private.church_invite_mail as mail where mail.invite_id = target_invite for update;
  evaluated_at := clock_timestamp();
  if not found or claimed.dispatch_id is distinct from p_job_id or claimed.state <> 'claimed'
    or claimed.lease_token is distinct from p_lease_token or claimed.lease_until <= evaluated_at
    or invitation.state <> 'pending' or invitation.expires_at <= evaluated_at then return false; end if;
  update private.church_invite_mail as mail
  set state = case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'temporary_failure' and claimed.attempt_count < 5 then 'queued'
      else 'dead' end,
    next_attempt_at = case when p_outcome = 'temporary_failure' then
      evaluated_at + make_interval(mins => (2 ^ least(claimed.attempt_count, 5))::integer)
      else mail.next_attempt_at end,
    lease_token = null, lease_until = null,
    token_value = case when p_outcome = 'permanent_failure'
      or (p_outcome = 'temporary_failure' and claimed.attempt_count >= 5)
      then repeat('0', 64) else mail.token_value end,
    provider_reference = case when p_outcome = 'sent' then p_provider_reference else null end,
    updated_at = evaluated_at
  where mail.invite_id = claimed.invite_id;
  return true;
end;
$$;

revoke all on function api.church_invite_worker_complete(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.church_invite_worker_complete(uuid,uuid,text,text) to service_role;
