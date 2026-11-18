# Step 40C-62D-C10 — Windows DPAPI local gateway-secret and global-role recovery preparation

**Status: source and 17 source-contract tests staged on `bdp-development`; operator Node/PowerShell runtime verification PENDING. NO database, SQL role, permanent credential or session writes have occurred.**

## Starting evidence (Nov 18, 2026)

The latest operator screenshot confirms **1,415/1,415** land regressions passed, zero failures/skips, and a successful Vite production build (250 modules) using the one-command `--max-old-space-size=2048` workaround. The planned C9 gateway login is **not installed** in the persistent database. The C8 read-only role preflight previously verified empty account/session/county tables, installed NOLOGIN account reader and absent gateway login.

## Why C10 exists

Our current Windows development machine has a persistent `ldos_auth_dev` PostgreSQL database and a previously restored custom-format `pg_dump` archive. That database archive does **not** itself contain all cluster-global role definitions. We need a protected local recovery reference for role declarations as well as a future restricted-login credential *before* any persistent SQL LOGIN migration.

The new **`scripts/bdp/app-auth-dev-protected-recovery.ps1`** has three deliberately explicit modes:

- `-PlanOnly` — no Docker, database or local-file writes. Displays a fixed description.
- `-SealLocalOnly` — **opt-in filesystem creation**, only after separately approved operator verification. Re-runs the exact C8 read-only identity/role/empty-ledger preflight, calls **`docker exec ldos-auth-dev-auth-postgres-1 pg_dumpall -U postgres --globals-only --no-role-passwords`** (read-only export), verifies it includes the canonical NOLOGIN reader and no gateway role, generates 32 cryptographically random bytes as an unused future gateway password, and encrypts the credential and the no-password global-role snapshot separately using **Windows DPAPI CurrentUser**. Stores two new protected files under `$HOME\ldos-local-secrets`, **not inside the Git repository**. The directory is configured with explicit current-user and SYSTEM access. The script rejects existing files and does not overwrite them.
- `-CheckSealsOnly` — no database access. Uses DPAPI CurrentUser to decrypt and validate both artifacts under the same Windows account; it does not print any credential or role SQL.

The script does not create or modify SQL roles, PostgreSQL passwords, application users, sessions, county grants, Supabase Auth, parcel PostGIS, browser routes or GIS permissions. No sensitive materials should be pasted into ChatGPT or committed to GitHub.

**Important recovery limits:** Windows DPAPI CurrentUser protects material under the current Windows user context. The encrypted files are generally **not portable to another Windows account or machine** without an approved OS recovery process. The globals snapshot explicitly excludes role password hashes; recovering the database would require a separate approved password reset/rotation procedure. An integrity/decryption test is **not** a full role restore drill. A Windows PowerShell runtime audit is required before executing the sealing mode.

## Operator Phase A — safe offline checks only

From `C:\Users\brand\gods-eye-view`:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevProtectedRecovery.test.mjs
powershell.exe -NoProfile -NonInteractive -File .\scripts\bdp\app-auth-dev-protected-recovery.ps1 -PlanOnly
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

**Predicted:** 17/17 focused Node tests and full suite **1,432** (1,415 previously confirmed + 17), zero failures, successful Vite build. Expected plan-only text:

```text
PLAN: C10 Windows DPAPI local gateway secret and password-free global-role recovery snapshot; no SQL writes; C8 preflight required before creating protected files.
```

The test suite is source-only; it does NOT exercise the Windows DPAPI operation. The PowerShell plan-only run is a lightweight parse/runtime proof that creates no files. If PowerShell execution policy blocks the local script, stop and report the error; do not change machine-wide execution policy.

## Operator Phase B — not yet authorized

Do **not** run `-SealLocalOnly` or `-CheckSealsOnly` until Phase A results are inspected. If a later separately approved seal runs, verify the two protected files exist, then run the local DPAPI decrypt check in the same user context. Preserve existing `pg_dump` backup outside the repository. Never run `pg_dumpall` without the `--no-role-passwords` option as part of this workflow and never publish role dumps, password hashes, or credentials.

Afterward, separately stage/prove a privileged SQL LOGIN migration, real independent `pg` driver connection, credential rotation and revocation, controlled account enrollment, MFA, county authority and licensed GIS response gating. Nothing in C10 enables private parcel delivery or changes our original Cesium UI.
