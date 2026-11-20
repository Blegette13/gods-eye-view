# Step 40C-22 — Exact source-window coverage evidence (STAGED, UNROUTED)

## Operator checkpoint: November 1, 2026

The operator's latest PowerShell screenshot shows **625/625 passing land-development tests, zero failures and skipped tests**, followed by a successful **Vite 6.4.5 production build (250 modules, 10.52 seconds)**. The build retains nonfatal large-JavaScript-chunk warnings. This verifies the focused local regression for the previous Step 40C-21 private geometry service, not production geometry delivery or the complete legacy world-overlay release suite.

## Committed scope

- `src/bdp/ingestion/parcelExactCoverageEvidence.js`: staged **fixed SQL** and **pure coverage evidence checker**. Uses previously validated county, trusted source/run, exact WGS84 bounds and the existing provenance-aware PostGIS index. No new login, database grants, HTTP route, GIS data import or Cesium changes.
- `src/bdp/ingestion/parcelExactCoverageEvidence.test.mjs`: 12 new test cases checking false completeness, stale evidence, overflow, source revocation, county/run mismatches, strict bind values and conservative unknown behavior.

The coverage SQL requires `ST_Equals` between the recorded source window polygon and the actual request rectangle. Bounding-box coincidence or a collection of overlapping cached source windows is not proof that all parcels were examined. The query retains source caching-rights checks and returns at most **two** rows, allowing the checker to reject ambiguous duplicate evidence instead of selecting a convenient record.

The checker accepts **exactly one** matching record with a valid trusted run and unexpired source-caching rights, a recent (<=1 hour) observation, `run_outcome='complete'`, `coverage_state='complete'`, `received_records>=0`, `omitted_unidentified=0`, `source_truncated=false`, and **no limit+1 page overflow**. Otherwise evidence is downgraded to `partial` or `unknown`, with `unavailable` reserved for an explicit current source-window state. Any empty or duplicate set of records remains UNKNOWN.

Every return value, even a verified exact source window, continues to say **`viewportCoverage:'unknown'` and `geometryDelivered:false`**. A single query window is not a fully covered city, viewport or county. This code cannot authorize geometry redistribution or certify title, survey, development clearance or completeness of other tiles.

The 12 pure tests were also run against the fetched committed JavaScript implementations in an isolated JavaScript evaluation and all passed. **This is not a local Node test run on the operator's machine and not a real PostGIS integration test.** The proposed coverage SQL has not been executed on production or a disposable container.

## Operator validation

From the existing PowerShell project directory, execute each command separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelExactCoverageEvidence.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Do not mount a coverage API or alter the 2.4 km Free Explorer while these checks are pending. A future DBA-reviewed restricted coverage RPC, current session and entitlement enforcement, separately reviewed source rights, keyset pagination and union-of-source-window evidence remain required. The complete inherited `npm.cmd test` release gate and the outstanding intermittent overlay timeout investigation are unchanged.
