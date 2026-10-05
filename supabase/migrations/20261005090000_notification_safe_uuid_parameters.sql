create or replace function app.notification_parameters_are_safe(requested_parameters jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
  string_content text;
begin
  if requested_parameters is null or jsonb_typeof(requested_parameters) <> 'object' then return false; end if;
  for item in
    select parameter.key, parameter.value as content
    from jsonb_each(requested_parameters) as parameter(key, value)
  loop
    string_content := case when jsonb_typeof(item.content) = 'string'
      then item.content #>> '{}'
      else null
    end;

    if item.key !~ '^[a-z][a-z0-9_]{0,39}$'
      or item.key ~* '(email|phone|contact|address|coordinate|latitude|longitude|note|route|token|secret)'
      or jsonb_typeof(item.content) not in ('string', 'number', 'boolean', 'null')
      or (string_content is not null and (
        char_length(string_content) > 160
        or string_content ~ '[[:cntrl:]]'
        or (
          string_content !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and string_content ~* '(https?://|www\.|[[:alnum:]_.%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|\+?[0-9][0-9 ()-]{6,}[0-9])'
        )
      ))
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function app.notification_parameters_are_safe(jsonb) is
  'Accepts flat non-sensitive template parameters, including canonical UUID references, while rejecting contact details, addresses, routes, tokens, URLs, and nested values.';
