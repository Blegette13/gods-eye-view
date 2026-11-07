# Step 40C-30 — Seal-enforced initial parcel page (STAGED / UNROUTED)

## Operator checkpoint — November 2, 2026

The screenshots show successful **Step 40C-29 validation** on the user's machine: **11/11** keyset SQL contract tests, **8/8** disposable harness guard tests, and an actual disposable PostGIS smoke ending with:

```
PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.
```

The first screenshot shows a preceding **699/699 passing land-development suite** and a successful Vite 6.4.5 build (250 modules, 4.36 seconds) with pre-existing nonfatal large-chunk warnings. The second screenshot starts another `npm.cmd run test:land` but does not include its final summary; do not claim that subsequent run passed until its output is received.

## Implemented on branch bdp-development

- `src/bdp/ingestion/sql/parcelGeometrySealedInitialRpcFoundation.sql`: a **new, DBA-review-only, never auto-migrated** fixed eight-argument `parcel_geometry_sealed_initial_rpc`. Its SQL body matches the Step 40C-29 **sealed keyset** SQL **exactly except for removal of the strictly-after keyset filter**. Consequently first and continuation pages enforce the *same* complete immutable source/run seal, source/county/version/count match, non-truncation, approved source caching AND independently approved nonexpired geometry redistribution, bounded 0.12-degree WGS84 window, source parcel ID + BIGINT stable ordering, 200-feature budget and `limit+1` null-geometry sentinel. It is `SECURITY DEFINER` with pinned search path, no GRANTs, and atomic REVOKEs FROM PUBLIC and the existing metadata-only role. **No server authentication is provided by SQL alone.**
- `src/bdp/ingestion/parcelSealedInitialPagePlan.js`: strictly bounded and server-source-bound, immutable eight-parameter **draft SQL call**. Unexpected plan keys, cursor injection, extra bounds, invalid trusted source or run, oversized extent or invalid page are denied. The output continues to say `publishAuthorized:false`, `geometryDelivered:false`, and `viewportCoverage:'unknown'`. No direct DB reader or public route is created.
- `src/bdp/ingestion/parcelSealedInitialPage.test.mjs`: **10 targeted tests** cover complete SQL parity, seal matching, independent rights, page limits, allowlisted response columns, no grants, the fixed plan contract and fail-closed extra fields. Their JavaScript logic passed isolated source evaluation, **NOT** the operator's local Node or disposable PostGIS yet.
- `scripts/bdp/parcel-keyset-disposable-smoke.mjs` and `src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs`: extended synthetic runtime harness, now **10 fast guard tests**, to create the new initial RPC **after** installing the seal foundation, deny EXECUTE to the metadata role and PUBLIC, prove a new ungranted NOLOGIN role cannot invoke either RPC, grant each sealed RPC independently to the disposable synthetic-only NOLOGIN role, ensure rights-only-but-unsealed returns NO first/next page, then seal the three-parcel synthetic run and retrieve the **first page through the new seal-enforced RPC**, followed by existing strictly-after keyset second and third pages. Revoking either independent publication rights or source caching blocks **both** initial and subsequent pages. The old, unsealed snapshot RPC remains inaccessible to the dedicated test role.

The 10 new first-page tests and 10 updated disposable harness checks passed a JavaScript-source evaluation after GitHub commits. **This is NOT actual Node test execution or actual PostGIS migration/testing.** The expected Docker success string remains the prior keyset smoke line to minimize regression noise.

## Required security gates before deployment

This code is intentionally **not integrated with Cesium, HTTP, the map property panel, or a production DB**. First and next pages remain private and UNPUBLISHED. A real geometry service must independently verify the live authenticated session, county entitlements, distinct legally reviewed GIS redistribution grant, atomic quotas, run-seal validity, request budgets, and post-query revocation checks; it must use a separately vetted least-privileged geometry login, DB timeouts and cancellation, and robust per-page response validation. A seal is logical immutability, **not** an MVCC snapshot, legal property survey, fully evaluated city/viewport or commercial data license. Do not repurpose the old unsealed snapshot RPC for production first pages or grant the existing metadata-only role polygon access.

## Operator PowerShell commands — separately

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSealedInitialPage.test.mjs
node --test src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs
node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only
npm.cmd run test:land
npm.cmd run build
```

Expected: new **10/10** first-page tests, updated **10/10** smoke contract tests, and after actual isolated PostGIS execution:

```
PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.
```

If any command fails, stop at the first error and repair it before moving ahead. Docker Desktop is required for the disposable runtime. **NEVER execute these staged migrations against the persistent project database.** Full inherited world-overlay performance suite `npm.cmd test` and licensing/security reviews remain independent release gates.

The original God’s Eye View/Cesium interface, Free Explorer 2.4 km discovery height, Travis County parcel overlays, and Property Intelligence panel are unchanged.
