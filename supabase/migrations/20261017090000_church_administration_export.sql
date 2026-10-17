-- Account-owned administration history, not a church-wide roster or private delivery export.
-- Existing church-scoped/active-only indexes do not cover these own historical selections.
create index if not exists church_admin_membership_export_account on app.church_admin_membership (account_id);
create index if not exists church_admin_invite_export_sender on app.church_admin_invite (sender_account_id);
create index if not exists church_admin_invite_export_recipient on app.church_admin_invite (accepted_account_id)
  where accepted_account_id is not null;
create index if not exists church_admin_event_export_actor on app.church_admin_event (actor_account_id)
  where actor_account_id is not null;
create index if not exists church_admin_event_export_subject on app.church_admin_event (subject_account_id)
  where subject_account_id is not null;
create index if not exists church_archive_request_export_account on app.church_archive_request (requested_by)
  where requested_by is not null;

create or replace function app.export_church_administration(p_actor_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id', membership.public_id, 'church_id', church.public_id,
      'status', membership.status, 'access_source', membership.access_source,
      'accepted_at', membership.accepted_at, 'ended_at', membership.ended_at,
      'created_at', membership.created_at, 'updated_at', membership.updated_at
    ) order by membership.created_at, membership.public_id), '[]'::jsonb)
      from app.church_admin_membership as membership join app.church as church on church.id = membership.church_id
      where membership.account_id = p_actor_id),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object(
      'invitation_id', invitation.public_id, 'church_id', church.public_id,
      'sent_by_me', invitation.sender_account_id = p_actor_id,
      'accepted_by_me', coalesce(invitation.accepted_account_id = p_actor_id, false),
      'transfers_position', invitation.transfer_membership_id is not null,
      'status', invitation.state, 'issued_at', invitation.issued_at, 'expires_at', invitation.expires_at,
      'last_sent_at', invitation.last_sent_at, 'decided_at', invitation.decided_at
    ) order by invitation.issued_at, invitation.public_id), '[]'::jsonb)
      from app.church_admin_invite as invitation join app.church as church on church.id = invitation.church_id
      where invitation.sender_account_id = p_actor_id or invitation.accepted_account_id = p_actor_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', event.id, 'church_id', church.public_id, 'event_type', event.event_type,
      'acted_by_me', coalesce(event.actor_account_id = p_actor_id, false),
      'about_me', coalesce(event.subject_account_id = p_actor_id, false), 'occurred_at', event.occurred_at
    ) order by event.occurred_at, event.id), '[]'::jsonb)
      from app.church_admin_event as event join app.church as church on church.id = event.church_id
      where event.actor_account_id = p_actor_id or event.subject_account_id = p_actor_id),
    'archival_requests', (select coalesce(jsonb_agg(jsonb_build_object(
      'request_id', request.public_id, 'church_id', church.public_id, 'status', request.status,
      'requested_at', request.requested_at, 'cancelled_at', request.cancelled_at, 'resolved_at', request.resolved_at
    ) order by request.requested_at, request.public_id), '[]'::jsonb)
      from app.church_archive_request as request join app.church as church on church.id = request.church_id
      where request.requested_by = p_actor_id)
  );
$$;
revoke all on function app.export_church_administration(uuid) from public, anon, authenticated, service_role;

-- Preserve every existing export section, account-state guard, signature, and ACL.
do $$
declare definition text; original_field text := '''personal_blocks'', (';
begin
  definition := pg_get_functiondef('api.export_current_account_data()'::regprocedure);
  if position('app.export_church_administration(actor_id)' in definition) > 0 then return; end if;
  if position(original_field in definition) = 0 then
    raise exception using errcode = '55000', message = 'Unexpected account export definition.';
  end if;
  execute replace(definition, original_field,
    '''church_administration'', app.export_church_administration(actor_id), ' || original_field);
end;
$$;
