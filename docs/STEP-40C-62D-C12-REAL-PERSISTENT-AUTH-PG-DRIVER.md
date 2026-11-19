# Step 40C-62D-C12 — Real restricted node-postgres connection to persistent local auth-dev (read-only)

**Status November 18, 2026: C12 SOURCE STAGED on `bdp-development`, operator tests and actual persistent node-postgres SQL connection NOT YET VERIFIED.** The operator reports that the prior C11 **one-time** `-ApplyLocalAuthOnly` operation returned its exact expected PASS, installing `ldos_auth_gateway_login` into persistent local `ldos_auth_dev`. **Never rerun C11 Apply.**

## C12 changes

- `scripts/bdp/app-auth-gateway-installed-preflight.mjs` — exact container/project/port/volume attestation plus **read-only** execution of the existing C11's reviewed SQL **postflight SELECT**. It requires the newly installed restricted SQL LOGIN, precise SET-only membership in `ldos_auth_account_reader`, no inherited/direct table access, and empty accounts, sessions and county grants. Requires `--check-local-auth-only`. No database writes or credentials.
- `scripts/bdp/app-auth-dev-pg-driver-live-check.mjs` — explicit one-shot **server-only** `node-postgres` integration proof (only `--local-auth-dev-only`). Receives the gateway password from standard input, not from argv, environment, HTTP, browser, logs, project files, or GitHub. Accepts only exact `127.0.0.1:54338` / `ldos_auth_dev` / `ldos_auth_gateway_login`. Reuses the existing `createUnroutedAuthDevRoleSwitchPg` adapter and `createUnroutedPrimaryAccountReader`. The adapter uses a pinned real client, `BEGIN READ ONLY`, `SET LOCAL ROLE`, 19 strict privilege booleans and the **fixed parameterized three-column account SQL**; it rolls back before returning the connection. The runner requires the result to be a genuine **empty SELECT** for a fixed synthetic absent UUID (not just a silently caught error). It separately proves the raw LOGIN cannot SELECT account/session/county tables or escalate to postgres, requiring PostgreSQL **SQLSTATE 42501** for denied operations. No SQL data writes or application activation.
- `scripts/bdp/app-auth-dev-pg-driver-live-check.ps1` — Windows DPAPI CurrentUser credential unsealing and scoped child-process stdin bridge. Requires `-VerifyLocalAuthOnly`; `-PlanOnly` is safe/no IO. Executes the C12 installed-role read-only preflight **before** decrypting secrets; refuses absent/reparse-point/oversized DPAPI files. It starts only the fixed Node runner and passes the password in redirected standard input, drains stdout/stderr without showing them on failure, and expects a single exact sanitized PASS line. Node is bounded to a one-minute check. This does not install roles, create users or change PostGIS/Supabase.
- `src/bdp/ingestion/parcelAuthDevLivePgDriver.test.mjs` — **24** source and mocked-Pool security contracts for the exact role and query, fail-closed empty account evidence, raw privilege denial and Windows credential bridge. These tests do **not** substitute for the actual Windows/driver run.

## Operator instructions — Stage A: source and no-write role postflight

In PowerShell at `C:\Users\brand\gods-eye-view`, execute each line **separately**; stop on failure:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevLivePgDriver.test.mjs
node scripts/bdp/app-auth-gateway-installed-preflight.mjs --check-local-auth-only
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\scripts\bdp\app-auth-dev-pg-driver-live-check.ps1 -PlanOnly
```

Expected focused **24/24**, then exact installed gateway confirmation:

```text
PASS: C12 persistent local auth primary, restricted gateway LOGIN and SET-only NOLOGIN reader attested; empty ledger; no database writes.
```

Expected plan-only output:

```text
PLAN: C12 real local node-postgres gateway reader probe through protected stdin; no app accounts or database writes.
```

These are predictions, **not operator verification**.

## Operator instructions — Stage B: actual restricted Node connection (no DB writes)

**Only after Stage A passes**, run:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\scripts\bdp\app-auth-dev-pg-driver-live-check.ps1 -VerifyLocalAuthOnly
```

