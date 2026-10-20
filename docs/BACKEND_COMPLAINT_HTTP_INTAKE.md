# Inactive complaint HTTP intake reader

`createComplaintPreparationRequestReader` in `src/lib/complaints/request.ts` is a provider-independent server transport boundary, not an application route, complaint submission, authenticated session, email proof, receipt, or activation. Its `parsed.input` is still untrusted server-side input for the existing preparation broker. Never forward the reader result as a browser response or derive actor/network/capabilities from its fields.

## Public-origin and metadata checks

The factory requires an explicit credential-free public HTTPS origin without a path/query/fragment. It never derives that origin from Host, forwarded headers, or a return URL. It accepts only POST, an exact matching Origin, JSON with optional UTF-8 charset, and absent/identity content encoding. If Sec-Fetch-Site is present it must be same-origin. Origin metadata protects the browser submission boundary, not identity: non-browser clients can forge headers and must still pass session, rate, challenge, and database authority.

Missing configuration is unavailable. Missing/foreign/opaque Origin, foreign Fetch Metadata, wrong method/encoding/type, invalid/oversized Content-Length, consumed or aborted bodies fail before body reading, with best-effort cancellation. No cross-origin/CORS exception, Referer fallback, trusted proxy rule, or implicit actor is introduced.

## Bounded private body

Actual streamed bytes are capped at 64 KiB regardless of an absent or false size header. This technical serialization ceiling covers the existing field maxima, including UTF-16 escape pairs for 4000 Unicode code points, padded mailbox input, a full challenge token, and escaped field names. It is not a new description limit, operational rate, retention value, or deployment setting. UTF-8 and JSON are strict; only an object reaches the broker, which retains all field, category, target, actor, and authority checks.

The entire read is bounded to five seconds, including a stream whose cancellation never resolves. Abort/deadline must not turn a valid partial JSON prefix into success. Cancellation is never awaited; timers/listeners/locks are cleaned up. Bounded empty-chunk iteration prevents a microtask loop from starving timers. Fixed failure codes contain all parser/stream diagnostics without complaint text, mailbox, token, IP, headers, or exception messages.

## Shared resource primitive

`src/lib/http/limited-json.ts` centralizes the existing byte/strict UTF-8/JSON pattern. The provider acknowledgement wrapper keeps its public import path, 16 KiB limit, advertised-length check, fixed errors, and caller-owned provider deadlines. No provider is changed or enabled. Its abort handling now also bounds an abort-ignoring reader directly. This narrow reuse avoids coupling request intake to a provider-specific adapter or maintaining two private-data readers.

## Verification and remaining boundaries

No-network tests cover metadata/configuration refusal before reads, both UTF-8 charset forms, split Unicode, maximum escaped fields, exact/excess byte bounds, false Content-Length, invalid UTF-8/JSON/non-byte data, consumed/aborted/stalled bodies, valid-prefix interruption, private errors, locked-reader ownership, empty-chunk loops, and domain/actor refusal through the unchanged broker. Existing Bird/Resend/acknowledgement regressions separately preserve provider classifications and deadlines. These tests are not actual browser, proxy, cookie/session, provider, mailbox, load, or PostgreSQL proof.

Actual route composition, independently verified session/account and hosting/proxy context, encrypted retry-cookie integration/clearing, approved operational rate values, real challenge/mailbox proof, received cases, owner receipt/review, cleanup scheduling, approved retention, and browser/manual acceptance remain required before public exposure. No route, environment fallback, privileged client, migration, dependency, provider call, or production operation is added here.
