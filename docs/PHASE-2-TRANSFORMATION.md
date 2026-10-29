# Phase 2 — Land Development Operating System transformation

Status: **active planning / incremental migration** (October 29, 2026). Working product descriptor: **Land Development Operating System**. **The commercial name and logo are not approved.** This plan is for `Blegette13/gods-eye-view` on `bdp-development`; do not fork, replace Cesium, or rename the existing BDP implementation namespaces during this migration.

## Baseline and architecture audit

Reviewed against the `bdp-development` source tree before Phase 2 changes. The team's last confirmed local checkpoint is **Step 51: 8 tests passed**. That result is not evidence that the entire repository's test suite or production deployment currently passes.

| Concern | Existing owner / implementation | Phase 2 direction |
|---|---|---|
| Entry and lifecycle | `src/main.js`, `src/standalone/application.js`, `src/app/application.js` | Keep staged scene / controls / data / tools construction, abort/teardown contracts. |
| Globe, map modes, credits | `src/app/viewer.js`, `src/standalone/scene.js`, `src/mapStackController.js` | **Retain Cesium and map stack.** Do not hide map/source attribution. |
| Legacy console shell | `index.html`, `style.css`, `src/ui.js`, `src/standalone/controls.js` | Incrementally build a property/development workspace around the map; stop exposing unrelated console controls. Avoid a wholesale `ui.js` rewrite. |
| Existing search | `#location-search` in LOCATION tray, `src/ui.js` native geocode, `src/bdp/ui/landSearch.js`, `src/standalone/data.js` | Present one persistent, accessible search input; **reuse the same native input** and BDP command events rather than run parallel search systems. |
| County records | `src/bdp/cad/*Adapter.js`, `src/bdp/parcels/*` | Existing Bexar, Travis, Williamson, Hays, Dallas and Harris pilots only. Coverage, currency and capability vary; no implied all-county completeness. |
| Evidence and GIS | `src/bdp/overlays/*`, `src/bdp/intelligence/*`, `server/providers/bdp-*.js`, `src/bdp/ingestion/sql/*` | Preserve spatial SQL, source contracts, bounded/cancellable queries, single parcel-intelligence request, provenance, confidence and unknown statuses. |
| Property UI | `src/bdp/ui/propertyCard.js`, `src/bdp/ui/godsEyeUi.js` | Progressive disclosure: Overview, Parcel, Risks, Zoning/Entitlements, Utilities/Access, Feasibility, Documents, Project. Reorganize *views*, not evidence. |
| Layer catalog and persistence | `src/standalone/data.js`, `src/data/manager.js`, `src/data/layerState.js`, `src/bdp/config/layerRegistry.js` | Introduce a deliberate land-focused surface and startup policy; do not silently reinterpret old layer-state/share tokens. |
| Secure evidence foundation | `server/providers/bdp-evidence-*.js`, `src/bdp/regulatory/*`, `src/bdp/ingestion/sql/regulatoryEvidence*.sql` | Keep Step 51 session contract un-routed; authentication integration remains paused. Never substitute browser claims for authenticated operator identity or weaken PostGIS RLS. |
| Local backend, build, checks | `server/providers/*`, `vite.config.js`, `server/standalone/vite.config.js`, `.github/workflows/*`, `scripts/*` | Change provider routing only after dependency and regression review. Keep local PostGIS and validation workflow operational. |

### Important discovery about current search

The native `#location-search` input already handles place/address/geocoding and accepts land search commands through the *capture-phase* handler in `src/bdp/ui/godsEyeUi.js`. The latter parses explicit `[county] parcel: ID`, `[county] account: ID`, and `[county] owner: NAME` syntax, then routes via `src/standalone/data.js`. However, `index.html` places the input inside a collapsed LOCATION popover, and `style.css` gives it zero width except in `.expanded` state. **There is no independently visible unified search**. A persistent search should expose that original input instead of cloning it, preserving native geocoding and the county routing/cancellation contract.

### Legacy feature dependency audit (initial, not a deletion authorization)

