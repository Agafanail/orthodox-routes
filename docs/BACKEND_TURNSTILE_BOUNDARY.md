# Turnstile server boundary

## Current implementation

`src/lib/anti-abuse/turnstile.ts` is an inactive server-side Cloudflare Turnstile adapter. The provider was selected in Backend Architecture §4; no new provider or dependency is introduced.

`getTurnstileConfig()` requires server-only `TURNSTILE_SECRET_KEY` and an HTTPS `ORTHODOX_ROUTES_APP_URL`. It derives the exact normalized hostname, refusing credentials, paths, query strings, fragments, wildcard/invalid hostnames, IP literals, localhost, and trailing-dot names. All three documented dummy secrets are refused in every environment. There is no local-success mode or fallback provider.

`createTurnstileVerifier(config)` returns a verifier for trusted server-selected `complaint_submit` / `support_submit` actions. Its only results are `verified`, `rejected`, and `unavailable`. Neither raw errors nor provider values escape this boundary.

## Provider and resource contract

The implementation follows Cloudflare's [server validation contract](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [testing-key documentation](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), checked on 17 October 2026. Tokens are limited to 2,048 characters; server validation must confirm hostname/action and single-use validity within the provider's five-minute lifetime.

- POST JSON only to the fixed HTTPS Siteverify URL; redirects fail, credentials are omitted, and caching is disabled.
- Send only the server secret, challenge token, and a fresh opaque verification UUID. Do not forward visitor IP headers, account/case identifiers, complaint text, notes, locations, or client `cdata`.
- Require strict boolean success, no contradictory errors, the exact hostname/action, and a valid challenge timestamp no older than 300 seconds (at most 60 seconds ahead for clock skew).
- Bound response bytes to 16 KiB and the complete operation, including response reading, to five seconds. Abort outstanding I/O, cancel stalled/oversized bodies, release readers, and clear timers.
- Treat invalid/spent tokens as rejected; configuration, transport, protocol, or provider-operational failures remain unavailable. Both are refusal, never authorization.
- Make one attempt per call, without automatic retry or a verdict cache. A later invocation revalidates; the provider remains authoritative for token consumption. Application-operation idempotency must be handled separately by the eventual write workflow.

## Trust boundary and remaining work

The trusted handler must select the action and consume the verdict on the server. Never accept a browser-supplied verdict or use a frontend widget as write authorization. Challenge success is neither authenticated identity nor email ownership, complaint acceptance, moderation, or permission to access a target. A future intake must independently enforce target authority, email confirmation, input limits, rate limits, atomic writes, retries, and safe owner delivery. Direct Data API writes must not bypass that handler.

No widget/sitekey, form, route, complaint intake, provider account, domain restriction, key, or production configuration is created. Wiring the adapter and choosing when a challenge is required are separate flow implementation. Operational setup and real isolated-staging verification remain owner-controlled; no production access is requested.

## Verification

Sixty-nine focused unit cases cover configuration, dummy-key refusal, all verdicts, exact hostname/action binding, lifetime/skew edges, malformed input/JSON/provider responses, redirect/HTTP refusal, replay-shaped responses, privacy-safe output/logging, aborts, oversize/stalled bodies, and a transport ignoring cancellation. All provider calls in these tests use an injected fake. This proves the adapter contract only, not Cloudflare delivery, real token consumption, widget behavior, accessibility, or end-user acceptance. No browser-visible flow changes in this slice; the existing required browser regression remains part of CI.
