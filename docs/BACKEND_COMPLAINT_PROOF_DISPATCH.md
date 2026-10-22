# Protected single-job complaint mailbox-proof dispatch

`POST /api/internal/complaint-proof-worker` is a fixed server-only bridge to the existing complaint mailbox-proof runner. It leases at most one pending draft and sends only its prepared six-language confirmation message through the selected Resend adapter. It never receives a complaint, delivers a report to the owner, signs in an account, changes contacts, performs cleanup or applies received-case retention.

## Authorization and activation

`COMPLAINT_PROOF_WORKER_SECRET` is empty by default. It must be a printable 32–256-character server-only secret distinct from notification, translation and complaint-maintenance secrets. Missing configuration returns unavailable; an incorrect bearer returns unauthorized before any claim or provider construction. Request bodies are ignored/cancelled and cannot select a recipient, job, operation or batch size. Responses contain only fixed configured/claimed/sent/failed counters with private/no-store and no-referrer headers.

No environment, secret, scheduler, real provider or production connection is configured by adding this route. Activation requires reviewed secret storage/scheduling, existing explicit secure application origin and Resend configuration, public preparation/verification abuse boundaries with approved operational settings, and actual mailbox/browser proof. Do not put worker secrets in URLs, public environment variables, logs or analytics. The maintenance token cannot authorize sending mail.

## Bounded and validated dispatch

The HTTP route explicitly calls the existing runner with limit one: dependency waits are at most five seconds for the claim, twelve seconds for sending and five seconds for completion, not those bounds multiplied by a batch. The selected protected client also has a five-second request timeout. Claim/completion attach AbortSignals and are aborted on acknowledgement or deadline. An uncertain completion stops further claims. An unknown transport result may already have committed or reached a mailbox; it is not automatically retried inside the current attempt.

Database-relative lease/draft durations still subtract the complete monotonic claim round trip. All timestamps now reuse strict literal-calendar parsing, refusing impossible dates normalized by `Date.parse`. Dispatch requires more than twenty seconds remaining after claim to cover the twelve-second provider wait, five-second completion wait and margin. This only refuses too-late work; it does not extend the original fifteen-minute/reporting deadline, 45-second maximum lease, capability lifetime or SQL completion authority.

The existing notification-result normalizer moved unchanged into the shared adapter contract; its original worker export remains compatible. Ordinary notification behavior is unchanged. Complaint proof mail now uses the same strict check instead of trusting an `outcome` word: selected adapter identity, a valid successful HTTP class, a valid email-provider UUID acknowledgement and no failure must agree. Unknown/malformed acknowledgements become the existing temporary failure. Known safe permanent refusals retain their classification. Only the fixed outcome reaches complaint completion; provider IDs, bodies, private diagnostics and extra fields do not.

Existing SQL token rotation, independent resume proof, idempotency, post-lock expiry, verification/completion interaction, five-attempt ceiling and backoff remain authoritative and unchanged. A successful counter means validated provider acceptance plus accepted completion, not mailbox delivery, email ownership or receipt of a complaint. There is no exactly-once external-delivery claim.

## Verification and exclusions

Focused tests cover independent secrets, authorization before dispatch, fixed one-job routing, minimized responses, shared normalizer compatibility, malformed acknowledgements, safe permanent refusals, selected Resend with a no-network HTTP fake, RPC abort/late completion, no later claim after uncertain completion, strict timestamps and insufficient dispatch reserve. Existing real disposable SQL exercises claim/rotation/expiry/concurrency and completion; local fakes are not real provider/handset/mailbox verification.

The loopback-only local production build was also probed with the new worker secret absent: GET returned 405 and POST returned private/no-store `503 unavailable`. This proves default refusal, not authenticated database dispatch or real mail delivery.

No dependency, migration, public complaint page, operational rate value, received case, legal retention or production setting changes. Actual scheduler/environment/provider activation and user-visible browser confirmation remain release work.