| Legacy family | Direct registration / entry | Likely coupling / reason to audit | Proposed disposition |
|---|---|---|---|
| Live aircraft, military flights/awareness, installations | `src/standalone/data.js`, `src/data/flights.js`, `militaryFlights.js`, `militaryAwareness.js`, `militaryInstallations.js` | Layer-state codec, tracking/follow-camera, contextual panels, voice commands, HUD, provider routes | **Hide from land workspace first; disable feeds only after restore and teardown tests.** |
| CCTV | `src/data/cctv.js`, `src/ui.js`, `server/providers/*` | Sync chips, observation panels, routing and key setup | Quarantine from land workspace; do not remove shared overlays or camera primitives. |
| Space/rocket/satellites | `src/data/rocketLaunches.js`, `satellites.js` | Global context, shared state and telemetry | Quarantine; audit before unregistering. |
| Vessel/AIS, radio, voice | `src/data/aisLiveVessels.js`, `radio.js`, `src/voice/*`, `src/standalone/tools.js` | Network sessions, tool lifecycle, input and key configuration | Quarantine; disable network work only with verification that no land feature requires it. |
| Traffic, local data and camera tooling | `src/data/traffic.js`, `localLayers.js`, `src/locations.js`, `src/mapStackController.js` | Traffic map context, navigation, possible spatial reference data | **Review individually:** roads/traffic and general map navigation can serve land-development workflows. Do not blindly remove. |
| Land layers | `src/bdp/parcels/*`, `src/bdp/overlays/*`, `src/bdp/config/layerRegistry.js` | Parcel intelligence and overlays | **Keep.** Group by task, apply visibility and coverage labels. |

**Removal gates:** inventory (a) import sites, (b) initial registration and auto-start, (c) share-link and local-state tokens, (d) UI references and shortcuts, (e) server routes, (f) disposal and network cleanup, (g) tests and docs. Test restored states containing legacy tokens before stopping any module. An invisible layer is not necessarily a disabled feed. Do not mutate the upstream registry or delete files just to declutter the UI.

## Target product model

A map-first workspace with a persistent search at the top, a slim task navigation rail, controlled map-layer groups and a right-hand parcel/workflow pane. Default map state should be quiet and parcel-oriented; users explicitly enable overlays. Search uses addresses/coordinates via existing geocoding, and county-specific parcel/account/owner adapters. **Unqualified parcel commands currently default to Bexar;** this is transitional and must become an explicit county selector for nationwide expansion. Owner result sets require bounded, paginated results and reliable identity details, not automatic confidence or a synthetic "best parcel".

All property views consume **one normalized selection and unified intelligence response**. Display statuses `VERIFIED` (only with specific evidence), `PRELIMINARY`, `STALE`, `INCOMPLETE`, `UNAVAILABLE`, and `UNKNOWN` as appropriate; never silently convert missing results into zero risks, utility capacity, legal clearance, buildable acreage, market comps or entitlement. Store source URLs, snapshots, dates and applicable jurisdictions. AI provides cited explanations and next-evidence requests, not invented legal/financial outcomes.

### Proposed information architecture

- **Discover:** persistent search, filters, saved searches (future), GIS layers.
- **Evaluate:** parcel facts, evidence quality, environmental/GIS, access/utilities, zoning, development constraints, ownership/title.
- **Model:** user-entered acquisition assumptions, feasibility scenarios, sensitivity, verified cost inputs when supported.
- **Acquire:** pipeline stages, underwriting, document requests, diligence tasks.
- **Develop:** permitting/entitlements, schedules, dependencies, budget, contractor milestones.
- **Portfolio:** comparisons, projects, exports, audit-ready reports.
- **Admin:** operator roles, provenance, permissioned documents, settings; real auth only after architecture/security review.

## Sequence and acceptance criteria