Expected exact result:

```text
PASS: C12 real restricted node-postgres gateway on local auth-dev; exact primary account read denied for absent synthetic UUID, role-switch privilege proof passed, raw table and role escalation denied; no database writes.
```

If it returns the sanitized C12 failure, **stop, do not rerun C11 Apply or change SQL role grants**. The runner dynamically imports `pg` from the local Node environment; if it is missing, the runtime will fail without connecting. The earlier disposable `pg` driver used a locally installed `pg` module, but its presence is not guaranteed after a fresh checkout. If the only issue is missing `pg`, locally install `npm.cmd install --no-save --package-lock=false pg` as already used in Step 40C-62C, then rerun the **read-only** C12 verification; do not commit package changes.

## Final source regression and build

```powershell
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Predicted land suite with 24 new tests: **1,499** (previous operator-verified 1,475 + 24). Vite chunk-size warnings remain separate nonfatal optimization. These predictions are not actual results.

## Security and product boundaries

This step is a **real local SQL connection test**, not an app-user sign-in endpoint or production authentication service. No real account rows, Supabase user links, MFA verification, licensed county permissions, application sessions, private GIS geometry, property-data release, or public routes. The original God’s Eye View/Cesium UI, 2.4-km Free Explorer, Travis County public parcel boundaries and separate PostGIS are not altered.

**Important remaining risk:** Windows DPAPI CurrentUser is machine/account-dependent, and the password-free globals snapshot is not a full restore drill. Credential rotation/revocation, failure recovery, backend hosting, real user onboarding and auth-to-GIS decision gates must be reviewed before production deployment. Never paste password, DPAPI ciphertext, PG role dump, connection string or real UUIDs into chat.

## Operator build evidence — November 18, 2026

The latest provided PowerShell screenshot confirms that the C12 checkout's **Vite v6.4.5 production build passed** (250 modules, `built in 4.26s`) using `node --max-old-space-size=2048 ... vite.js build`. Vite's large-chunk warning is nonfatal. **The screenshot only shows the build**, not the 24 C12 focused tests, full 1,499-regression result, installed-role preflight, or actual protected node-postgres `-VerifyLocalAuthOnly` success. Until independently reported, **C12 real persistent PG-driver verification remains pending**. Do not enable any authentication API or real-user access on the basis of this build alone.

## Operator full regression evidence — November 18, 2026

The latest PowerShell screenshot confirms **1,499/1,499 complete land tests passed**, **0 failures, 0 skipped, 0 cancelled**, duration ~25.997 seconds. The immediately preceding operator screenshot confirms Vite v6.4.5 built successfully (250 modules, ~4.26 seconds). The provided screenshots do **not** independently establish that the dedicated C12 persistent installed-role preflight and protected real `node-postgres` `-VerifyLocalAuthOnly` driver verification returned PASS. Verify those exact runtime checks before recording C12 integrated PostgreSQL access as complete; no role re-apply or database writes are necessary.

## Operator final C12 persistent driver verification — November 18, 2026

The newest PowerShell screenshot independently confirms BOTH exact expected PASS messages: (1) `node scripts/bdp/app-auth-gateway-installed-preflight.mjs --check-local-auth-only` successfully attested the persistent local auth primary, installed restricted gateway LOGIN, SET-only NOLOGIN reader, empty ledger and no database writes; (2) `powershell.exe ... -VerifyLocalAuthOnly` successfully verified a **real `node-postgres` connection** to persistent `ldos_auth_dev` using the protected credential, exact empty fixed account SELECT for the synthetic UUID, READ ONLY role switch and 19-boolean privilege proof, and denial of raw auth-table access or role escalation. Earlier screenshots independently show **1,499/1,499 full land tests passed** and **Vite build PASS** with the 2-GiB Node old-space setting. Mark C12 **OPERATOR VERIFIED** for this isolated development deployment. It is **not** verification of actual app-user login, account provisioning, MFA, session issuance, county entitlement or GIS/private-geometry release. No persistent authentication rows were created.
