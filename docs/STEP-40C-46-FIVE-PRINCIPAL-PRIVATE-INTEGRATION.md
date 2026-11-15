# Step 40C-46 — Fifth-principal current sealed-run proof inside the PRIVATE geometry boundary

**Status: SYNTHETIC STAGE OPERATOR-VALIDATED / UNROUTED / NOT DEPLOYED. Checkpoint: November 15, 2026.**

## Step 40C-45 confirmed

Operator screenshots show **30/30 focused tests**, **996/996 land-development regression tests**, and a successful **real disposable PostGIS current-sealed-run epoch SQL smoke**. The Docker Desktop server became responsive; the missing `postgis/postgis:17-3.5` image was downloaded; the SQL smoke printed PASS and returned to PowerShell cleanly. The last separately shown production build succeeded earlier in the Step 40C-45 sequence; no fresh build screenshot accompanied the Docker fix. This confirms **synthetic** database security behavior, not live rights, authentication or public parcel delivery.

## Source-controlled Step 40C-46 changes

1. `server/providers/bdp-parcel-five-principal-geometry-dependencies.js` creates a **new, explicit five-SQL-principal composition** with no HTTP, public geometry or database migration. Required separately provisioned factories:
   - sealed source authority;
   - independent GIS redistribution publication review;
   - sealed geometry-only reader;
   - source-cache and publication rights epoch reader;
   - **new fixed current sealed-run epoch-only reader**, which uses `createPinnedPrivateCurrentRunEpochRpcExecutor` and `createPrivateCurrentSealedRunEpochReader` from validated Step 40C-45.

   The factory demands five **distinct connection factory functions and SQL login strings**, separate HMAC keys and a trusted session/county epoch callback. All inputs are strictly allowlisted. In particular, it **rejects any caller-provided `readSealedRunEpoch` function**: the current-run proof is derived only from the pinned, independently attested, fixed SQL role. It does not forward raw clients, polygon rows, SQL statements or arbitrary user-controlled permission values.
2. The existing `createPrivateVerifiedGeometryDependencies` v2 runtime receives this newly derived `readSealedRunEpoch` collaborator. It independently checks current session/county authorization, fresh sealed source, redistribution review, source and review epochs, and **current latest sealed-run epoch** before the fixed geometry query and again afterward. The existing HMAC cursor revision incorporates exact run epochs; a changed latest finished run, a missing seal, an unknown version or an A→B→A source/run change must invalidate the private page and any previously signed private keyset continuation. The exposed method is still **`readPrivatePage`**, returning counts and an opaque signed cursor, **NOT parcel polygons or an authorization-to-publish decision**.
3. `src/bdp/ingestion/parcelFivePrincipalGeometry.test.mjs` adds **14 new synthetic integration/contract cases** for missing/untrusted injected dependencies, all five distinct SQL connections and logins, five role attestations, valid bounded private paging, missing/duplicate/incorrect latest-run proof, independent run epoch ABA, failed revocation, privilege drift, pre/post run changes, stale signed cursor denial, stable cursor continuation, cancelled requests and the absence of HTTP/pool/browser geometry pathways.

**Operator screenshot confirms 50/50 focused tests PASSED**, **1010/1010 full land regression tests PASSED**, and **Vite production build PASSED** (250 modules; 6.34 seconds) with zero failures. This confirms the synthetic five-reader composition, **NOT a real five-LOGIN PostgreSQL deployment**. The new composition has not been verified against five concurrently provisioned real DB logins in one environment. The 40C-45 dedicated run-epoch SQL role was already tested in an independent real disposable PostGIS smoke; connecting it to the five-role private runtime is new and only has synthetic fixture tests so far.

## Mandatory remaining production blockers

All five SQL roles are **design requirements, not provisioned live database accounts**. The Step 40C-43 session/county epoch authority is still a **synthetic table**, not the actual login/MFA/logout/county-grant store. Source caching and legal GIS redistribution must be separately licensed and approved. Actual secure session issuer and county grant revocations, DBA audit of `SECURITY DEFINER` functions, stale read replicas, read/response race tests, consistent cross-store snapshots, non-reusable cursor policy across restores, and a reviewable **final on-wire release authorization gate** are still missing. Even a five-principal private check cannot guarantee that a right is still valid at the later moment when a network response leaves the service. Do not deploy, serve or claim official GIS polygons, complete Travis coverage, legal permission or verified buildability from this staging work.

The original God’s Eye View/Cesium interface, **2.4 km Free Explorer** handoff, Travis County public CAD browsing and Property Intelligence panel are unchanged.

## Operator validation — PowerShell, one command at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelFivePrincipalGeometry.test.mjs src/bdp/ingestion/parcelEpochGuardedGeometry.test.mjs src/bdp/ingestion/parcelCurrentSealedRunEpoch.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **50/50 focused** (14 new + 17 private-epoch + 19 current-run) and **1010/1010 full land tests** if all are discovered. These totals are **predictions, NOT operator-confirmed results**. Stop at the first failure and share the error. No new real PostGIS smoke is required in this milestone. **Do not apply migrations or create roles against the actual land-development database.**

## Next — Step 40C-47

Design an independently authoritative, versioned session/county grant reader (real account lifecycle, MFA, county access, logout), then stage disposable multi-backend race checks against **both** run-selection and legally approved publication-revision epochs. Specify a precise release/abort decision so revocations occurring after a private SQL query do not silently authorize output. No browser geometry or live licensing without independent legal/DBA/security review.
