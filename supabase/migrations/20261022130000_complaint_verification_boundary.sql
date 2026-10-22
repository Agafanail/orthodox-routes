-- Dormant mailbox-verification budgets. Values require approval before activation.
alter table ops.security_policy
  add column if not exists complaint_verify_rate_version text,
  add column if not exists complaint_verify_window_seconds integer,
  add column if not exists complaint_verify_network_limit integer,
  add column if not exists complaint_verify_draft_limit integer,
  add column if not exists complaint_verify_global_limit integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'ops.security_policy'::regclass
    and conname = 'security_policy_complaint_verify_rate') then
    alter table ops.security_policy add constraint security_policy_complaint_verify_rate check (
      (complaint_verify_rate_version is null and complaint_verify_window_seconds is null
        and complaint_verify_network_limit is null and complaint_verify_draft_limit is null
        and complaint_verify_global_limit is null)
      or (complaint_verify_rate_version is not null and complaint_verify_window_seconds is not null
        and complaint_verify_network_limit is not null and complaint_verify_draft_limit is not null
        and complaint_verify_global_limit is not null
        and complaint_verify_rate_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        and complaint_verify_window_seconds between 60 and 86400
        and complaint_verify_network_limit between 1 and 1000000
        and complaint_verify_draft_limit between 1 and 1000000
        and complaint_verify_global_limit between 1 and 1000000)
    );
  end if;
end $$;

create table if not exists ops.complaint_verification_rate_bucket (
  policy_version text not null check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  scope text not null check (scope in ('global', 'network', 'draft')),
  rate_key text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 1000000),
  updated_at timestamptz not null,
  primary key (policy_version, scope, rate_key),
  check (window_ends_at > window_started_at and window_ends_at <= window_started_at + interval '86400 seconds'
    and updated_at >= window_started_at)
);
create index if not exists complaint_verification_rate_expiry on ops.complaint_verification_rate_bucket(window_ends_at);
alter table ops.complaint_verification_rate_bucket enable row level security;
alter table ops.complaint_verification_rate_bucket force row level security;
revoke all on table ops.complaint_verification_rate_bucket from public, anon, authenticated, service_role;

create or replace function api.consume_complaint_verification_rate_limit(p_network_key text, p_draft_key text)
returns text language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare policy ops.security_policy%rowtype; evaluated_at timestamptz; bucket record;
begin
  if p_network_key is null or p_network_key !~ '^[0-9a-f]{64}$'
    or p_draft_key is null or p_draft_key !~ '^[0-9a-f]{64}$' then return 'unavailable'; end if;
  select * into strict policy from ops.security_policy where singleton for share;
  if policy.complaint_verify_rate_version is null then return 'unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('complaint-verification-rate:v1', 0));
  evaluated_at := clock_timestamp();
  begin
    for bucket in select * from (values
      ('global'::text, repeat('0', 64), policy.complaint_verify_global_limit),
      ('network'::text, p_network_key, policy.complaint_verify_network_limit),
      ('draft'::text, p_draft_key, policy.complaint_verify_draft_limit)
    ) as limits(scope, rate_key, allowed_count)
    loop
      insert into ops.complaint_verification_rate_bucket as current_bucket (
        policy_version, scope, rate_key, window_started_at, window_ends_at, request_count, updated_at
      ) values (policy.complaint_verify_rate_version, bucket.scope, bucket.rate_key, evaluated_at,
        evaluated_at + make_interval(secs => policy.complaint_verify_window_seconds), 1, evaluated_at)
      on conflict (policy_version, scope, rate_key) do update set
        window_started_at = case when current_bucket.window_ends_at <= evaluated_at then evaluated_at else current_bucket.window_started_at end,
        window_ends_at = case when current_bucket.window_ends_at <= evaluated_at
          then evaluated_at + make_interval(secs => policy.complaint_verify_window_seconds) else current_bucket.window_ends_at end,
        request_count = case when current_bucket.window_ends_at <= evaluated_at then 1 else current_bucket.request_count + 1 end,
        updated_at = evaluated_at
      where current_bucket.window_ends_at <= evaluated_at or current_bucket.request_count < bucket.allowed_count;
      if not found then raise exception using errcode = 'P0429', message = 'Complaint verification budget exhausted.'; end if;
    end loop;
    return 'allowed';
  exception when sqlstate 'P0429' then return 'rate_limited';
  end;
end;
$$;

create or replace function api.expire_complaint_verification_rate_buckets(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare removed_count integer; evaluated_at timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Verification cleanup bound is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complaint-verification-rate:v1', 0));
  evaluated_at := clock_timestamp();
  with expired as (select policy_version, scope, rate_key from ops.complaint_verification_rate_bucket
    where window_ends_at <= evaluated_at order by window_ends_at, policy_version, scope, rate_key limit p_limit),
  removed as (delete from ops.complaint_verification_rate_bucket as bucket using expired
    where (bucket.policy_version, bucket.scope, bucket.rate_key) = (expired.policy_version, expired.scope, expired.rate_key) returning 1)
  select count(*)::integer into removed_count from removed;
  return removed_count;
end;
$$;
revoke all on function api.consume_complaint_verification_rate_limit(text,text),
  api.expire_complaint_verification_rate_buckets(integer) from public, anon, authenticated, service_role;
grant execute on function api.consume_complaint_verification_rate_limit(text,text),
  api.expire_complaint_verification_rate_buckets(integer) to service_role;
