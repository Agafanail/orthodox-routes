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
| A | Campaign authority and documentation reconciliation | Complete | Commit `2698399`; CI `32601966939` green on all three jobs |
| B | Provider/legal feasibility and provider-independent geo design | Complete | Google Maps Platform terms fetched and reviewed 23 August 2026, recorded clause by clause in Backend Architecture V1 §11; the approved model is not contractually supportable on Google. The provider adapter contract, its storage rule, and a deterministic local fake are implemented, so Checkpoints C to F stay provider-independent |
| C | PostGIS and protected location foundation | Complete | Commit `21ceb1a`; migration `20260823120000_geographic_foundation.sql`; CI `32604195964` after the shared-database fix, confirmed by `32605335711` |
| D | Location selection and map foundation | Complete | Commits `324d4b8`, `ada3b12`, `0039742`; CI `32614345866` green on all three jobs. Place field, picker flow with address search, tap-to-place correction, manual fallback, explicit location action, saved-place reuse, church catalog with universal search and `Рядом со мной`, catalog map, and the dedicated church location screen. Map imagery and address search run through the Geoapify adapter and activate as soon as the owner injects the keys |
| E | Deterministic quality-matching engine | Complete | Migration `20260823170000_quality_matching.sql`; CI `32605335711` green; `test:matching` proves every hard condition, the detour rule, the best place among alternatives, block suppression, live recomputation, provider-failure degradation, and agreement independence |
| F | Transport-board integration and matching UX | Complete | `Подходит` marker, `Подходящие мне` view, explainable detour line, and the ordinary-language unavailable message; Core responses, confirmation, capacity, cancellation, restoration, and disclosure preserved |
| G | Full campaign verification, privacy audit, human UX gate, release | Awaiting the manual UX test | CI green on `1c94ddb` across all four jobs five consecutive times — `33016589727`, `33016856712`, `33017129980`, `33017555476`, `33017810667` — including the browser regression that had been failing roughly every other run. `047e7a0` then merged the owner's copy review group 2B from `main` and is green on all four jobs as run `33018778122`, with the pull request mergeable. The group 2B amendment moved the map onto the «Где вас забрать?» screen itself; the campaign's separate rule that no public-area field exists is kept beside it, because it states a different fact. The provider credential now answers on every endpoint, address search is verified across four countries on the deployment, matching is verified against live routing, and the privacy boundary is re-verified on the deployed anonymous page. Only the owner's own walkthrough remains |

**Current continuation:** the manual UX test, then the merge.

Everything the agent can verify is verified. What remains is what no automated check can stand in for: a person looking at the maps and the wording on their own screen. The reason that is a genuine gate rather than a formality is recorded under *What the agent could not see* below.

### Verification completed so far

- Clean nine-plus-two migration replay from empty, and a representative pre-Maps upgrade with a confirmed agreement created on the last pre-Maps migration.
- `npm test` (368 tests), `npm run lint`, `npm run build`, and `git diff --check` clean.
- The full database suite in CI order against one shared database: account, phone, drafts, transport, agreements, geography, matching.
- Browser verification against the local deterministic fake provider: anonymous visitor, authenticated non-participant, passenger author, driver author, and a confirmed pair; catalog search, proximity ordering, and viewport; the church location screen; the place picker with its explicit location action; the suggestion marker and the suggestions view; provider-unavailable degradation; and mobile layout without horizontal overflow.
- Public payload inspection: no exact address, exact coordinate, or route geometry in any anonymous response; every published circle centre measured between 300 and 700 metres from its exact point.
- Grant audit: `route_worker_*` reachable only by the service role; every exact-data function limited to `authenticated` with an actor check inside; no application role holding table or view access to church, place, block, measurement, or approximation-secret relations; forced row level security on every new table.
- Campaign diff review over `8da5f38..HEAD`: no secret-shaped string, no `pgRouting`, corridor, polyline, stored route geometry, compatibility score, or match percentage in the new code, and no vendor name in any user-facing text apart from the licence attribution the map surfaces are required to show.
- Matching re-audit against the approved rules after the provider decision: the verdict stays a deterministic boolean with no score, rating, or percentage; church, active state, service or one-hour time compatibility, whole-group seats, children, child seat, and mutual block are all still enforced live in SQL; the detour compares the baseline route against the route through the passenger point, and added kilometres remain the only blocking geographic condition; there is no direction rule and no public corridor; every fitting passenger place is exposed with the smallest-detour one marked. One defect was found and fixed: suggestions were ordered by added distance and then by arrival time, so an earlier-arriving driver could outrank one whose detour cost the passenger less. Added estimated time is now the tie-break, with arrival time only settling a remaining tie.
- Environment note: Docker would not start on the development machine during this cycle, so the database suites were not re-run locally. No migration changed between `13ee236` and `3caa56c`; the later ordering fix in `3022e4b` did change SQL and was verified by CI run `32740756923`, which performs the clean replay, the representative upgrade, and the full matching suite.

