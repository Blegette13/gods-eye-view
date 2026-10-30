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
