-- Manual representative review remains outside the application. This swaps one church seat, not identity or history.
alter table ops.owner_operation add column if not exists replacement_account_id uuid
  references app.account(id) on delete restrict;
do $$
declare item record; expression text;
begin
  for item in select * from (values
    ('owner_operation_operation_type_check', 'replace_church_admin', 'operation_type = ''replace_church_admin'''),
    ('owner_operation_reason', 'reviewed_membership_replacement',
      'operation_type = ''replace_church_admin'' and reason_code = ''reviewed_membership_replacement''')
  ) as additions(constraint_name, marker, extension)
  loop
    select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
      where conrelid = 'ops.owner_operation'::regclass and conname = item.constraint_name;
    if position(item.marker in expression) > 0 then continue; end if;
    execute format('alter table ops.owner_operation drop constraint %I', item.constraint_name);
    execute format('alter table ops.owner_operation add constraint %I check ((%s) or (%s))',
      item.constraint_name, expression, item.extension);
  end loop;
  alter table ops.owner_operation drop constraint owner_operation_membership_target;
  alter table ops.owner_operation add constraint owner_operation_membership_target
    check ((operation_type in ('remove_church_admin', 'replace_church_admin')) = (target_membership_id is not null));
  if not exists (select 1 from pg_constraint where conrelid = 'ops.owner_operation'::regclass
    and conname = 'owner_operation_replacement_target') then
    alter table ops.owner_operation add constraint owner_operation_replacement_target
      check ((operation_type = 'replace_church_admin') = (replacement_account_id is not null));
  end if;
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'ops.audit_event'::regclass and conname = 'audit_event_operator_shape';
  if position('reviewed_membership_replacement' in expression) = 0 then
    if position('''reviewed_invite_cancellation''' in expression) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected operational audit boundary.';
    end if;
    alter table ops.audit_event drop constraint audit_event_operator_shape;
    execute 'alter table ops.audit_event add constraint audit_event_operator_shape check (' ||
      replace(expression, '''reviewed_invite_cancellation''', '''reviewed_invite_cancellation'', ''reviewed_membership_replacement''') || ')';
  end if;
end; $$;

-- The lock order is church slot/church/operation, then incoming Auth/account/contact, then legal metadata/evidence.
-- SHARE protects eligibility through the swap; the short legal table lock also excludes publication phantoms.
create or replace function ops.lock_church_replacement_actor(p_account_id uuid)
returns void language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare current_terms uuid;
begin
  perform 1 from auth.users where id = p_account_id for share;
  if not found then raise exception using errcode = '42501', message = 'Replacement account is unavailable.'; end if;
  perform 1 from app.account where id = p_account_id for share;
  if not found then raise exception using errcode = '42501', message = 'Replacement account is unavailable.'; end if;
  perform 1 from private.account_contact where account_id = p_account_id for share;
  if not found then raise exception using errcode = '42501', message = 'Replacement account is unavailable.'; end if;
  lock table app.legal_document_version in share mode;
  current_terms := app.current_legal_document_id('terms', clock_timestamp());
  perform 1 from app.legal_acceptance where account_id = p_account_id
    and document_version_id = current_terms and acceptance_type = 'terms_explicit' for share;
  if not found or not coalesce((app.current_eligibility_result(p_account_id)->>'eligible')::boolean, false)
    or not exists (select 1 from auth.users as identity join private.account_contact as contact on contact.account_id = identity.id
      where identity.id = p_account_id and lower(identity.email) = contact.email_normalized and identity.email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'Replacement account is unavailable.';
  end if;
end; $$;

-- Only a digest leaves this ungranted function. No contact/identity values enter the preview, stored payload, or audit.
create or replace function ops.church_admin_replacement_fingerprint(p_church_id uuid, p_account_id uuid)
returns text language sql volatile security definer set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'church', ops.church_lifecycle_state(p_church_id),
    'replacement', jsonb_build_object('public_id', account.public_id, 'status', account.status,
      'updated_at', account.updated_at, 'adult_declared_at', account.adult_declared_at,
      'identity_updated_at', identity.updated_at, 'email_confirmed_at', identity.email_confirmed_at,
      'email', identity.email, 'contact_email', contact.email_normalized,
      'email_changed_at', contact.email_changed_at, 'phone_changed_at', contact.phone_changed_at,
      'phone_verified_at', contact.phone_verified_at,
      'terms_id', app.current_legal_document_id('terms', clock_timestamp()),
      'eligibility', app.current_eligibility_result(account.id)))::text, 'UTF8'), 'sha256'), 'hex')
  from app.account as account join auth.users as identity on identity.id = account.id
    join private.account_contact as contact on contact.account_id = account.id where account.id = p_account_id;