| Stage | Work | Exit gate |
|---|---|---|
| **P2.1** (now) | Audit and roadmap; introduce *non-final* neutral descriptor; surface existing native location/land input persistently. | No new repo, no rewire of geocode/parcel engine; accessible on narrow/desktop viewports; search still distinguishes geocoding from county commands. |
| **P2.2** | Approve product name, visual identity and commercial license plan; replace only presentation-facing BDP/GEV branding. | Internal `bdp` DB/API namespace and migrations unchanged until separately versioned; comply with MIT attribution and source/asset licensing. |
| **P2.3** | Land-only feature-surface policy, quiet defaults, explicit overlay categories. | Share/restoration and keyboard/cockpit dependencies covered; hidden legacy feeds cannot keep running unintentionally. Preserve relevant road/map functionality. |
| **P2.4** | Search UX: county selector, input hints, auto-suggestions, parcel result list, address-to-parcel resolution **only where verified data supports it**. | Leading-zero identifiers preserved; no invented match; cancellation, race handling, query limits and explicit unsupported county handling pass tests. |
| **P2.5** | Property intelligence navigation, status badges, grouped map overlays and consistent source citations. | No duplicate provider requests and no scoring/evidence regression; compare response and visible source ledger before/after. |
| **P2.6** | Acquisition/project workspaces and feasibility models, initially local and clearly labeled. | User assumptions never confused with CAD or verified sale prices; permissions and document lineage designed before storage. |
| **P2.7** | Resume Step 52: real identity provider + server identity/role binding and PostgreSQL RLS controls. | Independent authorization tests and operator/parcel isolation gates; no trust in client-submitted role/session. |
| **P2.8** | Expand vetted county/state adapters and production hardening. | County-by-county source, currency, licensing and validity gates; automated regression and integration checks. |

## Phase 2 incremental implementation log

### P2.1 — neutral shell and unified search (committed; local verification pending)

The existing `#location-search` DOM input is moved into a permanently displayed search bar by `src/bdp/ui/persistentSearch.js`. It is not cloned or substituted: native address/coordinate geocoding, county search commands, cancellation and the underlying property panel retain their existing owners. A temporary descriptive title replaces visible company-specific labels. No software brand/trademark is claimed.

### P2.3 — land-only operational mode, first cleanup wave (committed; local verification pending)

- `src/bdp/config/workspacePolicy.js` classifies **all 16 upstream data layer IDs** as legacy and leaves **all 17 BDP land layer IDs** available.
- `src/standalone/data.js` registers the data manager's existing visibility guard **before** `styleManager.attachDataManager` can restore saved/share state. Attempts to enable a legacy layer are refused for every origin (including restored links, scene tools, scripts and manual toggles); disabling is allowed. The original upstream registry, encoded URL tokens, registered module IDs and cleanup paths remain unchanged.
- `src/bdp/ui/workspace.css` hides aircraft/cockpit, radio/context, CCTV, scene controls, style instruments, upstream layer rows and the legacy mission launcher from the land workspace. This visibility-only CSS is paired with the actual data-manager guard; hiding a control by itself never stops a feed.
- `src/standalone/startupChrome.js` skips constructing the old first-run mission dialog and its keyboard event handlers while **preserving provider key setup and map loading**.
- `src/bdp/config/workspacePolicy.test.mjs` covers every upstream ID and all restore origins. New UI/mount tests already cover preservation of the original search input.

**Scope limit:** legacy modules are still bundled/registered, and some ancillary infrastructure (voice, scene, CCTV providers, keyboard/cockpit controls) still exists in source. This is an operational **quarantine**, not a dependency-safe deletion, commercial data-license resolution, or proof that all legacy network/process work has stopped. Further disable/removal must be done provider-by-provider after import/route/teardown and restored-state audits. Browser regression is required before calling this finished.

### Full-suite feedback and fixes (October 29, 2026)

The first local `npm.cmd test` run reported **3 failures** among 3,243 tests. The targeted Phase 2 tests passed 12/12. Two failures came from the existing startup Chrome VM fixture not supplying the newly imported workspace policy and `document` state; the fixture now supplies the real policy function and verifies that land mode suppresses only the old first-run dialog while preserving key setup. The third failure revealed an unrelated existing Node-only regulatory document hashing module inside browser-built `src/`; it has been moved without changing its hashing/security logic to `server/providers/bdp-document-integrity.js`. The local intake CLI and document-integrity tests now import the server-owned module, and the browser boundary still checks all `.js` source modules.

