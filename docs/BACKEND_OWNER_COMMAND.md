# Fixed church owner command

## Inactive operational boundary

`scripts/church-owner-command.mjs` is a prebuilt interactive command for the approved church archive/restore contract. It is not an application route or automatic deployment step. No real operator identity, credential, certificate, protected environment, staging connection, or production connection is provisioned by this code. Codex must not receive production secrets or execute production operations.

The database contract and preserved product rules are described in [Protected church lifecycle operations](BACKEND_OWNER_OPERATIONS.md). The command additionally supports a narrow own-operation outcome lookup after an ambiguous failure; it never needs to rerun a transition just to inspect its status.

## Owner-controlled prerequisites

- A protected operator terminal with Node.js 22+ and PostgreSQL 17+ `psql`, using an explicitly reviewed staging or production target. Ordinary CI/deployment environments must not receive this connection.
- A separate LOGIN identity with an opaque lowercase ASCII letter/digit/underscore name (never an email/contact), only membership/usage in `orthodox_routes_church_operator`, no elevated role attributes, no other parent roles, no direct application table access, and no schema creation/application-schema usage. Do not use `postgres`, a Supabase administrator, an application service identity, or a shared database-owner login.
- Owner-provisioned libpq service and password files outside the checkout, with regular-file/no-symlink protection. Both files must be private (`0600` on Unix; reviewed owner-only ACLs on Windows). The service selects host/database/login and the required trusted CA; the password is not a command argument or environment variable. Do not paste either file into Codex.
- Configure the authenticated operator session with `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, and pgAudit parameter logging disabled where present. The runner checks these settings on every parameter-bearing connection before sending the query. A database administrator must configure any privileged login setting through the approved provisioning process; the operator is not granted permission to weaken logging policies.
- Independently review provider/proxy tracing and access logs before activation. The code does not claim that unit tests prove remote TLS, authentication, secret storage, or logging configuration.

Only four explicit configuration values are read: `OWNER_CHURCH_ENVIRONMENT` (`staging` or `production`), `OWNER_CHURCH_PG_SERVICE` (the fixed service-file alias), `OWNER_CHURCH_PG_SERVICE_FILE`, and `OWNER_CHURCH_PG_PASSFILE` (absolute protected file paths). There is no fallback to application URLs/keys, `.env.local`, inherited `PGPASSWORD`, or arbitrary `PGOPTIONS`.

## Command lifecycle

The command accepts exactly one canonical church UUID, a fixed action (`archive_church` or `restore_church`), and an opaque case reference. For example, using synthetic identifiers only:

```text
node scripts/church-owner-command.mjs --church 11111111-1111-4111-8111-111111111111 --action archive_church --case SYNTHETIC-CASE
```

The default is preview-only. It prepares a short-lived operation, projects the safe preview, and discards the capability from command state on exit. It never prints or writes the capability to a file.

Adding `--execute` requires both input and output to be interactive terminals. After showing the exact safe preview, the command requires typing `EXECUTE <operation UUID>`. Any other answer cancels without a transition. The database independently checks the same operator, token, expiry, current target fingerprint, future work, and permitted transition.

Only fixed function calls are generated. PostgreSQL 17 extended-query `\bind` sends argument values separately from SQL text. The subprocess uses no shell, startup file, interactive password prompt, or password-bearing argv. Each connection uses `verify-full` TLS, a five-second connection timeout, a 15-second statement timeout, a five-second lock timeout, and a 20-second subprocess deadline. Captured output is bounded; raw stderr, SQL, connection files, tokens, and unrecognized response fields are never forwarded.

After a timeout or ambiguous failure, inspect the already printed operation identifier through the same protected login:

```text
node scripts/church-owner-command.mjs --status 22222222-2222-4222-8222-222222222222
```

This returns only the caller's operation type, church identifier, and `prepared`, `expired`, or `succeeded` state. It does not prepare, execute, or expose the capability, fingerprint, case narrative, private membership IDs, or ride details. Review the case rather than blindly starting another operation.

## Verification boundaries

Unit tests use injected process/configuration/confirmation fakes and no external connection. Local-only database CI verifies the real protected outcome function and parameter-binding syntax with synthetic identities. These are separate from owner-controlled staging authentication/TLS/logging verification and a real operational rehearsal. Complete durable refusal/error-result auditing is still required before activation; the first database contract audits committed transitions only. No frontend screen or production control is enabled.

References: PostgreSQL [psql binding](https://www.postgresql.org/docs/17/app-psql.html), [TLS](https://www.postgresql.org/docs/17/libpq-ssl.html), [password-file environment](https://www.postgresql.org/docs/17/libpq-envars.html), [parameter logging](https://www.postgresql.org/docs/17/runtime-config-logging.html), and [pgAudit parameter logging](https://github.com/pgaudit/pgaudit/blob/REL_17_STABLE/README.md).
