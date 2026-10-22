# Bounded Web Push egress

The selected VAPID adapter retains the installed `web-push` library for payload encryption and request signing. Its default network transport now uses native HTTPS with a connection-time public-address boundary and a ten-second wall-clock deadline. The previous library socket timeout did not bound an active response, and its sender accumulated the complete provider body.

## Destination authority

Subscription endpoints remain private, untrusted capability URLs, not permission to access the application's internal network. The adapter accepts credential-free HTTPS URLs up to the existing 2048-character structural ceiling, without whitespace/control characters or fragments. WHATWG parsing canonicalizes numeric/hexadecimal IPv4 aliases before literal-address validation. The same canonical URL supplies the VAPID audience and HTTPS destination. No provider hostname allowlist, proxy, redirect, caller-selected agent, or alternate protocol is introduced.

Public literals are checked before any request. Hostnames resolve through the request agent's own lookup hook; every returned address must be public before the exact checked numeric records are passed to the socket. There is no preliminary DNS check followed by a second uncontrolled lookup. Empty, malformed, mixed public/private or failed answers are refused. The original hostname remains available to native TLS certificate verification. Each dispatch owns a non-keepalive agent, destroyed on every outcome; this deliberately trades connection reuse for a small, isolated security boundary.

IPv4 exclusions cover private/shared, loopback, link-local/metadata, documentation, benchmarking, multicast, reserved and deprecated relay ranges. IPv4-mapped IPv6 uses those same exclusions. Native IPv6 permits global-unicast space while excluding special non-global/documentation/uncertain transition ranges; specific globally reachable IANA exceptions are retained. Well-known NAT64 `64:ff9b::/96` is accepted only when its embedded IPv4 destination also passes the public-address check. Scoped, local-use NAT64, unspecified, unique-local, link-local and multicast addresses are refused. This is an application boundary, not a claim that public-looking addresses cannot be rerouted by deployment networking; infrastructure egress controls remain defense in depth.

Classification follows the [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry), [IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry), and [global-unicast registry](https://www.iana.org/assignments/ipv6-unicast-address-assignments), inspected on 22 October 2026. Registry changes require review, not runtime downloads or caller overrides.

## Resource and privacy boundary

The ten-second timer covers DNS, connection, TLS, upload and response headers. Completion or timeout aborts the request, closes the response and destroys its agent. Aborted lookup callbacks cannot later open a connection. Operating-system DNS work may finish independently, but late results are ignored. Response headers have a 16 KiB parser limit. The sender reads only the status, immediately closes the response, and never collects its body, headers, capability URL or diagnostic error into delivery results. It never follows a redirect.

Existing 2xx success handling, TTL, urgency, key version, minimized payload, adapter identifier and injected sender contract are preserved. Existing 404/410 invalidation and other HTTP failure classifications are unchanged. Destination/DNS/network refusal becomes the existing temporary `provider_unavailable` result; it does not invalidate a subscription or change saved preferences by itself. The selected adapter's deadline fits within the worker's twelve-second provider wait. This does not establish a whole-batch hosting deadline or exactly-once external delivery.

The maintained library exposes [request generation separately from sending](https://github.com/web-push-libs/web-push#generaterequestdetails). [RFC 8030 section 5](https://www.rfc-editor.org/rfc/rfc8030.html#section-5) distinguishes provider acceptance from delivery to a user agent; the existing `sent` result is not a handset receipt.

## Verification and exclusions

Focused tests cover public/special IPv4 and IPv6, mapped/NAT64 forms, numeric URL aliases, mixed DNS answers, both native lookup callback shapes, requested families, abort/late callbacks, maintained encryption/signing and metadata, status-only acknowledgement of a never-ending response, no redirect, deadline/cleanup and private-error containment. A real native HTTPS request with synthetic DNS returning loopback is refused before an actual loopback TCP listener receives any connection. No external push service is contacted.

No database migration, grant, dependency, subscription policy, UI, browser permission, provider activation, operational abuse value or production setting changes. Real browser/device/provider acceptance and infrastructure configuration remain separate release work.
