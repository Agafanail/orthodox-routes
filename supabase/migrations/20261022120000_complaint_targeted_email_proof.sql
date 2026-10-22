-- A future explicit confirmation must bind the presented proof to the displayed
-- draft BEFORE mutation, not verify a different draft then compare its receipt.
create or replace function api.verify_complaint_email_draft_v2(p_draft_id uuid, p_email_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare draft private.complaint_email_draft%rowtype; evaluated_at timestamptz;
begin
  if p_draft_id is null or p_email_token is null or p_email_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into draft from private.complaint_email_draft as item
  where item.id = p_draft_id
    and item.email_token_hash = encode(extensions.digest(convert_to(p_email_token, 'UTF8'), 'sha256'), 'hex') for update;
  if not found then return null; end if;
  evaluated_at := clock_timestamp();
  if app.expire_complaint_email_draft(draft.id, evaluated_at) then
    return jsonb_build_object('draft_id', draft.id, 'status', 'expired', 'expires_at', draft.expires_at);
  end if;
  if draft.state = 'pending_email' then
    update private.complaint_email_draft set state = 'email_verified', verified_at = evaluated_at
    where id = draft.id returning * into draft;
  end if;
  return jsonb_build_object('draft_id', draft.id, 'status', draft.state, 'expires_at', draft.expires_at);
end;
$$;
revoke all on function api.verify_complaint_email_draft_v2(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.verify_complaint_email_draft_v2(uuid, text) to service_role;

-- Keep the original service-only signature/grants and token-only behavior for
-- existing workers/tests. Its lookup is not authority: v2 rechecks both facts under lock.
create or replace function api.verify_complaint_email_draft(p_email_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare draft_id uuid;
begin
  if p_email_token is null or p_email_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select item.id into draft_id from private.complaint_email_draft as item
    where item.email_token_hash = encode(extensions.digest(convert_to(p_email_token, 'UTF8'), 'sha256'), 'hex');
  return api.verify_complaint_email_draft_v2(draft_id, p_email_token);
end;
$$;

comment on function api.verify_complaint_email_draft_v2(uuid, text) is
  'Service-only target-bound mailbox proof. No account authentication, contact change, received complaint, or public endpoint.';
