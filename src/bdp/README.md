# BDP Land Intelligence

This directory contains BDP Land Co-specific land intelligence capabilities layered on top of God's Eye View.

## Design rules

1. Keep BDP domain logic isolated from upstream geospatial/rendering code whenever possible.
2. Normalize county/CAD data before it reaches map or AI features.
3. Prefer authoritative APIs, GIS services, and bulk downloads over scraping.
4. Preserve source provenance and last-verified timestamps on every parcel record.
5. Treat legal, title, mineral, water, environmental, and entitlement outputs as decision support, not final professional determinations.

## Regional feed applicability

The initial **City of San Antonio** zoning/ETJ/future-land-use and Growth Radar
providers are **Bexar County pilot-only**. Parcel intelligence now skips both
providers for Travis, Williamson, Hays, Dallas, Harris, and any other parcel
without a positive Bexar county identity. It records `not-screened-outside-pilot`
instead of implying that zero San Antonio intersections clear the tract. These
screens count as **UNKNOWN evidence gaps**, contribute nothing to feed-response
or score-model coverage, and generate no San Antonio-specific red flags for
out-of-pilot counties. The property panel explicitly directs the user to local
jurisdiction records. Bexar county eligibility does not establish whether a
parcel is inside San Antonio or its ETJ; the regional provider must evaluate
that footprint, and zoning remains unverified until independently checked.

This is an applicability guard, **not** an Austin, Travis County, or statewide
zoning implementation. Expand with verified local jurisdiction polygon sources,
service metadata, data currency, and appropriate permitting/county review before
assigning regional land-use screens beyond this pilot.

## Live-source troubleshooting (October 27, 2026)

The first end-to-end Travis property session returned three isolated source failures:
`terrain`: USGS 3DEP replied without raster statistics (no slope or elevation
result can be inferred); `transportation`: TxDOT AADT returned a capped
candidate set (proximity metrics are withheld rather than treating incomplete
rows as all roads); and `utilities`: Windows `psql --command` exceeded its
process argument limit (`spawn ENAMETOOLONG`) when supplied embedded GIS
geometry. The utility provider now pipes SQL into `psql --file -` with bounded
output and timeouts; this needs live verification against the local PostGIS
container. Do not reduce GIS query extent merely to avoid limits unless the
reported metric's coverage is correspondingly constrained or explicitly unknown.
No USGS or TxDOT feed is considered restored without a passing live property
screen and complete authoritative response.

Follow-up 3DEP diagnostic: a prior Austin request without optional arguments
returned an elevation statistics band, and a later `Slope Degrees` request
**without** pixelSize returned one slope band (mean ~4.075 degrees for the
**diagnostic sample polygon only**, not a selected parcel). Three other requests
timed out. The terrain adapter therefore omits `pixelSize` and uses the
ImageServer default resolution, omits `renderingRule` for raw elevation, and
uses only `Slope Degrees` for slope. It does **not** claim the old 10 m sample
resolution. Independent elevation/slope requests now retain any verified
statistical band while marking missing companion evidence as `LIMITED`; if
both fail, terrain stays `UNAVAILABLE`. Neither a diagnostic sample nor a
partially returned band proves parcel-wide slope suitability, grading cost,
drainage capacity, or surveying accuracy. Re-test on an actual Travis parcel
before considering the terrain implementation verified in production.

## TxDOT source pagination (October 27, 2026)

The live Travis screening originally failed because TxDOT AADT returned a
2,000-feature capped query. The new transportation adapter first obtains the
complete ArcGIS object-ID inventory for the original bounded viewport, then
fetches all records in 400-ID pages (four requests concurrently), verifying
that every requested ID is present exactly once. It accepts the combined
collection only after the inventory is complete, geometries are valid, and
hard record/byte ceilings pass. If any page is capped, lost, duplicated, or
oversized, the source stays **UNAVAILABLE** and no false no-traffic/access
conclusion is calculated. The original screening buffer remains intact.
Large PostGIS transportation SQL now streams to `psql --file -` to avoid
the Windows `spawn ENAMETOOLONG` problem already observed with utilities.
A verified bounded viewport is **not** proof of legal ingress/egress,
right-of-way, driveway permits, current traffic, or road condition.
Live Travis parcel screening and actual TxDOT response sizes remain to be
verified before calling this source operational.

## Austin / Travis entitlement discovery (October 28, 2026)

Read-only source discovery is now available via
`node scripts/bdp/diagnose-austin-zoning.mjs`. It probes **City of Austin**
GIS sources used by the official Property Profile: jurisdiction boundaries
(`Shared/JurisdictionsFill/MapServer/0`), zoning polygons
(`Shared/Zoning_1/MapServer/0`), and the ETOD overlay
(`Shared/Zoning_2/MapServer/14`). The pilot tests only a representative
**point** near central Austin. It does NOT add Austin zoning to the unified
property-intelligence model, and cannot be interpreted as a parcel-wide
zoning determination or current permitted uses. Empty point results are
**UNKNOWN**, multiple point hits are **AMBIGUOUS**, and a capped response is
**INCOMPLETE**. Until all parcel geometry, jurisdiction boundary overlaps,
overlay constraints, city permitting authority, source currency, and land-use
regulations have been checked, score and recommendation stay withheld.
Austin itself warns that simplified zoning-by-address datasets omit
overlays and multiple zoning; users should consult official Property Profile
and the city for zoning determinations.

