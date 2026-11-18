# Step 40C-62D-C6 — Unrouted local auth-dev role-switch PG gateway (SOURCE ONLY)

**Status November 18, 2026: STAGED IN GITHUB, NOT CONNECTED TO PERSISTENT AUTH DB.** The operator reports Step C5 restricted `NOLOGIN` reader migration PASS, following an isolated backup/restore drill. This is operator-reported local status, not a GitHub deployment or public authentication release.

## What is staged

- `server/providers/bdp-auth-dev-role-switch-pg.js` — an unmounted, server-only, injectable node-postgres Pool adapter compatible with the existing fixed `PRIMARY_ACCOUNT_SQL` and `createUnroutedPrimaryAccountReader` from Step 40C-62B.
- `src/bdp/ingestion/parcelAuthDevRoleSwitchPg.test.mjs` — **17 source and mocked-Pool tests**.
- Only the exact auth-dev loopback endpoint `127.0.0.1:54338`, database `ldos_auth_dev`, and separate `ldos_auth_gateway_login` would be accepted. No browser, API, real client credentials, GIS or new persistent SQL role is created.
- The existing `ldos_auth_account_reader` stays **NOLOGIN**. The proposed future gateway LOGIN is intentionally **not provisioned**. For a later reviewed PostgreSQL 17 grant, it would require an explicit, non-inheriting role membership with `SET TRUE, INHERIT FALSE, ADMIN FALSE` and no other memberships.
- Each future fixed account read uses **one pinned pooled client**, `BEGIN READ ONLY`, `SET LOCAL ROLE ldos_auth_account_reader`, a same-transaction strict privilege attestation and the one approved parameterized account lookup, then `ROLLBACK` before returning the session to the pool. Role or cleanup uncertainty is denied and the connection is evicted when rollback fails.
- The SQL attestation checks the current primary, exact login/effective role, role attributes and membership, exact account column SELECT rights, and denial of `created_at`, account writes, session/county reads, guard-function calls and candidate RPC presence. This is runtime defense-in-depth, not independent authorization or proof of an actually provisioned role.
- Building/importing the source does not connect to any DB. The file remains **unrouted** until separately reviewed provisioning, synthetic real-PG tests and explicit server-side identity and consent checks are complete.

## Operator Phase A — source-only verification (NO DB WRITES)

In PowerShell, from `C:\Users\brand\gods-eye-view`:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevRoleSwitchPg.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected focused **17/17**, predicted full land suite **1,372** (the operator previously reported 1,355 + 17), zero failures and a successful Vite build. Local Node mocked-Pool tests previously passed 17/17 in a standalone copy, but the operator has **not** confirmed the connected checkout or full regression build for this stage. Do **not** run any SQL migration or create a gateway database account yet.

## Release and security gates still open

A separately approved disposable real PostgreSQL integration proof using the actual NOLOGIN account reader plus `SET LOCAL ROLE`, a restricted LOGIN credential provisioning and rotation plan, live server-held driver validation, primary backup/recovery and robust identity/MFA verification must precede actual application account access. No app sessions, entitlements, private geometry, GIS redistribution, public endpoints or paid access may be enabled by this adapter alone.

**Unchanged:** original Cesium UI, 2.4-km Free Explorer, Travis County property boundaries, public parcel browsing and separate land PostGIS.
