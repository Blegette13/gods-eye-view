# Step 40C-62D-C5 — Stage local NOLOGIN restricted app-account reader

**Status: source code and 16 Node security-contract tests staged on `bdp-development`. Not yet operator-verified or applied to the persistent database.** The operator reported that the isolated candidate-RPC smoke test passed and that the first persistent auth-ledger migration succeeded. These are different environments. The candidate RPC is **not** installed into the persistent database.

## Why this step

The server-side fixed primary account reader in `server/providers/bdp-primary-account-reader.js` requires exactly `ldos_auth_account_reader` and reads only `subject`, `account_state`, and `revision` from `ldos_app_auth.accounts`. It does not require sessions or county grants. The previous migration created the empty deny-first ledger without a role.

This stage adds `scripts/bdp/app-auth-local-reader-role-migration.mjs`. Its reviewed plan creates a **NOLOGIN**, **NOINHERIT**, non-superuser role, grants only `USAGE` on `ldos_app_auth`, and grants column-limited `SELECT` on the three specified account columns. It grants no table writes, account `created_at`, sessions, county grants, candidate-RPC execution, passwords, GIS privileges or application access. Because the role has **NOLOGIN**, it cannot yet be used as the actual PostgreSQL application driver connection; credential provisioning and enabling an independent restricted SQL LOGIN are **separate future reviews**.

## Staged safety behavior

- The only accepted flags are `--plan-only` and `--apply-local-auth-only`.
- **`--plan-only` never invokes Docker or writes to a database.**
- Apply verifies the exact original `postgres:17` Compose service, healthy local container, loopback port, and persistent auth-dev volume through the same strict target-attestation function as the first ledger migration.
- Apply also verifies the exact `ldos_auth_dev` primary, the three empty ledger tables, the absence of the reader role, and the absence of a previously installed candidate RPC. It fails closed on other targets or changed state.
- SQL runs in a single transaction with a database name/current principal/primary/empty-ledger guard, short lock and statement timeouts, and `psql -X -v ON_ERROR_STOP=1`.
- An exact read-only postflight checks account-column rights and **denies** schema creation, other table reads, writes, guard-function execution, inherited memberships and login. It also asserts no accounts, sessions or county grants were created.
- The script does not run automatically on checkout, test or build. An apply failure, particularly at postflight after DDL was committed, requires inspection rather than a blind retry.

## Operator Phase A: safe source/test verification ONLY

From `C:\Users\brand\gods-eye-view` in PowerShell:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevReaderRoleMigration.test.mjs
npm.cmd run test:land
npm.cmd run build
node scripts/bdp/app-auth-local-reader-role-migration.mjs --plan-only
```

Expected focused security contracts: **16/16**. Predicted complete land test count if no other changes: **1,355** (1,339 previously reported + 16 added), zero failures. The Vite build should succeed. The plan should print:

```text
PLAN: exact local auth-dev NOLOGIN account reader; three SELECT columns only; no Docker commands or writes.
```

These are predictions, not verified operator results. No password, real user, Supabase secret, Docker write or GIS release is required for Phase A.

## Operator Phase B: role application — NOT YET AUTHORIZED

The staged mutation flag is `--apply-local-auth-only`. **Do not run it during Phase A.** Before separate approval for persistent DDL, review the target and establish a usable local backup/restore procedure. Then the operator can choose to apply this narrow role migration with the exact target guard.

Subsequent milestones: restricted SQL credential lifecycle, testing an independent DB login without elevated rights, a real trusted primary account reader through a reviewed server-held adapter, and separate server-verified enrollment and MFA. None of this currently authorizes application sessions, county grants, paid/licensed GIS, or private geometry publication. The Cesium UI, 2.4 km Free Explorer and Travis County boundaries are unaffected.