$$;

create or replace function ops.prepare_church_admin_replacement(
  p_church_id uuid, p_membership_id uuid, p_replacement_account_id uuid, p_support_reference text
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  church_internal_id uuid; incoming_id uuid; member app.church_admin_membership%rowtype;
  target jsonb; preview jsonb; operation ops.owner_operation%rowtype;
  capability text := encode(extensions.gen_random_bytes(32), 'hex');
  operator_id text := encode(extensions.digest(convert_to(session_user::text, 'UTF8'), 'sha256'), 'hex');
  prepared_time timestamptz;
begin
  if session_user in ('authenticator', 'anon', 'authenticated', 'service_role') then
    raise exception using errcode = '42501', message = 'Separate operational authentication is required.';
  end if;
  if p_church_id is null or p_membership_id is null or p_replacement_account_id is null or p_support_reference is null
    or p_support_reference !~ '^[A-Z0-9][A-Z0-9._-]{3,63}$' then
    raise exception using errcode = '22023', message = 'Church replacement operation input is invalid.';
  end if;
  select id into church_internal_id from app.church where public_id = p_church_id;
  if church_internal_id is null then raise exception using errcode = 'P0002', message = 'Church is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-admin-slots:' || church_internal_id::text, 0));
  perform 1 from app.church where id = church_internal_id for update;
  select * into member from app.church_admin_membership where church_id = church_internal_id
    and public_id = p_membership_id and status in ('active', 'transferring');
  if not found or exists (select 1 from app.church_admin_invite where transfer_membership_id = member.id and state = 'pending') then
    raise exception using errcode = 'PT409', message = 'Membership or pending transfer must be resolved first.';
  end if;
  select id into incoming_id from app.account where public_id = p_replacement_account_id;
  if incoming_id is null or exists (select 1 from app.church_admin_membership where church_id = church_internal_id
    and account_id = incoming_id and status in ('active', 'transferring')) then
    raise exception using errcode = '42501', message = 'Replacement account is unavailable.';
  end if;
  perform ops.lock_church_replacement_actor(incoming_id);
  target := ops.church_lifecycle_state(church_internal_id);
  preview := (target - array['administrator_ids', 'pending_request_ids', 'pending_invite_ids', 'updated_at'])
    || jsonb_build_object('membership_id', p_membership_id, 'replacement_account_id', p_replacement_account_id,
      'administrator_count', jsonb_array_length(target->'administrator_ids'),
      'pending_archival_requests', jsonb_array_length(target->'pending_request_ids'),
      'pending_invitations', jsonb_array_length(target->'pending_invite_ids'));
  prepared_time := clock_timestamp();
  insert into ops.owner_operation(operation_type, church_id, target_membership_id, replacement_account_id,
    target_preview, target_fingerprint, support_reference, reason_code, token_hash, prepared_by, prepared_at, expires_at)
  values ('replace_church_admin', church_internal_id, member.id, incoming_id, preview,
    ops.church_admin_replacement_fingerprint(church_internal_id, incoming_id), p_support_reference,
    'reviewed_membership_replacement', encode(extensions.digest(convert_to(capability, 'UTF8'), 'sha256'), 'hex'),
    operator_id, prepared_time, prepared_time + interval '15 minutes') returning * into operation;
  return jsonb_build_object('operation_id', operation.id, 'operation_type', operation.operation_type,
    'preview', preview, 'token', capability, 'expires_at', operation.expires_at);
end; $$;

