# Inactive encrypted complaint retry state

`createComplaintPreparationRetryStore` in `src/lib/complaints/retry-state.ts` is a provider-independent Node/server codec for the existing preparation broker. It does not expose an HTTP route, parse a cookie/session/header, prepare a draft, verify email, receive a complaint, or enable delivery. No environment fallback or new storage/provider/dependency is introduced.

## Boundary and contents

The factory requires an explicit dedicated random 32-byte lower-case hex secret. Invalid/missing configuration returns only null results. The future trusted HTTP boundary must supply the authenticated reporter UUID from verified claims, or explicitly null for a guest. Structural UUID validation is not authentication. The reporter is authenticated as AES-GCM additional data; guest/account/other-account tickets are not interchangeable. The purpose is separate from contextual-registration tickets even if a secret is mistakenly reused; deploy a dedicated secret nevertheless.

`issue(reporter, now)` creates the existing random client UUID and independent 256-bit resume/email capabilities. Only these three values and issuance/expiry times enter the encrypted authenticated envelope. No complaint text, email, target, account ID, IP/network identifier, challenge verdict/token, session credential, database result, or provider response is stored in its plaintext. Raw intent returned by issue/open is protected server state, never a browser JSON response or log value.

Tickets use fresh 96-bit IVs, AES-256-GCM authentication, a purpose-derived key, exact four-part v1 framing, canonical bounded base64url, and strict decrypted-field validation. They are at most 1024 characters. Open contains malformed/tampered/unknown/expired results and returns a frozen minimal server intent or null, not exception text. It cannot authenticate a person or establish ownership of an email mailbox.

## Lifetime and explicit retry

The original maximum lifetime is fifteen minutes, matching the existing unsubmitted draft ceiling rather than setting complaint/audit retention. `restrict(ticket, reporter, databaseExpiry, now)` can only shorten the original expiry, never renew the original issuance or extend an earlier deadline. A fresh IV on restriction does not change the retry intent. Expired, future-issued, malformed, or wrong-reporter state fails closed.

Before the first uncertain write, the future HTTP implementation must retain the issued ticket in a secure, HttpOnly, appropriately scoped SameSite cookie (or equivalent protected server storage), without making the raw intent/browser-readable mail capability available. After a valid database receipt it must restrict to the actual deadline, which may be earlier than fifteen minutes; after closed/expired/refused state it must clear the cookie. Before an uncertain receipt, the local envelope ceiling cannot prove the database's actual target-bound expiry; database checks remain authoritative and are never extended by a ticket.

On explicit retry, open restores the same input identity for the existing broker. The broker must still consume the attempt budget, require a fresh accepted challenge, and invoke the protected draft API. The database's canonical input digest refuses changed target/text/mailbox under that identity. No budget, verdict, email proof, or received-complaint status is cached by this codec. A transport timeout never proves rollback, and no automatic retry is added.

## Verification and remaining gates

No-network tests cover actor/guest separation, purpose/key separation, private-value exclusion, distinct generated intents, tamper/noncanonical/oversize/truncated inputs, exact expiry, invalid clocks/configuration, no lifetime extension, database-deadline tightening, and composed explicit retries through the existing broker with renewed budget/challenge calls. These fake dependencies are not actual mailbox, provider, browser, session, or PostgreSQL proof.

The HTTP/CSRF/body-limit boundary, trusted hosting/proxy address, secret provisioning/rotation, cookie integration/clear paths, real challenge/mailbox confirmation, approved operational values, received cases, owner receipt/review, cleanup scheduling, approved retention, and browser/manual acceptance remain unfinished. Do not expose the inactive broker merely because protected state serialization exists.
