-- Ordinary ride preferences cannot disable an existing account-security email.
-- Keep the event key, payload, destinations, retention and effective ride-channel rule unchanged.
create or replace function app.notification_requires_security_email(p_event_type text)
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(p_event_type = 'account.phone_changed', false); $$;
revoke all on function app.notification_requires_security_email(text) from public, anon, authenticated, service_role;

do $$
declare definition text; anchor text; marker text; occurrences integer;
begin
  definition := pg_get_functiondef('app.create_notification(uuid,text,text,uuid,text,text,jsonb,integer)'::regprocedure);
  if position('contact.email_normalized = lower(btrim(identity.email))' in definition) = 0 then
    raise exception using errcode = '55000', message = 'Current verified email guard is missing.';
  end if;
  marker := 'app.notification_requires_security_email(requested_event_type)';
  anchor := 'if preference.ride_email_enabled then';
  occurrences := (length(definition) - length(replace(definition, marker, ''))) / length(marker);
  if occurrences = 0 then
    if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
      raise exception using errcode = '55000', message = 'Unexpected notification email selection.';
    end if;
    execute replace(definition, anchor,
      'if preference.ride_email_enabled or app.notification_requires_security_email(requested_event_type) then');
  elsif occurrences <> 1 or position(anchor in definition) > 0 then
    raise exception using errcode = '55000', message = 'Unexpected mandatory email selection.';
  end if;

  definition := pg_get_functiondef('api.update_notification_preference(boolean,boolean,uuid,uuid)'::regprocedure);
  marker := 'app.notification_requires_security_email(notification.event_type)';
  anchor := '(delivery.channel = ''email'' and not p_ride_email_enabled)';
  occurrences := (length(definition) - length(replace(definition, marker, ''))) / length(marker);
  if occurrences = 0 then
    if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 2 then
      raise exception using errcode = '55000', message = 'Unexpected preference suppression definition.';
    end if;
    execute replace(definition, anchor,
      '(delivery.channel = ''email'' and not p_ride_email_enabled
        and not app.notification_requires_security_email(notification.event_type))');
  elsif occurrences <> 2 or position(anchor in definition) > 0 then
    raise exception using errcode = '55000', message = 'Unexpected mandatory email suppression guard.';
  end if;
end;
$$;