### Final provider decision — 23 August 2026

The owner selected **Geoapify as the only embedded map and geospatial provider** for V1: embedded maps, address search and autocomplete, geocoding, route and detour calculation, and the map interaction used to select a place. PostgreSQL with PostGIS remains the application-owned durable store and spatial computation layer.

Google Maps and Yandex Maps are **not** embedded providers; their map, search, and routing APIs must not be integrated. They may be opened externally when a person explicitly chooses another maps application, as outbound links only.

The decision confirms the standing rules: public approximate areas remain required, provider route geometry is never stored, saved places live until their owner deletes them with no thirty-day expiry, the board stays the default experience, and matching stays an explainable aid rather than a gate.

### Owner gate — the provider account and its keys

Google Maps Platform cannot support the approved model, as recorded above and in Backend Architecture V1 §11. **Geoapify** is the selected direction: one account covering address search, autocomplete, driving routes, and map imagery; data from OpenStreetMap, OpenAddresses, and GeoNames, whose open licences permit permanent storage and cross-user reuse subject to attribution; a free tier of 3000 requests per day; EU registration. The obligation it creates is visible attribution to the data sources and, on the free tier, a link to Geoapify, which the application already renders beneath every map surface.

The adapter, the interactive maps, the attribution, the key separation, and the tests are all implemented. What remains is only what the owner alone can do:

1. create a Geoapify account and one project;
2. create **two separate keys** in it, because one value must never serve both purposes:
   - a server key restricted by allowed IP address to the hosting platform's outbound addresses;
   - a render key restricted by allowed HTTP referrers and origins to the application's own domains;
3. set `ORTHODOX_ROUTES_MAP_PROVIDER` to `geoapify`, `ORTHODOX_ROUTES_MAP_SERVER_KEY` to the server key, and `NEXT_PUBLIC_ORTHODOX_ROUTES_MAP_RENDER_KEY` to the render key, through the hosting secret manager;
4. confirm that it is done.

Neither key is ever requested in conversation, committed, logged, or placed in a fixture or a screenshot. Until they exist, maps and suggestions stay unavailable and the ordinary board keeps working, which is the approved degradation and is covered by tests.

After the keys are configured, the remaining verification runs in this same campaign: real interactive maps, real address search including the documented Italy, USA, Belarus, and Russia check through `npm run test:geoapify-search`, routing and matching against live measurements, attribution, and provider-failure behavior. The manual mobile and desktop UX test follows.

### Staging verification result — 23 August 2026

Both geographic migrations are applied to the isolated staging project, the campaign branch is deployed, and both staging suites pass.

`npm run test:staging-maps` now also asserts that the provider accepts the server credential and returns a usable result. That assertion was missing at first, which is why the check passed while address search was completely dead; rendering and search use different credentials and different network paths, and both must be proved. It confirmed against the deployment: both migrations applied remotely; the public catalog exposes exact church coordinates and orders by proximity only when a location is supplied; public listings expose only approximate areas and carry no route geometry; `list_quality_matches`, `route_worker_pending_legs`, `route_worker_record_leg`, and `list_saved_places` all refuse an anonymous caller; the catalog and church location screens mount the interactive map and render the OpenStreetMap and Geoapify attribution; and neither the server credential nor any exact geography reached anonymous HTML. Its synthetic church was removed afterwards.

`npm run test:staging-core` passed on the new schema, which also proves the changed publication signatures did not break Core on the deployed environment: ownership, public privacy, agreements, capacity, cancellation, restoration, and disclosure all held, and its synthetic data was removed.

### Deployed provider check — 23 August 2026

Walked the deployed application as a signed-in synthetic passenger against the walkthrough fixture.

**Rendering works.** The catalog map loads real Geoapify resources — `style.json`, `data.json`, and sprites from `maps.geoapify.com` — and displays the OpenStreetMap, OpenMapTiles, and Geoapify credits. The render credential and its origin restriction are correct.

**Address search and route measurement do not.** Searching `Via Roma 1, Torino` in the place picker returns the ordinary fallback line, and `app.route_measurement` holds no rows after loading a board that has a matching passenger request and driver offer, so no `Подходит` marker appears. The server action itself responds normally, which means the failure is inside the provider call rather than in the application.

