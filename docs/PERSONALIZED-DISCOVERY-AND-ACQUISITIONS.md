# Phase 2: Personalized Land Discovery and Acquisition Workspace

Status: **interactive client-side prototype implemented on `bdp-development`; not an authenticated, persistent CRM.**

## Customer journey

1. **Pre-map discovery.** Before `application.start()` constructs Cesium or initializes live feeds, the user receives a full-screen, accessible intake with optional land purpose, maximum purchase budget, five-digit ZIP, minimum acres and maximum acres. There is a prominent **Explore without criteria** action. All input is validated; no assumption is substituted for missing preferences.
2. **Map Explorer.** Upon continuing, the original Cesium/Google/Earth geospatial workspace and existing land-source/data manager initialize unchanged. A new navigation switch offers Map Explorer, Acquisition Board, and Edit Criteria.
3. **Property evaluation.** A parcel card continues to show source owner, evidence, UNVERIFIED source currency, and acreage/valuation warnings. An explicitly labeled **Save property to acquisition board** button adds the minimal county-qualified snapshot to a **session-only** in-memory shortlist.
4. **Separate Acquisition Board.** A full-width, independent business UI overlays the interactive globe with six usable pipeline columns: Identified, Screening, Due Diligence, Negotiation, Under Contract and Acquired. Each card identifies its source county/parcel and provisional values and can be moved between stages, removed or re-opened through the original map search.
5. **Criteria evidence.** ZIP or nonzero reported acreage may show *Source indicates match* / *Source indicates outside*, clearly indicating their source quality, not verified legality. Price and legally allowed purpose remain **UNKNOWN**, since GIS appraisal values are not listing/transaction prices and GIS zoning overlays do not establish entitlement. Missing data never excludes a candidate as though it failed a verification.

## State and security boundary

The introductory preferences and shortlist exist **only in this tab's memory** and disappear when the page reloads or closes. The interface prominently discloses this; no localStorage, cookies, credential handling, database writes or fake account persistence are added. No client-filtered recommendation may be called verified or buildable. The existing source provenance and screening remain authoritative only within their own documented limitations.

The onboarding gate **blocks actual application startup** until submitted or skipped and the HTML initially conceals all upstream UI; this prevents a tactical map or other tools flashing in before the questionnaire.

We keep the original repo, `bdp-development` branch, PR #1, module names / `bdp:land-search` events, Cesium globe, registered county GIS layers, PostGIS/data-access protocols, and upstream attribution.

## Release architecture / not yet implemented

A commercial release needs a **real user/account/organization model**, server-owned project membership, role-based authenticated operations, audit trails and PostgreSQL row-level security bound to validated sessions on a pinned connection, as already required in Step 51. Proposed entities (subject to architecture review): `buyer_search_profiles`, `acquisition_projects`, `acquisition_candidates`, `candidate_stage_history`, `candidate_notes`, `candidate_evidence_snapshots` (source URL, timestamp, verification level, basis). All operations must enforce tenant authorization on the server, not merely UI filters. Do not silently migrate session mock data as authenticated records.

Production discovery then needs **bounded, county-by-county parcel candidate search with proven coverage, completeness and pagination**, provenance-aware filtering, verified asking/listing prices from appropriately licensed sources, address/ZIP and acreage spatial checks with confidence/unknown states, and explainable preference rankings. The GIS platform cannot assert asking prices or allowed uses without corroborating source records. Show *Unknown* rather than overfiltering. Do not conflate an investor's declared target budget with an offer recommendation.

## Manual acceptance

1. Pull branch, run targeted onboarding/board model tests, full `npm.cmd test`, and `npm.cmd run build`.
2. Hard refresh. The questionnaire must appear **before the Cesium map**. Try invalid ZIP and reversed acreage range; they should stay in the form with clear errors. Try skip.
3. Complete a sample profile; the map and native search must load. The navigation bar must not hide search, provider credit or panel controls.
4. Find a supported county parcel through its real GIS provider; inspect source/UNKNOWN fields and save it. The **Acquisition Board** must take over the viewport.
5. Move the saved card from Identified to Screening or Due Diligence; verify it appears under the new stage. Save it twice; verify no duplicate and no overwritten stage.
6. Open saved parcel back on map. Confirm the county-specific source lookup, blue outline and expandable evidence still work, including closing the card.
7. Reload. Criteria and shortlist should clear intentionally in this preview, without implying records are safely saved.
8. Inspect keyboard navigation, screen reader dialog title, small displays and all map/data attribution.

