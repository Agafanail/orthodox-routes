# Core Multi-User Staging Readiness

## Verified staging state — 21 August 2026

The isolated `orthodox-routes-staging` Supabase project and `https://orthodox-routes-staging.onrender.com` deployment are configured with synthetic-only data boundaries. All eight committed migrations through `20260820200000_core_application_projection.sql` are applied with matching local/remote history. The remote API exposes only the committed `api` schema, Auth uses the exact HTTPS `/auth/confirm` redirect, and `GET /api/readiness` returns HTTP 200.

`npm run test:staging-core` passed against the remote Auth/Data API and HTTPS board with separate synthetic passenger, driver, and unrelated identities. It verified public/private projections, actor ownership, agreement, capacity, cancellation, restoration, and on-demand disclosure, then removed every synthetic fixture. Remote security advisors reported 41 expected warnings for the deliberately executable `SECURITY DEFINER` RPC boundary and no other warning type; direct sensitive grants, unhardened security-definer functions, actor-ID API arguments, and protected tables without FORCE RLS all remained zero.

Real staging email-link delivery and real SMS delivery are not verified. No application SMS worker/provider account, billing, sender/route registration, callback authentication, or provider secret is configured. The database-owner phone fixture used by the remote smoke proves only the deployed eligibility boundary and is not provider evidence.

## Status and boundary

This is the version-controlled readiness contract for the isolated Orthodox Routes Core staging environment. It does not authorize production access, configure billing, publish production legal text, or store provider credentials. Those remain owner-controlled actions. Maps, geocoding, routing, PostGIS quality matching, notification delivery, and later roadmap domains are outside this contract.

## Required environment values

The Next.js runtime requires exactly these application values:

| Variable | Exposure | Requirement |
| --- | --- | --- |
| `ORTHODOX_ROUTES_APP_URL` | server | Exact HTTPS staging origin, with no path, query, fragment, or embedded credentials |
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server | Isolated staging Supabase API origin |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser and server | Publishable/anonymous key only; a service-role or secret key is rejected |
| `SUPABASE_SECRET_KEY` | server only | Staging secret/service-role key used only by the contextual-draft orchestration boundary |
| `CONTEXTUAL_REGISTRATION_SECRET` | server only | Independent high-entropy value of at least 32 characters used to seal short-lived resume tickets |

`SUPABASE_SECRET_KEY` and `CONTEXTUAL_REGISTRATION_SECRET` must be injected by the hosting secret manager. They must never use a `NEXT_PUBLIC_` prefix, appear in browser bundles, `.env.local`, logs, screenshots, CI artifacts, or repository files. Production and staging must use different values and different Supabase projects.

## Supabase and Auth configuration

Before application smoke testing, the owner or authorized deployment pipeline must maintain the following configuration:

1. use only the isolated staging project and record its region and ownership;
2. configure the Auth Site URL to the exact `ORTHODOX_ROUTES_APP_URL` origin;
3. allow the exact `/auth/confirm` redirect on that origin, without wildcard production domains;
4. keep anonymous Auth identities disabled and email confirmation enabled;
5. configure an approved staging email sender/catcher that does not deliver synthetic tests to real people;
6. apply every committed migration in timestamp order to an empty staging database through a reviewed, auditable migration job;
7. publish a staging-only Terms version and only synthetic church/account fixtures clearly labelled as staging data;
8. keep direct grants on `app`, `private`, and `ops` tables absent and expose only the committed `api` schema.

The application intentionally shows a safe unavailable state when a configured backend has no matching published church. It never falls back to browser-owned transport records. Do not import `localStorage` requests, offers, responses, agreements, capacity, contacts, or ownership.

## Phone-provider boundary

Core phone ownership is provider-independent and already enforced by the database. Enabling real staging delivery still requires an owner-approved SMS account, billing, sender/route registration where applicable, callback authentication, and secret injection. The worker may lease only the restricted transient delivery contract. It must never receive general application table access or return OTP material to the browser API. Until that adapter is configured, staging participation remains correctly ineligible unless an isolated privileged synthetic fixture is used for testing.

## Deployment and smoke sequence

Run these checks before declaring staging usable:

1. locally run `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run test:core-upgrade`, and all focused backend verification scripts;
2. confirm the remote migration job applied the same migration filenames and recorded its immutable commit SHA;
3. require `GET /api/readiness` to return HTTP 200 with only `{ "scope": "core-application", "status": "ready" }`; HTTP 503 means required server/public configuration is incomplete or the committed safe Core RPC boundary is unavailable;
4. load an unconfigured deployment and confirm only the isolated demo board is available;
5. load the configured staging deployment and confirm a missing church cannot fall back to demo data;
6. complete passwordless email sign-in through the explicit confirmation button and verify SSR session persistence and local sign-out;
7. with synthetic eligible passenger and driver accounts, publish from separate browser contexts, exchange a response, confirm exactly one agreement, and verify capacity in both contexts;
8. verify an unrelated signed-in account receives no participant responses, agreements, contacts, or exact meeting place;
9. confirm contacts and exact meeting place are absent from initial HTML and appear only after the participant's explicit disclosure action;
10. cancel the agreement and verify disclosure is immediately unavailable, capacity returns exactly once, and full passenger need requires explicit restoration;
11. inspect application, Auth, database, and provider logs to confirm they contain no OTP, resume capability, contact, exact-place, cookie, service key, or full protected payload.

For a newly linked, empty, synthetic-only project named exactly `orthodox-routes-staging`, `npm run test:staging-core` performs the database/API part of this sequence with three isolated synthetic identities and then removes every fixture it created. It refuses any differently named, unhealthy, or non-empty project, obtains keys only through the already-authenticated Supabase CLI without persisting or printing them, and leaves real email-link and SMS delivery for the separately configured provider smoke. Its database-owner phone fixture proves remote eligibility wiring only and must never be reported as real SMS verification.

The committed `supabase/config.toml` is local-only and must never be pushed directly to a remote project because its Auth URLs intentionally point at localhost. Remote API/Auth changes require a reviewed staging-specific operation that preserves the exact HTTPS Site URL and `/auth/confirm` redirect.

## Promotion gate

Staging readiness is not production approval. Promotion requires a separate owner-approved production project, provider and billing decisions, approved production Terms/Privacy versions, secret rotation, backup/restore and operational procedures, and the later roadmap work explicitly excluded from this Core campaign. No production migration or access is authorized by this document.
