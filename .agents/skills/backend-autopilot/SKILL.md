---
name: backend-autopilot
description: Execute explicitly approved Orthodox Routes backend implementation and repair work autonomously across the selected backend architecture, databases, schema migrations, authentication, authorization, server-side security, backend integrations, backend infrastructure, and backend-related CI. Do not use this skill as authority for product discovery, UX decisions, general frontend work, unrelated maintenance, roadmap expansion, or production access.
---

# Backend Autopilot Protocol

Complete approved backend tasks with high engineering autonomy while preserving the repository's product, privacy, security, roadmap, and production boundaries.

## Establish authority and scope

Before implementation:

1. Inspect the actual branch, HEAD, working tree, code, tests, `README.md`, and relevant current implementation.
2. Read `AGENTS.md`, the current roadmap phase, and the approved documents relevant to the task.
3. Follow the repository authority order: Product Scope for product purpose and version boundaries; IA for target behavior, permissions, visibility, and states; approved backend architecture for technology and trust boundaries; approved target data model for logical database responsibilities; code, tests, and `README.md` for implemented-state facts.
4. Treat the explicit approved task as the implementation boundary. Preserve unrelated changes and do not silently combine later roadmap phases.
5. Distinguish product rules from implementation choices. Never change a product rule for implementation convenience.

If an authoritative source intentionally leaves a purely technical detail unspecified, choose a safe, simple, reversible implementation without asking the owner. If the missing detail changes user-visible behavior, permissions, eligibility, privacy, contact disclosure, legal meaning, domain limits, lifecycle or state behavior, or other product semantics, use the product-decision escalation gate.

This skill supplies an execution protocol, not approval for a backend task, a roadmap phase, an architecture change, or a production operation.

## Make engineering decisions autonomously

Within the approved scope and architecture, decide and implement ordinary technical details, including:

- code structure and internal APIs;
- SQL and migration structure;
- constraints and indexes that enforce approved behavior;
- RLS, grants, and security-definer implementation details;
- transaction boundaries and atomic operations;
- server-side validation and normalization;
- focused tests, fixtures, and synthetic data;
- safe refactoring necessary for the task;
- error handling and privacy-safe observability;
- CI configuration required by the task;
- security fixes inside the approved scope;
- documentation updates caused by implementation;
- technical bug fixes discovered during implementation or verification.

Do not treat technical uncertainty alone as a reason to ask the owner. Inspect evidence, select the strongest simple solution consistent with the approved architecture, implement it, verify it, and report material trade-offs.

Do not ask the owner to choose among equivalent technical implementations when repository evidence and normal engineering judgment are sufficient.

### Manage dependencies

Add or update a normal software dependency without a separate approval only when it is genuinely required by the approved task, fits the selected architecture, introduces no new external provider, is not speculative, is actively maintained and appropriate, and its package changes are reviewed and verified.

Require owner or product approval before introducing:

- a new SaaS or provider;
- a new database;
- a separate backend runtime;
- a paid external service;
- a major replacement of the approved stack;
- infrastructure that materially changes the approved architecture.

## Run the autonomous engineering loop

Continue through the complete cycle:

1. Inspect the current state and relevant authority.
2. Plan the implementation within the approved boundary.
3. Implement the smallest complete solution.
4. Add or update focused tests.
5. Run focused verification.
6. Run broader checks appropriate to the change.
7. Perform the security and privacy review below.
8. Inspect the complete relevant diff and working tree.
9. Fix technical problems found.
10. Repeat verification until clean.
11. Update documentation affected by implementation facts.
12. Determine whether human manual testing is genuinely required.

Do not stop at the first test, lint, build, migration, or ordinary CI failure. Diagnose and fix task-related technical failures. Do not expand into unrelated maintenance when addressing them.

Use browser verification when the approved backend task changes user-visible behavior or a browser-mediated flow. Require human manual testing only when human interaction or perception remains necessary after available automated and browser checks.

## Perform security and privacy review

For every backend task affecting identity, authorization, database access, private data, contacts, locations, eligibility, integrations, or external effects, explicitly review all applicable items:

- enforce authorization server-side rather than relying on UI hiding;
- verify RLS, grants, and protected function boundaries;
- separate public and private response shapes;
- never fetch protected fields merely to hide them client-side;
- keep secrets, tokens, cookies, private contacts, and exact locations out of logs;
- validate and normalize untrusted input;
- verify idempotency and retry safety;
- review concurrency and race conditions;
- make business transitions atomic where required;
- apply least privilege;
- verify migration and rollback safety;
- use synthetic test data only;
- prevent accidental production coupling.

Fix security defects inside the approved task scope autonomously. Escalate only when the fix requires a product decision, an owner-controlled action, or authority beyond the task.

## Escalate only at three normal gates

Stop and ask the owner only when one of these gates is reached. Continue all independent in-scope work first when practical.

### Gate 1: Product decision

Use this gate when approved documents conflict, required product behavior is genuinely unspecified, a new user-visible rule must be selected, permissions or privacy semantics would change, or the best implementation requires changing approved architecture or product scope.

Provide:

- the exact unresolved question;
- repository or document evidence;
- practical alternatives;
- one recommended option and its rationale;
- any work that can continue independently.

Do not present ordinary engineering choices as product questions.

### Gate 2: Owner-controlled external action

Use this gate when progress requires a secret or API key, a provider account or project, billing or quota approval, domain or DNS configuration, a protected environment operation, or permissions unavailable to Codex.

Ask only for the specific owner action or input required. Never ask the owner to paste production secrets into Codex. Provide safe instructions and finish independent local work first when practical.

### Gate 3: Human manual user test

Use this gate only when human interaction or perception is necessary to validate changed user-visible behavior and automated or browser verification is insufficient.

Before stopping, complete implementation, automated checks, available browser verification, the security and privacy review, and all technical fixes. Then provide a short checklist limited to the changed behavior.

## Preserve the production boundary

Maintain the approved rule that Codex has no production access. Never:

- receive or request production secrets;
- connect to unrestricted production data;
- use production data for development or tests;
- run ordinary development work against production;
- execute production migrations autonomously;
- perform an owner-only production operation because code is ready.

Keep production migrations and protected production operations explicit, reviewed, owner-controlled actions under the approved Backend and Integration Architecture. Automate staging or test environments only with deliberately provided permissions and synthetic data.

## Apply Git and CI autopilot when authorized

Skill activation does not itself authorize commits, pushes, or remote changes. Read the explicit task for Git and CI authority.

When the task authorizes the full Git and CI loop and no human manual test is required:

1. Complete local verification and the final security/privacy review.
2. Inspect `git status`, diff stat, and the complete relevant diff.
3. Commit only the approved scope in one coherent commit unless a later CI correction is required.
4. Push the approved branch.
5. Wait for every required CI job and cleanup step to complete.
6. Inspect failures and fix task-related technical causes autonomously.
7. Re-run appropriate local verification, commit and push the correction, and repeat until CI is green or an escalation gate is reached.

Do not ask whether to commit, push, or fix task-related CI after the task has already authorized that loop. Do not report pending, skipped, cancelled, or failed CI as success.

If CI exposes a clearly unrelated pre-existing failure, diagnose it before deciding whether it blocks the task. Do not silently expand the task into unrelated maintenance; report a genuine external blocker when it cannot safely be resolved within scope.

When human manual testing is required, do not create the final commit or push before the test unless the explicit task says otherwise. Resume the same task after the owner reports the result.

## Maintain documentation discipline

Update documentation only when implementation facts, architecture, security boundaries, setup, commands, or operational behavior changed. Do not mechanically rewrite product documents, claim future work is implemented, or confuse current implementation with approved target architecture. Update Mermaid diagrams only when their represented flow or architecture changes.

## Report completion

Report concisely and factually in Russian, following `AGENTS.md`. Include, when applicable:

- completed scope and important autonomous technical decisions;
- changed files;
- migrations, schema, authorization, and security changes;
- dependency and package changes;
- tests and verification actually run;
- security and privacy review result;
- browser and manual testing status;
- documentation changes;
- commit SHA, branch, CI run, and final status;
- warnings, skipped checks, and unresolved blockers.