**No claim of a complete commercial discovery algorithm, user account persistence, secure saved portfolios or backend filters can be made until their own implementation and release gates are complete.**


## Next iteration — county/radius-guided discovery and fit ratings (October 29, 2026)

The intake now requires one of the **six implemented Texas pilot counties** for a guided search (Bexar, Travis, Williamson, Hays, Dallas, Harris). The radius menu allows **county only**, 5, 10, 25, or 50 miles. A separate **Browse map without a search profile** option remains; it is not a guided search and shows no selected county. Changing preferences pre-fills the previous selections and refreshes the geographic overlay.

### Authoritative county and radius map

The map uses a **live U.S. Census Bureau TIGERweb State_County/MapServer/1 County 2026-vintage GeoJSON service** rather than a guessed Texas county bounding rectangle. The selected county is identified by known five-digit Census GEOID, a blue county outline displays when the source responds, and neighboring county outlines appear in slate for nonzero radius where geographic data can be fetched. The search radius is a **geodesic circle centered at the Census county internal point (INTPT)**, drawn in orange; it is not a radius from every point on the county boundary or ZIP centroid. On map load, Cesium fits the selected county. If the Census source is unavailable or incomplete, the system reports this and does not manufacture county lines or suggest county lookup was successful.

**Radius does not imply parcel adapter coverage.** A 25-mile ring can cross jurisdictions without data adapters. The six pilot county adapters retain their own viewport limits, incompleteness and source-currency caveats. The board can save source parcels without claiming an exhaustive radius search.

### Provisional source-field candidate pins

When a customer zooms into a **successfully completed bounded GIS viewport** and enables a county parcel layer, that layer emits a minimal internal viewport event containing its actual fetched normalized source parcels. The map projects up to **24 tentative green pins** only for geometries with at least one **reported ZIP or positive acreage field** matching the profile, no reported conflicting field, and a county/radius geography that fits the selected configuration. Pins are based on approximate centers of the **GIS polygon bounding boxes**, not surveyed centroids, and selecting a pin routes to the original exact parcel lookup. Over-limit, failed and disabled county layers clear their candidate hints. Missing price/use data are **UNKNOWN**; the pins are **not** listing inventory, clearance, entitlement, verified property matches or a complete countywide search. No candidate pin is shown for an unsupported property claim or budget-only/purpose-only profile.

The source-based rating on the Acquisition Board is likewise **not a suitability score**: it displays a provisional label (*Possible profile match*, *Source-reported mismatch*, or *Not rated*), the count of sourced field matches/conflicts and unknown fields, with the numeric investment/development score deliberately withheld until enough corroborated business-use, asking-price and regulatory evidence is available. The user's stated intended use is an explicit **unverified factor** and cannot be inferred from GIS alone. This is a transparent step toward scoring without falsely suggesting a property is investment-grade.

### Hazard and infrastructure markers — next integration gate

Existing map overlays (FEMA flood hazard, wetlands, EPA cleanup sites, TXDOT access, energy/utilities and zoning) remain available in the Map Layers panel. Future **source-specific contextual icons** may summarize verified/qualified GIS map evidence *only* when the relevant provider, county, time range, confidence and geometry are known. Icons cannot stand in for legal flood determinations, buildability, utility capacity or environmental clearance. Sensitive facilities will not be spotlighted as speculative location pins.

### Required local acceptance

- Pull the new code, run `node --test src/bdp/acquisition/session.test.mjs src/bdp/acquisition/preferenceRating.test.mjs src/bdp/map/discoveryGeography.test.mjs src/bdp/map/candidateHints.test.mjs src/bdp/ui/acquisitionWorkspace.test.mjs`.
- Run `npm.cmd test` and `npm.cmd run build`, then `npm.cmd run dev`.
- Refresh: county is mandatory for guided entry. Verify missing county is rejected; selecting Travis + 10 miles displays a **sourced blue county line**, **orange radius**, and **slate nearby county boundaries** where Census fetch works.
- Verify the globe flies to Travis County and all original property search, layer toggles, provenance and credits work; source outage produces clear error instead of guessed geography.
- Zoom into Travis and enable Travis Parcels. With positive acreage/ZIP filters, green **possible match** pins may appear for records in the *current complete viewport only*. Search a pin or normal parcel, save it and inspect the board rating/caveats.
- Change radius in Edit criteria; the Census overlay and pins should refresh without needing page reload, and saved board stages stay unchanged.
- Test loading/failed/truncated viewports; candidate pins must disappear rather than imply completed coverage, and county-only must not include other counties.
- Observe mobile map layout and Safari/Chrome event compatibility; test source GeoJSON fetch CORS and API availability separately. Release acceptance is pending local browser verification.