**These fixes are committed but await the operator's updated full-suite output.** Do not claim a green full suite or production build until actually observed. To isolate the exact previous failures, run:

```powershell
node --test src/browserModuleBoundary.test.mjs src/standalone/startupChrome.test.mjs src/bdp/regulatory/documentIntegrity.test.mjs scripts/bdp/prepare-regulatory-document.test.mjs
```

### Local acceptance sequence (Windows PowerShell in existing checkout)

```powershell
git checkout bdp-development
git pull --ff-only origin bdp-development
node --test src/bdp/config/workspacePolicy.test.mjs src/bdp/ui/landSearch.test.mjs src/bdp/ui/persistentSearch.test.mjs
npm.cmd test
npm.cmd run format:check
npm.cmd run check:boundaries
npm.cmd run build
npm.cmd run dev
```

Use the terminal's printed local URL. In the browser: confirm the map and legally required attribution, persistent search in a clean session and after reload, and a visible land-only MAP LAYERS panel. Confirm **`travis parcel: 302959`** and another supported county query behave as expected, and try ordinary address/coordinates separately. Check the property panel still shows missing/regional/unavailable source evidence as unknown; no scores or permissions should be inferred from empty results. Inspect the browser console for failed registrations and attempt an old share link containing `flights`/other legacy layer tokens: the source may remain in stored state, but the layer must not enable or fetch. Browser inspection of network requests can identify **additional** provider activity outside the data manager for the next cleanup wave. Do not expose database secrets or API keys in screenshots.

Local tests/production build and real browser behavior **have not been run from the GitHub connector**. Until the operator performs these checks, the modifications are provisional and do not certify Step 51 security isolation.

## First actual browser inspection — Phase 2 UI revision

The operator verified the first Phase 2 shell in a running local Chromium browser after a successful production build. The real screenshot confirmed that the Cesium 3D imagery, independent title, fixed property search bar, map-layer control, and original provider-settings access render together; legacy cockpit, CCTV, Context, military and satellite panels are not visible in that workspace.

**Observed usability defects:** tiny low-contrast names and source lines in the scrolling layer rail, a visible legacy `BDP ·` label prefix, and 17 datasets presented as one undifferentiated list. This is a working geospatial shell, **not yet** an acquisition/development/project management operating system.

**First usability improvement committed:** `src/bdp/ui/landLayerPresentation.js` supplies a complete presentation-only classification of the 17 registered data layers into *Parcels & Ownership*, *Environmental & Site Constraints*, *Access & Infrastructure*, and *Regulatory & Entitlements*. `godsEyeUi.js` injects accessible headings and removes only the displayed `BDP ·` prefix; the manager's registered IDs, saved tokens, click handlers and authoritative feed provenance are untouched. `workspace.css` raises contrast/type sizes in the search bar, data-layer rail and property evidence panel. New regression tests enforce one-to-one data coverage and original registry ordering.

**Operator confirmation remaining:** pull these UX commits, run `npm.cmd test` and `npm.cmd run build`, then visually check headings, nonduplicated groups, active layer toggles, scrolling, search behavior, mobile fit and accuracy of source/UNKNOWN reporting. These latest UI refinements have passed source-derived smoke checks but not yet a full local suite/browser verification.

## Phase 2 visual design: professional proptech surfaces (committed; visual acceptance pending)

Following the operator's second working local screenshot, the workspace has been moved away from the original black/cyan tactical/HUD visual styling toward a modern, customer-facing property-intelligence product:

- `src/bdp/ui/professionalTheme.css` is a **scoped presentation-only theme** imported after `workspace.css`. It applies warm-white floating search, layer and property cards, slate typography, muted blue controls, subtle shadows, rounded corners, visible keyboard focus, and distinct warning/error states.
- The land-layer grouping, manager lifecycle, data sources, original Cesium world and provider credits, PostgreSQL data contracts, and missing-data rules remain unchanged.
- First-pass human-facing labels now use *Map layers*, *Available datasets*, *Enable all*, *Clear*, *Property & location search*, and *Texas preview*, rather than command-center labels. The search hint explicitly distinguishes map navigation from parcel-record lookup to avoid promising an unsupported address-to-parcel match.
- The local development-only provider setup gets a professional dialog theme and neutral label showing unconfigured credentials. It does **not** imply that nine unrelated legacy OSINT keys are prerequisites for the land system. Existing upstream pure helper behavior remains the default; a new test covers the land-specific label.

**Quality gates not yet observed on this commit:** the local unit suite, Vite production build, and real-browser desktop/mobile screenshot. Test layering, parcel search, map attribution, toggles, scrolling and property-card evidence states after pulling. **Do not infer the product is ready for paying customers from a theme alone**: authentication and licensing, data coverage, on-call reliability, acquisition/development workflows and actual parcel search behavior still need verified release gates.

## First parcel search acceptance — confirmed and data-quality finding

The operator's October 29, 2026 browser screenshot confirms that entering `Travis parcel: 302959` in the persistent native input triggered the county-specific search: the Travis parcel layer switched ON, the camera moved into Austin, the search reported the matched owner, and the property intelligence card displayed a situs address, reported acreage, valuation fields, parcel ID, provenance and explicit **UNVERIFIED** currency.

**Important: retrieval is not source verification.** The displayed Travis County GIS/TCAD fields for the sample parcel were reported as land **$1,198,206**, improvements **$95,897**, and total **$695,000**. The displayed land component alone exceeds the reported total. This is a material source-component discrepancy, **not proof that any one county field is wrong**. The underlying GIS fields may describe different bases, exemptions or periods. Investigate the authoritative appraisal record and field definitions before using the figures for underwriting. Other parcels/counties have not been visually accepted.

The implementation now adds a **presentation-only source-valuation review** helper: if nonnegative reported land and/or improvement components materially exceed the reported value, a visibly amber `REVIEW REQUIRED` row explains the discrepancy and requests independent county verification. It does **not** rewrite source values, fabricate a corrected appraisal, infer a sale price, or mark unknown records as safe. The panel now uses the less-ambiguous labels `Reported value` and `Reported value / acre` rather than suggesting that a GIS total is necessarily the sum of land and improvements. A unit test covers the exact screenshot field pattern and assures the raw numbers remain unchanged.

**Remaining QA:** pull these changes, run the narrow valuation/property-card tests and full suite/build, then repeat the Travis lookup and confirm the amber caveat appears. Browser screenshots, maps, county records and temporary local test samples are not evidence of current legally verified ownership, boundaries, land use or valuations. Acquisition recommendations and verified development rights remain withheld.

## Parcel intelligence QA and selected-boundary visualization (committed; operator check pending)

The operator's second screenshot of Travis parcel `302959` **confirmed the new amber valuation discrepancy warning displays prominently** in the property panel while retaining the unchanged $1,198,206 land, $95,897 improvements and $695,000 reported total figures. This establishes that the new alert is visible in an actual browser, **not** that the source valuations or recorded ownership are legally verified.

A new Phase 2 map interaction now highlights the **source-mapped GIS parcel polygon and separate ground-clamped LineString boundary entities** when the user searches for or clicks a parcel, using the **exact county-prefixed ID** to avoid cross-county ID collisions. Selected boundaries use a bright but non-tactical blue outline and soft transparent fill; unselected polygons and lines retain their existing low-contrast default treatment. Closing the property card, hiding it for another county, disabling or destroying a county layer resets the selection. All five other pilot counties inherit the same behavior through the existing shared county-layer factory. The viewer's native `flyTo` now uses a conservative per-parcel `HeadingPitchRange` computed only from the real source GeoJSON exterior coordinates; owner multi-match searches still fly to the full result set, and invalid/missing geometry never creates a guessed focal point.

**Evidence limitation:** a visually highlighted **county GIS polygon is not a survey or legal parcel boundary**. No geometry, parcel source URL, ownership evidence, IDs, or PostGIS logic has changed. A viewport refresh that no longer contains the selected ID may remove its visual outline; the data should not be re-created or fabricated to keep an apparent parcel visible.

