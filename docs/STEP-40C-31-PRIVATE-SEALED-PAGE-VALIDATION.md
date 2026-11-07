# Step 40C-31 — Strict private sealed-geometry page validation (STAGED / UNROUTED)

## Operator checkpoint — November 2, 2026

The operator's latest screenshots confirm the Step 40C-30 first-page **10/10** focused SQL/planner tests and the updated disposable keyset **10/10** guard tests passing, followed by the **real, isolated PostgreSQL/PostGIS smoke** printing:

```
PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.
```

An immediately preceding land-development suite showed **711/711 passed** and a successful Vite 6.4.5 production build (250 modules, 4.39 seconds). A new `npm.cmd run test:land` was started after the Step 40C-30 Git pull, but its **final result is not visible** in the screenshots. Do not claim the post-pull run passed until its summary arrives.

## Newly committed

- `src/bdp/ingestion/parcelSealedGeometryPageValidator.js` — **private-only**, dependency-reusing validator for **either sealed first-page or sealed keyset PostGIS results**. Requires an exact trusted bounded plan; server-owned trusted source/run; current separate caching + redistribution publication review; and verifies ALL ten returned fixed-RPC columns, including the overflow row. It compares canonical numeric PostgreSQL BIGINT version IDs and stable source parcel IDs in strict order, rejects duplicate/reordered/mismatched source/county/run/version rows, and optionally checks the first row lies strictly **after** a previously independently HMAC-verified server cursor. Reuses the existing `stageParcelGeometrySnapshot` and `stageParcelGeometryCandidate` routines, so WGS84 Polygon/MultiPolygon structural rules, per-feature/page vertex, memory and wire-byte budgets, 2D coordinate validation, sanitized GeoJSON allowlist, and the `limit+1` NULL-geometry overflow sentinel continue to fail closed. Nothing is silently skipped or declared safe.
- `src/bdp/ingestion/parcelSealedGeometryPageValidator.test.mjs` — **13 isolated regression cases** for trusted rights, pagination order, canonical IDs and numeric version ordering, overflow, wrong county/source/run, injected columns, invalid geometry/budgets, empty pages, and lack of a public route. All 13 passed a JavaScript-source evaluation against the actual connected GitHub file contents; **operator Node tests have not yet been run**. A previously uncovered version-ID test assumption was corrected: the established geometry metadata budget rejects multiple rows with the same source parcel ID on a single page, so numeric order is tested with a signed-cursor-like lower bound instead of duplicating names within the page.

The only successful output has `status:'validated-private'`, `publishAuthorized:false`, `geometryDelivered:false`, `viewportCoverage:'unknown'` and an **internal-only** serialized candidate. Failure returns `status:'unavailable'`, with no geometry, count or cursor. This is **structural validation, not permission to return geometry to any browser**. No frontend file, API route, role grant, DB migration, token signing key, source license, county data or Cesium layer was changed.

## Threat boundary and outstanding work

The validator itself **cannot prove** an actual source run was sealed merely by inspecting rows. It MUST be invoked only after the DBA-reviewed Step 40C-30 sealed-initial or Step 40C-29 sealed-keyset RPC under a separately reviewed least-privileged geometry DB role, never the obsolete unsealed snapshot RPC. SQL's independent source caching + geometry redistribution checks remain necessary but **not sufficient**.

Before any deployment, a private server must verify current **session identity, county entitlements, source/run/seal binding, separate GIS redistribution review, quotas, cancellation and current review revision** BEFORE executing an RPC and AGAIN AFTER the data read and before delivery. Signed continuation tokens bind position/context but are not an authorization grant. The source's licensing rights, the persistent PostGIS migration/upgrade, server security review and the full inherited world-overlay performance suite are still outstanding. No map/county can be marked cleared from a finite page, including an empty one.

## Operator checkpoint — PowerShell, one at a time

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSealedGeometryPageValidator.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expect **13/13** in the focused validator test, green local land tests and Vite build. Stop at the first failure. Previous Step 40C-30 real disposable PostGIS smoke has already passed; there is no new SQL file or Docker runner in this step.

Next step should build an **unrouted, deny-by-default private service boundary** that composes the existing authenticated session/source lookup, current independent rights, the sealed first/next fixed SQL RPCs, this validator, and pre-/post-query revocation. Do not expose geometry in HTTP or hook the Cesium interface until an end-to-end security and legal review is completed.

The original God's Eye View/Cesium interface, 2.4 km Free Explorer discovery height, Travis CAD overlays and Property Intelligence panel remain unchanged.