**Narrowed further, 23 August 2026.** The probe now checks each capability separately and the deployment answers `autocomplete: 401`, `geocode: 401`, `routing: 401`. All three refuse the same credential, including the plain geocoding endpoint the owner successfully exercised in the Geoapify console. That eliminates an endpoint or plan limitation, and it eliminates the application's request construction, since three differently built requests fail identically. What remains is the credential itself: the value configured on the host is not one the provider accepts from that server, either because it is not the tested value or because it carries an origin restriction a server-side call can never satisfy.

**The cause is now known precisely.** Readiness reports `search: true`, so the credential is configured and the request does leave the server. The provider probe returns **HTTP 401**: Geoapify refuses the credential. The owner separately confirmed the key value works in the Geoapify console, and the render credential works from a browser, so the remaining explanation is a restriction that a server-side call cannot satisfy — most plausibly one key used for both purposes with an origin restriction, which a browser request satisfies and a server request never can.

Two earlier pieces of advice were wrong and are corrected here. Suggesting the same key for both variables created this failure mode. Suggesting an IP restriction for the server key was also unsafe: a hosting platform offers stable outbound addresses only on some plans, and an incomplete list produces the same silent refusal. The server credential should be a separate key with no origin, referrer, or CORS restriction; the render credential keeps its origin restriction, where it belongs and works.

The application behaves correctly throughout: it never shows a vendor name, a status code, or a technical cause, it never claims a ride does not match when it could not check, and the board, listings, and agreements keep working. That is the approved degradation, observed live.

### Provider working end to end — 26 August 2026

The owner replaced the server credential and the refusal ended. The readiness probe answers `autocomplete: 200`, `geocode: 200`, `routing: 200`, `ok: true`, and `npm run test:staging-maps` passes all seven assertions including the one that proves the provider accepts the server credential and returns a usable result.

**Search was asking the wrong endpoint.** With the credential fixed, the four-country check showed a real defect: `Via Roma 1, Torino` came back as `Via Romagnano, 1`, a differently named street in the same city. The picker was calling `/v1/geocode/autocomplete`, which is tuned for partial input and, given a finished address, will confidently return a near-miss rather than nothing. A whole typed address belongs to `/v1/geocode/search`. Corrected in `7019503`; the probe's usable-result count rose from 1 to 4 on the same query, which is how the deploy was confirmed to have landed.

**Four-country address check on the deployment.** Run through the real place picker as a signed-in synthetic passenger, biased towards a Turin church.

| Country | Query | Result |
| --- | --- | --- |
| Italy, city | `Via Roma 1, Torino` | Street correct. The three offered candidates are metro-Turin comuni; central Torino `10121` is not ranked first, because proximity bias to the church outranks it |
| Italy, small town | `Via Vittorio Veneto 3, Rivoli` | Exact, including the fuller street name |
| USA, city | `1600 Pennsylvania Avenue NW` | Exact |
| USA, small town | `112 Main Street, Woodstock, Vermont` | No exact match. Nearby Vermont addresses are offered alongside same-named streets in other states |
| Belarus, city | `проспект Независимости 4, Минск` | Exact |
| Belarus, rural | `Советская 12, Мир` | Exact |
| Russia, city | `улица Арбат 20, Москва` | Exact |
| Russia, small town | `улица Ленина 5, Суздаль` | Exact |

Six of eight are exact. The two weaker cases both degrade into a list the person chooses from rather than a wrong answer imposed on them, and the picker's map lets them correct the point directly, which is the fallback the design already required.

**Matching verified against live routing.** With the walkthrough fixture published, the board shows `Подходит · По пути · без заезда` with `Лучше всего подходит` and `Также подходит`, and the deliberately distant Rivoli place is correctly excluded. `app.route_measurement` held four legs from provider `geoapify` between 7889 and 32474 metres. No geometry was stored.

**Privacy re-verified on the deployment.** The anonymous church page contains no exact address, no email, and no coordinate of any kind — not even an approximate circle centre; only the derived area names `Torino`, `Rivoli`, and `Moncalieri`, and no `Подходит` marker. The only phone-shaped string is the `+390000000000` placeholder in an input.

**Probe stability.** Three probes fired back to back returned green, green, and one Render error page. The credential and the endpoints are sound; the free tier simply refuses rapid repeats. A single retry is the correct response, not a diagnosis.

### Defects found and fixed while preparing the walkthrough

