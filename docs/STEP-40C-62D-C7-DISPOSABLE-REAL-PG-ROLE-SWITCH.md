# Step 40C-62D-C7 — Isolated real PostgreSQL 17 role-switch verification

**Status: source and 16 source-contract tests STAGED on `bdp-development`; operator Node tests and real disposable PostgreSQL test PENDING.** The operator reports the C6 1,372-test gate with no failures and a Vite production build successful only after a one-command 2,048-MB Node old-space override. The original default-memory production build failed with V8 heap exhaustion; that was a resource failure, not verified evidence of a source defect.

## Scope

`scripts/bdp/app-auth-role-switch-disposable-smoke.mjs` creates a **brand-new randomly named `postgres:17` container with `--network none`, no port publishing, no persistent volume, no host mounts**. It applies the already-reviewed original ledger SQL and the C5 NOLOGIN reader migration **inside that disposable instance only**.

The fixture creates a synthetic, randomly passworded restricted `ldos_auth_gateway_login` SQL LOGIN with only an explicit **SET TRUE / INHERIT FALSE / ADMIN FALSE** membership in the NOLOGIN `ldos_auth_account_reader`. It checks real password-authenticated local PostgreSQL access through `docker exec` and `psql -h 127.0.0.1`. The LOGIN must not directly inherit account or session rights and cannot switch to `postgres`.

The smoke opens **READ ONLY** SQL transactions, temporarily switches to the canonical reader role, executes the existing 19-boolean current-primary/privilege attestation and fixed account SELECT through `PREPARE`/`EXECUTE`, then rolls back. The test verifies deny-first suspended account, active epoch 2, suspended epoch 3, active epoch 4, forbidden hidden column/session/county reads and mutations. It destroys **only the new disposable container** on exit. No persistent local DB, Supabase project, real user, county entitlement, parcel/PostGIS database or browser API is involved.

**Limit:** This verifies actual PostgreSQL behavior through the real `psql` client, but it is **not yet a node-postgres (`pg`) driver-to-persistent-auth-dev integration test**. C6's injected source-only adapter remains unmounted and its future gateway LOGIN remains unprovisioned on persistent auth-dev.

## Safe operator validation

In PowerShell, working directory `C:\Users\brand\gods-eye-view`, run individually:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevRoleSwitchDisposableSmoke.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Predicted focused checks **16/16** and complete land suite **1,388** (prior predicted 1,372 + 16), assuming no further changes. Test and build results are **unverified until operator runs them**. The memory flag is per command, not a permanent configuration change.

After those checks pass, and Docker Desktop is available, separately run:

```powershell
node scripts/bdp/app-auth-role-switch-disposable-smoke.mjs --disposable-only
```

Expected:

```text
PASS: disposable PG17 restricted gateway LOGIN -> NOLOGIN account reader; read-only role switch, privilege attestation, deny-first states, ABA epochs and forbidden SQL verified; persistent auth-dev untouched.
```

If an error appears, **stop**, share sanitized phase text and do not blindly repeat. Check for a cleanup warning. No password, token or DB URL should be pasted. The script is intentionally not included in standard test/build commands and cannot run without the one explicit `--disposable-only` flag.

## Next security milestones

Review staged results before any persistent SQL LOGIN/credential provisioning. Continue to require server-side Supabase identity verification, independently verified MFA, controlled enrollment, county licensing, GIS authority and stable migration/restore safeguards before enabling private parcel delivery. Original Cesium UI, 2.4-km Free Explorer and public Travis parcels are unchanged.
