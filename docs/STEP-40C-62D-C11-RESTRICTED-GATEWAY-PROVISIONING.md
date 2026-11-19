# Step 40C-62D-C11 — Guarded restricted gateway login: staged operator checks and disposable proof

**Status November 18, 2026: IMPLEMENTATION STAGED in `bdp-development`. No PostgreSQL gateway LOGIN has been provisioned in the persistent auth-dev database. Actual Windows PowerShell execution, complete regression and disposable SQL tests require operator verification. DO NOT RUN APPLY YET.**

## Preceding operator evidence

The operator reports C10 completed all three previously requested tasks: the two DPAPI target paths were absent, `-SealLocalOnly` succeeded, and `-CheckSealsOnly` succeeded. These protected local files contain an unused future gateway password and a no-passwords PostgreSQL globals snapshot. They are tied to the current Windows account and **are not a complete, portable recovery procedure**. C10 did not create a SQL LOGIN.

Prior operator proof: 1,432 land tests passed and Vite built with `--max-old-space-size=2048` before the later four focused C10 source tests were added. C10's DPAPI in-memory canary and protected file seal/decrypt were separately reported successful.

## New C11 implementation

- **`scripts/bdp/app-auth-dev-gateway-provision.ps1`** stages the Windows-only, isolated local auth-dev database migration. It accepts exactly one of `-PlanOnly`, `-ValidateLocalAuthOnly`, or `-ApplyLocalAuthOnly`. Only **Apply** may modify PostgreSQL. Neither Plan nor Validate creates files, credentials, roles, accounts, sessions or grants.
- Plan prints a fixed plan with no DB or filesystem access. Validate re-runs the C8 exact healthy Docker target and current-primary/reader-ACL/empty-ledger preflight, decrypts both DPAPI files only inside the local process, checks the no-passwords global-role snapshot and 64-hex gateway credential, verifies PostgreSQL's `scram-sha-256` password-hashing setting and constructs guarded, static SQL in memory; it does **not** submit this SQL for execution.
- Apply (separate operator decision **not yet authorized**) performs the same preflights before sending the exact transactional SQL **over Docker/psql redirected standard input**, never a password-bearing command-line argument. It grants one restricted `ldos_auth_gateway_login` LOGIN with `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, and only `GRANT ldos_auth_account_reader TO ldos_auth_gateway_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`. Existing canonical reader remains NOLOGIN. No table, GIS or HTTP access is granted.
- DB-side guard checks exact `ldos_auth_dev` primary, SQL operator, absent gateway, unprivileged NOLOGIN reader, empty `accounts`/`sessions`/`county_grants`, no candidate RPC, and `scram-sha-256`. It uses short transaction timeouts and refuses unknown state. Its read-only postflight checks login attributes, exact role membership, no effective direct schema/table read privileges and unchanged empty ledger. Errors are sanitized. **Any failure after attempted Apply requires inspection; never blindly retry.**
- `src/bdp/ingestion/parcelAuthDevGatewayProvision.test.mjs` adds **21 source contracts**, checking refusal modes, DPAPI, no password on argv, fixed Docker target, gated SQL, and privilege postflight.

## Exact SQL rehearsal, no persistent mutation

- **`scripts/bdp/app-auth-gateway-provision-disposable-smoke.mjs`** extracts the C11 SQL heredoc and postflight from the source and runs them only in a brand-new randomly named **`postgres:17`** container. The container uses **`--network none`**, no host port, no persistent volume, no mounts, no real DPAPI secret or account identity. The script loads the original ledger and C5 reader, uses a fresh random synthetic gateway password, executes the exact C11 SQL, confirms restricted password login, NOINHERIT and `SET LOCAL ROLE` under a READ ONLY transaction, checks all 19 authorization attestation booleans, denies direct table access and duplicate role creation, then removes only its own container.
- `src/bdp/ingestion/parcelAuthDevGatewayProvisionDisposableSmoke.test.mjs` adds **18 offline test contracts**.
- Neither script is an HTTP route, application login, MFA proof, Supabase migration or GIS publication.

## Operator Phase A — validate source and protection only

From `C:\Users\brand\gods-eye-view`, in the existing PowerShell window, run separately and stop on any failure:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevGatewayProvision.test.mjs
node --test src/bdp/ingestion/parcelAuthDevGatewayProvisionDisposableSmoke.test.mjs
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\scripts\bdp\app-auth-dev-gateway-provision.ps1 -PlanOnly
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\scripts\bdp\app-auth-dev-gateway-provision.ps1 -ValidateLocalAuthOnly
```

Expected: focused **21/21**, **18/18**, and fixed plan/validation messages:

```text
PLAN: C11 exact local auth-dev gateway LOGIN migration prepared; validate protected inputs and current SQL permissions before separately approved apply; NO database changes.
PASS: C11 protected gateway credential and local auth-dev primary/role preflight verified; no database writes.
```

These checks are **not proof of role installation**. They cannot expose or modify accounts, sessions or GIS information; do not paste plaintext passwords or role dumps.

## Phase B — disposable PostgreSQL 17 and regression verification

Only if Phase A passes, run:

```powershell
node scripts/bdp/app-auth-gateway-provision-disposable-smoke.mjs --disposable-only
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected disposable result:

```text
PASS: C11 exact gateway SQL verified in isolated PG17; synthetic LOGIN, SET-only NOLOGIN reader, full privilege attestation, no direct table rights, duplicate-apply denial; persistent auth-dev untouched.
```

Predicted full regression count if no other files change: **1,475** (prior 1,432 + four later C10 tests + 21 C11 tests + 18 disposable tests). Prediction is not operator confirmation. Retain Vite's nonfatal chunk warning as a separate optimization task.

**Do not execute `-ApplyLocalAuthOnly` yet.** First review the actual Phase A and B evidence and the DPAPI/global-role recovery caveats. A persistent gateway SQL LOGIN still does **not** authenticate a real Supabase user, verify MFA, provision accounts, authorize county access or release private geometry; those remain separate workstreams. Existing God’s Eye View/Cesium UI, 2.4-km Free Explorer and Travis County public parcel screen remain unchanged.

## Operator verification update — November 18, 2026

Latest provided PowerShell screenshot confirms **1,475/1,475 complete land tests passed**, with **0 failures, 0 skips and 0 cancellations**, followed by a **successful Vite v6.4.5 production build** (250 transformed modules; approximately 4.24 seconds) using a 2,048-MB Node old-space limit. The large-chunk warning is nonfatal. The screenshot does **not** show the separate C11 `-PlanOnly`, `-ValidateLocalAuthOnly`, or `--disposable-only` actual PostgreSQL smoke-test results, so those gates must be confirmed separately before considering any persistent role migration. No gateway LOGIN installation is verified.

## Operator runtime proofs — November 18, 2026

Operator PowerShell screenshot independently confirms the Windows local **`-ValidateLocalAuthOnly`** operation returned exactly `PASS: C11 protected gateway credential and local auth-dev primary/role preflight verified; no database writes.` The real isolated PostgreSQL 17 C11 SQL rehearsal returned exactly `PASS: C11 exact gateway SQL verified in isolated PG17; synthetic LOGIN, SET-only NOLOGIN reader, full privilege attestation, no direct table rights, duplicate-apply denial; persistent auth-dev untouched.` The prior screenshot also confirms 1,475/1,475 full land tests and Vite production build passed. These runtime proofs satisfy C11 pre-apply development gates. They **do not mean a persistent gateway LOGIN exists yet**. The separate operator-controlled one-time persistent migration remains pending.
