# AGENTS.md

## 1. Project and documentation

- This repository contains Orthodox Routes, built with Next.js App Router, React, TypeScript, and Tailwind CSS. Consult `README.md` and `docs/CODEX_ROADMAP.md` for the current implementation status.
- Read the relevant implementation and authoritative documentation before changing behavior. Do not restate product specifications in this file.
- Use the documentation map and authority order below:
  - `docs/ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md`: approved source of truth for the product purpose and boundaries of the first complete public version;
  - `docs/ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md`: approved source of truth for target-product screens, navigation, routes, roles, permissions, journeys, states, visibility, taxonomy, content structure, and transitions between public, personal, and church-administration contexts;
  - `docs/ORTHODOX_ROUTES_DESIGN_SYSTEM_V1.md`: approved source of truth for the initial visual system within Product Scope and IA V2;
  - `docs/ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md`: approved target backend, hosting, integration, security, operations, cost, and migration architecture;
  - `docs/ORTHODOX_ROUTES_TARGET_DATA_MODEL_V1.md`: approved canonical target logical data model for that architecture; it is not an executable migration;
  - `README.md`: current implementation, local setup, and CI overview;
  - `docs/PROJECT_SPEC_V0_1.md`: legacy specification for the browser-only prototype and historical v0.1 decisions;
  - `docs/DATA_MODEL.md`: current prototype entities, relationships, statuses, and persistence notes; it is not the approved target database schema;
  - `docs/UX_RULES.md`: current prototype UX rules plus a concise cross-reference to approved target UX in IA V2;
  - `docs/PROJECT_MAP.md`: current prototype architecture, product flows, and Mermaid diagrams;
  - `docs/CODEX_ROADMAP.md`: approved development sequence and current phase.
- When documents conflict, use Product Scope for approved product purpose and first-version boundaries and IA V2 for the approved target information architecture and product/interface behavior within its authority. The design system and approved backend/data documents operate only within those boundaries. A conflict between approved documents must be resolved explicitly before implementation; do not choose a rule independently. Use the actual code, tests, and `README.md` for current implementation facts. Legacy prototype documents must not override Product Scope or IA V2.
- An explicit task prompt may override these repository defaults. When a requested change intentionally conflicts with current code or documentation, implement the approved change, report the conflict, and update the affected documentation. Otherwise, do not invent new product rules.

## 2. Product and UX principles

- Orthodox Routes is church-centered transport coordination: a church transport board connecting passengers with drivers already travelling to a service. It is not an Orthodox taxi service or an Uber clone.
- Prefer the simplest viable implementation and avoid unnecessary architecture or speculative code.
- Do not introduce a backend, authentication, maps, paid services, new dependencies, or major architecture changes unless the task explicitly requires them. Approval of the target product scope defines the destination; it does not authorize implementing multiple roadmap phases at once.
- Approval of a backend architecture or target data model selects a later implementation direction; it does not by itself authorize infrastructure creation, provider configuration, executable migrations, or implementation of later roadmap phases in the same task.
- Keep work within the requested scope. Raise a concrete recommendation before making an unrequested product or architecture change.
- Write user-facing text for ordinary parishioners. Describe actions and consequences, not implementation details.
- Do not expose terms such as `local`, `mock`, `localStorage`, persisted state, ownership, internal status names, or public profile when users do not need those concepts. Follow `docs/UX_RULES.md` for detailed UX rules.
- User-facing UI copy may be Russian in the current prototype. Source code, identifiers, technical documentation, code comments, commit messages, and pull-request descriptions must remain in English unless the task explicitly says otherwise. Approved product-decision documents may remain in the language used for product approval.
- Communicate Codex progress and final reports to the user in Russian.

## 3. Implementation discipline

- Inspect existing components, helpers, types, and tests before creating parallel implementations.
- Reuse and centralize shared logic when practical, while avoiding abstractions that are not justified by the task.
- Preserve observable product behavior during refactors unless the task explicitly changes it, including UI copy, accessibility, validation, visibility, routes, and public import paths.
- Preserve backward compatibility for existing browser-stored data when changing persisted shapes or parsing. Treat `localStorage` input as untrusted.
- Keep private contact information out of public UI, public data shapes, logs, and any disclosure outside the approved product boundary. Follow the product documentation for when and to whom contacts may be revealed.
- Do not add dependencies, edit package files, or change generated files unless the task requires it.
- Do not perform unrelated refactoring or cleanup.

## 4. Verification

- Run checks appropriate to the change. Executable code, UI, configuration, dependency, and workflow changes normally require:
  - `npm test`;
  - `npm run lint`;
  - `npm run build`;
  - `git diff --check`.
- Add focused verification for the changed behavior instead of relying only on broad commands.
- Perform browser verification when a task changes user-visible behavior, layout, forms, navigation, modal behavior, or responsive behavior. Check the relevant desktop and mobile scenarios.
- Documentation-only changes require `git diff --check` and a review of the complete relevant documentation diff. Do not run application tests, lint, or build unless the documentation change affects executable configuration or needs such verification.
- Before reporting completion, inspect `git status --short`, `git diff --stat`, and the complete relevant diff.
- Report exact results and distinguish warnings, skipped checks, blocked checks, local verification, and remote CI.

## 5. Documentation

- Update affected documentation in the same task when architecture, product behavior, UX, data models, statuses, visibility, or flows change.
- Update Mermaid diagrams only when the flow or architecture they represent changes.
- Do not update documentation mechanically when no documented behavior changed.

## 6. Git and reporting

- Inspect the working tree and existing diff before editing. Preserve unrelated user changes and do not overwrite them.
- Do not create commits or push unless the task explicitly requests it.
- When a commit is requested, use a concise English imperative subject and include only the approved task scope.
- When push and CI are part of the task, report the commit SHA, pushed branch, and final CI status. Do not describe pending or failed CI as successful verification.
- Classify changes as Product Change, Technical Change, Technical Refactor, or Documentation-only Change when useful for the report.
- Keep final reports concise and factual: list changed files, implemented and preserved behavior, documentation and Mermaid impact, checks actually run, dependency/package changes, Git actions, CI status, and warnings or errors.