### Austin jurisdiction discovery safeguard

The first live parcel envelope test on TCAD parcel `302959` (611 W Annie
St) returned **two zoning polygon candidates** with `SF-3-NP` attributes
and one `ETOD Overlay Eligibility / Subdistrict 2` candidate. These are
NOT parcel intersection results. The **jurisdiction** candidate originally
failed the 50,000-coordinate guard because a citywide GIS polygon is vastly
larger than the tiny test parcel. That guard must not be removed to force
success. Instead the jurisdiction pilot now queries **attributes-only**
(`returnGeometry=false; f=json`) for candidates intersecting the parcel
envelope. It returns no geometry and records
`unverified-envelope-attribute-candidates`; it does **not** establish
parcel-wide city limits, legal zoning jurisdiction, or percent overlap. Zoning
and ETOD candidate queries still retain their polygon geometries for future
PostGIS exact intersection screening. All GIS source data remains
unverified for legal entitlements.

### Travis County parcel-wide source candidates

The Austin point discovery validated live jurisdiction, zoning, and ETOD
layer responses at a representative **point**, not a parcel. For the next
stage, run `node scripts/bdp/diagnose-austin-parcel.mjs 302959` to retrieve
the real TCAD polygon and query all three official Austin polygon layers
against its **bounding envelope**. This deliberately retrieves candidate
polygons with GIS geometries (GeoJSON), validates them, reports source
attribute diversity and limits, but **does not assign a zoning classification
or development rights**. An envelope can include polygons that never touch
the actual tract, and the ETOD source may explicitly return an *eligibility*
status instead of adopted zoning. Do not confuse it with automatic entitlement.

Before attaching any Austin evidence to the unified property panel, use
PostGIS to intersect complete source polygons against the complete TCAD
parcel geometry, disclose every area share and conflicting classification,
verify city/ETJ boundaries and overlay/regulatory applicability, and check
data currency. Empty or capped GIS results stay UNKNOWN; mapped geometry is
not a legal boundary survey or official zoning verification letter.

### Austin PostGIS intersection diagnostic (Step 33)

The Austin jurisdiction attributes-only source audit now returns a City of
Austin FULL PURPOSE *envelope candidate* for TCAD property `302959`.
The same test found two `SF-3-NP` zoning polygons and one `ETOD Overlay
Eligibility` polygon. The first two sources have geometry suitable for a
**read-only PostGIS polygon intersection diagnostic**, implemented as:

```powershell
node --test src/bdp/entitlement/austinParcelOverlap.test.mjs
node scripts/bdp/diagnose-austin-overlap.mjs 302959
```

Run the second command in a local PowerShell session with `BDP_PG_SERVICE`
and `PGSERVICEFILE` configured for the existing PostGIS database.
The script downloads actual TCAD polygon geometry, complete bounded Austin
zoning and ETOD candidate polygons, and sends a SQL query to PostGIS through
stdin. EPSG:5070 is used for preliminary **area measurements**; results
include each candidate's actual intersection area and proportion of the
mapped parcel. Overlapping polygons must NOT be added together as though
they were disjoint. Invalid polygons, capped queries and missing evidence
fail without declaring zoning or land-use clearance.

This is an **unverified GIS pilot**. It has not yet been integrated into the
unified screening model/property panel. City jurisdiction still lacks a
parcel-exact intersection because we cannot substitute the attributes-only
envelope candidate for the huge official jurisdiction polygon. The TCAD
boundary is not a legal survey, `Eligible` on the ETOD source is not a
development approval, GIS source currency is unverified, and no land-use
regulations or permit availability have been adjudicated. Acquisition
recommendations must remain withheld where evidence is incomplete.

### Travis pilot: Austin spatial evidence in the unified property card (Step 34)

The **existing** BDP unified parcel screening request now optionally collects
`evidence.austinZoning` for parcels whose recorded county identity is Travis,
using the verified PostGIS parcel/zoning and ETOD overlap code. It does **not**
replace the San Antonio entitlement/Growth Radar pilots or create a new
independent client request. The original God's Eye View interface adds
**AUSTIN GIS / PRELIMINARY ZONING** only for the Travis pilot.

The section discloses polygon overlap shares, but omits zero-area envelope
candidates from the list of positive intersections. When multiple zoning
polygons intersect a mapped parcel, the panel now requires a **boundary
review** (particularly for GIS slivers under 1%, such as the 703 Pressler
Street pilot observation of 0.1% MF-4-NP and 99.9% SF-2-HD-NP).
Do not automatically discard the smaller sliver or treat it as legally
applicable without an official parcel/zoning boundary review. Zero ETOD
candidates are **UNKNOWN**, not a declaration that no ETOD rules apply.
The Bexar/San Antonio entitlement pilot is explicitly labeled out of scope
for an Austin/Travis parcel even when the Austin GIS preview succeeds.
The pilot reports jurisdiction, source currency, legal entitlement,
and ETOD adoption as **UNVERIFIED**. The ETOD `Eligible` attribute is not an adopted density
bonus or development permit; official zoning must be checked in Austin's
Property Profile/with Austin Planning. No Austin preview result contributes
score-model coverage, red-flag clearance, buy recommendation or the 13-source
feed-response denominator. Provider failure is isolated and shows unavailable
preview rather than a guessed or favorable zoning outcome.

