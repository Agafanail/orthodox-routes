# Backend Campaign — Maps & Quality Matching

- **Status:** active
- **Mode:** Backend Campaign
- **Campaign unit of completion:** the entire approved Maps & Quality Matching phase
- **Starting commit:** `8da5f3830f8ea8fcc02daadeb9ddbdb06cc97b7e` (`Complete Core backend campaign`)
- **Starting CI:** GitHub Actions run `32575440456` on `main`, fully green
- **Working branch:** `claude/maps-quality-matching-503581`, integrated into `main`
- **Starting working tree:** clean

## Goal and authority

Implement church-centered maps and deterministic, explainable quality matching as one continuous checkpointed backend campaign. The product question the campaign answers is narrow: *if this driver is already going to this church, is picking up this passenger reasonably on the way?*

Authority order: Product Scope V1 for product purpose and first-version boundaries; IA V2 for target behavior, journeys, permissions, visibility, and states; Design System V2 for approved visual behavior inside those rules; Backend and Integration Architecture V1 for architecture and trust boundaries; Target Data Model V1 for logical data responsibilities; current code, tests, and `README.md` for implementation facts.

The explicit approved product decisions recorded in the campaign task override older conflicting documentation. Affected canonical documents are reconciled rather than left contradictory.

## Approved boundary

Included:

- documentation reconciliation with the approved Maps/matching product decisions;
- a fresh route/geocoding provider terms and storage-boundary review, recorded with its date;
- a PostGIS-backed protected location foundation: church exact location, saved user places, exact private coordinates, passenger places up to three, driver departure place, stable offset public approximation, indexes, public/private projections, authorization, retention-compatible schema;
- a safe compatible migration away from the interim exact/public text-label representation;
- reusable address/place-first location selection with map confirmation, marker correction, manual placement fallback, explicit "use my location", and saved-place reuse;
- the church catalog map, the church address to dedicated map/location view, and a secondary transport-board map for one service/date group;
- a deterministic quality-matching engine with cheap candidate filters, seats/group, child and child-seat, church/service/date/time, block and active rules, route-detour evaluation of up to three passenger places, best compatible place, added km and approximate added minutes, stale invalidation, and graceful provider-failure degradation;
- transport-board integration of "Подходит" and "Подходящие мне" with explainable detour information;
- privacy/security verification, migrations, tests, documentation, and CI.

Explicitly excluded:

- public driver route corridors and any public driver route geometry;
- persisted provider route polylines;
- a separate "direction" quality-match rule, directional-angle heuristics, route optimization, multi-passenger pickup optimization, driver waypoints, alternative routes, pgRouting, a self-hosted street graph, geospatial microservices, or a second database;
- ML/AI matching, compatibility percentages, opaque scores, ratings, and reviews;
- full My Trips, durable notification delivery, Web Push, PWA;
- full church creation/administration, schedule management, localization rollout, translation;
- production Terms/Privacy drafting, complaints/support/analytics, chat, payments, subscriptions;
- live vehicle location, live ETA tracking, navigation SDK, turn-by-turn navigation;
- the full production Design System V2 migration;
- production access, production migrations, production data, and provider secrets in the repository or agent conversation.

## Checkpoints and continuation state

| Checkpoint | Scope | Status | Evidence |
| --- | --- | --- | --- |
| A | Campaign authority and documentation reconciliation | Not started | |
| B | Provider/legal feasibility and provider-independent geo design | Not started | |
| C | PostGIS and protected location foundation | Not started | |
| D | Location selection and map foundation | Not started | |
| E | Deterministic quality-matching engine | Not started | |
| F | Transport-board integration and matching UX | Not started | |
| G | Full campaign verification, privacy audit, human UX gate, release | Not started | |

**Current continuation:** Checkpoint A — verify the baseline, create this campaign file, audit authority documents and the current Core implementation, and reconcile the approved Maps/matching product decisions across canonical documentation.

For every completed checkpoint, replace its status with `Complete` and record the commit SHA plus the final green CI run. Update **Current continuation** to the next unfinished scope. Do not record synthetic research, pending CI as green, or external verification that did not occur.

## Dependencies and external gates

