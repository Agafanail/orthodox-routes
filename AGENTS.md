# AGENTS.md

## 1. Project and documentation

- This repository contains Orthodox Routes, built with Next.js App Router, React, TypeScript, and Tailwind CSS. Consult `README.md` and `docs/CODEX_ROADMAP.md` for the current implementation status.
- Read the relevant implementation and authoritative documentation before changing behavior. Do not restate product specifications in this file.
- Use the documentation map below:
  - `README.md`: current implementation, local setup, and CI overview;
  - `docs/PROJECT_SPEC_V0_1.md`: product behavior, scope, roles, and privacy rules;
  - `docs/DATA_MODEL.md`: entities, fields, relationships, statuses, and persistence notes;
  - `docs/UX_RULES.md`: user journeys, UI copy, forms, accessibility, and visibility rules;
  - `docs/PROJECT_MAP.md`: architecture, product flows, and Mermaid diagrams;
  - `docs/CODEX_ROADMAP.md`: implemented capabilities, priorities, and out-of-scope work.
- An explicit task prompt may override these repository defaults. When a requested change intentionally conflicts with current code or documentation, implement the approved change, report the conflict, and update the affected documentation. Otherwise, do not invent new product rules.

## 2. Product and UX principles

- Orthodox Routes is church-centered transport coordination: a church transport board connecting passengers with drivers already travelling to a service. It is not an Orthodox taxi service or an Uber clone.
- Prefer the simplest viable implementation and avoid unnecessary architecture or speculative code.
- Do not introduce a backend, authentication, maps, paid services, new dependencies, or major architecture changes unless the task explicitly requires them.
- Keep work within the requested scope. Raise a concrete recommendation before making an unrequested product or architecture change.
- Write user-facing text for ordinary parishioners. Describe actions and consequences, not implementation details.
- Do not expose terms such as `local`, `mock`, `localStorage`, persisted state, ownership, internal status names, or public profile when users do not need those concepts. Follow `docs/UX_RULES.md` for detailed UX rules.
- User-facing UI copy may be Russian in the current prototype. Source code, identifiers, technical documentation, code comments, commit messages, and pull-request descriptions must remain in English unless the task explicitly says otherwise.
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
