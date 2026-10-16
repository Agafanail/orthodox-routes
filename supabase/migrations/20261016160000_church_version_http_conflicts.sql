-- An application version mismatch is an HTTP conflict, not a database serialization failure.
-- PostgREST 14 retries explicit 40001 indefinitely; preserve the guards and change only the code.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
do $$
declare
  function_name text;
  definition text;
  old_code constant text := 'errcode = ''40001''';
  new_code constant text := 'errcode = ''PT409''';
  old_count integer;
  new_count integer;
  expected_count integer;
begin
  foreach function_name in array array[
    'api.update_church_content', 'api.cancel_one_off_service', 'api.update_church_address',
    'api.update_one_off_service_content', 'api.update_one_off_service_time',
    'api.cancel_recurring_service_date', 'api.reschedule_recurring_service_date',
    'api.update_recurring_service_date_content', 'api.cancel_recurring_service_future',
    'api.correct_church_content_translation', 'api.update_church_public_contacts'
  ]::text[] loop
    select pg_get_functiondef(routine.oid) into strict definition
    from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname || '.' || routine.proname = function_name and routine.prokind = 'f';
    expected_count := case when function_name = 'api.correct_church_content_translation' then 2 else 1 end;
    old_count := (length(definition) - length(replace(definition, old_code, ''))) / length(old_code);
    new_count := (length(definition) - length(replace(definition, new_code, ''))) / length(new_code);
    if not ((old_count = expected_count and new_count = 0)
      or (old_count = 0 and new_count = expected_count)) then
      raise exception using errcode = '55000', message = 'Church conflict migration encountered an unexpected function body.';
    end if;
    if old_count > 0 then execute replace(definition, old_code, new_code); end if;
  end loop;
end;
$$;
