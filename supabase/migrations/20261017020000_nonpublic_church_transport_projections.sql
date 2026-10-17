-- A public board RPC must enforce the church boundary independently of page routing.
do $$
declare
  routine regprocedure;
  definition text;
  original_filter text := 'and (p_church_id is null or church.public_id = p_church_id);';
  protected_filter text := 'and church.status = ''published''
    and (p_church_id is null or church.public_id = p_church_id);';
begin
  foreach routine in array array[
    'api.list_active_passenger_requests(uuid)'::regprocedure,
    'api.list_active_driver_occurrences(uuid)'::regprocedure
  ] loop
    definition := pg_get_functiondef(routine);
    if position(protected_filter in definition) > 0 then continue; end if;
    if position(original_filter in definition) = 0 or position(original_filter in
      substring(definition from position(original_filter in definition) + length(original_filter))) > 0 then
      raise exception using errcode = '55000', message = 'Unexpected public transport projection definition.';
    end if;
    -- Preserve signatures, complete safe shapes, all other filters, and current ACLs.
    execute replace(definition, original_filter, protected_filter);
  end loop;
end;
$$;
