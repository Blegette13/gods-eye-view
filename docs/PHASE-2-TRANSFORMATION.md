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
