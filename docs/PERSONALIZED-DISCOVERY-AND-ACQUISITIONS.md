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
