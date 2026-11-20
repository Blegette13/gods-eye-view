# Step 40C-62D-C10 — Windows DPAPI local gateway-secret and global-role recovery preparation

**Status November 18, 2026: operator verified 17/17 focused Node source contracts, 1,432/1,432 land tests (0 failures/skips), Vite build PASS with 2,048-MB old-space heap, and subsequently confirmed Windows PowerShell `-PlanOnly` PASS. DPAPI `-SealLocalOnly` / `-CheckSealsOnly` have NOT been run or verified; no local secret file or database mutation confirmed.**

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

## Operator C10 source/test/build result — November 18, 2026

Screenshots confirm **17/17 C10 focused source tests** passed, **1,432/1,432 full land tests** passed with zero failures/skips/cancellations, and **Vite v6.4.5 build PASS** (250 transformed modules, 4.18 seconds) with a one-command Node heap limit increase. An earlier `powershell.exe -File ... -PlanOnly` attempt was blocked by the Windows execution policy; the newest screenshot shows only test/build output, not a successful `-PlanOnly` run. **Do not claim that DPAPI runtime or the script plan has been validated until a separate non-mutating PowerShell execution succeeds.** No secret files should be generated until runtime review.

## Subsequent operator plan result — November 18, 2026

The operator subsequently reported that the non-mutating Windows PowerShell `-PlanOnly` invocation passed after the earlier Windows execution-policy block. This confirms the plan entry can run on their Windows setup; it **does not** validate DPAPI encryption, global-role export, filesystem ACLs, or either protected recovery file. A later separately operator-initiated `-SealLocalOnly` pass and `-CheckSealsOnly` pass are required before declaring protected recovery ready. Never print/decrypt secret material into shared screenshots or paste it into chat.

## Windows PowerShell 5.1 DPAPI type-loader fix — November 18, 2026

The operator's first **`-SealLocalOnly`** attempt failed with `Unable to find type [Security.Cryptography.ProtectedData]` at the first in-memory encryption call. On Windows PowerShell 5.1 (.NET Framework), the type resides in `System.Security.dll` and may not be loaded until explicitly requested. The script reached this call after its C8 database preflight and password-free globals export, but **before** creation of its local directory and two DPAPI files. No database mutation was attempted by this workflow. Confirm that the two expected encrypted files are absent before retrying.

The source has been updated to load `System.Security` in Windows PowerShell Desktop and to introduce **`-ProbeDpapiOnly`**, a no-filesystem, no-PostgreSQL, public-canary encrypt/decrypt round-trip gate. Four additional offline security-contract tests were added (focused count **21**, complete land suite predicted **1,436**). The updated Node source contracts have been evaluated under an isolated JS assertion harness **21/21**, but the Windows PowerShell runtime and operator checkout remain **UNVERIFIED**. No secrets should be sent to chat.

Safe verification sequence (after `git pull --ff-only origin bdp-development`):

```powershell
node --test src/bdp/ingestion/parcelAuthDevProtectedRecovery.test.mjs
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\scripts\bdp\app-auth-dev-protected-recovery.ps1 -ProbeDpapiOnly
```

Expected probe: `PASS: C10 Windows DPAPI in-memory round-trip verified; no files or database accessed.` Confirm both `$HOME\ldos-local-secrets\auth-gateway-v1.dpapi` and `auth-globals-no-passwords-v1.dpapi` are absent before a separately operator-directed seal retry. The new probe never accesses the database or recovery directory. If it fails, stop; do not weaken the execution policy or continue to `-SealLocalOnly`.

## Operator DPAPI canary result — November 18, 2026

The operator reports that the revised **21 focused source tests** and the Windows PowerShell **`-ProbeDpapiOnly` in-memory encryption/decryption canary** passed after the `System.Security` assembly fix. This validates the local DPAPI API canary, not the persistent protected file creation. **`-SealLocalOnly` and `-CheckSealsOnly` remain pending**. Check explicitly that neither of the two target `.dpapi` files already exists before the separately opted-in seal. The prior type-loading failure happened before file creation but it is safer to verify filesystem state rather than assume absence.

## Operator sealed-files verification — November 18, 2026

The operator reports **all three requested steps completed**: both prospective protected-file paths were checked absent, `-SealLocalOnly` produced its successful result, and `-CheckSealsOnly` validated decryption and data shape under the Windows account. Treat C10's local encrypted-file creation/validation as operator-verified. This does **not** prove recovery on another device/account, a full PostgreSQL global-role restoration, role/password rotation, or a connected production login. No PostgreSQL role changes occurred in this C10 sealing workflow.

Next phase: separately review and validate provisioning of the restricted `ldos_auth_gateway_login` SQL LOGIN, which is still absent from the persistent auth-dev database. The two DPAPI files must never be uploaded, committed or printed.
