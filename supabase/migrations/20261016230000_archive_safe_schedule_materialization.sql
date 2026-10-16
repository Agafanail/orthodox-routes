-- The worker's initial series selection may predate an owner archival transaction.
-- Recheck church lifecycle only after taking its lock, without advancing the archived source.
do $$
declare
  materializer regprocedure := 'app.materialize_service_series(uuid,timestamptz)'::regprocedure;
  definition text;
  church_lock text := 'perform 1 from app.church where id = target_church_id for update;';
  lifecycle_guard text := '  if not exists (select 1 from app.church where id = target_church_id'
    || ' and status in (''published'', ''hidden'')) then return 0; end if;';
begin
  definition := pg_get_functiondef(materializer);
  if position(church_lock || E'\n' || lifecycle_guard in definition) > 0 then return; end if;
  if position(church_lock in definition) = 0
    or position(church_lock in substring(definition from position(church_lock in definition) + length(church_lock))) > 0 then
    raise exception using errcode = '55000', message = 'Unexpected schedule materializer definition.';
  end if;
  execute replace(definition, church_lock, church_lock || E'\n' || lifecycle_guard);
end;
$$;