To test this stage (local PostGIS must be configured in the Vite server's
PowerShell environment):

```powershell
node --test src/bdp/entitlement/austinParcelOverlap.test.mjs src/bdp/intelligence/regionScope.test.mjs src/bdp/intelligence/screeningSession.test.mjs server/providers/bdp-austin-zoning.test.mjs src/bdp/ui/propertyCard.test.mjs
npm.cmd run dev
```

This code has not independently established full City of Austin jurisdiction
geometry, every zoning overlay, current legal zoning status, boundary survey
accuracy, or permitted development density. Keep acquisitions withheld where
source facts or legal review are missing.

### Austin jurisdiction spatial-relation diagnostic (Step 36)

The God’s Eye / BDP Travis pilot now includes a read-only jurisdiction
**envelope relationship** diagnostic that uses Austin's official
`Shared/JurisdictionsFill/MapServer/0` layer without downloading its enormous
full-city polygon. ArcGIS performs `esriSpatialRelIntersects` and
`esriSpatialRelWithin` comparisons against the **bounding envelope**
of a full TCAD parcel. A single GIS feature matching both relationships
suggests the entire *envelope* may be within a mapped jurisdiction; multiple
candidates trigger boundary review. This does **not** establish legally
controlling city/ETJ jurisdiction, surveyed parcel boundaries, effective
annexation status, permitted uses, or a precise PostGIS area share. In
particular, no source layer attributes may be treated as current municipal
authority without agency verification.

Run:
```powershell
node --test src/bdp/entitlement/austinJurisdictionRelations.test.mjs
node scripts/bdp/diagnose-austin-jurisdiction.mjs 302959
```

The first diagnostic property is 611 W Annie St; the second live source
validation should be a parcel close to a city/ETJ border to exercise the
ambiguous boundary path. The diagnostic does **not** yet feed the live
property card, and no score/clearance or acquisition recommendation may
change based on these preliminary geometry-only source relationships.

### Zoning map sliver display precision (Step 38)

The Travis County 701 Pressler St field validation returned three positive
mapped zoning polygon intersections, including a tiny SF-3-NP sliver which
rounded to `0%` at one decimal place. The panel now displays positive
shares smaller than `0.1%` as `<0.1%` rather than `0%`, and a near-100%
share as `<100%` rather than implying exact full mapped coverage. These
are display-only changes. All positive slivers remain flagged for zoning
boundary review rather than being silently discarded; GIS overlaps are not
a legal split-zoning finding. Run
`node --test src/bdp/ui/propertyCard.test.mjs` to validate.

### Austin jurisdiction envelope screen in the unified parcel panel (Step 37)

A successful live jurisdiction diagnostic on Travis parcel `302959` (611 W
Annie St) returned Austin ArcGIS jurisdiction OBJECTID `1326`, type
`FULL`, details `FULL PURPOSE`, for both *intersects-envelope* and
*query-envelope-within-target-polygon* relationships. This means the **GIS
parcel envelope** is preliminarily mapped within one returned Austin
jurisdiction feature. It is NOT verified legal jurisdiction, boundary-survey
accuracy, ordinance applicability, zoning entitlement, or permit approval.

The unified BDP screening response now returns separate supplementary
`evidence.austinJurisdiction` / `errors.austinJurisdiction` for parcels
identified as Travis County. It uses a City of Austin REST *attributes-only*
query and works without a separate front-end request or local PostGIS. The
original property panel includes `AUSTIN GIS / JURISDICTION SCREEN` with
the mapped boundary relationship, candidates, and visible legal caveats.
The existing `AUSTIN GIS / PRELIMINARY ZONING` remains a separate PostGIS
polygon-overlap section. Either supplemental feed can fail independently.
Neither contributes to source coverage, acquisition scoring or a buy verdict.

Run after updating `bdp-development`:

```powershell
node --test src/bdp/entitlement/austinJurisdictionRelations.test.mjs server/providers/bdp-austin-jurisdiction.test.mjs src/bdp/intelligence/screeningSession.test.mjs src/bdp/ui/propertyCard.test.mjs
npm.cmd run dev
```

The corresponding live diagnostic remains:

```powershell
node scripts/bdp/diagnose-austin-jurisdiction.mjs 302959
```

Still required: verify map currency, correct governing agency and city/ETJ
legal jurisdiction; obtain authoritative zoning confirmation, all relevant
overlays, property restrictions and applicable development regulations.
Mapped jurisdiction does not establish buildability or vested development
rights.

### Austin regulatory source and review workflow (Step 39)