- A route/geocoding provider is required for real detour calculation. All provider-independent schema, contracts, adapters, local fakes, matching logic, tests, and documentation are completed before any provider gate is raised.
- Provider account, billing, API key, key restrictions, and environment configuration remain owner-controlled. Secrets are never requested in conversation or committed.
- Production access remains excluded. Verification uses local synthetic data only.

## Approved product decisions applied by this campaign

1. **Map surfaces.** Catalog: list plus map, universal search, "near me" only after an explicit action. Church page: no large inline map; the exact public address stays visible and opens a dedicated map/location view. Transport board: the board stays primary and the map is a secondary spatial view for one service/date group. Publication: address/place-first picker with map confirmation.
2. **Church geography.** Public and exact: coordinates, normalized/display address, locality, country, timezone. The full church creation/administration lifecycle stays out of scope.
3. **User places.** The user selects only the real place; the privacy-safe public representation is derived automatically. Passenger: one required place plus up to two more, three maximum. Driver: one exact departure place. Saved places persist until the user deletes them.
4. **Place picker.** Search, choose, confirm on the map, correct the marker, or place it manually when address data is poor. Device geolocation only after an explicit action; no background tracking.
5. **Public approximation.** About 1 km, stable, deliberately off-centre, never centred on the exact point. Anonymous visitors and authenticated non-participants see exactly the same approximation. **No public driver route corridor exists.**
6. **Exact data visibility.** Private before mutual confirmation. After confirmation the driver receives the one selected exact passenger meeting place and approved contacts; the passenger receives the driver's exact departure place and approved contacts. Unused passenger places stay private.
7. **Matching meaning.** Deterministic and explainable, user-facing concept "Подходит". Recommendation only; never auto-confirms and never restricts the ordinary board.
8. **Hard conditions.** Same church; both records active; same service occurrence or compatible custom date/time; no applicable mutual block; enough available seats for the entire remaining group; child and child-seat compatibility; at least one passenger place inside the driver's detour limit.
9. **Detour.** Compare driver→church against driver→passenger place→church. Extra kilometres block; extra minutes are informational. Approved limits 0, 2, 5, 10, 15, 20 km. The provider route is a calculation tool, never a commitment.
10. **Multiple passenger places.** Evaluate up to three, expose every compatible alternative, identify the best by smallest added road distance with added time as a tie-break.
11. **Time compatibility.** Same occurrence passes automatically. Custom time uses the approved one-hour rule: driver arrival not later than the passenger's desired time and at most one hour earlier.
12. **Presentation.** Board stays primary with a simple "Подходит" marker; "Подходящие мне" is a user-accessible view sorted by smallest detour; explanations are concrete, never a score.
13. **Recomputation.** Derived results are invalidated when their inputs change. A confirmed agreement is never silently cancelled by later matching input changes.
14. **Provider failure.** Degrades gracefully; an uncomputed candidate is never labelled as not matching; only the explicit "Подходящие мне" experience shows a short ordinary-language message.
15. **Route data storage.** No permanent provider route geometry. Any derived cache holds only privacy-safe facts: source identifiers and versions, selected place reference, verdict, added distance, added time, calculation timestamp.

## Stopping conditions

The campaign may stop only for:

1. a genuine unresolved product decision after all authority and independent work are exhausted;
2. the minimum owner-controlled external action genuinely required next;
3. the human manual UX test that remains necessary after automated and browser verification;
4. successful completion of the entire campaign.

Checkpoint completion, commits, pushes, green CI, ordinary technical uncertainty, and task-related failures are not stopping conditions.

## Final completion criteria

Completion requires repository evidence that documentation matches the approved product decisions; Core transport, agreement, capacity, cancellation, restoration, and disclosure behavior remains intact; exact church and user geography is migration-backed and protected; the public approximation cannot expose an exact point through its centre; saved places work under a compliant storage model; maps work on the approved surfaces; route-aware deterministic quality matching enforces every approved hard condition; up to three passenger places are supported with explainable results; matching failure never breaks the ordinary board; confirmation and disclosure boundaries are correct; no public driver route corridor and no unnecessary route geometry exist; automated, database, browser, and privacy verification is clean; the owner's manual UX test has passed; Git history is coherent; `main` is pushed; every required GitHub Actions job and cleanup step is green; this file records final evidence; and no later roadmap phase was silently implemented.
