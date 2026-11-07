# Step 40C-42 — Epoch-bound PRIVATE geometry proof / cursor integration (STAGED — UNROUTED)

**Checkpoint: November 7, 2026**

## Verified previous milestone

The operator screenshots confirm **Step 40C-41 focused tests 26/26 PASS**, **complete land suite 911/911 PASS**, and **real disposable epoch-only SQL LOGIN PostGIS smoke PASS**. The screenshots **did not show a Step 40C-41 production Vite build**, so build confirmation is still pending. These are technical/synthetic results and do not authorize redistribution of official Texas county GIS polygons.

## Staged changes

1. `server/providers/bdp-parcel-sealed-geometry-runtime.js` accepts a strictly **all-or-nothing** collection of three new trusted private callbacks: `readPolicyEpochSnapshot`, `readSessionCountyEpoch`, and `readSealedRunEpoch`. No partial set is accepted. Existing v1 synthetic-only behavior is preserved for regression compatibility; **v1 is NOT for new deployments**. A v2 private page still separately verifies current session, source caching, sealed run, independent GIS publication review, and quotas, then fetches **canonical positive PostgreSQL BIGINT decimal-string epochs** for four independent dimensions: session/county grant; sealed run; source-caching rights; and separate geometry-publication review. Exact session digest, county, run and source identities are required. Any malformed/missing/stale/extra fields fail closed. Readers are re-invoked on the pre-query and post-query authorization paths.
2. The v2 `publicationRevision` used by the existing sealed geometry private boundary is now a hash of **all current validated source/review facts PLUS all four exact epochs**. This existing revision is already bound to HMAC private keyset cursors and compared before and after each fixed sealed geometry RPC. Therefore a correctly updated **A→B→A** version change rejects an in-flight private result even when review facts are back to their original values, and it invalidates a previously minted continuation cursor. No epoch or geometry data is returned in the private page summary.
3. `server/providers/bdp-parcel-verified-geometry-dependencies.js` can now wire a **fourth separate, fixed, attested epoch-only SQL principal** and two independent current session/run epoch callbacks; all four connection factory functions MUST be distinct. Partial config rejects instead of degrading. The legacy three-principal private fixture remains unchanged.
4. `server/providers/bdp-parcel-epoch-guarded-geometry-dependencies.js` is the NEW explicit **strict v2 PRIVATE factory**. All four SQL roles, source and review, geometry, epoch-only login, the verified current session/county epoch reader and independent run-seal epoch reader are mandatory. There is no HTTP route, database role creation, login transport, persistent session store, new migration, frontend geometry or live license approval.
5. `src/bdp/ingestion/parcelEpochGuardedGeometry.test.mjs` adds **17 new synthetic integration tests**: fully validated private page, separate four-role attestation, absence/downgrade rejection, source and legal rights ABA between SQL reads, session/county and run seal revisions, malformed/wrong/absent epochs, role privilege drift, revoked account, denied quota, cancellation, stable cursor and invalidation of prior signed cursor after ABA, and no polygon/credential leakage.

## Critical security limitations

**This milestone is NOT a production authorization, production session revision system, or final release gate.** The `readSessionCountyEpoch` and `readSealedRunEpoch` callbacks are presently **injected test collaborators only**: there is no durable source implementation, no independent DBA-reviewed fixed run-epoch RPC, and no real strongly-current account/county-grant revision authority. The dual policy-epoch migration from 40C-40 remains DBA-review-only, NOT installed in the existing database. The fixed 40C-41 epoch reader remains isolated, not mounted. The privileged source/review readers have separate database transactions, so even with pre/post checks and versioned cursors there is no common atomic MVCC view or race-free final publish/response handoff. An unexpected rollback of authority/epoch storage, tampering with triggers, or stale replicas can defeat guarantees. An existing v1 test factory remains in source but cannot be used for future public geometry. Active PostgreSQL cancellation, audited session grant transitions, run-seal monotonicity, pooled connection budgets and explicit user-facing release decisions remain absent. **No viewport completeness or county GIS redistribution rights can be inferred.**

## Operator verification — PowerShell (one command at a time)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelEpochGuardedGeometry.test.mjs src/bdp/ingestion/parcelVerifiedGeometryDependencies.test.mjs src/bdp/ingestion/parcelSealedGeometryRuntime.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **48/48 focused cases** (17 new + 16 prior cross-principal + 15 prior geometry runtime), **928/928 full land cases** (911 previous + 17 new), and a Vite production build. These expected outcomes are **NOT operator confirmed**. Stop immediately on the first failure. No new real PostGIS disposable smoke is added this step: existing 40C-41 real PostGIS isolated epoch role is separately operator validated, but this new four-principal in-process wiring is **synthetic only**.

**Never apply any migration, create DB roles, grant execution or mount public parcel geometry for this step.** The original God's Eye View/Cesium Free Explorer at **2.4 km**, existing Travis County CAD overlays and Property Intelligence panel remain unchanged.

## Next

Step 40C-43 should implement and independently verify **durable session/county-grant and sealed-run epoch authorities** and controlled concurrent real SQL interleavings, then design a reviewable release-time decision boundary. Continue using real PostGIS only in isolated disposable synthetic test environments until licensing, DBA and authentication approvals are complete.
