-- Delivery metadata shares the draft row lock. Clear email capabilities exist only in a worker lease.
alter table private.complaint_email_draft
  add column mail_state text not null default 'queued'
    check (mail_state in ('queued', 'claimed', 'sent', 'failed', 'closed')),
  add column mail_attempt_count integer not null default 0 check (mail_attempt_count between 0 and 5),
  add column mail_next_at timestamptz not null default clock_timestamp(),
  add column mail_job_id uuid,
  add column mail_lease_hash text,
  add column mail_lease_until timestamptz,
  add constraint complaint_mail_lease_shape check (
    (mail_state = 'claimed' and mail_job_id is not null and mail_lease_hash ~ '^[0-9a-f]{64}$'
      and mail_lease_hash is not null and mail_lease_until is not null)
    or (mail_state <> 'claimed' and mail_job_id is null and mail_lease_hash is null and mail_lease_until is null));
create index complaint_proof_mail_due on private.complaint_email_draft(mail_next_at)
  where state = 'pending_email' and mail_state in ('queued', 'claimed');
update private.complaint_email_draft set mail_state = 'closed' where state <> 'pending_email';

create or replace function app.expire_complaint_email_draft(p_draft_id uuid, p_evaluated_at timestamptz default clock_timestamp())
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update private.complaint_email_draft set state = 'expired', expired_at = p_evaluated_at,
    reporter_account_id = null, target_type = null, target_public_id = null, category = null,
    description = null, reply_email = null, language = null, resume_hash = null, email_token_hash = null,
    input_digest = null, verified_at = null, mail_state = 'closed',
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null
  where id = p_draft_id and state <> 'expired' and expires_at <= p_evaluated_at;
  return found;
end;
$$;
revoke all on function app.expire_complaint_email_draft(uuid, timestamptz) from public, anon, authenticated, service_role;

create function api.complaint_proof_mail_claim(p_lease_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare draft private.complaint_email_draft%rowtype; proof text; evaluated_at timestamptz;
begin
  if p_lease_token is null then return null; end if;
  -- A crashed final attempt must not leave a logically live claim indefinitely.
  update private.complaint_email_draft set mail_state = 'failed',
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null
  where id in (select candidate.id from private.complaint_email_draft as candidate
    where candidate.state = 'pending_email' and candidate.mail_state = 'claimed'
      and candidate.mail_attempt_count = 5 and candidate.mail_lease_until <= clock_timestamp()
    order by candidate.mail_lease_until, candidate.id limit 50 for update skip locked);
  select * into draft from private.complaint_email_draft as candidate
    where candidate.state = 'pending_email' and candidate.expires_at > clock_timestamp()
      and candidate.mail_attempt_count < 5 and candidate.mail_next_at <= clock_timestamp()
      and (candidate.mail_state = 'queued'
        or (candidate.mail_state = 'claimed' and candidate.mail_lease_until <= clock_timestamp()))
    order by candidate.mail_next_at, candidate.id limit 1 for update skip locked;
  if not found then return null; end if;
  evaluated_at := clock_timestamp();
  if app.expire_complaint_email_draft(draft.id, evaluated_at) then return null; end if;
  proof := encode(extensions.gen_random_bytes(32), 'hex');
  update private.complaint_email_draft set mail_state = 'claimed',
    mail_attempt_count = mail_attempt_count + 1, mail_job_id = gen_random_uuid(),
    mail_lease_hash = encode(extensions.digest(convert_to(p_lease_token::text, 'UTF8'), 'sha256'), 'hex'),
    mail_lease_until = least(evaluated_at + interval '45 seconds', expires_at),
    email_token_hash = encode(extensions.digest(convert_to(proof, 'UTF8'), 'sha256'), 'hex')
  where id = draft.id returning * into draft;
  return jsonb_build_object('draft_id', draft.id, 'job_id', draft.mail_job_id,
    'attempt_count', draft.mail_attempt_count, 'destination_email', draft.reply_email,
    'language', draft.language, 'email_token', proof, 'expires_at', draft.expires_at,
    'lease_until', draft.mail_lease_until, 'evaluated_at', evaluated_at);
end;
$$;

create function api.complaint_proof_mail_complete(p_job_id uuid, p_lease_token uuid, p_outcome text)
returns boolean language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare draft private.complaint_email_draft%rowtype; evaluated_at timestamptz;
begin
  if p_job_id is null or p_lease_token is null or p_outcome is null
    or p_outcome not in ('sent', 'temporary_failure', 'permanent_failure') then return false; end if;
  select * into draft from private.complaint_email_draft as item where item.mail_job_id = p_job_id for update;
  if not found then return false; end if;
  evaluated_at := clock_timestamp();
  if app.expire_complaint_email_draft(draft.id, evaluated_at) then return false; end if;
  if draft.mail_state <> 'claimed' or draft.mail_lease_until <= evaluated_at
    or draft.mail_lease_hash is distinct from encode(extensions.digest(convert_to(p_lease_token::text, 'UTF8'), 'sha256'), 'hex')
    then return false; end if;
  update private.complaint_email_draft set
    mail_state = case when state = 'email_verified' then 'closed' when p_outcome = 'sent' then 'sent'
      when p_outcome = 'temporary_failure' and mail_attempt_count < 5 then 'queued' else 'failed' end,
    mail_next_at = evaluated_at + make_interval(secs => least(30 * (2 ^ (mail_attempt_count - 1))::integer, 240)),
    mail_job_id = null, mail_lease_hash = null, mail_lease_until = null
  where id = draft.id;
  return true;
end;
$$;

revoke all on function api.complaint_proof_mail_claim(uuid), api.complaint_proof_mail_complete(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function api.complaint_proof_mail_claim(uuid), api.complaint_proof_mail_complete(uuid, uuid, text)
  to service_role;