New regression tests cover exact-ID selection, resets, multipart geometry, conservative camera range and property-card close cleanup. Initial source-derived smoke checks passed. **The full local npm suite, production build, and real-browser selected-outline appearance on current Cesium imagery remain to be verified** before accepting this map interaction.

## Selected parcel visual acceptance and evidence-panel organization

On October 29, 2026, the operator's live screenshot confirmed **Step 19: Travis parcel 302959 selected successfully in the 3D globe**: camera zoomed from the original distant Austin view to local neighborhood scale, the exact county GIS shape has a blue visible outline and transparent blue fill, the parcel intelligence panel still opens, and the amber valuation disagreement warning remains visible. This confirms the first real browser rendering of the selected-parcel feature, not a legal survey, verified title, or valuation clearance. The black circular imagery boundary / vignette and degree of map viewport coverage remain separate visual-review items.

The parcel card was previously one continuous scrolling list of more than 20 detail groups. The latest **presentation-only evidence-navigation revision** adds five native accessible disclosure sections: **Screening summary & red flags** (expanded initially), **Acquisition, ownership & title**, **Planning, zoning & development**, **Environmental & site constraints**, and **Transportation, utilities & water**. The parcel owner, raw CAD fields, provenance, data currency and amber valuation warnings stay **outside** disclosures and cannot be hidden by collapsing a detail group. A permanent introductory caution says absent/unverified data are not clearance. Async evidence containers, source URLs, existing section headings, and economic scenario controls are reparented into the disclosures, not removed or duplicated. Reopening the same parcel rerenders a fresh set of groups.

**Acceptance required:** pull these commits, run `node --test src/bdp/ui/propertyCard.test.mjs`, then `npm.cmd test` and `npm.cmd run build`. In the browser repeat the Travis lookup, scroll the property panel, expand each group, verify source caveats and ability to enter scenario assumptions, verify both keyboard and mouse disclosure actions, close/reopen the panel and confirm the selected GIS outline resets. Do not represent screenshots and a green build as a commercial release gate.

## October 29 runtime regression — Travis layer enable blocked by dense viewport

The operator successfully ran the complete local test suite and Vite build after the evidence-accordion revision. However, a **subsequent real-browser lookup** of `Travis parcel: 302959` failed with **`Travis parcel service returned malformed or truncated GeoJSON`** on the layer row and **`Travis parcel layer must be enabled before parcel lookup`** in the search status. The browser remained over Austin from the previous camera/share-link state; **it did not load the selected parcel** on this run.

**Root cause visible in code:** `DataManager.setEnabled(..., true)` always invokes the layer's `update()` before declaring it enabled. A county-layer `update()` performs a **viewport-wide GIS query** and rejects a malformed, truncated or over-limit response. When this fails, the manager cancels layer activation. The search handler then attempted the requested **bounded exact parcel lookup** on a disabled layer, generating the secondary misleading error. At the zoomed-in Austin viewpoint the viewport request was attempted during activation; this failure was not observed with the earlier distant-view search. The exact provider response's cause (transient error, exceeded transfer limit, or another source issue) is **not independently established**.

**Conservative fix committed:** the shared county layer exposes a token-scoped `beginFocusedLookup()` reservation. The land-search handler starts it before the manager's ordinary `setEnabled` lifecycle, and releases it in `finally` even after cancellation, search errors or success. While a reserved exact parcel/owner lookup is pending, the layer's ordinary viewport `update()` returns without issuing an unrelated countywide fetch. The **actual** bounded `focusParcel`/`focusOwner` request still contacts the original county GIS provider and must validate the returned GeoJSON. If that direct query itself fails, the user gets a real source error, **never fabricated parcel data**. Manual layer toggles and later viewport requests continue to fetch and report truncation/errors normally; when a previous explicit parcel snapshot exists, a later viewport error marks the layer degraded rather than clearing verified source provenance. A fake-Cesium lifecycle regression test reproduces the failed viewport and successful direct parcel lookup, plus ownership-token isolation and manual-toggle source failures.

