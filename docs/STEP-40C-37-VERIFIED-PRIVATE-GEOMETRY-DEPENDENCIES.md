# Step 40C-37 — Three-principal private geometry dependency integration (STAGED / UNROUTED)

## Verified prior milestone — November 4, 2026

The operator's PowerShell screenshots confirm **Step 40C-36 25/25 focused tests PASSED**, **819/819 land regression tests PASSED**, **production Vite build PASSED** (250 modules, 18.67 s), and the **real disposable PostGIS independent geometry-publication LOGIN security smoke PASSED**. The npm upgrade notice and Vite large-bundle advisory are nonfatal. These results do NOT establish a live GIS redistribution license, actual source ingestion, a public map API, or production credentials.

## Step 40C-37 changes — awaiting operator testing

**All new files are SERVER-ONLY, PRIVATE, UNMOUNTED and UNROUTED. None connect to production; no browser/HTTP route, DB migration, login, secret, PostGIS table, GIS source or Cesium property layer was changed.**

1. `server/providers/bdp-parcel-verified-geometry-dependencies.js`: composes the prior sealed-source adapter + pinned source-authority SQL reader (Steps 40C-34/35), independent publication-review adapter + pinned publication-only SQL reader (Step 40C-36), and private sealed-geometry session/rights/quota runtime (Step 40C-33). It accepts **three distinct** server-injected connection factories, separate dedicated SQL LOGIN names for source and publication, distinct server-only session/cursor HMAC keys, a strongly current server session-digest lookup, an **atomic distributed quota** callback, and an optional trusted clock. Every source and review lookup is independently attested at the SQL principal level. The Step 40C-33 boundary revalidates session/county, immutable source run seal, source-caching approval, and separate redistribution review **before and after** the fixed geometry RPC. The only returned method is `readPrivatePage`, providing internal count/overflow/short-lived signed cursor only. **No GeoJSON or polygons can be serialized into its result.**
2. `server/providers/bdp-parcel-sealed-geometry-rpc.js` and its existing 15-test runtime suite are updated to explicitly demand that the **geometry-only** SQL principal *cannot execute* the new sealed-source authority or independent geometry-publication-review RPCs. The query attestation is fail closed if either function is missing or a permission is unexpectedly granted.
3. `src/bdp/ingestion/parcelVerifiedGeometryDependencies.test.mjs` has **16 NEW synthetic no-database tests** covering a full three-principal private first page, signed continuation, authoritative session denial and post-read revocation, missing/ambiguous sealed runs, caching revocation or immutable seal changes, separate GIS review expiry/revocation/revision, SQL privilege drift for every dedicated principal, quota, malformed input, cancellation, no polygon delivery and no public transport.

All new behavior is dependency composition and **synthetic** verification. Production session issuance/rotation/logout, persistent MFA and county grants, secure cookie transport, actual least-privileged SQL LOGINs and secrets, connection cancellation/backpressure, GIS licensing, monotonic revocation revision counters, transaction coherency, real GIS source enrollment/ingest and operator monitoring are still missing. The two independent policy reads and geometry SQL do **not** share one atomic database snapshot: pre/post checks mitigate some revocations but do not eliminate races/ABA (revoke/reapprove to identical values). Do NOT mount this factory in a public API or enable browser geometry.

## PowerShell operator checks, in order

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelVerifiedGeometryDependencies.test.mjs src/bdp/ingestion/parcelSealedGeometryRuntime.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **31 focused tests** (16 new three-principal integration + 15 previously existing geometry runtime tests), pending local execution. Based on the prior **819/819** suite and 16 additional discovered cases, the new land suite may reach **835/835**; do not mark it passed until verified.

**No new disposable PostGIS smoke was added in this step** because the source and publication SQL LOGINs were separately verified by their own real disposable tests in Steps 40C-35/36. This step tests in-process wiring synthetically only; **three simultaneously authenticated real PostGIS connections plus multi-transaction revocation coherence remain unverified**. Do not apply migrations or create/grant any production DB role for this step.

## Next: Step 40C-38 (design only)

Pin the geometry-only DB principal's exact LOGIN identity and prohibit all other index RPCs, then design isolated multi-connection integration with active cancellation, revocation epoch/version coherence and transaction boundary review before any real deployment. The larger Step 40D incremental Cesium rendering phase remains separately planned.

Original God’s Eye View/Cesium UI, **2.4 km Free Explorer handoff**, Travis County CAD browser overlays, and Property Intelligence panel remain unchanged.
