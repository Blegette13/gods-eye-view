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
