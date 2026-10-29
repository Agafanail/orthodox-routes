-- IA V2 sections 14.2 and 48.1: a fulfilled request stays private after either
-- participant cancels. Only its author can explicitly publish the same request again.
-- Do not infer consent from historical active rows or rewrite their history.
do $$
declare definition text; previous_branch text; restored_branch text; route_anchor text;
begin
  definition := pg_get_functiondef('app.cancel_ride_agreement_internal(uuid,uuid,timestamptz)'::regprocedure);
  previous_branch := $branch$          -- The driver withdrew and the passenger still needs the ride they asked for.
          when driver_withdrew then case
            when remaining_passengers + agreement.confirmed_passenger_count >= total_passengers then 'active'
            else 'partial'
          end
          -- The passenger withdrew. Their own «Опубликовать снова» stays the only way back.
          else 'restore'$branch$;
  restored_branch := $branch$          -- A fulfilled request requires the passenger's explicit republication.
          else 'restore'$branch$;
  if position(previous_branch in definition) > 0 then
    if (length(definition) - length(replace(definition, previous_branch, ''))) <> length(previous_branch) then
      raise exception using errcode = '55000', message = 'Unexpected cancellation restoration definition.';
    end if;
    definition := replace(definition, previous_branch, restored_branch);
    definition := replace(definition, E'  driver_withdrew boolean;\n', '');
    definition := replace(definition, $obsolete$  -- Who ended it decides whether the request goes back by itself. The two accounts are always
  -- different, because a person cannot answer their own publication.
  driver_withdrew := cancelling_actor_id = agreement.driver_account_id;

$obsolete$, '');
    execute definition;
  elsif position(restored_branch in definition) = 0 or position('driver_withdrew' in definition) > 0 then
    raise exception using errcode = '55000', message = 'Unexpected cancellation restoration definition.';
  end if;

  -- A cancellation recipient must reach the implemented church board, not the
  -- still-unimplemented personal-area route. This carries no request/contact data.
  definition := pg_get_functiondef('app.notify_ride_agreement_transition()'::regprocedure);
  route_anchor := '''ride.cancelled'', ''ride_agreement'', new.public_id, ''/trips'',';
  if position(route_anchor in definition) > 0 then
    if length(definition) - length(replace(definition, route_anchor, '')) <> length(route_anchor) then
      raise exception using errcode = '55000', message = 'Unexpected cancellation notification route.';
    end if;
    execute replace(definition, route_anchor,
      '''ride.cancelled'', ''ride_agreement'', new.public_id,
        (select case when char_length(church.slug) <= 231 then ''/churches/'' || church.slug else ''/churches'' end
          from app.passenger_request as request join app.church as church on church.id = request.church_id
          where request.id = new.passenger_request_id),');
  elsif position('char_length(church.slug) <= 231' in definition) = 0 then
    raise exception using errcode = '55000', message = 'Unexpected cancellation notification route.';
  end if;

  -- Reuse the existing author-only read, not a public or counterparty projection.
  definition := pg_get_functiondef('api.current_transport_items()'::regprocedure);
  if position('''church_name'', church.official_name' in definition) = 0 then
    if (length(definition) - length(replace(definition,
      '''request_id'', request.public_id, ''church_id'', church.public_id,', '')))
      <> length('''request_id'', request.public_id, ''church_id'', church.public_id,') then
      raise exception using errcode = '55000', message = 'Unexpected owned request projection.';
    end if;
    execute replace(definition, '''request_id'', request.public_id, ''church_id'', church.public_id,',
      '''request_id'', request.public_id, ''church_id'', church.public_id,
      ''church_name'', church.official_name, ''service_name_snapshot'', request.service_name_snapshot,');
  end if;
end;
$$;
