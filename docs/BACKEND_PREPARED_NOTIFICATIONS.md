# Prepared notification text

## Boundary

`src/lib/notifications/prepared-copy.ts` is the version-controlled catalog for the existing ordinary notification delivery worker. Each stable key has a positive revision and a complete English, Russian, Italian, Romanian, Ukrainian, and German text. Lookup returns the resolved key, language, revision, and text. It does not call a translation provider or change stored notification rows.

The renderer selects body text using the existing `localization_key` and account language. Unknown keys use the original generic update; unsupported languages use English. Own-property checks exclude prototype names. Subject and action labels retain their previous wording.

Prepared event text reports what happened and directs the recipient to the application for current details. A delayed email must not promise that an agreement, response, listing, or administrator membership is still active. Cancelling a service must not imply that its linked rides were automatically cancelled. A match is only a possible option, never a confirmed ride.

## Privacy and compatibility

- No text interpolates names, addresses, contacts, coordinates, free notes, arbitrary safe parameters, or delivery credentials.
- HTML text and links remain escaped. Provider adapters and destination handling are unchanged.
- Push retains exactly `eventType`, `notificationId`, and `route`; no translated text or additional personal fields are added.
- No migration, stored-data rewrite, dependency, provider call, or production configuration is required.
- These fixed sentences intentionally contain no numeric placeholders or plural forms. Future counted text needs explicit six-language plural coverage rather than string concatenation.

## Verification and remaining work

Focused tests enumerate every catalog entry/language, constrain text length and control/markup characters, check all literal notification keys in migrations plus generated response/change keys, exercise deterministic/prototype-safe fallback, render all languages, verify escaping, and prove injected private values never enter email or push. The existing worker and provider tests cover integration with delivery.

This is prepared development copy, not a claim of owner or native-speaker acceptance. Authentication, recovery, administrator invitations, legally required templates, standard service types, localized UI/push presentation, real provider/device delivery, and human language acceptance remain distinct work. No human test is needed to prove this server-side contract; final public-language acceptance remains a release check.
