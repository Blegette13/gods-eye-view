# Step 40C-48 — Six-principal private synthetic session/county revision integration

**Checkpoint: November 15, 2026. STAGED / UNROUTED / NOT DEPLOYED / OPERATOR VALIDATION PENDING.**

## Step 40C-47 verified

Operator screenshots confirm **1,037/1,037 land-development regression tests PASSED**, **Vite production build PASSED** (250 modules, 4.13 seconds) and a **real disposable PostGIS session/county epoch-only SQL smoke PASS with clean exit**. The 27-case focused summary was not separately shown. These results validate synthetic tests and an isolated SQL-login proof, NOT actual sign-in, real MFA, a production account authority or legal GIS redistribution.

## Step 40C-48 source additions

1. `server/providers/bdp-parcel-six-principal-geometry-dependencies.js` creates a new PRIVATE, server-only, deny-default **six-distinct-identity composition**. The first five independently attested roles retain their established fixed SQL authorities: sealed source, independent legal publication review, sealed geometry-only read, source/publication policy epochs, and latest FINISHED sealed-run epochs.
2. The sixth must be a **separately pinned and attested `ldos_parcel_session_epoch_...` SQL account** using the Step 40C-47 `createPinnedPrivateSessionCountyEpochRpcExecutor` and strict `createPrivateSessionCountyEpochReader`. The SQL reads ONLY the synthetic session digest/county/positive epoch joined to four current synthetic grant flags. The new factory prohibits caller-provided `readSessionCountyEpoch` or `readSealedRunEpoch` callbacks and any unrelated input fields. All SIX connection factories and login names must be pairwise distinct.
3. The new factory binds the separately derived current-session epoch reader into the existing five-principal private runtime. The latter checks source, publication, session/county grant revision and current sealed run before a bounded geometry SQL query, then rechecks them before returning a PRIVATE count + opaque HMAC cursor. Missing, conflicting, revoked, changed or malformed session epoch rows deny output. A session grant A→B→A version change invalidates a just-read page and a previously signed cursor even if current flags look identical. The returned API remains **`readPrivatePage` only**; no rows, coordinates or public HTTP transport.
4. `src/bdp/ingestion/parcelSixPrincipalGeometry.test.mjs` adds **20 new synthetic integration tests** by extending the established five-principal harness with a sixth independent fixed SQL-login/role attestation, exact digest and county RPC arguments, duplicate/missing/malformed session epochs, privilege drift, pre/post synthetic ABA and stale signed cursor handling, and fail-closed cancellation and invalid dependencies.

**Expected full land regression tests: 1,057/1,057** (1,037 confirmed in Step 40C-47 + 20 new tests). The new JavaScript modules passed **source syntax inspection**, but the 20 new tests, 1,057-test suite and Vite build have **NOT yet been run by the operator**. This stage does NOT provision any of the six actual database identities; each previous PostGIS disposable login was tested separately, not together in a real shared deployment.

## Critical limitations

**Six independent SQL checks are NOT equivalent to real authentication or linearizable authorization at the network release boundary.** The synthetic `ldos_private_auth` tables are not connected to actual login issuer, logout, MFA lifecycle, account disablement, county grant administration, or any real grant authority. The `findSessionByDigest` callback is still a trusted synthetic collaborator. This composition must stay UNROUTED and cannot deliver GIS geometry to browsers until those operations and a final output-release boundary are implemented, reviewed, and exercised. There is also no verified commercial GIS redistribution license, survey, zoning clearance, complete parcel inventory, or right to publicly release a polygon.

The inherited God's Eye View/Cesium interface, 2.4 km Free Explorer cutoff, Travis County public CAD browsing and Property Intelligence panel remain unchanged.

## Operator commands — existing repository PowerShell, one at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSixPrincipalGeometry.test.mjs src/bdp/ingestion/parcelFivePrincipalGeometry.test.mjs src/bdp/ingestion/parcelSessionCountyEpochReader.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**Predicted:** **52/52 focused** (20 + 14 + 18), **1,057/1,057 full**, and a successful production build. These are not yet verified. Stop at the first failure and share the actual output. There is no new PostGIS Docker smoke required in this step; a true six-login real-database integration test remains future work. **Do NOT install or migrate the staged synthetic SQL into a development or production database**.

## Proposed Step 40C-49

Build a fresh, disposable, strictly network-isolated PostgreSQL suite with six separate real login accounts and a single consistent synthetic fixture, verifying cross-role privilege boundaries, the exact end-to-end six-role private count/cursor flow, explicit denial on revoked/missing synthetic grants, independent publication changes, and full cleanup. Document that even such a test does not establish a real user identity provider, legally approved GIS license or race-free network release authorization.
