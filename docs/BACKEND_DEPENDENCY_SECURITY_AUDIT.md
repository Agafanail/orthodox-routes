# Backend dependency security snapshot

Checked on 15 October 2026. This is a dependency/implementation snapshot, not a claim that an advisory-free installation has no vulnerabilities.

## Scoped remediation

- Pin Next.js and its matching ESLint configuration to `16.3.8`, within the existing major/minor release line. The official [16.3.8 security release](https://github.com/vercel/next.js/releases/tag/v16.3.8) covers image-optimization, metadata, and cache issues; the earlier `16.3.6` patch fixes the [Node ImageResponse advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j).
- Pin Vitest to `4.1.12`, including the [redirect-mock path validation fix](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). Its resolved Vite/Rolldown and associated compiler dependencies also move within their permitted existing major versions; no application framework major upgrade or package-type change is introduced.
- Refresh only the affected compatible transitive packages: `baseline-browser-mapping` to `2.11.28`, both `brace-expansion` lines to `1.1.21`/`5.0.12`, `browserslist` to `4.29.3`, `js-yaml` to `4.3.2`, and `source-map-js` to `1.2.2`, with their required data packages. Preserve existing overrides; do not use a forced audit rewrite.
- Keep the separately reviewed Sharp `0.35.5` processor dependency intact.

## Reachability and residual finding

The repository inspection found no `next/og`/`ImageResponse`, remote image allowlist, Draft Mode, or custom `dynamicParams` use. The application uses App Router without a Pages Router or root catch-all page. These absent prerequisites narrow several advisory paths; the patch is still applied rather than treating that inspection as permanent protection. Existing authorization, no-store private data boundaries, and safe provider configuration remain necessary.

After remediation:

- `npm audit --omit=dev --json`: zero reported vulnerabilities.
- `npm audit --json`: five high-severity dependency entries, zero moderate/critical entries. All five are one remaining `braces` advisory propagated through `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next`, not five independent runtime flaws.
- The registry's current `braces` release is still `3.0.3`, which the [remaining advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) includes. That chain is used for development lint file matching and is absent from the production-only audit. No public application route accepts glob patterns for it. Do not expose lint/dev tooling to untrusted network input. CI executes project tooling in disposable runners with read-only repository permissions.
- npm's suggested ESLint downgrade to `14.2.35` is not an appropriate automatic fix for this Next.js 16 project. Track the upstream fix and update this snapshot at the final campaign audit; do not silently override an incompatible parser or claim the full audit is clean.

## Verification boundary

Required CI still runs the full application suite, lint, production build, clean database replay, representative upgrade, synthetic authorization/domain integration, and Core browser regression. None of those checks is weakened by this update.

The Windows host experienced native allocation failures during an initial full local test attempt, distinct from a test assertion failure. A subsequent unchanged full run passed all 660 tests in 67 files with one worker and a bounded 512 MiB heap. Local lint and the Next.js 16.3.8 production build passed; the remote full-suite result remains required before merge. Vitest emits a non-blocking advisory about a future native configuration-loader default; the existing configuration is not changed and the warning is not suppressed.

No production deployment, provider account configuration, new service, legal decision, or migration is part of this dependency slice.
