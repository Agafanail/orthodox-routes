-- Keep one catalog entry point; existing named/positional arguments retain their defaults.
drop function api.search_published_churches(
  text, double precision, double precision, double precision,
  double precision, double precision, double precision, integer
);

create function api.search_published_churches(
  p_query text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_south double precision default null,
  p_west double precision default null,
  p_north double precision default null,
  p_east double precision default null,
  p_limit integer default 50,
  p_language text default 'en'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_language is null or p_language not in ('en', 'ru', 'it', 'ro', 'uk', 'de') then
    raise exception using errcode = '22023', message = 'Unsupported content language.';
  end if;

  with bounded as (
    select
      nullif(btrim(coalesce(p_query, '')), '') as query,
      case
        when p_lat is null or p_lng is null or p_lat < -85 or p_lat > 85
          or p_lng < -180 or p_lng > 180 then null
        else extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      end as near,
      case
        when p_south is null or p_west is null or p_north is null or p_east is null then null
        else extensions.st_makeenvelope(p_west, p_south, p_east, p_north, 4326)::extensions.geography
      end as viewport,
      least(greatest(coalesce(p_limit, 50), 1), 200) as row_limit
  ), matched as (
    select church.public_id, church.slug, church.official_name, church.address_display,
      church.locality, church.country_code, church.timezone, church.location,
      coalesce(localized.translated_text, church.official_name) as display_name,
      coalesce(localized.translation_source = 'machine', false) as name_automatically_translated,
      case when bounded.near is null then null
        else extensions.st_distance(church.location, bounded.near) end as distance_m
    from app.church as church
    cross join bounded
    left join app.content_source as source
      on source.object_type = 'church' and source.object_id = church.id
        and source.field_name = 'official_name'
    left join app.content_translation as localized
      on localized.content_source_id = source.id
        and localized.source_version = source.source_version
        and localized.target_language = p_language and localized.status = 'ready'
    where church.status = 'published'
      and church.location is not null
      and (
        bounded.query is null
        or church.official_name ilike '%' || bounded.query || '%'
        or church.locality ilike '%' || bounded.query || '%'
        or church.country_code ilike bounded.query
        or exists (
          select 1 from app.content_translation as translation
          where translation.content_source_id = source.id
            and translation.source_version = source.source_version
            and translation.status = 'ready'
            and translation.translated_text ilike '%' || bounded.query || '%'
        )
      )
      and (bounded.viewport is null or extensions.st_intersects(church.location, bounded.viewport))
    order by distance_m asc nulls last, display_name asc, church.public_id asc
    limit (select row_limit from bounded)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'church_id', matched.public_id,
    'slug', matched.slug,
    'official_name', matched.official_name,
    'display_name', matched.display_name,
    'name_automatically_translated', matched.name_automatically_translated,
    'address', matched.address_display,
    'locality', matched.locality,
    'country_code', matched.country_code,
    'timezone', matched.timezone,
    'lat', extensions.st_y(matched.location::extensions.geometry),
    'lng', extensions.st_x(matched.location::extensions.geometry),
    'distance_m', case when matched.distance_m is null then null else round(matched.distance_m)::bigint end
  ) order by matched.distance_m asc nulls last, matched.display_name asc, matched.public_id asc), '[]'::jsonb)
  into result from matched;
  return result;
end;
$$;

revoke all on function api.search_published_churches(
  text, double precision, double precision, double precision,
  double precision, double precision, double precision, integer, text
) from public, anon, authenticated, service_role;
grant execute on function api.search_published_churches(
  text, double precision, double precision, double precision,
  double precision, double precision, double precision, integer, text
) to anon, authenticated;
comment on function api.search_published_churches(
  text, double precision, double precision, double precision,
  double precision, double precision, double precision, integer, text
) is 'Published-only catalog searches original and current ready translated names; localized ordering yields to explicit proximity.';