This read-only phase adds `AUSTIN / REGULATORY REVIEW` to the existing
God's Eye property panel for Travis County parcels. It derives a **research
queue only** from previously retrieved Austin GIS zoning codes and mapped
jurisdiction candidates. If any mapped zoning suffix contains `NP` or
`H/HD`, the panel calls for neighborhood-plan / historic-review research;
lack of a suffix is **not clearance**. If multiple classification codes have
positive polygon overlap (including tiny slivers), the panel requires review
of the actual governing boundary and ordinances.

Authoritative City of Austin links are provided for Property Profile, formal
zoning verification, zoning resources / combining districts, the Land
Development Code (including sections 25-2-491 and 25-2-492), address /
jurisdiction verification and historic preservation. **The app does not fetch
or assert the regulations themselves** and does not infer allowed uses,
dwelling-unit counts, setbacks, height, density or buildability. Effective
ordinances, property-specific conditions, source currency, recorded surveys,
official zoning verification and relevant overlays remain unverified.
Acquisition recommendations and the 13-source model are unaffected.

Local tests after `git pull --ff-only origin bdp-development`:

```powershell
node --test src/bdp/entitlement/austinRegulatoryReview.test.mjs src/bdp/ui/propertyCard.test.mjs
```

Reload 701 Pressler St in God's Eye View to inspect the new manual research
section. This is intentionally **not** automated legal code interpretation;
that requires authoritative, versioned ordinance evidence and a confirmed
controlling jurisdiction before parcel-specific development rules can be
evaluated.

### Step 40 — Austin outstanding regulatory evidence queue

The verified Step 39 UI for the Travis County 701 Pressler St sample showed
mapped `SF-2-HD-NP`, `MF-4-NP`, and `SF-3-NP` zoning GIS candidate
codes. This release adds **Next evidence requests** (collapsed by default) in
the existing `AUSTIN / REGULATORY REVIEW` section. The queue explicitly
requires official jurisdiction review, formal zoning verification, parcel
ordinances, all overlays, relevant historic / neighborhood plan research,
the current permitted-use chart, site rules and survey/title documents.
Multiple positive GIS classification codes also trigger an explicit boundary
reconciliation task.

Tasks are regenerated for the selected parcel and remain
`verification-required` until an independently evidenced review workflow is
implemented; no task can be auto-cleared by GIS fetch success. The panel
provides City of Austin links to gather the requested official documents.
The queue is deliberately collapsed to preserve the original God's Eye
parcel UI and is separate from the 13-core-source coverage denominator and
any acquisition recommendation.

The update also improves contrast on official links (cyan instead of dark
browser-default blue) and correctly labels Austin address verification as
an address check rather than legal jurisdiction verification.

Check:

```powershell
node --test src/bdp/entitlement/austinRegulatoryReview.test.mjs src/bdp/entitlement/austinRegulatoryDueDiligence.test.mjs src/bdp/ui/propertyCard.test.mjs
```

A passing test does not certify applicable regulations, approved development
rights, the completeness of all overlays, historic designation, or zoning
boundaries. Remaining implementation priority: verified, dated, parcel-linked
ordinance evidence and an auditable manual review ledger before any site
standards or capacity calculations.

### Step 41 — append-only regulatory evidence ledger foundation

The expanded Austin regulatory checklist was visually verified on **701 Pressler
Street** with ten outstanding requests and properly labeled official links.
The next layer adds a **PostgreSQL evidence journal**; it does not yet add a
document uploader or a task-completion control to God's Eye View.

`src/bdp/regulatory/evidenceLedger.js` defines a strictly validated
parcel+task+provenance event (official/document URL, title, date if known,
optional SHA-256, research notes and entering reviewer). Events are always
`unverified`; no current evidence entry is an official zoning
determination, legal jurisdiction clearance, permit approval, or proof of
buildability. Recording a document **does not close its checklist task**.
Correction notes are appended as new events instead of modifying history.

`src/bdp/ingestion/sql/regulatoryEvidenceLedger.sql` creates ONLY a new
`bdp_regulatory_evidence_events` table, indexes, and append-only write
guard. It does not rewrite existing parcel GIS or screening tables. The
guard rejects UPDATE/DELETE; however, database owners/superusers can
bypass DB triggers, so stronger role separation, authentication, external
archive/backups and document fingerprints are required before claiming
tamper-proof review history. This is a research journal, NOT a certified
compliance repository. Source URLs must not contain authentication tokens,
confidential documents, or personal information.

In PowerShell after updating branch `bdp-development`:

```powershell
node --test src/bdp/regulatory/evidenceLedger.test.mjs src/bdp/entitlement/austinRegulatoryDueDiligence.test.mjs
psql "service=bdp" -v ON_ERROR_STOP=1 -f src/bdp/ingestion/sql/regulatoryEvidenceLedger.sql
psql "service=bdp" -v ON_ERROR_STOP=1 -f src/bdp/ingestion/sql/regulatoryEvidenceLedgerSmoke.sql
psql "service=bdp" -c "SELECT COUNT(*) AS evidence_events FROM bdp_regulatory_evidence_events;"
```

