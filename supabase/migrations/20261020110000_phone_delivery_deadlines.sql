-- A lease deadline is frozen on the transient OTP delivery, never in an ordinary response.
alter table ops.phone_verification_delivery add column if not exists lease_until timestamptz;

create or replace function ops.claim_phone_verification_delivery_target(p_attempt_id uuid, p_lease_token uuid)
returns table(attempt_id uuid, phone_e164 text, verification_code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  material ops.phone_verification_delivery%rowtype;
  attempt ops.phone_verification_attempt%rowtype;
  lease_seconds integer;
  evaluated_at timestamptz;
begin
  if p_lease_token is null then return; end if;
  -- Match completion/supersession lock order; never return code from a stale attempt snapshot.
  select * into material from ops.phone_verification_delivery as target
    where target.attempt_id = p_attempt_id for update skip locked;
  if not found then return; end if;
  select * into attempt from ops.phone_verification_attempt as target where target.id = p_attempt_id for update;
  select phone_delivery_lease_seconds into strict lease_seconds from ops.security_policy where singleton;
  evaluated_at := clock_timestamp();
  if attempt.state <> 'queued' or attempt.expires_at <= evaluated_at then
    update ops.phone_verification_attempt as target set state = 'expired', code_salt = null, code_digest = null
      where target.id = p_attempt_id and target.state in ('queued', 'sent') and target.expires_at <= evaluated_at;
    delete from ops.phone_verification_delivery as target where target.attempt_id = p_attempt_id;
    return;
  end if;
  if material.state = 'leased' and coalesce(material.lease_until,
    material.leased_at + make_interval(secs => lease_seconds)) > evaluated_at then return; end if;
  update ops.phone_verification_delivery as target set state = 'leased', lease_token = p_lease_token,
    leased_at = evaluated_at, lease_until = least(attempt.expires_at, evaluated_at + make_interval(secs => lease_seconds))
    where target.attempt_id = p_attempt_id;
  return query select attempt.id, attempt.phone_e164, material.code, attempt.expires_at;
end;
$$;

-- The ungranted legacy batch helper keeps its four-column shape. A reclaim resets any
-- deadline left by a newer worker; completion derives the bounded legacy lease below.
do $$ declare definition text; begin
  definition := pg_get_functiondef('ops.claim_phone_verification_deliveries(uuid,integer)'::regprocedure);
  if position('lease_until = null' in definition) = 0 then
    if position('leased_at = now()' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected legacy phone claim definition.';
    end if;
    execute replace(definition, 'leased_at = now()', 'leased_at = clock_timestamp(), lease_until = null');
  end if;
end; $$;

create or replace function ops.complete_phone_verification_delivery(p_attempt_id uuid, p_lease_token uuid,
  p_delivered boolean, p_provider_adapter text, p_provider_reference text default null)
returns boolean language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  material ops.phone_verification_delivery%rowtype;
  attempt ops.phone_verification_attempt%rowtype;
  evaluated_at timestamptz;
  deadline timestamptz;
begin
  if p_delivered is null or p_provider_adapter is null or char_length(btrim(p_provider_adapter)) not between 1 and 64
    or p_provider_adapter ~ '[[:cntrl:]]' or coalesce(char_length(p_provider_reference), 0) > 256
    or coalesce(p_provider_reference, '') ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'The phone delivery result is invalid.';
  end if;
  select * into material from ops.phone_verification_delivery as target where target.attempt_id = p_attempt_id
    and target.state = 'leased' and target.lease_token = p_lease_token for update;
  if not found then return false; end if;
  select * into attempt from ops.phone_verification_attempt as target where target.id = p_attempt_id for update;
  evaluated_at := clock_timestamp();
  if attempt.state <> 'queued' then return false; end if;
  if attempt.expires_at <= evaluated_at then
    update ops.phone_verification_attempt as target set state = 'expired', code_salt = null, code_digest = null where target.id = p_attempt_id;
    delete from ops.phone_verification_delivery as target where target.attempt_id = p_attempt_id;
    return false;
  end if;
  select coalesce(material.lease_until, material.leased_at + make_interval(secs => policy.phone_delivery_lease_seconds))
    into deadline from ops.security_policy as policy where policy.singleton;
  if deadline is null or deadline <= evaluated_at then return false; end if;
  update ops.phone_verification_attempt as target set state = case when p_delivered then 'sent' else 'failed' end,
    sent_at = case when p_delivered then evaluated_at else target.sent_at end,
    code_salt = case when p_delivered then target.code_salt else null end,
    code_digest = case when p_delivered then target.code_digest else null end,
    provider_adapter = btrim(p_provider_adapter), provider_reference = nullif(btrim(p_provider_reference), '')
    where target.id = p_attempt_id;
  delete from ops.phone_verification_delivery as target where target.attempt_id = p_attempt_id;
  return true;
end;
$$;

create or replace function api.phone_worker_claim_delivery_v3(p_attempt_id uuid, p_lease_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare job jsonb; metadata record;
begin
  select to_jsonb(claimed) into job from ops.claim_phone_verification_delivery_target(p_attempt_id, p_lease_token) as claimed;
  if job is null then return null; end if;
  select attempt.sms_template_version, attempt.sms_language, material.lease_until into metadata
    from ops.phone_verification_attempt as attempt join ops.phone_verification_delivery as material on material.attempt_id = attempt.id
    where attempt.id = p_attempt_id;
  return job || jsonb_build_object('sms_template_version', metadata.sms_template_version, 'sms_language', metadata.sms_language,
    'lease_until', metadata.lease_until, 'evaluated_at', clock_timestamp());
end;
$$;
revoke all on function ops.claim_phone_verification_delivery_target(uuid,uuid),
  ops.complete_phone_verification_delivery(uuid,uuid,boolean,text,text), api.phone_worker_claim_delivery_v3(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.phone_worker_claim_delivery_v3(uuid,uuid) to service_role;

-- Verification must not accept an expired code after either row/index wait. Acquire
-- the contact before the attempt, matching request/supersession, and roll back a
-- tentative binding if waiting for the unique phone index consumed the code lifetime.
do $$ declare definition text; begin
  definition := pg_get_functiondef('api.verify_phone_code(uuid,text)'::regprocedure);
  if position('Phone verification expired during binding.' in definition) = 0 then
    if position('verified_time timestamptz := clock_timestamp();' in definition) = 0
      or position('where id = p_attempt_id and account_id = actor_id for update;' in definition) = 0
      or position('exception when unique_violation then' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected phone verification definition.';
    end if;
    definition := replace(definition, 'verified_time timestamptz := clock_timestamp();', 'verified_time timestamptz;');
    definition := replace(definition, '  select * into attempt from ops.phone_verification_attempt',
      '  perform 1 from private.account_contact where account_id = actor_id for update;
  select * into attempt from ops.phone_verification_attempt');
    definition := replace(definition, 'where id = p_attempt_id and account_id = actor_id for update;',
      'where id = p_attempt_id and account_id = actor_id for update;
  verified_time := clock_timestamp();');
    definition := replace(definition, 'exception when unique_violation then',
      '  if found and attempt.expires_at <= clock_timestamp() then
      raise exception using errcode = ''PT408'', message = ''Phone verification expired during binding.'';
    end if;
  exception when sqlstate ''PT408'' then
    update ops.phone_verification_attempt set state = ''expired'', code_salt = null, code_digest = null where id = attempt.id;
    return jsonb_build_object(''status'', ''expired'');
  when unique_violation then');
    execute definition;
  end if;
end; $$;
alter function api.verify_phone_code(uuid,text) set lock_timeout = '5s';
