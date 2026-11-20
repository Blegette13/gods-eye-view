# Step 40C-25 — Disposable real PostGIS keyset function smoke (STAGED)

## Operator checkpoint — November 2, 2026

The latest submitted screenshot shows the Vite 6.4.5 production build succeeded (**250 modules, 4.86 seconds**) with nonfatal JS bundle-size warnings. This screenshot does **not** show whether the Step 40C-23 12-case token test, Step 40C-24 nine-case SQL-contract test, or the full focused `test:land` suite passed. Keep those local test gates open.

## Committed test infrastructure

`scripts/bdp/parcel-keyset-disposable-smoke.mjs` adds an explicitly opt-in **`--disposable-only`** PostgreSQL/PostGIS test for the *staged* Step 40C-24 rights-gated `parcel_geometry_keyset_rpc` function. It starts a random new container using the pinned `postgis/postgis:17-3.5` image, `--network none`, NO published ports, NO project database, NO bind mounts, NO persistent data volumes, and generated credentials. All commands execute through `docker exec` and the isolated PostgreSQL socket. The container and anonymous volumes are removed in `finally`.

The smoke imports only the existing synthetic 40C-13/17 fixture data and the proposed index, metadata, independent geometry-rights, snapshot and keyset SQL foundations. It explicitly asserts:

- Metadata-only `ldos_parcel_rpc_client` cannot execute the keyset function or read publication reviews.
- A new **test-only NOLOGIN** geometry role, with schema USAGE but no function EXECUTE, cannot call the function (also validates PUBLIC default denial).
- That NOLOGIN role receives **EXECUTE on the one keyset RPC only**, never the snapshot RPC or underlying geometry tables; all such grants exist solely in the disposable container.
- Prior to synthetic, explicit publication review, even a currently cache-approved source returns **zero** geometry records.
- Using the temporary admin account only for the first snapshot page, the test retrieves one accepted synthetic parcel and a NULL geometry overflow sentinel. The restricted keyset role reads the second and third accepted parcels with strictly-after positions; a final page is empty. All three accepted parcel IDs are unique and never skipped. The probe count is **2** (one accepted parcel plus one overflow record).
- Wrong county, source, or run yields no geometry. Revoking either independent publication permission or source caching permission blocks further pages.

`src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs` adds **seven fast guard/contract tests** for opt-in refusal, fresh/no-network/no-port container isolation, synthetic-only fixture, restricted SQL rights, paging progression, revocations and lack of HTTP/public services. Their syntax and seven simple source-contract assertions passed in an isolated JavaScript evaluation; neither local Node nor real Docker PostGIS has been executed by the assistant.

**Security/release limitations:** This is not a production migration, data license, deployed GIS service, HTTP pagination endpoint, authenticated user session or complete GIS coverage. The proposed SECURITY DEFINER SQL and rights records remain **unapplied** to the persistent database. The example test GRANT may only occur inside the disposable synthetic database. Live delivery still needs verified source-specific redistribution terms, session/entitlement and quota checks before/after every page, frozen run/snapshot integrity, a vetted application DB principal, an independent audit and real driver-level cancellation. Never authorize the existing metadata-only account to retrieve polygons. Keep viewport coverage UNKNOWN.

## Local PowerShell checkpoint (run each command separately)

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelKeysetPagination.test.mjs
node --test src/bdp/ingestion/parcelGeometryKeysetRpc.test.mjs
node --test src/bdp/ingestion/parcelKeysetDisposableSmoke.test.mjs
node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only
npm.cmd run test:land
npm.cmd run build
```

Docker Desktop is required only for the opt-in PostGIS smoke. **Expected final Docker line (only after actual execution):**

`PASS: disposable PostGIS keyset paging, restricted EXECUTE, overflow, and rights revocation.`

**Stop for diagnosis at the first failing test**. Do not run any of the proposed SQL migrations on an existing database. The full inherited God's Eye View release test remains an outstanding additional gate, including intermittent memory-heavy overlay timeouts. No changes were made to Cesium, the **2.4 km** free-exploration threshold, existing Travis CAD map rendering, or the Property Intelligence panel.
