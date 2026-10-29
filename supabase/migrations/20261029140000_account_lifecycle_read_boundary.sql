-- Auth sessions may outlive an application lifecycle transition. A valid subject
-- is not sufficient to read private transport data after deletion has started.
-- Keep pre-account registration and restricted-user safe reads unchanged.
do $$
declare definition text; anchor text := '  return actor_id;';
begin
  definition := pg_get_functiondef('app.current_actor_id()'::regprocedure);
  if position('-- Refuse deleting/deleted subjects before private application access.' in definition) = 0 then
    if length(definition) - length(replace(definition, anchor, '')) <> length(anchor)
      or position('actor_id uuid := auth.uid();' in definition) = 0 then
      raise exception using errcode = '55000', message = 'Unexpected application actor definition.';
    end if;
    execute replace(definition, anchor, '  -- Refuse deleting/deleted subjects before private application access.
  if exists (select 1 from app.account as account
    where account.id = actor_id and account.status in (''deleting'', ''deleted'')) then
    raise exception using errcode = ''42501'', message = ''Application account is unavailable.'';
  end if;
' || anchor);
  end if;
end;
$$;