- **The browser regression could never pass again.** Main's new Playwright check typed an exact place and a public area into two text inputs. This campaign deleted those inputs on purpose — a publisher now confirms a real place and the database derives the circle — so the test sat at a label that no longer exists until it timed out. Two commits had no CI at all while the pull request was conflicting, which is why it surfaced late. Fixed in `78717de`: the fixture saves one place per publisher and the test publishes through the real place field, taking its saved-place path because CI configures no provider. The privacy markers survive the move intact, because the exact address and the locality are exactly the two halves the assertions already depended on.
- **The staging teardown had never once run to completion.** It deleted agreements and then the church, but requests, offers, responses, and condition snapshots restrict rather than cascade, so the church delete was always rejected and every run left its accounts behind; ten had accumulated. Fixed in `6e2a243`, which names each dependent record in order and leaves out route measurements and personal blocks because those genuinely do cascade.
- **The browser regression stalled, and three separate things were wrong.** It burned its whole two-minute budget, roughly every other run, on commits that changed nothing but a Markdown file. Tracing named the first cause exactly: the sign-in helper waited for the address to equal `http://127.0.0.1:3000/` as literal text, while the sign-in link carries its one-use token in a URL fragment that can survive the redirect. The second was the retry added to paper over the first: the fixture is built once per run and its links are one-use, so the retry always signed in with links the first attempt had already spent and could only ever fail, appending a misleading second failure to a real one. The third was that Playwright leaves navigation and action timeouts unbounded, so a single slow navigation consumed the budget and the report then blamed whichever unrelated call was in flight when the clock ran out — which is why an early failure appeared to be about reading cookies. The helper now waits for the path, the retry is gone, and both timeouts are bounded. Five consecutive runs on `1c94ddb` are green where the rate had been roughly one in two; that is strong evidence rather than proof, and any stall that remains will now name itself instead of hanging.
- **A privacy assertion was comparing coordinates as text.** `test:geography` reported that an exact coordinate had leaked into a public payload. It had not. A public centre is published to five decimals and the exact point is written to four, so `45.06112` contains `45.0611` as a substring. The offset runs a fixed distance along a per-owner bearing, and a bearing running nearly due east leaves the latitude almost unchanged while the point still moves the required hundreds of metres. The comparison is numeric now; the distance assertions that actually prove the privacy property were already correct and are untouched.
- **A spent sign-in link forced the data to be rebuilt.** `npm run staging:maps-fixture:links` now mints fresh one-use links against the identities already present and writes nothing, so a walkthrough can be paused and resumed without disturbing what is being tested.

### Arrival compared as stated — 28 August 2026

The owner withdrew the effective-arrival rule below one day after approving it, and the reasoning is worth keeping. A stated arrival is a target the driver commits to. A driver who needs longer to collect someone leaves earlier; adding the pickup to their stated time treated that target as though it were a departure, which it is not.

The approved rule is now a direct comparison of two stated times: the driver suits the passenger when the arrival they stated falls from sixty minutes before to thirty minutes after the desired arrival, inclusive. A passenger wanting 12:30 is suited by a driver stating 11:40 and not by one stating 13:30. The same service occurrence remains compatible by definition.

The widened late edge survives from the withdrawn change, and it is the part that mattered: the original rule refused any driver arriving even a minute after the desired time.

Road measurement keeps its other two jobs untouched — it decides whether a pickup fits the driver's approved kilometres, and it supplies the approximate minutes shown to people. Those minutes explain and decide nothing.

**The SQL got simpler, not more complex.** Time is settled once again entirely by the cheap filter, before any provider call, so no candidate is ever measured for a slot it could not fill. The per-place time verdict, the effective-arrival column, and the detour-duration allowance that existed only to keep the prefilter honest are all gone. Migration `20260828090000_stated_arrival_matching.sql`; the window bounds keep their named functions.

**Tests.** Five boundary cases on the stated time, each on the second: exactly an hour early matches and a second more does not; exactly half an hour late matches and a second more does not; a minute late matches. A sixth case guards the inverse — a pickup costing many minutes still matches while its kilometres fit and the stated arrival is inside the window — so the minutes cannot quietly become a condition again. The shared service occurrence keeps its suggestion after its clock is moved three hours.

**Documentation** was returned to this rule in the same three places it had been changed, and the source comment with it.

**CI** `33217590482` green on `d0029ec` across all four jobs, including the clean migration replay from empty over both new migrations. One defect surfaced on the way: a view records a dependency on every function its definition calls, so the detour allowance could not be dropped before the view that referenced it.

**Staging carries two pending migrations**, `20260827090000` and `20260828090000`. Applying both in order is correct and intended — the second withdraws what the first introduced, and the history stays honest about that. The step remains the owner's, since the environment's safety classifier refuses a schema change to a live database from here. The application needs no deploy: the rule lives entirely in SQL.

### Superseded — arrival measured after the pickup — 27 August 2026

An approved product-rule change, found by the owner during manual testing. Previously a driver had to reach the church no later than the passenger's desired time, and the added minutes of the pickup detour were shown to people but decided nothing. Both halves were wrong in practice: a driver a minute late is still useful, and a driver whose own schedule looks ideal can become useless once the detour to collect this passenger is counted.