Run the SQL commands in the PowerShell tab that already has the working BDP
`PGSERVICEFILE` and database password. Smoke tests use a ROLLBACK-only
synthetic fixture and leave no new evidence record (identity sequences may
advance). The final row count may be zero; this is expected and means no
research evidence has been entered. An existing database backup is advisable
before changing its schema.

**Next required implementation**: a separately authenticated, parcel-bound
document intake workflow with secure storage, a read-only journal view in
God's Eye, explicit reviewer identity/authorization, document effective
dates and replacement records. No automatic model-score, development
capacity or purchase-decision changes may be made from submitted documents.

### Step 42 — local read-only regulatory evidence inspection

The initial PostgreSQL migration and rollback-only smoke tests for Step 41
were verified locally on October 28, 2026: the table, indexes, functions,
triggers and comment committed, the smoke test confirmed blocks on UPDATE,
DELETE and `verified` inserts, and the evidence row count was **0** after
ROLLBACK. The separate Node.js contract test results were not included in
this database screenshot and should be run independently.

This phase adds a parcel-filtered, **metadata-only** inspector for the new
evidence journal. It is deliberately a LOCAL PowerShell CLI, **not** a web
endpoint or publicly exposed Vite route. It returns only a bounded set of
event IDs, task IDs, event types, dates, source titles and optional checksums;
no notes, reviewer names, source URLs, attachments or credentials are printed.
It uses the established `BDP_PG_SERVICE` connection with SQL passed over
stdin to avoid Windows command limits.

Run in the PowerShell session with existing BDP_PG_SERVICE/PGSERVICEFILE
and `PGPASSWORD` settings (the **same** PowerShell session matters):

```powershell
cd "$HOME\\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/regulatory/evidenceLedger.test.mjs src/bdp/regulatory/evidenceIndex.test.mjs
node scripts/bdp/inspect-regulatory-evidence.mjs 48453 302959
```

The current empty database should report `totalEvents: 0`,
`returnedEvents: 0`, `events: []`, `verifiedTasks: 0`, and
`legalClearance: null`. This is EXPECTED. The final output explicitly
states that no legal land-use clearance or acquisition recommendation was
established. Queries are strictly scoped to a validated five-digit Texas
county FIPS and simple parcel identifier, and result pages are limited to
50 by default (never >100). The `truncated` flag is true if more than
the returned page of events exist.

**Privacy/security boundary:** evidence metadata is not yet served to the
God's Eye browser. Before connecting a live journal to the native UI we
need a secure authentication/authorization model, protected data access,
reviewer identity management, optional document hashing / private storage,
and a full provenance workflow. The existing regulatory checklist is
still a **research queue**; GIS observations and archived documents never
auto-close tasks or modify score, buildability, or acquisition readiness.

### Step 43 — dry-run-first local regulatory evidence intake

Step 42 is verified on Windows: eight Node.js tests passed with zero failures,
and the read-only index for Travis County FIPS `48453`, parcel `302959`
returned `totalEvents: 0`, no reviewed tasks, and `legalClearance: null`.
This confirms the query path, not yet a document-ingestion or legal-review
workflow.

Step 43 adds a LOCAL operator-controlled event intake, not an HTTP API or
native property-panel write control. Input is a small JSON file, validated
against `createRegulatoryEvidenceEvent` with an explicit allowlist of
permitted fields. Unexpected approval/verification fields are rejected.
User-controlled URLs and notes are serialized as UTF-8 JSON, encoded to hex,
and decoded by PostgreSQL inside a statement streamed over psql stdin; raw
notes, URLs, and reviewer names are never printed in console output.
A dry run validates the event without touching the database.
Only an explicit `--commit` causes a real INSERT, always with
`verification_state='unverified'` enforced at the database level. The
result must match the requested county, parcel, task, and unverified status.
A real INSERT creates an append-only historical record and cannot be undone
through ordinary UPDATE/DELETE. Do not commit any synthetic fixture to a
real parcel or store confidential personal details in research notes.

