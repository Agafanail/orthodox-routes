# Core Multi-User Staging Readiness

## Verified staging state — 22 August 2026

The isolated `orthodox-routes-staging` Supabase project and `https://orthodox-routes-staging.onrender.com` deployment are configured with synthetic-only data boundaries. All nine committed migrations through the service-role-only targeted phone-delivery bridge in `20260822130000_phone_delivery_worker_api.sql` are applied with matching local/remote history. The remote API exposes only the committed `api` schema, Auth uses the exact HTTPS `/auth/confirm` redirect, and `GET /api/readiness` returns HTTP 200.

`npm run test:staging-core` passed again after the ninth migration against the remote Auth/Data API and HTTPS board with separate synthetic passenger, driver, and unrelated identities. It verified public/private projections, actor ownership, agreement, capacity, cancellation, restoration, and on-demand disclosure, then removed every synthetic fixture. The new worker functions have zero `anon`/`authenticated` grants and exactly two `service_role` grants. The prior remote security advisor audit reported 41 expected warnings for the deliberately executable `SECURITY DEFINER` RPC boundary and no other warning type; direct sensitive grants, unhardened security-definer functions, actor-ID API arguments, and protected tables without FORCE RLS all remained zero before this hardened two-function delta.

Staging Auth is owner-configured to send through Resend as `Orthodox Routes <auth@orthodox-routes-staging.churchmemory.by>`; its domain authentication is verified and no Render email variables are required. On 22 August, Supabase Auth accepted a real passwordless-email request and the owner confirmed delivery to Gmail from `Orthodox Routes` with subject `Confirm your Orthodox Routes sign-in`. The owner then used the explicit visible sign-in action, confirmed the authenticated state, refreshed the page to confirm SSR session persistence, and signed out on the current device. The message was placed in Spam. Delivery and the link/session flow are therefore confirmed; Spam placement is a separate deliverability issue and is not evidence of an SMTP configuration failure.

Bird is owner-approved for staging SMS delivery without Bird Verify. Billing, Italy routing, the active alphanumeric sender `OrthoRoutes`, and all three Bird runtime values are owner-configured in the Render secret manager. The application owns OTP generation and verification; the repository implements the current Bird Messages API adapter and targeted service-role worker bridge. A real staging smoke produced two sequential same-account attempts: Bird accepted both with distinct validated references, the first was safely superseded and cleared when the second was requested, and the second reached the handset and became verified only after the owner entered the application-generated OTP. No active, unrelated, cross-account, failed, or expired attempt remained; no transient delivery material remained; and the synthetic account/Auth/legal/church fixtures were removed after the audit. Provider acceptance alone did not create a verified phone or participation eligibility. The database-owner phone fixture used by the automated remote smoke remains separate and is not provider evidence.

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
| `BIRD_API_KEY` | server only | Owner-held Bird API key whose region prefix must match the configured API host |
| `BIRD_API_BASE_URL` | server only | Exact regional Bird origin, for example `https://eu1.platform.bird.com`, with no path, query, fragment, port, or credentials |
| `BIRD_SMS_SENDER` | server only | Approved 1–11 character alphanumeric sender; staging uses `OrthoRoutes` |

`SUPABASE_SECRET_KEY`, `CONTEXTUAL_REGISTRATION_SECRET`, and `BIRD_API_KEY` must be injected by the hosting secret manager. They must never use a `NEXT_PUBLIC_` prefix, appear in browser bundles, `.env.local`, logs, screenshots, CI artifacts, or repository files. Production and staging must use different values, keys, and Supabase projects. The Bird adapter fails closed unless all three Bird values pass strict validation.

## Supabase and Auth configuration

Before application smoke testing, the owner or authorized deployment pipeline must maintain the following configuration:

1. use only the isolated staging project and record its region and ownership;
2. configure the Auth Site URL to the exact `ORTHODOX_ROUTES_APP_URL` origin;
3. allow the exact `/auth/confirm` redirect on that origin, without wildcard production domains;
4. keep anonymous Auth identities disabled and email confirmation enabled;
5. maintain the owner-approved Resend SMTP sender directly in Supabase Auth; no duplicate Render email configuration is required;
6. apply every committed migration in timestamp order to an empty staging database through a reviewed, auditable migration job;
7. publish a staging-only Terms version and only synthetic church/account fixtures clearly labelled as staging data;
8. keep direct grants on `app`, `private`, and `ops` tables absent and expose only the committed `api` schema.

The application intentionally shows a safe unavailable state when a configured backend has no matching published church. It never falls back to browser-owned transport records. Do not import `localStorage` requests, offers, responses, agreements, capacity, contacts, or ownership.

## Phone-provider boundary

Core phone ownership remains application-owned and database-authoritative. The Next.js server action can lease only the attempt just returned by the authenticated request, and only through two `service_role`-granted `api` functions; browser roles cannot execute them and direct `ops` grants remain absent. Bird receives the E.164 destination, short-lived OTP text, sender, authentication category, and attempt ID as an idempotency key. HTTP 202 with a validated `sms_` message ID records provider acceptance, not handset delivery. Provider errors, keys, OTPs, phone numbers, and response bodies are not logged or returned to the browser. Missing or invalid Bird configuration and any provider/database failure clear recoverable delivery material and surface only the safe unavailable state.

## Deployment and smoke sequence

Run these checks before declaring staging usable:

1. locally run `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run test:maps-upgrade`, and all focused backend verification scripts;
2. confirm the remote migration job applied the same migration filenames and recorded its immutable commit SHA;
3. require `GET /api/readiness` to return HTTP 200 with only `{ "scope": "core-application", "status": "ready" }`; HTTP 503 means required server/public configuration is incomplete or the committed safe Core RPC boundary is unavailable;
4. load an unconfigured deployment and confirm only the isolated demo board is available;
5. load the configured staging deployment and confirm a missing church cannot fall back to demo data;
6. run `npm run test:staging-email`, supply only an owner-approved recipient and its newly received confirmation URL through standard input, and require safe callback GET, explicit verification, SSR session persistence, local sign-out, and synthetic-user cleanup to pass;
7. with synthetic eligible passenger and driver accounts, publish from separate browser contexts, exchange a response, confirm exactly one agreement, and verify capacity in both contexts;
8. verify an unrelated signed-in account receives no participant responses, agreements, contacts, or exact meeting place;
9. confirm contacts and exact meeting place are absent from initial HTML and appear only after the participant's explicit disclosure action;
10. cancel the agreement and verify disclosure is immediately unavailable, capacity returns exactly once, and full passenger need requires explicit restoration;
11. inspect application, Auth, database, and provider logs to confirm they contain no OTP, resume capability, contact, exact-place, cookie, service key, or full protected payload.

For the linked synthetic-only project named exactly `orthodox-routes-staging`, `npm run test:staging-core` performs the database/API part of this sequence with three uniquely identified synthetic identities and then removes only the records created by that run. It requires the project to be healthy and to have a current synthetic Terms fixture, can reuse an existing published walkthrough church without deleting it, and never truncates shared staging data. It obtains keys only through the already-authenticated Supabase CLI without persisting or printing them, and leaves real email-link and SMS delivery for the separately configured provider smokes. `npm run test:staging-email` applies the same project-name and health guard, does not include the recipient/link in its own status output, and removes a newly created synthetic Auth identity after success. The database-owner phone fixture proves remote eligibility wiring only and must never be reported as real SMS verification.

The committed `supabase/config.toml` is local-only and must never be pushed directly to a remote project because its Auth URLs intentionally point at localhost. Remote API/Auth changes require a reviewed staging-specific operation that preserves the exact HTTPS Site URL and `/auth/confirm` redirect.

## Promotion gate

Staging readiness is not production approval. Promotion requires a separate owner-approved production project, provider and billing decisions, approved production Terms/Privacy versions, secret rotation, backup/restore and operational procedures, and the later roadmap work explicitly excluded from this Core campaign. No production migration or access is authorized by this document.
