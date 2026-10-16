# Protected church lifecycle operations

## Implementation boundary

This is an inactive database contract for the approved archive/restore operations, not a production control panel or an activated operator workflow. Production access, operator login provisioning, protected workflow/environment configuration, and a real operational rehearsal remain owner-controlled. Ordinary deployment must never run these operations automatically.

Migration `20261016200000_church_owner_lifecycle.sql` creates the `orthodox_routes_church_operator` NOLOGIN group with no elevated role attributes, parent roles, table grants, or ordinary application-role membership. Only `ops.prepare_church_lifecycle` and `ops.execute_church_lifecycle` are executable by that group. `ops` is not exposed by the application Data API. The normal application secret/service role cannot operate this boundary or read its tables.

No login, password, production secret, remote connection, or role membership for a real operator is created. A future protected runner must use a distinct operator database identity, not the application's connection or shared database-owner identity. PostgreSQL's authenticated `session_user` is hashed into the operation/audit identity; request text or JWT metadata never selects the operator. The role and definer boundary follows the official PostgreSQL 17 [role attributes](https://www.postgresql.org/docs/17/sql-createrole.html), [session identity](https://www.postgresql.org/docs/17/functions-info.html), and [hardened function](https://www.postgresql.org/docs/17/sql-createfunction.html) contracts.

## Prepare and execute contract

1. The owner manually reviews a support case. Inputs are one canonical church UUID, `archive_church` or `restore_church`, an opaque case reference (4–64 uppercase ASCII letters/digits, dots, underscores, or hyphens), and the corresponding fixed reason code `reviewed_archival` or `reviewed_restoration`. Do not put names, contacts, or a narrative into the case reference.
2. Prepare locks the administrator-slot boundary and church, resolves the current target, and stores its fingerprint. The returned preview contains public identification, state/version/timestamp, administrator/invitation/request counts, and future transport counts. It contains no administrator/account IDs, private contacts, exact user locations, or ride details.
3. Prepare returns a cryptographically random 256-bit capability once; only its SHA-256 hash is stored. The technical lifetime is 15 minutes. A future runner must keep the capability in protected memory/secret transport, mask it before any output, show only the safe preview, and require explicit execution confirmation. Never print the complete prepare response, token, SQL statement, or connection string into a job log. No free-form SQL input is part of the product interface.
4. Execute requires the same authenticated operator and capability, reacquires the same locks, and rechecks the fingerprint and current future transport. Lock waits are bounded at five seconds; the protected caller must also set a whole-statement/request deadline.
5. A successful transition, pending archival-request resolution, operation result, and minimized audit are one transaction. A conflicting/erroring operation changes none of them. A consumed capability can only return its original result; replay after a later restoration cannot archive the church again.

The fingerprint covers current church metadata/version, current administrator slots, pending requests/invitations, and future transport counts. Any relevant change requires a new preview. The underlying state reader uses a fresh volatile snapshot after locking.

## Preserved product rules

- Archival requires every future active/partial/fulfilled/restorable passenger request, active/full driver occurrence, pending future response, and confirmed/change-pending future agreement to be resolved. The operation never silently cancels them.
- Archival changes only church visibility/version and pending archival-request state. It does not delete church, schedule, photograph, administrator, ride, agreement, or participant history.
- Public catalog/schedule/image projections already require a published church. Both single-trip and regular-series publication take the church lock before inserting transport, so either a new ride commits and prevents archival or archival commits and publication is refused. The regular-series path retains its existing signature and grants.
- Restoration republishes the same page and identity, subject to existing address/location/deduplication constraints. A church without a current administrator must have its separate administration case resolved first; restoration does not assign privileges or invent a representative.
- Pending administrator invitations are not implicitly accepted or reassigned. Their existing expiry remains; acceptance refuses an archived church.
- Audit stores opaque operator/target/operation identifiers, fixed action/reason codes, case reference, and changed field names, never the capability or private before/after content. Direct rewriting remains prohibited.

## Verification and remaining work

`npm run test:church-owner` connects only through the exact disposable local Docker database container. It has no remote URL or credential option. Separate synthetic local login roles verify the database session boundary; they are not evidence of remote operator authentication or production readiness. The verifier checks ordinary/service-role denial, forced RLS, table isolation, safe preview, wrong token/operator, expiry, stale state, every future-work class, archive/restore/history/audit/replay, missing-administrator refusal, and archive-versus-publication concurrency. Exact fixture/role cleanup is mandatory.

Required CI runs the contract test after the existing church-administration suite. A deterministic barrier pauses the real regular-publication RPC before its first series insert and checks that archival is already blocked, then verifies the resulting refusal after publication commits. Historical audit-backfill replay preserves the current action constraint, rather than downgrading the later schema. Exact disposable cleanup temporarily disables only the immutable-snapshot trigger inside the cleanup transaction and restores it before commit; production immutability is unchanged. No production data or provider is involved.

Remaining independent work includes a fixed-command protected runner and its secret-handling tests, durable refusal/error-result auditing before activation, case-scoped membership repair, remaining owner actions, approved retention/deletion, and operational backup/restore rehearsal. External activation must wait for owner-provisioned least-privilege identities and protected execution controls. Production migrations require the approved backup/review process; Codex must not receive production credentials.