**Verification still required:** `node --test src/bdp/parcels/focusedLookup.test.mjs src/bdp/parcels/parcelLayerSyntax.test.mjs src/bdp/ui/propertyCard.test.mjs`; `npm.cmd test`; `npm.cmd run build`; and a fresh browser attempt of `Travis parcel: 302959`. If the exact lookup still fails, inspect the browser Network/Console response for `...TCAD/MapServer/0/query` and distinguish an ArcGIS `error` object, `exceededTransferLimit`, a bad GeoJSON payload, HTTP error or CORS. Do not claim the source is fixed until a live response is observed, and do not interpret provider availability as legal/valuation verification.

## Phase 2 full-viewport map — tactical keyhole removed from land workspace

The operator reviewed the working grouped property evidence interface and requested removal of the persistent black circular border around the satellite map. Investigation found that this is **not an intrinsic limitation of Cesium/Google 3D Tiles**: it is the upstream app's explicitly implemented `#scope-mask` 2D canvas (`src/scopeMask.js`), which paints near-opaque black outside a fixed circular viewport. The land-development product does not need this surveillance presentation.

**Implementation:** keep the upstream scope-mask renderer and its defaults intact for potential standalone/upstream views, but add an upstream-neutral `setScopeMaskAvailable(allowed)` guard. `applyBdpGodsEyeUi()` disables scope availability **synchronously before application startup**, preventing canvas painting, DPR backing-store work, and old share-link/scene restoration from reactivating the scope. `workspace.css` hides `#scope-mask` and the decorative celestial ring in the land workspace as a secondary first-paint safeguard. Cesium canvas, photorealistic tiles, native map control and required credits remain untouched. `src/scopeMask.test.mjs` now checks that unavailable scopes cannot paint/re-enable from older share links, and that explicit re-availability preserves original upstream functionality.

Source-derived syntax, startup-order, scoped-style, and fake canvas paint checks passed. **Acceptance pending:** update the local checkout, run `node --test src/scopeMask.test.mjs`, `npm.cmd test`, `npm.cmd run build`, then refresh the full browser map and inspect wide-screen and parcel zoom behavior. If a black region remains after this change, investigate Cesium/3D tiles availability/scene backdrop separately rather than disabling source attribution or masking source errors. The change is strictly visual and must not modify parcel GIS, saved evidence, search results or authorization.

## Step 24 — generic search guidance and Travis viewport transfer limits

Operator feedback: the fixed search hint should not hard-code an actual property identifier; the Travis layer also showed OFF / UNAVAILABLE after the full-map mask was removed, even though direct parcel lookup had previously succeeded. The hint now uses `Travis parcel: [parcel ID]` and `Travis owner: [name]` to show syntax **without pointing to any real property**. Native address/coordinate search and county command parsing remain unchanged.

**County-source issue:** The Travis ArcGIS TCAD layer advertises a maximum record count of **1,000** and supports queries/pagination. The existing app requested up to 501 features per visible camera area, and its strict GeoJSON reader treated a returned `exceededTransferLimit: true` or over-cap feature count as an error, causing the manager's enable-time refresh to turn the entire county layer OFF. After removing the circular mask, the visible viewport is broader; any one viewport can be too dense for a complete single-response snapshot. An error object or unexpected body can produce the same generic message; we have **not** established whether the operator's last specific provider response was an exceeded-transfer flag or a malformed GeoJSON body.

**Conservative update:** Only **well-formed FeatureCollections with an explicit transfer-limit flag or more features than the hard request limit** are now classified as `viewportCoverage.overLimit` for Travis viewport requests. In this case the adapter returns **no parcel subset** and the layer remains enabled but **DEGRADED / INCOMPLETE COVERAGE** with instructions to zoom closer or perform a specific parcel search. A truncated set of 500 neighborhood parcels must never masquerade as complete GIS coverage. Exact parcel and owner searches **continue to reject** truncated data, and malformed responses, HTTP failures, duplicates, invalid geometry, or GIS source errors remain fail-closed; no selected property or financial screening is invented. Other counties and all identifiers remain unchanged. A specific successful parcel lookup continues to replace the selected geometry with real county data.