Time compatibility is now judged on the arrival the passenger actually experiences:

    effective arrival = the driver's planned church arrival + the added minutes for this meeting point

and a meeting point is compatible when that falls no more than an hour before, and no more than half an hour after, the desired arrival. For a passenger wanting 10:55 the range is 09:55 to 11:25. Two people who chose the same service occurrence remain compatible by definition, untouched.

**Per meeting point, not per pair.** Each place carries its own detour, so each is judged separately. A place is offered only if it satisfies both the driver's approved kilometres and this window; one place can fail on time while another passes, and only the passing ones appear. Ranking is unchanged: smallest added distance, then smallest added time.

**Both stages kept.** The cheap SQL filter still runs before any provider call, but it can no longer decide time on its own, so it was narrowed to what it can still prove. A detour only ever delays a driver, so an occurrence already past the late edge can never return to the window and is still rejected for free. On the early side the detour is exactly what can rescue a driver, so the edge is pushed out by the longest detour that driver's own kilometre limit could take — deliberately generous, at five minutes per kilometre, since it only widens what gets measured and never decides anything. The final verdict is taken on the measured effective arrival.

Migration `20260827090000_effective_arrival_matching.sql`. The window bounds live in named functions rather than inline literals, so the approved numbers are readable and testable in one place.

**Documentation reconciled:** IA V2 §21 rule list, Product Scope §12.1 and §12.2 including the worked example, and the UX copy rule that called the minutes purely informational. One source comment that repeated the old claim was corrected too. No unrelated section was touched.

**Tests.** Eight boundary cases in `test:matching`, each placed on the second rather than near it: the stand-in provider is deterministic, so one probe reveals exactly what the pickup costs and every arrival is then constructed backwards from it. Exactly an hour early matches and a minute more does not; exactly half an hour late matches and a minute more does not; a driver one minute late matches, which the previous rule refused. A driver whose own planned arrival sits inside the window but whose detour pushes it past the late edge does not match, and the same far place matched by an earlier driver proves kilometres were never the obstacle. Where one place fails the window and another passes, only the passing one is offered. A shared service occurrence keeps its suggestion after its clock is moved three hours, proving the window is never consulted there.

Two defects in the tests themselves surfaced and were fixed: one person may not hold two active requests for the same church in the same minute, and publishing requires both sides of a shared service to name the service's own time, so that pair is now created legitimately and shifted afterwards.

**CI** `33166161094` green on `e676f51` across all four jobs.

**The staging database is one migration behind, and that step is the owner's.** The agent's attempt to apply it was refused by the environment's safety classifier, which is the right outcome for a schema change to a live environment. Until `npx supabase db push --linked --yes` runs on this branch, staging still answers with the previous rule, so the manual check must follow it rather than precede it. The application itself needs no deploy for this change: the whole rule lives in SQL.

**Walkthrough data.** The staging fixture now publishes three further drivers around one passenger, positioned either side of the window, and prints which of them should carry the mark.

### The blank map — 27 August 2026

The owner's manual test failed: on the catalog and on the church location screen the map container, its controls, and its attribution all appeared, and the map itself was entirely empty. No basemap, no roads, no labels, no markers.

**Cause.** MapLibre parses vector tiles in a module worker. The bundler emits that worker as a lone static asset under `_next/static/media`, but the worker's own `import './maplibre-gl-shared.mjs'` stays a relative address and no sibling by that name is emitted. The browser fetched `/_next/static/media/maplibre-gl-shared.mjs`, received a 404 page, refused it because it was not JavaScript, and the worker never started. Nothing surfaced as an error the application could catch, which is why it passed every automated check. It also explains the missing markers: those are added in MapLibre's `load` handler, and `load` never fires while no source can load.

Everything on the provider side was healthy the entire time, which is what made this misleading. With the render credential and the staging origin, the style answered 200, its tile index answered 200, a real vector tile answered 200 with 244 KB of protobuf, and the sprites and glyphs answered 200. The credential was never the problem and no restriction was blocking anything.

**Fix.** `scripts/copy-maplibre-worker.mjs` publishes the worker and every module it imports relatively into one directory under `public/maplibre`, and the map calls `setWorkerUrl` at that pair before constructing itself. The files are copied from the installed package at build time rather than committed, so they can never drift from the bundled version, and the script reads the worker's own imports rather than hard-coding a list, so an upgrade that splits it differently fails loudly in the build instead of silently in a browser.

**Why verification missed it.** The staging check asserted that the surfaces *mounted* an interactive map, which they always did. It now additionally requires both worker files to be served, as JavaScript, from the deployment. A regression test asserts the worker URL is set before the map is built.