**Known current limitations:** no countrywide county inventory, no reliable commercial asking/listing price source, no verified land-use suitability scoring, no full-server search over unvisited counties, no authenticated persisted acquisition profiles or pipelines, and no county GIS search completeness guarantee. The requirements for these functions belong in the account-authentication/PostGIS service phase, not browser-only heuristics.


## Guided map UX refinement — focused search, count semantics and on-demand layers (2026-10-30)

The operator supplied a ~32-second real-browser recording showing a clean full-viewport Travis County overview with blue sourced county borders and the orange 50-mile Census-centered search circle, but **no green property pins** despite a selected residential-development purpose, $600,000 budget, and 10–60-acre preference. The original Property Search box occupied the top center and the geographic legend overlapped the main map center. The full Map Layers registry remained open on the left even though a personalized search was active.

**Cause supported by architecture:** the existing parcel adapters intentionally do **not** download a full county when the camera is at county scale. They load bounded source parcels **only once the user zooms to a small enough viewport**; before that no complete parcel coverage is available. A budget and preferred business use also cannot match candidate records without asking-price or verified entitlement sources. Therefore **no pins does not establish zero matches** and must never trigger a countywide “no properties fit” claim.

**New guided map composition:** the original property search stays centered, but becomes narrower, substantially shorter and higher on the screen; native Cesium map actions move below it. The Census legend moves into a compact **top-right** key below workspace navigation and hides when the property card needs the same area. The left primary interface is now a **Your Land Search** summary showing selected county/radius and provisional match counts, with **Enable [county] parcels** and **Map layers** actions. In guided mode the full registry starts **hidden**, and can be opened whenever the user needs flood, environmental, road and utility overlays. In unprofiled **Browse map** mode the familiar Map Layers panel is retained. Registry IDs, source ownership and normal layer guards are unchanged.

**One-click activation:** the summary fires a scoped event that uses the existing DataLayerManager `setEnabled(id, true, { origin: 'user' })` and the six explicitly supported county IDs. It does not bypass provider responses, suppress guards, invent GIS data, activate military/OSINT feeds or promise countywide search. When the map is too far away the panel explains that the operator should **zoom into a neighborhood** before source parcels can be evaluated.

**Count integrity:** only **completed bounded source viewport snapshots** can contribute to green pins or counts. An incomplete/over-limit response, failed provider, map zoom-out, disabled layer, or a focused single-property lookup invalidates the viewport match cache. The UI distinguishes `Not evaluated yet` from **`0 preliminary matches among N loaded map-view parcels`** and **`M possible matches among N loaded map-view parcels`**. It counts more than 24 matching records accurately while limiting map clutter to 24 candidate pins. A missing Census radius center similarly prevents a false-zero result, and county-only searches exclude complete snapshots from other counties. A matching acreage/ZIP is still source-report based; all missing and unverified land-use, price, access, buildability and environmental evidence stays UNKNOWN.

**Important scope:** the new counter is **not a complete county or search-radius inventory**. Fully automatic discovery across unvisited parcels will require a bounded, complete, indexed PostGIS candidate service with source freshness and permissions. We should never advertise “X properties fit your criteria” without the explicit evidence and area denominator.

**QA gate:** pull latest `bdp-development` and run
`node --test src/bdp/map/discoveryFeedback.test.mjs src/bdp/map/candidateHints.test.mjs src/bdp/ui/acquisitionWorkspace.test.mjs`, then `npm.cmd test` and `npm.cmd run build`. A source-derived stub run has already verified the UI flow (map layers initially hidden, sourced county/radius render, `Not evaluated yet` first, enable action, 29 source matches with 24 visible pins, and clearing markers/count after zoom-out); **real-browser appearance and provider behavior require operator verification**. Confirm the legend no longer overlaps the map center, the search leaves enough space for globe controls, the Map Layers toggle works, and the counter changes only after fully loaded county GIS records. Do not mistake the browser screenshot for a legally verified inventory.


