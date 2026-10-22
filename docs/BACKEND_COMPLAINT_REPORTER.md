# Complaint reporter session boundary

`src/lib/complaints/reporter.ts` and the unwired Next.js seam in `server.ts` derive
the reporter for the existing preparation broker without accepting a browser actor.
This is not a route, complaint receipt, proxy trust rule, or provider activation.

## Session authority

The server seam uses the complete Next.js cookie jar, request headers, public project
configuration and the existing request-scoped SSR client. Cookie contents are never
decoded as identity. Project-cookie presence is classified using the installed
Supabase client's default `sb-<first hostname label>-auth-token` storage key, including
chunk-shaped names. No custom storage key is configured; a future change must update
this boundary and its real SSR integration together.

Only absence of that project's session cookies permits an immediate guest result.
Present, malformed, duplicate or ambiguous base-plus-chunk state never silently
becomes a guest. Competing Authorization input is refused: this cookie-based seam
does not accept a browser bearer fallback. Missing configuration/client or framework
errors also fail closed, including for apparent guests.

Present session state requires `auth.getUser()` verification followed by the existing
protected `current_eligibility` projection's boolean account-existence fact. It does
not fetch `current_account` or private contacts merely to check existence. A verified
identity without an application account remains a guest; an existing account is
associated by the verified Auth UUID without requiring phone, age, Terms, active
participation state, or optional transport delivery. The database remains authoritative
for target visibility/participation history; email proof is still required separately.

Identity lookup and the account RPC each have a five-second server wait bound. The
RPC signal is aborted on exit; an ignored/late identity result cannot trigger an
account read. The Auth client has no per-call abort option, so a timed-out Auth read
may finish in the background but cannot produce a resolved reporter. No read is
automatically retried by this resolver. Fixed results contain only a resolved internal
UUID/null or unavailable; no cookies, session tokens, Auth user, contacts, provider
errors or eligibility payload are forwarded or logged.

## Verification and remaining work

No-network tests exercise the real resolver/server seam with fake framework/Auth/RPC
dependencies, including chunked names, configuration, ambiguity, forged input,
pre-account guests, ineligible existing accounts, exceptions, malformed data and
abort-ignoring deadlines. Required disposable account integration imports the actual
resolver through Node 24 native TypeScript support and tests real SSR cookie persistence,
Auth user verification, pre-account/existing-account association without eligibility,
competing authority refusal and unusable session state using the parent's synthetic
identity. The module-detection warning does not justify a package-wide module change.

Public HTTP composition, verified hosting/proxy network identity, encrypted retry-cookie
retention/clearing, challenge/widget and mailbox/provider proof, approved operational
rates, received cases, working owner receipt, maintenance, legal retention, and browser
acceptance remain unfinished. The new seam is not registered or activated by this work.