**Confirmed after the fix, visually, against the deployment.** The browser surface normally available to the agent runs hidden and never composites a frame, which is why it could say nothing either way. Driving headless Chromium through Playwright instead — a browser that does composite — produced the missing evidence on all three surfaces:

| Surface | Tiles | Console errors | Markers | Result |
| --- | --- | --- | --- | --- |
| Catalog | 6 × 200 | none | 1 | Streets, labels, church pin, attribution |
| Church location | 6 × 200 | none | 1 | Streets, POIs, church pin at Via Giuseppe Verdi |
| Board map | 7 × 200 | none | 1 | Church pin plus all four approximate areas, three dashed meeting circles and one solid departure circle |

The board map also carried the matching line `Подходит · По пути · без заезда`. Before the fix the same surfaces requested no tiles at all and created no marker.

The lesson is recorded rather than the result alone: the agent's own browser could not answer this question, and the correct response to that was to reach for one that could, not to reason about what was probably happening behind the glass.

### What the agent could not see

The maps could not be visually confirmed. The browser surface available to the agent runs with the tab hidden: `document.visibilityState` is `hidden` and zero animation frames elapse in 1.2 seconds. MapLibre draws through WebGL on the animation-frame loop, so without frames the style never finishes loading and nothing paints — `isStyleLoaded()` stays false and no marker element is ever created.

Everything underneath the drawing was verified instead: the Geoapify style, its TileJSON, and its sprites all return 200 to the deployed page; the map container receives the church marker and the four approximate areas as props; the zoom controls, the attribution line, and the privacy sentence all render; and the picker's own map mounts with a working search beside it.

**This reasoning was wrong, and the owner's manual test proved it.** Every map was completely empty — frame, zoom controls, and credit line drawn over nothing. Treating an unobservable surface as probably working, on the strength of the data behind it, is not verification; the correct reading of "I cannot see this" was "I do not know", and the section below records what was actually broken.

### Earlier staging state — superseded

The owner created the Geoapify account, generated the two restricted keys, injected them into Render, and switched the staging service to deploy this campaign branch.

One step remains before staging can be verified: the isolated `orthodox-routes-staging` database is still on the nine Core migrations and has not received `20260823120000_geographic_foundation.sql` or `20260823170000_quality_matching.sql`. This was confirmed against the live project, not assumed: `supabase migration list --linked` reports both with an empty `remote` column, and `supabase db push --dry-run` reports exactly those two migrations, with no seeds and no roles.

The code and the schema must move together. The geographic migration drops and recreates the five publication functions with new signatures, so an application deployed against the old schema cannot publish, and vice versa.

Applying it is an owner-controlled action here: the agent's attempt to write to the remote database was refused by the environment's safety classifier, which is the correct outcome for a schema change to a live environment. The command is `npx supabase db push --linked --yes`, run on this branch.

`npm run test:staging-maps` is ready for the moment the schema catches up. It is guarded to the exact staging project, writes nothing, prints no key, and currently fails on its first assertion with `expected '20260823120000', actual ''`, which is the intended detection of the missing migration.

### Manual UX test — open

Synthetic walkthrough data is live on staging and stays until the owner says otherwise. Sign-in links are one-use; `npm run staging:maps-fixture:links` mints a fresh pair without touching the data. `npm run staging:maps-fixture:remove` clears everything afterwards.

The checklist is limited to human-visible behaviour and is deliberately short. Ten steps, in order:

1. **Catalog** — `/churches` shows the church, and the map below it draws.
2. **Рядом со мной** — the button asks for permission and reorders by distance; refusing it leaves the list working.
3. **Church address** — tapping it opens the location screen with a drawn map, the address, and nothing about a route.
4. **External maps** — `Маршрут в Google Картах` and `Маршрут в Яндекс Картах` leave the application, and the line saying navigation happens outside it is present.
5. **Choose a place** — `Попросить подвезти` → `Указать место`, search a real address, and confirm one from the list.
6. **Correct a place** — tap the map to move the point, and check that the marker follows.
7. **Privacy sentence** — the line promising that only an approximate area of about one kilometre is visible appears before publishing, not after.
8. **Publish** — the request appears with an area name, never a street address.
9. **Подходит** — sign in as the driver, publish a trip, and check the marker with its added distance and time, plus `Подходящие мне`.
10. **An outsider** — open the church page signed out and confirm that no exact address, phone, or route is visible anywhere.

Steps 1, 2, 3, 5, 6, and 9 are the ones the agent could not confirm visually; see *What the agent could not see*.

For every completed checkpoint, replace its status with `Complete` and record the commit SHA plus the final green CI run. Update **Current continuation** to the next unfinished scope. Do not record synthetic research, pending CI as green, or external verification that did not occur.