## Phase 2 discovery usability: independent county-source preview and result list (2026-10-30)

The operator provided a 90.5-second browser recording: with Travis County selected, the operator could see 2 provisional matches **only after manually flying/zooming into a small neighborhood**. The guided panel displayed a count but no property list, making direct comparison and acquisition investigation frustrating. The map imagery also lacked source city/highway labels, complicating orientation.

**Completed work in `bdp-development`:**

* **Bypass the profile:** the entry questionnaire's explicit *Browse map without a search profile* button bypasses county validation; the workspace navigation additionally offers *Browse freely*, clearing the search profile without deleting the session acquisition shortlist. The native map layer registry remains available in browse mode.
* **High-vantage Travis discovery preview:** independent of the viewer camera, a direct **Travis County GIS/TCAD ArcGIS query** requests up to 80 + 1 records at a time from the REAL source with bounded `resultRecordCount`, stable `OBJECTID` ordering, numeric acre filtering where supplied, and a WGS84 bounding envelope if a radius was selected. The retrieved source polygons are normalized by the **existing Travis CAD adapter**; any invalid/unidentifiable record is excluded, never replaced with fake data. The 25- or 50-mile circle is still centered at the Census county internal point, with client-side geodetic-radius refinement of candidate geometry. Additional pages may be requested using bounded server-side `resultOffset` up to a maximum of 320 sampled records. A truncated response or empty sample is explicitly **not** a countywide zero/failure claim.
* **Transparency of coverage:** this is a **limited source sample, not an exhaustive county or radius inventory**. An ArcGIS acreage predicate can omit polygons whose source acreage is missing (even if other indicators might qualify); a radius passing into neighboring counties does not give the Travis layer authority outside Travis. The other five pilot counties continue to rely on the already working bounded camera-view loaders, until independently verified high-altitude indexing and provider-specific paging are implemented. A production-grade complete result count requires trustworthy county-by-county PostGIS ingestion, indexed source geometry, coverage/completeness tests and permissioned endpoint querying.
* **Persistent shortlist on the left:** the focused search panel now includes a scrollable list of candidate address, county, exact external parcel ID, reported acreage or UNKNOWN, and a clearly preliminary call-to-action. The panel stays mounted while clicking a row triggers the existing guarded county parcel lookup, centers the selected GIS polygon using a 2.3× bounded camera distance to retain some surrounding context, and opens the original property intelligence panel on the right. Candidate cards, map pins and direct lookup remain linked by exact source county+parcel ID; the source warning/evidence restrictions are unchanged.
* **Map reference names:** public **U.S. Census TIGERweb incorporated-place internal points** and the existing **TxDOT GIS roadway source** provide bounded, optional Cesium label entities for town/city names and highways, even where Google photorealistic 3D tiles hide ordinary globe imagery reference layers. City and highway label appearance is provider/zoom/data dependent; the UI discloses actual load counts or source outage, and offers a toggle. These are *navigation hints only*, not confirmed road frontage, traffic access, legal roads, surveys or mapping warranties. Provider license and attribution requirements must be verified before commercial release. The underlying native Cesium/Google/Esri map credit display remains unchanged.

**Acceptance gate:** local `node --test src/bdp/ui/acquisitionWorkspace.test.mjs src/bdp/map/discoveryMapUi.test.mjs src/bdp/map/highAltitudeDiscovery.test.mjs src/bdp/map/geographicLabels.test.mjs src/bdp/map/discoveryFeedback.test.mjs`, then `npm.cmd test`, `npm.cmd run build`, and a real-browser check of (1) direct skip to map without county; (2) Travis search with 10-60 source acres without zoom; (3) scroll results and click one while keeping left list mounted and right property evidence visible; (4) map fly-to preserving surrounding context; (5) visible real place/TxDOT route names and toggle; (6) empty, over-limit, source-outage, out-of-radius and profile-switch conditions. All new GIS sources are preliminary and should fail **UNKNOWN**, not claim a verified full-county inventory. User/browser and network testing remain pending.


## Step 31 — Free Explorer, camera height and docked geography (2026-10-30)

The browser review revealed a prominent red county-validation message even for a customer seeking free exploration, a low camera viewing angle after leaving a focused parcel, a property-search input starting below the masthead, and a geography legend overlapping the right-side property-intelligence/map area.

