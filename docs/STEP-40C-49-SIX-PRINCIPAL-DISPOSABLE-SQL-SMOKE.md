# Step 40C-49 — Six real SQL principal isolation smoke (STAGED)

**Checkpoint: November 15, 2026. NOT operator validated. NO live database or browser changes.**

## Confirmed prerequisite — Step 40C-48

Operator screenshot confirms **1,057/1,057 complete land-development tests PASSED**, zero failures and **Vite production build PASSED** (250 transformed modules; 5.01 seconds). The screenshot does not include an independent focused 52-case summary, but the complete regression suite includes the staged six-principal synthetic Node tests. This is *not* evidence of an actual six-LOGIN database deployment.

## New implementation

`scripts/bdp/parcel-six-principal-disposable-smoke.mjs` runs ONLY with exactly one `--disposable-only` argument and uses one freshly randomized, separate `postgis/postgis:17-3.5` Docker container:

- Preflights the Docker engine and **already downloaded** PostGIS image, sets `--network none` and `--pull=never`, and exposes **no host ports, bind mounts, persistent volumes or production DB connection**. It generates random *synthetic-only* passwords and uses six actual independent SCRAM-authenticated PostgreSQL LOGINs. It does **not** use `SET ROLE` to impersonate six identities.
- Installs the existing reviewed *draft SQL* and fabricated parcel/session fixtures in that disposable container alone. The initial parcel index/geometry foundation precedes its immutable run seal, source authority, independently reviewed geometry publication, policy-epoch, latest sealed-run epoch, and synthetic session/county epoch RPCs. The temporary approval of fabricated geometry does **not** grant any real GIS redistribution rights.
- Assigns six distinct **least-privilege fixed SQL RPC grants**: sealed source, independent publication review, sealed initial/keyset geometry, source/publication policy epochs, latest finished sealed-run epoch, and synthetic session/county current grant epoch. Each principal is attested from **its actual password-authenticated session** against the pinned PostgreSQL catalog role-proof SQL; one cannot query another principal's RPC or raw source/session tables.
- Verifies unsealed and unreviewed synthetic source denial; after sealing and fabricated publication approval, checks bounded synthetic geometry *counts* while six roles remain independently restricted. For the synthetic county decision, exercises revoke→reapprove (ABA) and demands an incremented session/county epoch; tests independent publication revoke→reapprove and an incremented publication epoch without altering the source-cache revision. Both must be detectable even when the final flags look unchanged.
- Creates a newer FINISHED failed fabricated ingest run and verifies that latest current-run and sealed-source authorities **do not fall back** to a stale older sealed run. Injects extra raw-table privileges separately into the policy reader and synthetic session-epoch reader; each real role's catalog attestation must detect its own privilege drift. Restores grants and checks all six proofs again.
- Uses `finally` to remove only its own randomly named disposable Docker container, including if startup timed out. Database passwords are redacted in operator failure messages. Any SQL assertion failure aborts and does **not** produce a PASS.

`src/bdp/ingestion/parcelSixPrincipalDisposableSmoke.test.mjs` introduces **13 additional Node source/opt-in safety guards**, covering Docker isolation, six distinct password LOGINS, exact function grants, no shared raw-table access, immutable synthetic data, publication and session ABA, failed newer run denial, role proof and cleanup.

During staging, the JavaScript file parsed successfully and **13/13 lightweight simulated source-guard checks** passed. This **does not** mean the real Docker/PostgreSQL smoke has run: its 13 focused tests and the actual six-password-login SQL trial still require operator verification.

## Scope limitations — DO NOT overclaim

This is a **single-container, sequential SQL cross-principal integration smoke**, not a full real Node six-pool count/cursor end-to-end integration and not a simultaneous multi-backend write-race test. Previous synthetic Node tests validate six-reader private count/cursor behavior separately. No real account issuer, MFA/SSO, logout, or authoritative county grant store exists yet. SQL epoch snapshots and pre/post checks are NOT an atomic network response-release decision. There is no commercial GIS redistribution clearance; real county parcel geometry must remain governed by the existing public-source restrictions. No credentials, database role, schema, endpoint, Vite component, or Cesium integration are installed. The original 2.4 km Free Explorer behavior, Travis County browsing and Property Intelligence panel are unchanged.

## Operator checks — PowerShell, one command at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSixPrincipalDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**Expected: 13/13 focused and 1,070/1,070 full land tests** (1,057 last confirmed + 13 new), and a successful build. These new totals are predictions, not yet confirmed.

With Docker Desktop running and `postgis/postgis:17-3.5` present locally, and ONLY after the above are green:

```powershell
node scripts/bdp/parcel-six-principal-disposable-smoke.mjs --disposable-only
```

Expected final line:

`PASS: disposable PostGIS six independent SQL LOGINS, sealed source, publication, geometry, policy/run/session epochs and revocation isolation.`

The process must return normally to PowerShell without an error. **Stop at the first failure and share the error output.** Never apply these draft migrations, synthetic approval records, or smoke role credentials to an actual database.

## Step 40C-50 candidate

Plan and audit a **real identity-provider boundary** and strongly current account/MFA/logout/county-grant revocation store, then specify a final release/abort linearization mechanism and review the legal GIS redistribution agreements. Do not route private geometry to HTTP or a browser until these are implemented and independently security-reviewed.