## Dependencies and external gates

- A route/geocoding provider is required for real detour calculation. All provider-independent schema, contracts, adapters, local fakes, matching logic, tests, and documentation are completed before any provider gate is raised.
- Provider account, billing, API key, key restrictions, and environment configuration remain owner-controlled. Secrets are never requested in conversation or committed.
- Production access remains excluded. Verification uses local synthetic data only.

### Provider terms review, 23 August 2026

The current Google Maps Platform Service Specific Terms were fetched and read on 23 August 2026. The detailed clause-by-clause record lives in `docs/ORTHODOX_ROUTES_BACKEND_INTEGRATION_ARCHITECTURE_V1.md` §11. Summary:

- coordinates from Geocoding, Places, Directions, and Routes may be cached for at most 30 consecutive calendar days;
- the single indefinite-storage permission, Geocoding clause 6.3.2, requires the cached data to stay "logically isolated to the specific End User it is associated with" and states it "must not be used across multiple End Users";
- Places-derived coordinates have no indefinite permission at all;
- Google Maps Content must not be used with a non-Google map.

The approved product model stores a user's saved precise place until that user deletes it and uses one person's stored coordinate together with another person's for cross-user matching and public approximation. That is precisely what clause 6.3.2 excludes. User confirmation of a marker does not convert provider Map Content into application-owned data, and the approved decisions forbid assuming that it does.

**Therefore Google Maps Platform cannot support the approved model, and a provider decision with cost and account consequences belongs to the owner.** This is Gate 2 (owner-controlled external action) combined with an architecture consequence. It is raised only after Checkpoints C to F, all of which are provider-independent: the domain calls an application-owned adapter contract, a deterministic local fake implements it for tests, and no vendor payload ever reaches the database.

Whichever provider is selected must permit in writing: permanent storage of a user-selected coordinate until the user deletes it; use of that coordinate in server-side computation involving other users' records; and publication of an application-derived approximate area computed from it. Routing is unaffected because no routing output is persisted.

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

### Final audit — 26 August 2026

Supersedes the 23 August audit below, which is kept for its record of how the provider failure was diagnosed. Every criterion is checked against repository or deployment evidence rather than recollection. One remains open, and it is the one the agent must not close.

| Criterion | State | Evidence |
| --- | --- | --- |
| Documentation matches the approved product decisions | Closed | Unchanged since 23 August; IA §16.5 no longer promises an exact route and the review thread that raised it is resolved |
| Core transport, agreement, capacity, cancellation, restoration, and disclosure behaviour intact | Closed | `test:transport`, `test:agreements`, and the browser regression all green in CI `33017810667`; `test:staging-core` passed on the deployed schema |
| Exact church and user geography migration-backed and protected | Closed | `20260823120000`; forced row level security and no application-role grants on every new relation |
| Public approximation cannot expose an exact point through its centre | Closed | Constraint `user_place_public_contains_exact`; the deployed anonymous page carries no coordinate at all |
| Saved places under a compliant storage model | Closed | Open-licensed provider data; `ops.anonymize_expired_places` excludes `saved` rows |
| Maps work on the approved surfaces | Closed | They did not, and the owner's manual test caught it: every map drew its frame and nothing else, because the tile worker's sibling module was missing and the worker never started. Fixed in `9cbc998`. Confirmed since by driving a browser that composites frames: the catalog, the church location screen, and the board map each fetch tiles that answer 200, create the church marker, and draw the four approximate areas with their dashed and solid outlines |
| Address search works across the required countries | Closed | Four-country check on the deployment: six of eight exact, two degrading into a choosable list rather than a wrong answer |
| Deterministic matching enforces every approved hard condition | Closed | `test:matching` in CI, plus live confirmation against real Geoapify routing with the distant place correctly excluded |
| Up to three passenger places with explainable results | Closed | `passenger_request_place_position between 1 and 3`; the smallest-detour place is marked and the alternatives stay visible |
| Matching failure never breaks the ordinary board | Closed | An unmeasured candidate is never a negative claim; observed live during the credential outage |
| Confirmation and disclosure boundaries correct | Closed | Driver receives only the selected meeting place, passenger receives the driver departure place, unused places stay private |
| No public corridor and no unnecessary route geometry | Closed | No such entity in the schema; the adapter never reads route geometry; `app.route_measurement` holds two integers per leg |
| Automated, database, and privacy verification clean | Closed | CI `33017810667` green on `1c94ddb`: `verify`, `database-foundation`, `local-auth`, and `core-browser-e2e` |
| Browser verification | Closed | Deployment walked as anonymous visitor and as signed-in passenger; payload boundaries, search, matching, and mobile layout all verified. Visual rendering is now verified too, through headless Chromium, after the agent's own hidden browser surface proved unable to answer the question and a blank map reached the owner because of it |
| Owner manual UX test passed | **Open** | The checklist is above; the walkthrough data and links are live |
| `main` pushed, every required job green | **Open by design** | The branch is pushed and fully green; the merge waits on the owner's approval, as instructed |
| This file records final evidence | Closed | This table, the checkpoint table, and the dated sections above |
| No later roadmap phase silently implemented | Closed | No My Trips, Web Push, PWA, church administration, or schedule management in the diff |

