# Fixed church owner command

## Inactive operational boundary

`scripts/church-owner-command.mjs` is a prebuilt interactive command for the approved church hide/archive/restore contract. It is not an application route or automatic deployment step. No real operator identity, credential, certificate, protected environment, staging connection, or production connection is provisioned by this code. Codex must not receive production secrets or execute production operations.

The database contract and preserved product rules are described in [Protected church lifecycle operations](BACKEND_OWNER_OPERATIONS.md). The command additionally supports a narrow own-operation outcome lookup after an ambiguous failure; it never needs to rerun a transition just to inspect its status.

## Owner-controlled prerequisites

- A protected operator terminal with Node.js 22+ and PostgreSQL 17+ `psql`, using an explicitly reviewed staging or production target. Ordinary CI/deployment environments must not receive this connection.
- A separate LOGIN identity with an opaque lowercase ASCII letter/digit/underscore name (never an email/contact), only membership/usage in `orthodox_routes_church_operator`, no elevated role attributes, no other parent roles, no direct application table access, and no schema creation/application-schema usage. Do not use `postgres`, a Supabase administrator, an application service identity, or a shared database-owner login.
- Owner-provisioned libpq service and password files outside the checkout, with regular-file/no-symlink protection. Both files must be private (`0600` on Unix; reviewed owner-only ACLs on Windows). The service selects host/database/login and the required trusted CA; the password is not a command argument or environment variable. Do not paste either file into Codex.
- Configure the authenticated operator session with `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, and pgAudit parameter logging disabled where present. The runner checks these settings on every parameter-bearing connection before sending the query. A database administrator must configure any privileged login setting through the approved provisioning process; the operator is not granted permission to weaken logging policies.
- Independently review provider/proxy tracing and access logs before activation. The code does not claim that unit tests prove remote TLS, authentication, secret storage, or logging configuration.

Only four explicit configuration values are read: `OWNER_CHURCH_ENVIRONMENT` (`staging` or `production`), `OWNER_CHURCH_PG_SERVICE` (the fixed service-file alias), `OWNER_CHURCH_PG_SERVICE_FILE`, and `OWNER_CHURCH_PG_PASSFILE` (absolute protected file paths). There is no fallback to application URLs/keys, `.env.local`, inherited `PGPASSWORD`, or arbitrary `PGOPTIONS`.

## Command lifecycle

The command accepts exactly one canonical church UUID, a fixed action (`hide_church`, `archive_church`, or `restore_church`), and an opaque case reference. For example, using synthetic identifiers only:

```text
node scripts/church-owner-command.mjs --church 11111111-1111-4111-8111-111111111111 --action archive_church --case SYNTHETIC-CASE
```

The default is preview-only. It prepares a short-lived operation, projects the safe preview, and discards the capability from command state on exit. It never prints or writes the capability to a file.

Reviewed exclusion uses `--action remove_church_admin` and additionally requires `--membership <canonical public membership UUID>` from the manually reviewed case. Other actions reject `--membership`. It calls only the fixed `ops.prepare_church_admin_removal` contract, projects that exact membership reference, and expects `removed` for that same membership after confirmation. This action requires another current administrator and no pending transfer of the selected seat. It does not grant a replacement or remove the last administrator. Own-status lookup also recognizes this action without revealing a capability or account identity. No ordinary administrator/application key may invoke it.

Reviewed invitation revocation uses `--action cancel_church_invite` with `--invite <canonical public invitation UUID>` from the case; all other actions reject `--invite`. Only `ops.prepare_church_invite_cancellation` is called for preparation, and the exact selected invitation must match the projected preview and `cancelled` result. The same explicit interactive confirmation and durable attempt are mandatory. This revokes an outstanding ordinary or own-seat-transfer invitation without removing the sender, assigning a recipient, or changing other grants. Recipient contact and mail/capability fields are never printed. Own-status lookup recognizes this action without rerunning it.

Reviewed representative replacement uses `--action replace_church_admin --membership <outgoing public membership UUID> --replacement <incoming public account UUID>` from the manually reviewed case. The incoming account reference is not an email, domain, internal Auth ID, or permission to discover an account. Other actions reject `--replacement`; this action rejects `--invite`. The fixed preparation binds all selected references, and the `replaced` result must match them and contain a valid new membership reference. The same preview-only default, exact interactive confirmation, committed attempt, and own-outcome lookup apply. The existing final administrator remains until the atomic replacement succeeds. Private account history/contacts are neither printed nor transferred. The runner now uses an explicit fixed-call switch and result-state map; no action is translated into free-form SQL.

Adding `--execute` requires both input and output to be interactive terminals. After showing the exact safe preview, the command requires typing `EXECUTE <operation UUID>`. Any other answer cancels without a transition. A separate committed call then records a capability-authorized attempt start, and only its validated attempt UUID is passed to execution. If the start fails, no transition request is sent. The safe attempt UUID is printed, never the capability. The database independently checks the same operator, token, prior committed start, expiry, current target fingerprint, future work, and permitted transition.

Only fixed function calls are generated. PostgreSQL 17 extended-query `\bind` sends argument values separately from SQL text. The subprocess uses no shell, startup file, interactive password prompt, or password-bearing argv. Each connection uses `verify-full` TLS, a five-second connection timeout, a 15-second statement timeout, a five-second lock timeout, and a 20-second subprocess deadline. Captured output is bounded; raw stderr, SQL, connection files, tokens, and unrecognized response fields are never forwarded.

After a timeout or ambiguous failure, inspect the already printed operation identifier through the same protected login:

```text
node scripts/church-owner-command.mjs --status 22222222-2222-4222-8222-222222222222
```

This returns only the caller's operation type, church identifier, `prepared`/`expired`/`succeeded` state, and latest attempt UUID/state when one exists. Attempt states are `unfinished`, `success`, `refused`, and `error`. An unfinished attempt may still be in flight or may have rolled back after interruption; it is never evidence of failure or permission to retry. A completed refusal/error remains immutable on replay even if conditions later change. The lookup does not prepare, execute, or expose the capability, fingerprint, case narrative, private membership IDs, raw error text, or ride details. Review the case rather than blindly starting another operation.

## Verification boundaries

For a manually reviewed support-assisted final-administrator deletion case, `--support-deletion` selects the [case-bound resolution wrappers](BACKEND_CHURCH_ADMINISTRATION_CASES.md) for `replace_church_admin` or `archive_church`. Both require the exact `--membership`; replacement also retains `--replacement`. Other actions refuse the flag. The preview shows the opaque bound case UUID and final position; it ends no membership. Native successful execution atomically completes the case, and the projected command result includes that same case UUID. Account deletion itself and real operator activation remain separate.

If a separate legitimate membership lifecycle has already resolved that page, use `--action reconcile_church_administration_case --administration-case <case UUID>` with its exact `--church` and opaque `--case` reference. This [reviewed reconciliation](BACKEND_CHURCH_CASE_RECONCILIATION.md) accepts no new member/invitation/replacement or `--support-deletion`. The default remains preview-only, execution requires the same explicit confirmation and committed attempt, and success projects only the bound case/membership UUIDs and observed replacement/archive resolution. It changes restricted metadata and audit only, never permissions, identity, church, rides or notifications.

The hiding extension uses the same preview-only default and explicit interactive confirmation. It binds `hide_church` to `reviewed_hiding` and expects only a `hidden` transition result; own-status lookup recognizes it without returning a capability. Restoration handles either a hidden or archived page through the same protected contract. Hiding is not an instruction to cancel future trips, delete history, or reveal participant details. Record the actual reason and its resolution in the referenced support case, not in free-form command arguments.

Unit tests use injected process/configuration/confirmation fakes and no external connection. Local-only database CI verifies the protected outcome function, parameter binding, committed starts, minimized refusal/error results, rollback after partial transition work, timeout ambiguity, replay, and concurrent completion with synthetic identities. These are separate from owner-controlled staging authentication/TLS/security-logging verification and a real operational rehearsal. No frontend screen or production control is enabled.

References: PostgreSQL [psql binding](https://www.postgresql.org/docs/17/app-psql.html), [TLS](https://www.postgresql.org/docs/17/libpq-ssl.html), [password-file environment](https://www.postgresql.org/docs/17/libpq-envars.html), [parameter logging](https://www.postgresql.org/docs/17/runtime-config-logging.html), and [pgAudit parameter logging](https://github.com/pgaudit/pgaudit/blob/REL_17_STABLE/README.md).