**Try validation without a database write** (requires no PostGIS session):

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/regulatory/evidenceLedger.test.mjs src/bdp/regulatory/evidenceIndex.test.mjs src/bdp/regulatory/evidenceIntake.test.mjs scripts/bdp/prepare-regulatory-evidence.test.mjs
node scripts/bdp/prepare-regulatory-evidence.mjs --template
```

To prepare a REAL research note later: create a private local JSON file in
`.bdp-private\\` (this folder is Git-ignored) from
the printed template, replace all placeholders with an actual county/parcel,
a specific due-diligence task ID, truthful notes and a non-sensitive local
operator label, and run:

```powershell
node scripts/bdp/prepare-regulatory-evidence.mjs --file .\\.bdp-private\\research-note.json
```

The default command performs a dry run. Keep private evidence files outside Git commits and logs. Do NOT use `--commit` until you
intend to permanently append the entry, have confirmed your source
and parcel ID, and are working inside the locally controlled PostGIS
environment. To deliberately append an authentic unverified record later:

```powershell
$env:BDP_PG_SERVICE = "bdp"
node scripts/bdp/prepare-regulatory-evidence.mjs --file .\\.bdp-private\\research-note.json --commit
```

Follow with a local `inspect-regulatory-evidence.mjs` call for the matching
county and parcel to confirm the event index. This feature is for a trusted
local operator only. The current `bdp` database owner connection is not a
least-privilege service account. Never expose the CLI, general psql runner,
input files or unredacted evidence notes to the browser, CI logs or public
APIs. Before production, add authentication/authorization, least-privilege
DB roles, encrypted private file storage, document provenance, backup and
retention safeguards, and a separately authorized verification workflow.

### Step 44 — local-only regulatory document fingerprinting

Step 43 was verified on Windows with **16/16 passing Node.js tests** and the
template printed successfully. The live regulatory database remains empty
unless a local operator explicitly commits authentic evidence.

This phase adds cryptographic file fingerprinting and a **dry-run-first**
workflow for document-indexed research events. For an actual official PDF,
image, text, or DOCX from a responsible agency, BDP can compute a SHA-256
digest directly from a bounded local file (up to 32 MiB) and optionally append
the hash plus source metadata to the existing PostGIS evidence journal.
Original document bytes are **never** uploaded to GitHub, the browser, or
PostgreSQL. The `.bdp-private/` folder is Git-ignored. The intake rejects
oversized, empty, non-regular and out-of-folder files and detects symlinks.
It is NOT an antivirus scanner, encrypted storage system, document viewer,
verified ordinance lookup, or a production authorization layer. An official
webpage URL does not itself prove the document is current or authoritative.

Dry-run-only checks, safe even when no real parcel document is available:

```powershell
cd "$HOME\\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/regulatory/documentIntegrity.test.mjs scripts/bdp/prepare-regulatory-document.test.mjs src/bdp/regulatory/evidenceIntake.test.mjs
node scripts/bdp/prepare-regulatory-document.mjs --template
```

For a **real** regulatory document later, save the original document file and
a separate JSON metadata file under `.bdp-private/`. The JSON schema is
printed by `--template`; sourceUrl must be the actual HTTPS document source,
sourceTitle the actual published title, and sourceDate null if unknown. Never
add a sourceSha256 field to the metadata: BDP calculates it from document
bytes. Never enter fake parcel identifiers, unverified legal conclusions, or
sensitive information into notes.

The following command validates metadata and hashes the local file but
**does not write to the database**:

```powershell
node scripts/bdp/prepare-regulatory-document.mjs --document .bdp-private/official-file.pdf --meta .bdp-private/official-file.json
```

Only after careful independent source, parcel and metadata review may a
trusted LOCAL operator intentionally append the index row with `--commit`
and an appropriately configured `BDP_PG_SERVICE`. A journal entry remains
`unverified`, does not close a due-diligence task, and never changes
development capacity, zoning clearance, model coverage or recommendations.
Append-only entries cannot be edited/deleted through ordinary SQL; back up
the private original document separately to retain the ability to verify its
hash. No automatic file retention, access controls or backups exist yet.

Before any multi-user web access: implement proper authentication, scoped
authorization, least-privilege service roles, encrypted private document
storage, safe document scanning/preview, signed review events and auditable
source-effective-date reconciliation. Do not expose these local scripts or
database credentials in the Vite development server.

### Step 45 — deny-by-default regulatory evidence access gate (NOT live auth)

**Observed Step 44 local result:** 13 Node.js tests passed, 0 failed; the
local document metadata template printed without writing to PostgreSQL.
This verifies the fingerprinting test suite and dry-run template, not
production document authentication or multi-user permissions.

This phase adds **an unrouted server-side authorization boundary**:
`src/bdp/regulatory/evidenceAccessPolicy.js` requires a future trusted
server-side session resolver, exact county-FIPS + parcel-ID grants, and an
explicit `evidence-reader` or `evidence-researcher` role. A reader can
inspect metadata; a researcher can also append unverified research notes and
document-index entries. There are **NO** rights to verify, amend, delete,
mark a task complete, infer legal clearance or issue a BUY recommendation.
Missing sessions, wildcard grants, forged client roles, cross-parcel access,
and unknown actions all fail closed.

`server/providers/bdp-evidence-access.js` demonstrates the required
integration sequence: resolve a genuinely authenticated server-side
session; check the parcel-specific permission; *then* query PostGIS via
the existing evidence index or append adapter; verify the response remains
unverified. The adapter is NOT routed to HTTP/Vite and does not touch God's
Eye View's Cesium interface. Existing local-only CLI commands are unchanged.

For a development-machine test (no database changes, all fake identities):

```powershell
cd "$HOME\\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/regulatory/evidenceAccessPolicy.test.mjs server/providers/bdp-evidence-access.test.mjs
```

**Security caveat:** This code is an authorization *policy seam*, NOT a
login system or evidence security deployment. The future resolver MUST
verify real server-side sessions with a proper identity provider, derive
roles and parcel grants from a server-side authority (never browser
JSON/header values), implement CSRF protection, rate limiting, audit logging
and password/token handling, and use separate least-privilege DB roles.
Currently the `bdp` PostgreSQL connection is an owner-level local dev
connection. Do not expose a live evidence API or connect these adapters
to anonymous Vite routes. The policy alone does not secure an endpoint.

Next: threat model + restricted PostgreSQL read/write roles, securely
provisioned operator identity/session backing and controlled journal
read access; only then consider a property-panel evidence view. Never turn
an indexed document into a verified task without distinct authorized legal
review and independently corroborated evidence.

### Step 46 — separate PostgreSQL evidence privileges

**Step 45 local confirmation:** 12/12 authorization and service-boundary tests
passed. The trusted-server authorization policy is implemented, but NO real
operator login/session system or live evidence HTTP route has been deployed.

Step 46 is an **opt-in additive local Postgres migration**:
`src/bdp/ingestion/sql/regulatoryEvidenceRoles.sql`. This migration requires
the Step 41 evidence table and an administrator/superuser connection. It
creates exactly three NOLOGIN group roles:

- `bdp_evidence_reader`: SELECT on only the evidence index metadata
  columns (no notes, source URL, or entered_by).
- `bdp_evidence_appender`: EXECUTE on a narrowly-defined,
  `SECURITY DEFINER` `public.bdp_evidence_append_unverified(jsonb)` routine;
  no SELECT/INSERT/UPDATE/DELETE on the evidence table itself.
- `bdp_evidence_owner`: a separate NOLOGIN function owner, with permission
  only for specified INSERT and limited RETURNING columns. The function
  does not run as the original `bdp` database superuser.

The restricted function rejects unsupported fields (including approval
claims), inserts only records constrained as `unverified`, and returns a
small, non-legal clearance receipt. The post-auth service adapter now
generates RPC calls instead of direct INSERT statements. The previous
local trusted-operator evidence CLI still uses the original PostGIS
owner connection and remains intentionally **local-only**.

**Run automated Node.js policy and SQL-generation tests first:**

```powershell
cd "$HOME\\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/regulatory/evidenceAccessPolicy.test.mjs server/providers/bdp-evidence-access.test.mjs src/bdp/regulatory/evidenceIntake.test.mjs
```

**On the local trusted bdp PostGIS administrator connection only**, after
confirming you have a database backup, apply and smoke-test:

```powershell
psql "service=bdp" -v ON_ERROR_STOP=1 -f src/bdp/ingestion/sql/regulatoryEvidenceRoles.sql
psql "service=bdp" -v ON_ERROR_STOP=1 -f src/bdp/ingestion/sql/regulatoryEvidenceRolesSmoke.sql
```

The smoke test uses a synthetic test-only parcel event, a restricted role
context, and an outer `ROLLBACK` transaction. No synthetic evidence is
persisted. The CLI must report the grant checks pass and complete ROLLBACK;
the role migration itself commits three group roles, grants and the RPC.

**This is NOT deployable authentication**. NOLOGIN roles cannot be used to
log in; there are no separate login credentials yet and no parcel RLS.
Database reader metadata grants are *not* parcel-row restricted: actual
parcel access depends on the trusted application-level gate. Never share
`bdp` owner credentials with an application service, accept browser
claimed roles, grant anonymous access, or connect the evidence adapter to
an HTTP endpoint. The future server MUST inject its own verified-session
resolver and a separately provisioned least-privilege DB query adapter;
the adapter now refuses to default to the local owner connection.
Additional protections needed: real identity provider, parcel-grant
registry, DB-side row isolation, audit/retention, backups, secret rotation,
and authenticated private file storage. No evidence entry closes checklist
tasks or changes an acquisition recommendation.

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
All county layers feed the same normalized parcel,
property card and unified intelligence request. Screen/Clear include all
county layers, and switching county searches hides other property cards.

The Travis adapter uses Travis County GIS's **countywide** TCAD Parcels layer
(`Boundaries_and_Jurisdictions/TCAD/MapServer/0`), which Travis County TNR
describes as assembled from TCAD and updated monthly. GeoJSON property ID,
owner, and viewport lookups use the published GIS attributes; owner, acreage,
appraisal values, legal descriptions, and deed references remain unverified
source observations. A successful retrieval does not establish each record's
currency, title, or surveyed boundary. Capped/partial responses, malformed
polygons, missing property IDs, and repeated IDs fail screening.

**Source correction (October 27, 2026):** The prior adapter pointed at
`TCAD_Travis_County_Property/MapServer/3`. Its publisher's service description
explicitly restricts that layer to **Travis County-owned properties**. Ordinary
neighborhoods legitimately returned empty `features` arrays and displayed no
selectable parcels. This is not the countywide parcel inventory. The corrected
adapter uses the full TCAD layer and a live validator now checks that a
residential neighborhood in central Austin returns at least one parcel.
Neither a mapped boundary nor a GIS deed reference verifies legal title.
A current countywide neighborhood request returned 72 GIS polygons with valid
geometry but six records lacking a numeric `PROP_ID`. Viewport mapping now
retains the 66 identifiable parcels while labeling the feed DEGRADED / PARTIAL,
showing omitted counts, and attaching the coverage limitation to displayed
property source notes. The six unidentified polygons are not assumed safe,
silently treated as absent land, given fabricated IDs, or used for acquisition
screening. Invalid geometry, duplicate identifiable IDs, and truncated/capped
responses continue to fail closed. Exact parcel and owner searches also retain
strict identifier validation. A partial viewport does not imply complete parcel
coverage.

Parcel rendering: Cesium disables native polygon outlines on terrain-clamped
GeoJSON. County parcel polygons now keep their original fill/selection geometry,
but explicit ground-clamped LineString features trace exterior/interior rings
and MultiPolygon parts. Boundary features preserve the original `bdpParcelId`
for selection; they are visualization only, not a source, a new legal boundary,
or a new parcel record. Live browser visibility/picking must be checked after
each renderer change.



Source: https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD/MapServer/0
(official GIS layer and field metadata verified October 27, 2026).
The title review links to the Travis County Clerk's real-property page for
manual lookup, not a title clearance.

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

Hays is the fourth selectable screening county: `hays parcel: ID` and
`hays owner: NAME` query a public CODS/TNRIS Hays CAD polygon copy. The layer
provides parcel geometry, published owner, legal acreage (only where units
are acres), situs, legal description and historical values to the same map,
property panel and unified request. Its metadata says TNRIS acquired it in
February 2022 and sampled records report tax year 2022. The UI labels record
currency **STALE**, shows the source tax year and a high-priority verification
flag; retrieval today is not a current CAD roll or proof of ownership. Verify
with current Hays CAD records, the Hays County Clerk, and survey/title work.
Result caps, missing geometry, conflicting county identifiers and duplicate
parcel IDs fail the request. BDP Validation checks the live layer metadata
and a sample GeoJSON parcel. Source:
https://services6.arcgis.com/XnTA1N5QxtOFa9o8/ArcGIS/rest/services/CODS_Public_Map/FeatureServer/6
(checked October 6, 2026). The Clerk page is a manual document-lookup link.

Dallas is the fifth selectable county: `dallas parcel: ID` and
`dallas owner: NAME` query Dallas Central Appraisal District's ParcelPublishing
polygon layer. Published parcel IDs, owner names, situs, description and
appraisal observations feed the existing map, property panel and unified
request. `STATEDAREA` is used as reported acreage only when the record explicitly
states acres; otherwise acreage remains unknown. A reported revaluation year
is shown but does not verify current ownership, sale price or title. The
County Clerk link is for manual public-record review. Capped responses,
invalid geometry and repeated parcel IDs fail screening. BDP Validation
checks the live DCAD layer metadata and one GeoJSON polygon. Sources:
https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4
and https://www.dallascounty.org/government/county-clerk/recording/
(checked October 7, 2026).

Harris is the sixth selectable county: `harris parcel: ACCOUNT`,
`harris account: ACCOUNT`, and `harris owner: NAME` use the official county-hosted
HCAD polygon layer. Account IDs retain all 13 digits, including leading zeros.
Up to three published owner names, situs/mailing address, legal description,
explicitly labeled acreage, land/market appraisal values and source tax year
feed the original God’s Eye map, property panel and unified request. Missing
acreage/values stay unknown. Appraised value is retained as source context, not
an asking price, verified sale price or assessed tax liability. Retrieval and
tax year do not verify record currency or title.

Stacked/condominium accounts may share geometry, so account acreages must not
be summed as distinct physical land. Invalid/capped results, conflicting
account/county identifiers and repeated account IDs fail screening. The manual
title-review link points to Harris County Clerk; it does not perform a record
search. BDP Validation checks every requested field and a live GeoJSON sample.
Sources: https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0,
https://hcad.org/assets/uploads/pdf/GIS-ReadMe.pdf and
https://cclerk.hctx.net/RealProperty.aspx (checked October 8, 2026).

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

## Fail-closed environmental evidence

EPA cleanup normalization fails closed on transfer-limit flags and missing,
unsupported or invalid point geometry; records are never silently discarded
into a zero-site screen. EPA scoring requires explicit nonnegative integer
counts for every scored category, internally consistent counts, and a distance
when nearby records exist. Missing/invalid values do not count as zero. NWI/FEMA
percentages must be between 0 and 100; FEMA also requires floodway acreage.
Terrain/soil scoring ignores invalid slopes/shares and retains independently
valid evidence at its lower confidence. These checks leave GIS calculations
in PostGIS and do not change category weights or mapped-risk flags.

## Source response status

The unified request includes a per-feed `sourceCoverage` ledger with `returned`,
`limited`, `unavailable`, or `unknown` status. Partial utility failures, missing
or stale imported PUCT snapshots, incomplete FEMA/MSW coverage, empty evidence,
and unresolved San Antonio jurisdiction cannot count as unrestricted returned
feeds. Surviving metrics and mapped-risk flags remain available. These limits
also become source gaps in the acquisition brief. The native property panel
shows the ledger in an expandable source-response section, without another API
request. Derived analyses do not add independent sources to the denominator.

`sourceCoveragePercent` remains the percentage of the 13 feeds that returned
evidence without these explicit limits; it is now labeled **Feed response
coverage**, not "Live feeds". It does not establish inventory completeness,
current records, county coverage, score-model coverage, legal clearance or
utility capacity. San Antonio entitlement and Growth Radar remain regional
screens, including when their requests succeed. Score weights and withholding
of acquisition recommendations are unchanged.

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
