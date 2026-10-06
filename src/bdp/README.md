# BDP Land Intelligence

This directory contains BDP Land Co-specific land intelligence capabilities layered on top of God's Eye View.

## Design rules

1. Keep BDP domain logic isolated from upstream geospatial/rendering code whenever possible.
2. Normalize county/CAD data before it reaches map or AI features.
3. Prefer authoritative APIs, GIS services, and bulk downloads over scraping.
4. Preserve source provenance and last-verified timestamps on every parcel record.
5. Treat legal, title, mineral, water, environmental, and entitlement outputs as decision support, not final professional determinations.

## Initial modules

- `config/` — Texas and BDP configuration.
- `parcels/` — parcel schema, normalization, rendering, and selection.
- `cad/` — county/CAD adapters and registry.
- `overlays/` — flood, wetlands, soil, energy, utilities, traffic, and environmental layers.
- `intelligence/` — acquisition scoring, red flags, best-use, and entitlement analysis.
- `ui/` — BDP property and acquisition interfaces.

## County parcel pilots

Bexar remains the default for `parcel: ID` and `owner: NAME` in the original
God's Eye LOCATION tray. `travis parcel: ID`, `travis account: ID`, and
`travis owner: NAME` select the Travis parcel layer in the same UI; `bexar`
may also be given explicitly. Williamson commands select the third county.
All three layers feed the same normalized parcel,
property card and unified intelligence request. Screen/Clear include all three
county layers, and switching county searches hides other property cards.

The Travis adapter uses Travis County GIS's TCAD property layer, with bounded
GeoJSON queries for owner, property ID and viewport. It maps published TCAD
fields, preserving missing values as unknown and treating county GIS ownership,
legal description, acreage, values and deed references as unverified source
observations. A retrieval timestamp is not the date the CAD records changed.
Partial/capped responses, missing polygon geometry and missing property IDs
fail screening rather than producing a misleading subset. The separate county
TCAD_public layer is described as monthly; that does not establish the
currency of each record in this layer. Unit tests use representative published
fields and mocked responses; BDP Validation also checks the live GIS metadata
and a real parcel GeoJSON response. Browser rendering at deployment remains
to be checked. Other counties remain unsupported until verified adapters are added.

Source catalog: https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_Travis_County_Property/MapServer/3
and https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/layers
(metadata checked October 6, 2026). The title review links to the Travis
County Clerk's real-property page for manual lookup; a CAD deed reference does
not establish title.

Williamson is the third county pilot: `williamson parcel: ID` and
`williamson owner: NAME` use Williamson County GIS's WCAD polygon layer. The
same bounded search, God’s Eye map and property card show published ownership,
acreage and appraisal observations. The service's update information conflicts
with an old description date; currency remains unverified, including when
`DataDate` is present. Empty values stay unknown, and capped/invalid results
fail screening. The manual title-review link points to Williamson County
Clerk's official public-record search. The live GIS metadata and a sample
GeoJSON parcel are checked by BDP Validation. Source:
https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0
and https://www.wilcotx.gov/1611/Search-Records (checked October 6, 2026).

## PUCT sewer CCN territory

