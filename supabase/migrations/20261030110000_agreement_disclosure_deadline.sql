-- A manual arrangement may have distinct requested and offered arrival times.
-- Preserve the existing deadline wherever valid and clamp it to the immutable
-- accepted snapshot boundary. Never extend access or relax the relationship guard.
do $$
declare definition text;
  previous_assignment text := 'visibility_end := occurrence.arrival_at + interval ''30 days'';';
begin
  definition := pg_get_functiondef('api.confirm_ride_response(uuid,uuid)'::regprocedure);
  if position('least(occurrence.arrival_at, snapshot.scheduled_arrival_at)' in definition) > 0 then return; end if;
  if length(definition) - length(replace(definition, previous_assignment, '')) <> length(previous_assignment) then
    raise exception using errcode = '55000', message = 'Unexpected agreement confirmation definition.';
  end if;
  execute replace(definition, previous_assignment,
    'select least(occurrence.arrival_at, snapshot.scheduled_arrival_at) + interval ''30 days'' '
    'into strict visibility_end from app.ride_condition_snapshot as snapshot '
    'where snapshot.id = response.conditions_snapshot_id;');
end; $$;
