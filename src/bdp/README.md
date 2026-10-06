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