The official PUCT GIS page provides a statewide sewer CCN TSMS shapefile ZIP.
`node scripts/bdp/puct-sewer-import.mjs` downloads it with ETag/Last-Modified
checks, verifies SHA-256, uses GDAL to transform polygons to EPSG:4326, and
atomically replaces the PostGIS territory snapshot only after validation.
Set `BDP_PG_SERVICE` (or `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and
`PGPASSWORD`) and install `ogr2ogr` and `psql`. Apply
`src/bdp/ingestion/sql/puctSewerCcn.sql` to an existing database first; new
Docker databases receive it on initialization. CI imports the current official
archive and checks a parcel overlap. The unified utilities request includes
sewer CCN overlap, utility and CCN numbers with source Last-Modified. No import
or a source timestamp older than 180 days displays as unknown. A CCN is a
mapped certificated service area; it does not prove a current sewer main,
connection, capacity, extension cost, or provider commitment. Sewer CCN does
not increase the preliminary Utilities score. The existing God's Eye Utilities /
Infrastructure map layer shows imported territory at a close zoom with a purple
outline. PostGIS clips bounded map requests; missing, stale or capped results
cannot be displayed as reliable territory. PUCT source:
https://www.puc.texas.gov/industry/water/utilities/gis/ (checked October 6,
2026).

The separate TWDB-hosted PUCT water CCN layer still reflects a 2021 published
copy. It remains visible as archived territory context and is labeled as such
in the panel. Its overlap no longer earns score points, penalizes absence, or
reduces the no-current-water-service review priority. The official PUCT water
CCN ZIP now has a parallel checksum-verified PostGIS importer at
`scripts/bdp/puct-water-import.mjs`, with a source timestamp, parcel overlap,
and close-zoom God’s Eye map outline. Run it with the same database and GDAL
requirements as the sewer importer. Missing or older-than-180-day snapshots
display as unknown. Even a current CCN does not prove an actual main, available
capacity, a tap, or a will-serve commitment and does not grant score points.
The three remote service, archived CCN, and transmission screens fail
independently: an unavailable source yields null metrics and an unavailable
status for that source, while the other remote results and imported PUCT
snapshots remain in the unified parcel response. A failed feed never becomes
a measured zero overlap or zero crossings.

## Acquisition economics scenarios

The unified screening response includes `evidence.acquisitionEconomics`, derived
from `parcel.acquisition.askingPrice` and optional `parcel.acquisition.scenario`:
`closingCosts`, `dueDiligenceCosts`, `siteWorkCosts`, `holdingCosts`,
`dispositionCosts`, `exitPrice`, `targetReturnPercent`. Blank/invalid costs stay
unknown; explicit zero is a user assumption. All-in basis includes purchase plus
all five cost buckets. Break-even exit equals that basis; profit equals assumed
exit less basis. Return is profit / basis. The residual maximum offer for a
target return on cost is `exitPrice / (1 + targetReturnPercent / 100) - costs`.
Negative residuals remain negative and are marked infeasible.

The original property panel exposes the inputs and scenario arithmetic alongside
CAD context and Growth Radar. Edits are local to the current parcel selection,
not persisted. CAD values never become asking prices or comparable sales, and
scenario results do not fill the model's 12-point acquisition-economics category.
Verified sale comparables, cost evidence and market underwriting remain future
work. The ten score weights are unchanged.

## Parcel acquisition brief

The unified response includes top-level `acquisitionBrief`, assembled
deterministically from the existing score components, provider errors and red
flags. It performs no new GIS calculation or external fetch and does not change
score weights, source coverage or the underlying evidence. Non-info flags are
screening review triggers; info flags are separate screening limits. Source
details and qualifiers are retained verbatim, including MSW point uncertainty.

Unknown/preliminary categories and absent, failed or incomplete feeds become
explicit gaps. High/critical flags lead the review order, followed by unresolved
evidence and confirmation tasks. Every action links to its flag/gap IDs and
evidence references; unrecognized future flags remain visible with a generic
source-review action. References such as `redFlags.<id>` select by flag ID;
`score.components.<category>`, `evidence.<source>` and `errors.<source>` address
the same unified screening snapshot, including explicitly unknown values.

The existing property panel shows the review triggers and first three actions,
with expandable evidence gaps, screening limits and remaining tasks. Source
names are displayed; machine-readable evidence references are retained on rows
for auditing. Briefs reset with parcel selection and stale responses are ignored.
Scenario edits cannot enable a verdict or change model coverage. This first
version always withholds buy/pass recommendations, even for high numeric scores.
An empty risk list is not clearance. No LLM-generated facts are used.

## Ownership / title review

The unified evidence package includes `evidence.ownershipTitle`, a deterministic
document-review plan shown in the original property panel. CAD owner and legal
description remain observations. Deed vesting, seller authority, commitment
exceptions/requirements, survey/easements, legal access, liens/releases, taxes,
and mineral/water interests remain unknown until a verified document workflow
is implemented. Caller assertions and CAD record currency cannot clear title.
The eight-point Ownership/Title component stays unscored.

Pipeline, archived transmission and planning-road intersections prioritize
survey/easement review. Nearby wells and on-parcel TCEQ points prioritize rights
review. These are document-request triggers, not findings of encumbrances or
ownership. Missing or zero map metrics never remove baseline review tasks.
This derived plan is not an additional feed and does not increase source coverage.

Bexar parcels link to the county's official land-record information page;
unsupported or conflicting county identifiers receive no substitute county link.
All parcels link to Texas Department of Insurance title guidance. Opening either
link is a manual lookup, not a completed record search. References:
https://www.bexar.org/2950/Real-PropertyLand-Records and
https://www.tdi.texas.gov/title/titlefaqs.html (checked October 6, 2026).

## Development constraint footprint

Unified intelligence now includes `evidence.developmentConstraints` and a separate
`errors.developmentConstraints`. FEMA/NWI feeds are fetched once per request and
shared with their individual screens. PostGIS clips/repairs source polygons and
unions FEMA mapped hazards (including moderate hazard) with NWI wetland/water
features. Shared area is reported separately and counted once in the combined
footprint; percentages from separate providers are never added together.

The outside-footprint acreage is withheld when recognized FEMA A/V/X polygon
coverage is below 99.5% of the parcel. Zone D, missing mapping and incomplete
responses do not establish available acreage. Even complete source responses do
not certify inventory completeness or wetland jurisdiction. Outside-footprint
land is preliminary map context, never verified buildable acreage. The model's
15-point development-potential category remains unknown/unscored.

This is derived analysis, not an independent source; it does not inflate live
feed coverage or score weights. A failed upstream feed withholds the combined
result without hiding the successful individual screen. Capped/truncated FEMA
and NWI responses and unexpected missing/non-polygon geometries are unavailable,
not clear. The property panel uses the existing single intelligence request.

`node scripts/bdp/validate-development-postgis.mjs` uses PG* connection settings
to assert overlapping/duplicate polygons, missing/partial/undetermined FEMA
coverage, parcel holes and multipart tract calculations. Environmental provider
SQL is sent over stdin so larger geometry payloads are not placed in OS command
arguments. Existing input/response size limits and query timeouts still apply.

Individual FEMA screening uses the same evaluated-coverage rule: incomplete coverage withholds Flood/Water scoring and preliminary outside-hazard acreage while retaining observed hazards.
