# Step 40C-62D-C8 — Read-only persistent gateway readiness attestation

**Status November 18, 2026: source and 12 offline security-contract tests staged on `bdp-development`. Operator verification PENDING; no database writes performed by this stage.**

## Verified operator evidence preceding this step

The operator's latest PowerShell screenshot shows the Step C7 regression run completed **1,388/1,388 tests, zero failures and zero skips**, a successful Vite production build (250 modules) using `node --max-old-space-size=2048`, and a passing real PostgreSQL 17 `--disposable-only` role-switch SQL smoke. It proved restricted password LOGIN -> NOLOGIN reader, read-only local role switching, privilege evidence, deny-first states and monotonic ABA revisions **in a disposable PostgreSQL instance only**. It did not create or connect any persistent gateway LOGIN.

## New zero-write runtime

`scripts/bdp/app-auth-local-gateway-preflight.mjs` accepts **only `--check-local-auth-only`**.

- Rechecks the same exact Compose project/service/image/loopback-port/volume/healthy-container attestation used for the two approved local schema migrations.
- Uses only `docker inspect` and **read-only PostgreSQL SELECT** commands through the existing local container.
- Proves target database is `ldos_auth_dev`, current backend is a primary, SQL operator is `postgres`, the proposed gateway SQL LOGIN **does not yet exist**, and candidate RPC is absent.
- Asserts that the `accounts`, `sessions`, and `county_grants` tables remain empty.
- Reuses the exact Step C5 `POSTFLIGHT_SQL` verification to attest existing canonical `ldos_auth_account_reader` is NOLOGIN, NOINHERIT, least-privileged, with only three approved account SELECT columns and no session, county or other forbidden privileges.
- Emits a fixed PASS message or a sanitized phase error. It creates no credentials, new roles, app accounts, users, sessions, county entitlements, HTTP endpoints or GIS privileges. Does not connect to Supabase, parcel/PostGIS or the browser UI.

## Operator commands

From PowerShell in `C:\Users\brand\gods-eye-view`, run each separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevGatewayReadiness.test.mjs
node scripts/bdp/app-auth-local-gateway-preflight.mjs --check-local-auth-only
```

**Expected, not yet verified:** 12/12 focused checks and:

```text
PASS: local persistent auth-dev primary and NOLOGIN account-reader privileges verified; gateway LOGIN absent, ledger empty, candidate RPC absent; no database writes.
```

Stop if a step fails. **Do not attempt to rerun earlier migrations or create a gateway user.** As this milestone introduces only a read-only probe and tests, the previous complete 1,388-test regression and successful build remain the current operator evidence; after incorporating new source, the predicted count for another full run is 1,400 (not required in the first C8 operator verification).

## Next separate decision: provisioning a dedicated SQL LOGIN

Only if this preflight passes, separately design and test: randomized gateway password generation, secret retention outside source control and process arguments, a PostgreSQL 17 `LOGIN NOINHERIT` with no direct table rights, one exact `SET TRUE, INHERIT FALSE, ADMIN FALSE` reader-role membership, runtime client privilege attestation, role/password rotation and revocation, and verified transport bounds. Apply to the persistent `ldos_auth_dev` only after **explicit operator review and approval**, with a backup/restore plan for role/global objects (ordinary `pg_dump` of a database does not by itself capture cluster-wide roles).

The persistent auth database remains separate from Supabase Auth, parcel PostGIS and the public Cesium 2.4-km Free Explorer. Application account enrollment, real MFA, county privileges, licensing and GIS data release are still unimplemented.