create or replace function ops.apply_church_admin_replacement(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  operation ops.owner_operation%rowtype; member app.church_admin_membership%rowtype;
  church_row app.church%rowtype; incoming_public_id uuid; new_membership_id uuid;
  recipient record; operation_result jsonb; audit_id uuid;
begin
  select * into strict operation from ops.owner_operation where id = p_operation_id;
  select * into strict church_row from app.church where id = operation.church_id;
  select public_id into strict incoming_public_id from app.account where id = operation.replacement_account_id;
  select * into member from app.church_admin_membership where id = operation.target_membership_id
    and church_id = operation.church_id and status in ('active', 'transferring') for update;
  if not found or operation.operation_type <> 'replace_church_admin' or operation.state <> 'prepared'
    or exists (select 1 from app.church_admin_invite where transfer_membership_id = member.id and state = 'pending')
    or exists (select 1 from app.church_admin_membership where church_id = church_row.id
      and account_id = operation.replacement_account_id and status in ('active', 'transferring')) then
    raise exception using errcode = 'PT409', message = 'Membership or pending transfer must be resolved first.';
  end if;
  update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = member.id;
  insert into app.church_admin_membership(church_id, account_id, access_source)
    values (church_row.id, operation.replacement_account_id, 'protected_repair') returning public_id into new_membership_id;
  insert into app.church_admin_event(church_id, subject_account_id, event_type) values
    (church_row.id, member.account_id, 'membership.removed'),
    (church_row.id, operation.replacement_account_id, 'membership.joined');
  for recipient in select account_id from app.church_admin_membership where church_id = church_row.id
    and status in ('active', 'transferring') union select member.account_id
  loop
    perform app.create_notification_once(recipient.account_id, 'church-admin-replaced:' || operation.id::text,
      'church.admin.replaced', 'church', church_row.public_id, '/churches/' || church_row.slug,
      'notifications.church_admin_removed', jsonb_build_object('church_id', church_row.public_id), 50);
  end loop;
  insert into ops.audit_event(event_key, actor_kind, operator_fingerprint, support_reference, reason_code,
    action_type, target_type, target_id, changed_fields)
  values ('owner-operation:' || operation.id::text, 'operator', operation.prepared_by,
    operation.support_reference, operation.reason_code, 'membership.transferred', 'church', church_row.public_id,
    array['administrator_membership']) returning id into audit_id;
  operation_result := jsonb_build_object('operation_id', operation.id, 'church_id', church_row.public_id,
    'membership_id', member.public_id, 'replacement_account_id', incoming_public_id,
    'replacement_membership_id', new_membership_id, 'status', 'replaced');
  update ops.owner_operation set state = 'succeeded', executed_by = prepared_by, executed_at = clock_timestamp(),
    result = operation_result, audit_event_id = audit_id where id = operation.id;
  return operation_result;
end; $$;

do $$
declare definition text; item record;
begin
  definition := pg_get_functiondef('ops.apply_church_lifecycle(uuid,text)'::regprocedure);
  if position('return ops.apply_church_admin_replacement(operation.id)' in definition) = 0 then
    for item in select * from (values
      ('if operation.expires_at <= clock_timestamp() then',
       'if operation.operation_type = ''replace_church_admin'' then perform ops.lock_church_replacement_actor(operation.replacement_account_id); end if; if operation.expires_at <= clock_timestamp() then'),
      ('encode(extensions.digest(convert_to(target::text, ''UTF8''), ''sha256''), ''hex'') then',
       '(case when operation.operation_type = ''replace_church_admin'' then ops.church_admin_replacement_fingerprint(operation.church_id, operation.replacement_account_id) else encode(extensions.digest(convert_to(target::text, ''UTF8''), ''sha256''), ''hex'') end) then'),
      ('if operation.operation_type = ''hide_church'' then',
       'if operation.operation_type = ''replace_church_admin'' then return ops.apply_church_admin_replacement(operation.id); end if; if operation.operation_type = ''hide_church'' then')
    ) as replacements(original, replacement)
    loop
      if position(item.original in definition) = 0 then
        raise exception using errcode = '55000', message = 'Unexpected protected church operation dispatcher.';
      end if;
      definition := replace(definition, item.original, item.replacement);
    end loop;
    execute definition;
  end if;
end; $$;
revoke all on function ops.lock_church_replacement_actor(uuid), ops.church_admin_replacement_fingerprint(uuid,uuid),
  ops.prepare_church_admin_replacement(uuid,uuid,uuid,text), ops.apply_church_admin_replacement(uuid)
  from public, anon, authenticated, service_role, orthodox_routes_church_operator;
grant execute on function ops.prepare_church_admin_replacement(uuid,uuid,uuid,text) to orthodox_routes_church_operator;