Added adapter and shared-layer regression tests for over-limit state, strict source failure, and the search hint. **Verification pending:** local `node --test src/bdp/cad/travisAdapter.test.mjs src/bdp/parcels/focusedLookup.test.mjs src/bdp/ui/persistentSearch.test.mjs`, `npm.cmd test`, `npm.cmd run build`, manual layer activation, and direct Travis parcel lookup. In a high-density viewport, `ON + INCOMPLETE COVERAGE` with no falsely complete polygons is expected; zoom further for a smaller complete viewport. If it still says UNAVAILABLE, inspect the browser Network response for the county `/query` request: it may be a genuine provider/network/GeoJSON error requiring separate diagnosis; do not label the source healthy without a live response. A future source-pagination or viewport-tiling design can improve bulk parcel coverage once its completeness and request-budget guarantees are specified.

## Step 24 visual acceptance: Travis parcel viewport loads again

The operator's October 29, 2026 screenshot confirms the land-development browser displays a full-width unmasksed satellite map, generic search examples with **no specific parcel ID**, a green **Travis Parcels ON** state showing **201 parcels** sourced just now in the current map view, county GIS boundaries, and a property-intelligence card on a user-clicked parcel. This validates a successful runtime viewport query on that occasion. **201 is the displayed map-view count, not Travis County's total parcel inventory or proof of exhaustive county coverage.** The GIS-derived owner, appraisal and mapped lot data remain **UNVERIFIED** without separate survey/title/appraisal validation. Layer availability may still vary with provider responses and zoom.

The clicked parcel displayed **Acres: 0**, with no reported-value-per-acre calculation. In the Travis adapter, acreage takes `tcad_acres` first when it is non-null; a literal zero therefore remains zero even if other GIS acreage fields exist. We are not authorized to infer a corrected acreage from imagery or another unsurveyed field. A presentation-only `reviewReportedAcreage()` warning now highlights **nonpositive source acreage** in amber and requires current county/survey confirmation; the original reported acreage and reported value remain unchanged. Null or missing acreage stays missing rather than being converted to zero, and per-acre calculations are not invented.

**Operator verification pending for this latest warning:** run `node --test src/bdp/valuation/acreageReview.test.mjs src/bdp/ui/propertyCard.test.mjs`, the full `npm.cmd test`, and `npm.cmd run build`; refresh the land workspace, click a parcel with a source-reported zero and verify the amber Acreage review warning appears above the collapsible evidence sections. This is a UI data-quality flag only, not a new source of area evidence.

## Non-negotiable regression checklist

1. Cesium viewer, map stack and attribution render without legacy tracking layers.
2. Existing address/place/coordinate location lookup and all six scoped county command routes still work; repeat searches abort older requests, reset parcel UI and never cross parcel selections.
3. Existing unified intelligence response, sourceCoverage and category withholding remain unchanged.
4. Environmental, utility and entitlement incompleteness remains `UNKNOWN`/unscored; invalid/capped geometries fail closed.
5. PostgreSQL spatial union/clip calculations and evidence RLS/session isolation test unaffected.
6. Legacy shared state/share links are either intentionally migrated or safely ignored; never auto-enable hidden surveillance through restored state.
7. `npm run test`, `npm run build`, `npm run format:check`, `npm run check:boundaries` and targeted search/parcel tests; then local Windows browser verification.
8. Confirm licensing for bundled assets and fetched providers before offering a commercial product. `LICENSE` explicitly notes some datasets are noncommercial or have additional conditions.

## Decisions required from product owner

**Name/brand:** choose a commercially searchable identity after trademark, domain and app-store collision screening; meanwhile use descriptive "Land Development Operating System" text. **Workspace:** approve primary navigation and default overlay preset. **Geographic search:** confirm whether county should be auto-inferred from geocoded address or explicitly selected when parcel identity is ambiguous (recommended: explicit confirmation).
