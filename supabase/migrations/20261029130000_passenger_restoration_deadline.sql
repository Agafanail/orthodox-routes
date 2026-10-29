-- A time predicate evaluated before a row wait does not authorize publication
-- after the deadline. Pin the author's existing row, then run the existing UPDATE
-- as a fresh statement; keep idempotent successful replay before this check.
do $$
declare definition text; anchor text; marker text;
begin
  definition := pg_get_functiondef('api.restore_passenger_request(uuid,uuid)'::regprocedure);
  marker := '-- Pin the owned restoration row before evaluating its current deadline.';
  if position(marker in definition) = 0 then
    anchor := '  update app.passenger_request
  set status = case when remaining_passengers = total_passengers then ''active'' else ''partial'' end,';
    if position('app.require_mutating_actor(true)' in definition) = 0
      or position('if prior is not null then return prior; end if;' in definition) = 0
      or length(definition) - length(replace(definition, anchor, '')) <> length(anchor) then
      raise exception using errcode = '55000', message = 'Unexpected passenger restoration definition.';
    end if;
    execute replace(definition, anchor, '  ' || marker || '
  perform 1 from app.passenger_request as owned_request
    where owned_request.public_id = p_request_id and owned_request.author_account_id = actor_id for update;
  if not found then raise exception using errcode = ''P0002'', message = ''The passenger request is unavailable.''; end if;
' || anchor);
  end if;
end;
$$;
alter function api.restore_passenger_request(uuid,uuid) set lock_timeout = '5s';
