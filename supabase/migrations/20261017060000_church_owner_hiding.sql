-- Extend the existing inactive, separately authenticated owner workflow; do not grant a new entry point.
alter table ops.owner_operation drop constraint owner_operation_operation_type_check;
alter table ops.owner_operation add constraint owner_operation_operation_type_check
  check (operation_type in ('archive_church', 'restore_church', 'hide_church'));
alter table ops.owner_operation drop constraint owner_operation_reason;
alter table ops.owner_operation add constraint owner_operation_reason check (
  (operation_type = 'archive_church' and reason_code = 'reviewed_archival')
  or (operation_type = 'restore_church' and reason_code = 'reviewed_restoration')
  or (operation_type = 'hide_church' and reason_code = 'reviewed_hiding')
);
alter table ops.audit_event drop constraint audit_event_operator_shape;
alter table ops.audit_event add constraint audit_event_operator_shape check (
  (actor_kind = 'operator' and operator_fingerprint ~ '^[0-9a-f]{64}$'
    and operator_fingerprint is not null and support_reference is not null and reason_code is not null
    and support_reference ~ '^[A-Z0-9][A-Z0-9._-]{3,63}$'
    and reason_code in ('reviewed_archival', 'reviewed_restoration', 'reviewed_hiding'))
  or (actor_kind <> 'operator' and operator_fingerprint is null
    and support_reference is null and reason_code is null)
);
do $$
declare expression text;
begin
  select pg_get_expr(conbin, conrelid) into strict expression from pg_constraint
    where conrelid = 'ops.audit_event'::regclass and conname = 'audit_event_action_type_check';
  if position('church.hidden' in expression) = 0 then
    alter table ops.audit_event drop constraint audit_event_action_type_check;
    execute format('alter table ops.audit_event add constraint audit_event_action_type_check check ((%s) or action_type = ''church.hidden'')', expression);
  end if;
end;
$$;

-- Existing equal administrators must be able to repair a hidden page before reviewed restoration.
-- Patch only these membership-checked schedule entry points, never public reads or ride publication.
do $$
declare routine record; definition text; checked_count integer := 0;
  previous_guard text := 'church_row.status <> ''published''';
  repair_guard text := 'church_row.status not in (''published'', ''hidden'')';
begin
  for routine in select routine_row.oid from pg_proc as routine_row
    join pg_namespace as namespace on namespace.oid = routine_row.pronamespace
    where namespace.nspname = 'api' and routine_row.proname in (
      'create_one_off_service', 'preview_one_off_service_cancellation', 'cancel_one_off_service',
      'update_one_off_service_content', 'update_one_off_service_time', 'create_recurring_service',
      'preview_recurring_service_date_cancellation', 'cancel_recurring_service_date',
      'reschedule_recurring_service_date', 'preview_recurring_service_future_cancellation',
      'cancel_recurring_service_future', 'update_recurring_service_date_content',
      'update_recurring_service_future_content', 'reschedule_recurring_service_future', 'extend_recurring_service'
    )
  loop
    checked_count := checked_count + 1;
    definition := pg_get_functiondef(routine.oid);
    if position('app.church_admin_membership' in definition) = 0
      or position('account_id = actor_id' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected schedule membership boundary.';
    end if;
    if position(previous_guard in definition) > 0 then
      execute replace(definition, previous_guard, repair_guard);
    elsif position(repair_guard in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected schedule visibility boundary.';
    end if;
  end loop;
  if checked_count <> 15 then
    raise exception using errcode = '55000', message = 'Unexpected schedule repair function inventory.';
  end if;
end;
$$;

-- Preserve the reviewed bodies, row/advisory locks, fingerprint, session binding, token lifetime,
-- attempt wrapper, and ACL. Unexpected source shapes fail closed rather than patching partially.
do $$
declare definition text; change record;
begin
  definition := pg_get_functiondef('ops.prepare_church_lifecycle(uuid,text,text,text)'::regprocedure);
  if position('when ''hide_church'' then ''reviewed_hiding''' in definition) = 0 then
    for change in select * from (values
      ('p_operation_type not in (''archive_church'', ''restore_church'')',
       'p_operation_type not in (''archive_church'', ''restore_church'', ''hide_church'')'),
      ('when ''archive_church'' then ''reviewed_archival'' else ''reviewed_restoration'' end',
       'when ''archive_church'' then ''reviewed_archival'' when ''hide_church'' then ''reviewed_hiding'' else ''reviewed_restoration'' end'),
      ('or (p_operation_type = ''restore_church'' and target->>''status'' <> ''archived'') then',
       'or (p_operation_type = ''restore_church'' and target->>''status'' not in (''archived'', ''hidden'')) '
       'or (p_operation_type = ''hide_church'' and target->>''status'' <> ''published'') then')
    ) as replacements(original, replacement)
    loop
      if position(change.original in definition) = 0 then
        raise exception using errcode = '55000', message = 'Unexpected church preparation definition.';
      end if;
      definition := replace(definition, change.original, change.replacement);
    end loop;
    execute definition;
  end if;
  definition := pg_get_functiondef('ops.apply_church_lifecycle(uuid,text)'::regprocedure);
  if position('operation.operation_type = ''hide_church''' in definition) = 0 then
    for change in select * from (values
      ('if operation.operation_type = ''archive_church'' then',
       'if operation.operation_type = ''hide_church'' then new_status := ''hidden''; '
       'elsif operation.operation_type = ''archive_church'' then'),
      ('case new_status when ''archived'' then ''church.archived'' else ''church.restored'' end',
       'case new_status when ''hidden'' then ''church.hidden'' when ''archived'' then ''church.archived'' else ''church.restored'' end')
    ) as replacements(original, replacement)
    loop
      if position(change.original in definition) = 0 then
        raise exception using errcode = '55000', message = 'Unexpected church transition definition.';
      end if;
      definition := replace(definition, change.original, change.replacement);
    end loop;
    execute definition;
  end if;
end;
$$;
