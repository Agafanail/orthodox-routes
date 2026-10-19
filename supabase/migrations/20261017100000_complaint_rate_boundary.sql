-- Dormant prerequisite only: exact operational limits require approval before public activation.
alter table ops.security_policy
  add column complaint_rate_version text,
  add column complaint_rate_window_seconds integer,
  add column complaint_network_limit integer,
  add column complaint_mailbox_limit integer,
  add column complaint_global_limit integer,
  add constraint security_policy_complaint_rate check (
    (complaint_rate_version is null and complaint_rate_window_seconds is null
      and complaint_network_limit is null and complaint_mailbox_limit is null and complaint_global_limit is null)
    or (complaint_rate_version is not null and complaint_rate_window_seconds is not null
      and complaint_network_limit is not null and complaint_mailbox_limit is not null and complaint_global_limit is not null
      and complaint_rate_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and complaint_rate_window_seconds between 60 and 86400
      and complaint_network_limit between 1 and 1000000
      and complaint_mailbox_limit between 1 and 1000000
      and complaint_global_limit between 1 and 1000000)
  );

create table ops.complaint_rate_bucket (
  policy_version text not null,
  scope text not null,
  rate_key text not null,
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null,
  primary key (policy_version, scope, rate_key),
  constraint complaint_rate_version check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint complaint_rate_scope check (scope in ('global', 'network', 'mailbox')),
  constraint complaint_rate_key check (rate_key ~ '^[0-9a-f]{64}$'),
  constraint complaint_rate_count check (request_count between 1 and 1000000),
  constraint complaint_rate_time check (window_ends_at > window_started_at
    and window_ends_at <= window_started_at + interval '86400 seconds' and updated_at >= window_started_at)
);
create index complaint_rate_bucket_expiry on ops.complaint_rate_bucket (window_ends_at);
alter table ops.complaint_rate_bucket enable row level security;
alter table ops.complaint_rate_bucket force row level security;
revoke all on table ops.complaint_rate_bucket from public, anon, authenticated, service_role;

create function api.consume_complaint_rate_limit(p_network_key text, p_mailbox_key text)
returns text language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare policy ops.security_policy%rowtype; evaluated_at timestamptz; bucket record;
begin
  if p_network_key is null or p_network_key !~ '^[0-9a-f]{64}$'
    or p_mailbox_key is null or p_mailbox_key !~ '^[0-9a-f]{64}$' then
    return 'unavailable';
  end if;
  select * into strict policy from ops.security_policy where singleton for share;
  if policy.complaint_rate_version is null then return 'unavailable'; end if;
  -- One bounded shared budget also prevents rejected requests from creating arbitrary new keys.
  -- Sample database time only after the lock; stale queued requests cannot extend an old window.
  perform pg_advisory_xact_lock(hashtextextended('complaint-rate-boundary:v1', 0));
  evaluated_at := clock_timestamp();
  begin
    for bucket in select * from (values
      ('global'::text, repeat('0', 64), policy.complaint_global_limit),
      ('network'::text, p_network_key, policy.complaint_network_limit),
      ('mailbox'::text, p_mailbox_key, policy.complaint_mailbox_limit)
    ) as limits(scope, rate_key, allowed_count)
    loop
      insert into ops.complaint_rate_bucket as current_bucket (
        policy_version, scope, rate_key, window_started_at, window_ends_at, request_count, updated_at
      ) values (policy.complaint_rate_version, bucket.scope, bucket.rate_key, evaluated_at,
        evaluated_at + make_interval(secs => policy.complaint_rate_window_seconds), 1, evaluated_at)
      on conflict (policy_version, scope, rate_key) do update set
        window_started_at = case when current_bucket.window_ends_at <= evaluated_at then evaluated_at else current_bucket.window_started_at end,
        window_ends_at = case when current_bucket.window_ends_at <= evaluated_at
          then evaluated_at + make_interval(secs => policy.complaint_rate_window_seconds) else current_bucket.window_ends_at end,
        request_count = case when current_bucket.window_ends_at <= evaluated_at then 1 else current_bucket.request_count + 1 end,
        updated_at = evaluated_at
      where current_bucket.window_ends_at <= evaluated_at or current_bucket.request_count < bucket.allowed_count;
      if not found then raise exception using errcode = 'P0429', message = 'Complaint rate budget exhausted.'; end if;
    end loop;
    return 'allowed';
  exception when sqlstate 'P0429' then
    -- Roll back every dimension: a denial cannot partially spend another identity's budget.
    return 'rate_limited';
  end;
end;
$$;

create function api.expire_complaint_rate_buckets(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare removed_count integer; evaluated_at timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Rate cleanup bound is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complaint-rate-boundary:v1', 0));
  evaluated_at := clock_timestamp();
  with expired as (select policy_version, scope, rate_key from ops.complaint_rate_bucket
    where window_ends_at <= evaluated_at order by window_ends_at, policy_version, scope, rate_key limit p_limit),
  removed as (delete from ops.complaint_rate_bucket as bucket using expired
    where (bucket.policy_version, bucket.scope, bucket.rate_key) = (expired.policy_version, expired.scope, expired.rate_key) returning 1)
  select count(*)::integer into removed_count from removed;
  return removed_count;
end;
$$;
revoke all on function api.consume_complaint_rate_limit(text,text), api.expire_complaint_rate_buckets(integer)
  from public, anon, authenticated, service_role;
grant execute on function api.consume_complaint_rate_limit(text,text), api.expire_complaint_rate_buckets(integer) to service_role;