**Free exploration is county-independent.** The welcome explicitly says customers may browse freely. Clicking **Browse map without a search profile** always resolves the entry gate with `null`, and submitting the entirely empty questionnaire now also enters Free Explorer rather than displaying a county-validation error. If a customer enters **actual guided preferences** without a county, validation remains required so their constraints are not silently discarded. In-map **Browse freely** clears the current criteria while retaining the session shortlist and opens the original data layers; no county or permissioned search is required.

**Free-explorer camera framing:** on first free entry or a transition from Guided Discovery, Cesium flies to approximately **14 km camera height** (WGS84 ellipsoid), only when the existing local camera is outside a 10.5–26 km medium-view band or not in the Texas pilot region. If a previously guided view has the camera displaced by pitch, the system uses the **screen-center globe intersection** (where available) before geographic camera location to retain what the operator was actually viewing. It does **not** reset the camera on routine pan/zoom. When the viewer has no usable Texas location, it uses a publicly configured **Texas pilot map center**, not private user geolocation. Natural zooming remains fully interactive.

**Context boundaries:** Free Explorer can display **slate regional county-border lines** queried from the Census TIGERweb source around the viewed location, without inventing a selected county or matching candidate inventory. They are geographic context; parcel boundaries only display if the corresponding county GIS parcel layer is enabled and the provider covers the map scale. Missing boundary service does not block free browsing.

**Altimeter:** a compact, read-only camera-height badge updates on Cesium camera movement and when a flight ends. It explicitly represents **height above WGS84 ellipsoid**, not AGL, MSL, a parcel elevation, or aircraft altitude. The badge is hidden on the separate Acquisition Board and disposed with the Cesium workspace.

**Map layout:** the compact Property & Location Search now begins at the same top-screen level as the LAND DEVELOPMENT masthead. The workspace navigation moves to a separate row below, followed by the globe action controls. A dedicated flex left rail keeps **Your Land Search** (independently scrollable results) over **Search geography** (compact, independently visible county/radius color key), with bottom padding reserved for Cesium/Esri/Google provider credits. The old right-side geography overlay is eliminated. During Free Explorer, the guided-results panel disappears and the original layer panel is accessible; free regional county-reference lines can retain a small geography legend. Responsive rules preserve the layout on narrower screens.

**Required QA:** use `node --test src/bdp/ui/acquisitionWorkspace.test.mjs src/bdp/map/cameraAltitude.test.mjs src/bdp/map/discoveryMapUi.test.mjs`, full `npm.cmd test`, `npm.cmd run build` and real-browser verification. Try both the skip button and an entirely blank form submission, then a guided form with acreage entered but **no** county (should still reject it), then in-map Browse freely from a tall radius overview and from a close parcel. Expect a district-height free view with a live camera-height readout, no required county, separate rows for search/navigation, and Search Geography directly under Your Land Search. Guided county/radius workflow, existing county sources, property card, acquisition board and original Cesium credits must remain functional. Full browser checks and package tests have not yet been performed in the model environment.


## Step 32 — Header alignment and clean Free Explorer (2026-10-30)

A live customer screenshot revealed that the *Search geography* card appeared on top of the **Map Layers** registry after choosing county-free browsing. The card had been made visible by a successful optional Census county-context response even though the main guided-results panel was already hidden. The map-side county lines were correct; the extra overlay was not.

The Free Explorer now **keeps the actual sourced county context lines on the map** but **never displays the Search geography card** over Map Layers. Both JavaScript lifecycle and profile-scoped CSS enforce that rule. Guided Discovery still stacks *Your Land Search* above *Search geography*, preserving independent scrolling and provider credits.

For the usual wide desktop view (>=1420px), the **Map Explorer / Acquisition Board / Edit criteria / optional Browse freely navigation buttons** move to the **same top horizontal row as Property & Location Search**. The three separate native globe-action buttons occupy the unused space immediately to the **left** of the search bar, while the live camera-height badge sits directly below the right-side navigation. For smaller desktop sizes, the navigation retains a second row to avoid overlapping the centered search; phones use a stacked layout. Original event handlers, dataset meanings, Cesium controls, category layers, and property-intelligence panel are unchanged.

Verification includes fake DOM/Cesium source checks in which a county-free browse displays an actual Census county-reference data source, leaves the Map Layers registry enabled, and hides the geography card. Updated `src/bdp/map/discoveryMapUi.test.mjs` explicitly asserts this. Full Node suite, production bundler and a real-browser screenshot still require local QA.
