create schema app authorization postgres;
create schema private authorization postgres;
create schema api authorization postgres;
create schema ops authorization postgres;

revoke all on schema app, private, api, ops from public;
revoke all on schema app, private, api, ops from anon, authenticated, service_role;

comment on schema app is 'Core application data. Empty foundation only.';
comment on schema private is 'Protected application data. Empty foundation only.';
comment on schema api is 'Explicit application views and functions. Empty foundation only.';
comment on schema ops is 'Restricted operational data. Empty foundation only.';