Both open rows are the same decision in two places: the owner walks the ten steps, and then the merge happens. Nothing else is outstanding.

### Superseded audit — 23 August 2026

Each criterion checked against repository evidence rather than recollection. Three remain open and none of them can be closed by the agent.

| Criterion | State | Evidence |
| --- | --- | --- |
| Documentation matches the approved product decisions | Closed | Corridor and direction concepts removed across Product Scope, IA V2, Design System V2, backend architecture, target data model, UX copy, UX rules, roadmap, and the project map. IA §16.5 no longer promises access to an exact route; the PR review thread that raised it is resolved |
| Core transport, agreement, capacity, cancellation, restoration, and disclosure behavior intact | Closed | `test:transport` and `test:agreements` pass in CI; the disclosure and cancellation functions are unchanged apart from the added driver departure place |
| Exact church and user geography migration-backed and protected | Closed | `20260823120000`; forced row level security and no application-role grants on every new relation |
| Public approximation cannot expose an exact point through its centre | Closed | Database constraint `user_place_public_contains_exact` requires the point inside the circle and at least 100 m from its centre; the offset is deterministic per owner and place |
| Saved places under a compliant storage model | Closed | Open-licensed provider data; `ops.anonymize_expired_places` excludes `saved` rows; publication copies a saved place so deleting it never rewrites a live listing |
| Maps work on the approved surfaces | Partially closed | Map rendering is confirmed on the deployment: the catalog map loads real Geoapify tiles, sprites, and style data, and shows the attribution. Address search and route measurement do not work there yet, because the server credential is not answering |
| Deterministic matching enforces every approved hard condition | Closed | `test:matching` in CI; re-audited after the provider decision, one ordering defect found and fixed |
| Up to three passenger places with explainable results | Closed | `passenger_request_place_position between 1 and 3`; every fitting place is exposed with the smallest-detour one marked |
| Matching failure never breaks the ordinary board | Closed | An unmeasured candidate is never a negative claim; the failure line appears only in the suggestions view |
| Confirmation and disclosure boundaries correct | Closed | Driver receives only the selected meeting place, passenger receives the driver departure place, unused places stay private |
| No public corridor and no unnecessary route geometry | Closed | No such entity in the schema; the adapter never reads route geometry; anonymous payload scans are clean |
| Automated, database, and privacy verification clean | Closed | CI `32756648075` green on `fc2a804`, all three jobs |
| Browser verification | Partially closed | Local surfaces and fallbacks verified; on the deployment, rendering, the public boundaries, and Core all verified. Address search and matching cannot be exercised until the provider accepts the server credential |
| Owner manual UX test passed | **Open** | Requires the deployed staging environment |
| `main` pushed, every required job green | **Open** | The branch is pushed and green; merging waits on the owner's approval by design |
| This file records final evidence | Closed | This table, plus the checkpoint table and the staging state section |
| No later roadmap phase silently implemented | Closed | No My Trips, Web Push, PWA, church administration, or schedule management in the diff |

The three open items share one cause: the staging database is two migrations behind, so the deployed branch cannot be exercised. That push is an owner action, as recorded above.

That sentence was true on 23 August and is not true now. The migrations were applied, the credential was replaced, and the deployed branch has been exercised end to end. The current position is the audit dated 26 August above; this section is kept only for its record of how the provider failure was diagnosed.

### Original criteria

Completion requires repository evidence that documentation matches the approved product decisions; Core transport, agreement, capacity, cancellation, restoration, and disclosure behavior remains intact; exact church and user geography is migration-backed and protected; the public approximation cannot expose an exact point through its centre; saved places work under a compliant storage model; maps work on the approved surfaces; route-aware deterministic quality matching enforces every approved hard condition; up to three passenger places are supported with explainable results; matching failure never breaks the ordinary board; confirmation and disclosure boundaries are correct; no public driver route corridor and no unnecessary route geometry exist; automated, database, browser, and privacy verification is clean; the owner's manual UX test has passed; Git history is coherent; `main` is pushed; every required GitHub Actions job and cleanup step is green; this file records final evidence; and no later roadmap phase was silently implemented.
