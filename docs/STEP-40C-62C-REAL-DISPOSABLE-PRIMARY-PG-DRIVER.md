# Step 40C-62C — Real restricted PostgreSQL driver to account-reader integration (disposable)

**Checkpoint: November 17, 2026 — OPERATOR VERIFIED 1,306/1,306 full land regressions, Vite production build and ACTUAL disposable PostgreSQL driver smoke PASS. Focused 19-test summary not separately visible.** No permanent database, live Supabase migration, browser login, MFA authorization, county grants, GIS geometry release or public API deployed.

## Operator-confirmed 40C-62B

Operator screenshot confirms **1,287/1,287 complete land regression tests PASS**, 0 failures/skips, and Vite production **build PASS** (250 modules, 8.26 seconds). This establishes the **fixed SQL account-reader contract** after the UUID correction, but not a live PostgreSQL connection.

## Step 40C-62C adds a real PostgreSQL driver test

**`scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs`** is an explicitly operator-opted-in real PostgreSQL integration probe. It requires **exactly `--disposable-only`** before any network/database action, and dynamically imports a locally installed copy of `pg` (node-postgres). The script does not require Supabase or any real user credentials.

It performs the following in a brand-new, randomly named Docker container:

1. Confirms Docker Desktop is responsive and local `postgis/postgis:17-3.5` is present (reuse of previously tested local image; PostGIS extensions are not enabled).
2. Creates an **ephemeral container on Docker's standard bridge**, publishing a **randomized TCP port to `127.0.0.1` only**. No named volumes, mounts, external DB URL, production account/user tokens, or existing containers are ever used. A published random local port is needed for the *actual node-postgres TCP client*, unlike earlier entirely networkless SQL tests.
3. Applies the existing, unmodified Step 40C-57 authorization-ledger **draft SQL inside the new disposable database only**, creates one synthetic fixed UUID account, and generates a new synthetic PostgreSQL password for a restricted, non-superuser/no-BYPASSRLS `ldos_auth_account_reader` LOGIN.
4. Grants the synthetic reader **schema USAGE and SELECT on only `ldos_app_auth.accounts`**. There is no SELECT on sessions/county grants, no DML on accounts, and no role/admin rights.
5. Uses the **actual `pg.Pool` driver** to connect to that new local-only server. Every client checkout performs a **fixed SQL privilege attestation** on the same client: exact session/current role identity, safe non-admin status, on-primary (not standby), account read permission, absence of account mutations, schema CREATE, session and county-grant rights.
6. Invokes our new Step 40C-62B **fixed parameterized account reader SQL**, confirming a new account is denied by default; activation yields only `subject`, `account_state`, and **revision 2**; suspension denies; restored account yields **revision 4** (ABA protection). Wrong UUID and cancelled request deny. An unrelated raw sessions/county-grants query, account INSERT/UPDATE, schema CREATE and role escalation must fail for the actual restricted password-authenticated LOGIN.
7. Checks there are zero sessions and zero county grants, closes the `pg` Pool, and removes the entire disposable Docker container and its ephemeral storage in `finally` on normal or error exit. Prints one fixed, synthetic-only PASS message if all checks succeed. Failures produce a sanitized phase label and cannot disclose credentials or SQL.

This is a **real driver-to-Postgres network connection and real SQL ACL test**, not a production database, durable app account, independent MFA proof, user app-session or licensed GIS authorization. Operator confirmation is required before any real DB connection is asserted to have passed.

**`src/bdp/ingestion/parcelPrimaryPgDriverDisposableSmoke.test.mjs`** adds **19 Node unit and source-security contracts** for opt-in, strict localhost/port, adapter settings, exact canonical SQL, role attestation every checkout, malformed/cancelled requests, pool closure, no leak, and disposable Docker isolation. The committed source was exercised with an in-context JS mock harness: **19/19 passed**. This does **not** replace operator Node or Docker testing.

## Operator validation — PowerShell

Run one line at a time from `C:\Users\brand\gods-eye-view`:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrimaryPgDriverDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected focused **19/19**, predicted full land tests **1,306/1,306** (prior confirmed 1,287 + 19), and a green Vite production build. All are **predictions until operator confirmation**. None of these initial tests starts Docker or needs credentials.

Then ensure Docker Desktop is running, and run **only**:

```powershell
node scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs --disposable-only
```

If the result is `Local pg driver is not installed (install pg locally first)`, install node-postgres **locally only** without changing tracked package manifests:

```powershell
npm.cmd install --no-save --package-lock=false pg
```

Then retry the exact disposable-only command. The local image `postgis/postgis:17-3.5` must already be available (it was previously downloaded for earlier disposable tests).

Expected:

`PASS: disposable real pg driver and restricted primary account reader; deny-first, exact UUID/revision, revocation, no sessions, no counties, no GIS.`

It must return cleanly to the PowerShell prompt. If it fails, stop and share **only sanitized output** (no passwords, URLs, keys or user IDs). Docker cleanup warnings must be investigated before retrying. This script **does not** contact or modify `bdp-postgis` or Supabase.

## Operator verification — November 17, 2026

Operator PowerShell screenshot confirms **1,306/1,306 complete land tests PASS**, 0 failed, 0 skipped and 0 cancelled; **Vite production build PASS** (250 transformed modules, 16.72 seconds); and the actual `node scripts/bdp/app-primary-pg-driver-disposable-smoke.mjs --disposable-only` returned:

`PASS: disposable real pg driver and restricted primary account reader; deny-first, exact UUID/revision, revocation, no sessions, no counties, no GIS.`

This is verified **real node-postgres to a freshly created disposable Docker PostgreSQL instance using a restricted SQL LOGIN and synthetic account**, not a connection to a persistent application DB or Supabase Auth. The targeted 19/19 summary is **not independently shown** in this screenshot, but the full discovered suite passes all 1,306 tests. The screenshot shows the process returned to the PowerShell prompt. The tool should remove the disposable container in `finally`; the screenshot does not independently prove Docker container cleanup. No existing parcel PostGIS/Supabase project was intended to be changed.

## Real, persistent development app database — the next operator-controlled decision

Once 62C actual driver smoke passes, move to creating a **separate local app-owned PostgreSQL dev primary** with its own Docker Compose file, volume, restricted role provisioning, credential handling and approved reviewed migrations. This would introduce persistence and real operator-managed credentials, so it must be a **separate opt-in action**. Do not reuse or alter the existing parcel PostGIS database; do not apply ledger or RPC drafts to Supabase Auth or an external production database.

Still required before production: chosen backend host and database host, narrowly restricted and rotated principal credentials, explicit verified account enrollment/activation, independently verified provider MFA state, session issuance and revocation, source-license/rights review, restore/backup and revision policies, and final response release gating.

**Unchanged:** original God's Eye View/Cesium UI, Free Explorer parcel behavior at 2.4 km, Travis County public browsing, Property Intelligence panel and unknown-evidence fail-closed rules.
