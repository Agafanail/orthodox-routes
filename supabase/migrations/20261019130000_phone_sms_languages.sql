-- Existing attempts retain their exact legacy Russian provider body. New attempts freeze a six-language template.
alter table ops.phone_verification_attempt
  add column if not exists sms_template_version smallint not null default 1,
  add column if not exists sms_language text not null default 'ru';
alter table ops.phone_verification_attempt alter column sms_template_version drop default,
  alter column sms_language drop default;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'ops.phone_verification_attempt'::regclass
    and conname = 'phone_verification_sms_template') then
    alter table ops.phone_verification_attempt add constraint phone_verification_sms_template check (
      (sms_template_version = 1 and sms_language = 'ru')
      or (sms_template_version = 2 and sms_language in ('de', 'en', 'it', 'ro', 'ru', 'uk'))
    );
  end if;
end; $$;

create or replace function ops.freeze_phone_sms_template()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.sms_template_version is distinct from old.sms_template_version or new.sms_language is distinct from old.sms_language then
      raise exception using errcode = '23514', message = 'Phone delivery template is immutable.';
    end if;
  elsif new.sms_template_version is null then
    new.sms_template_version := 2;
    select preferred_language into new.sms_language from app.account where id = new.account_id;
    if not found then raise exception using errcode = '23503', message = 'Phone account is unavailable.'; end if;
  elsif new.sms_template_version = 1 and new.sms_language is null then
    new.sms_language := 'ru';
  end if;
  return new;
end; $$;
create or replace trigger freeze_phone_sms_template before insert or update of sms_template_version, sms_language
  on ops.phone_verification_attempt for each row execute function ops.freeze_phone_sms_template();
revoke all on function ops.freeze_phone_sms_template() from public, anon, authenticated, service_role;

-- Preserve the old four-column external contract and exact claim body; only a version-aware worker may claim v2.
do $$ begin
  if to_regprocedure('ops.claim_phone_verification_delivery_target(uuid,uuid)') is null then
    alter function api.phone_worker_claim_delivery(uuid,uuid) set schema ops;
    alter function ops.phone_worker_claim_delivery(uuid,uuid) rename to claim_phone_verification_delivery_target;
  end if;
end; $$;
revoke all on function ops.claim_phone_verification_delivery_target(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function api.phone_worker_claim_delivery(p_attempt_id uuid, p_lease_token uuid)
returns table(attempt_id uuid, phone_e164 text, verification_code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not exists (select 1 from ops.phone_verification_attempt where id = p_attempt_id and sms_template_version = 1) then return; end if;
  return query select * from ops.claim_phone_verification_delivery_target(p_attempt_id, p_lease_token);
end; $$;

create or replace function api.phone_worker_claim_delivery_v2(p_attempt_id uuid, p_lease_token uuid)
returns table(attempt_id uuid, phone_e164 text, verification_code text, expires_at timestamptz,
  sms_template_version smallint, sms_language text)
language sql volatile security definer set search_path = ''
as $$
  select claimed.attempt_id, claimed.phone_e164, claimed.verification_code, claimed.expires_at,
    attempt.sms_template_version, attempt.sms_language
  from ops.claim_phone_verification_delivery_target(p_attempt_id, p_lease_token) as claimed
  join ops.phone_verification_attempt as attempt on attempt.id = claimed.attempt_id;
$$;
revoke all on function api.phone_worker_claim_delivery(uuid,uuid), api.phone_worker_claim_delivery_v2(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function api.phone_worker_claim_delivery(uuid,uuid), api.phone_worker_claim_delivery_v2(uuid,uuid) to service_role;
