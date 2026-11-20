# Step 40C-59 — Private current county-candidate RPC and isolated SQL-role boundary

**Status: OPERATOR-VERIFIED (November 16, 2026): 1,210/1,210 LAND TESTS, VITE BUILD AND REAL DISPOSABLE RPC SQL SMOKE PASSED. NO PRODUCTION AUTH OR GIS RELEASE.**
**Date: November 16, 2026. No production Supabase/Auth, existing PostGIS, live app-owned database or public UI was changed.**

## Operator-verified Step 40C-58

Operator screenshot verifies **1,192/1,192 land regression tests PASSED (zero failures)**, **Vite production build PASSED** (250 modules, 4.97 seconds), and the **REAL isolated disposable PostGIS app-auth-ledger smoke PASSED**, returning cleanly to the PowerShell prompt:

`PASS: disposable app-owned PostgreSQL ledger: deny-default rows, independent LOGINs, monotonic ABA revisions, immutable bindings, rollback, concurrent updates and delete/truncate denial.`

That validates only the **synthetic database ledger**, not an identity provider, MFA/rights approval or production access. The Supabase Auth development project exists and Auth health has passed, but no actual user session has been bound to the app ledger.

## New Step 40C-59 code

### Fixed current-candidate RPC (UNDEPLOYED SQL)

`server/standalone/sql/landOsCurrentCountyCandidateRpc.sql` defines one **fixed, read-only, SECURITY DEFINER SQL function** `ldos_app_auth.current_county_candidate_rpc(text,text)`. It accepts a *server-held HMAC session digest* and Texas-shaped county FIPS, then checks `accounts`, `sessions` and `county_grants` from the Step 40C-57 ledger:

- Current account state `active`, session `active`, stored MFA flag `verified`, county grant `allowed`, issued-at not in future and expiry strictly greater than the database's `clock_timestamp()`.
- Required full lowercase 64-character digest, Texas county format and exact session/county joins. No geographic data, title, owner, account UUID, email or other user metadata is returned.
- At most one row can match the primary-key constrained synthetic ledger; when the row is missing, denied, expired or malformed, the function yields **no rows**.
- The ONLY columns on a matched row are `account_epoch bigint`, `session_epoch bigint`, and `county_grant_epoch bigint`. These are **potential current-row consistency evidence, NOT an authorized decision, independent MFA proof, legal GIS redistribution permission, or response release**. Any genuine read must be bound to a trusted Supabase subject/session in an independently designed server path.
- All table references are fully qualified; the function pins `search_path=pg_catalog,pg_temp` and is marked VOLATILE because current time is checked. The function runs with its owner privileges; use a **dedicated non-login, non-superuser function owner with only necessary SELECT privileges** in a future reviewed deployment. This draft does not provision such an owner.
- No PUBLIC function EXECUTE privileges survive its creation transaction. No production role receives EXECUTE, schema USAGE or table access. **Do not apply this SQL to Supabase Auth or a real Land OS database.**

### Real SQL-role integration smoke (disposable only)

`scripts/bdp/app-auth-candidate-rpc-disposable-smoke.mjs` requires exactly `--disposable-only`. It creates a fresh randomly named, **networkless, no-host-port/no-mount/no-persistence** `postgis/postgis:17-3.5` container using local Docker Desktop, installs only the existing Step 40C-57 schema and this draft function, and automatically removes its container even on failure. All sample subjects, sessions and grants are fabricated.

It provisions **two separate password-authenticated fixture LOGINs**, both non-superuser/non-owner/non-BYPASSRLS and with **no raw table reads or schema CREATE**. Only the candidate reader receives **precise EXECUTE on one fixed candidate RPC**, and the blocked login cannot invoke it. The PUBLIC pseudo-role ACL is inspected directly rather than relying on invalid `has_function_privilege('public',...)`.

The smoke tests real SQL deny-first records, successive account/session/county activation, wrong HMAC digest/county, separate revisions surviving state ABA flips, stored MFA flag reversal, session revocation, expired and future-issued sessions, inability to read raw rows, impersonate an owner, alter the function, or create schema tables. It must print the fixed PASS line only when these checks succeed. Failure prints a sanitized stage, never real credentials or SQL parameters.

`src/bdp/ingestion/parcelAppAuthCandidateRpcDisposableSmoke.test.mjs` contains **18 new Node source/opt-in security contracts**. Both new JavaScript files parsed, and **18/18 isolated source simulations** passed inside the development context. That is NOT an actual Node test or a real Docker/PostgreSQL result. Node, land suite, build and disposable SQL integration require operator confirmation.

## Operator commands (PowerShell, one at a time)

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAppAuthCandidateRpcDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **18/18 focused**, **1,210/1,210 complete land regressions** (prior operator-verified 1,192 + 18) and a green Vite build. Predictions only until operator screenshots confirm.

Then ensure Docker Desktop is running and the local `postgis/postgis:17-3.5` image is available, and run:

```powershell
node scripts/bdp/app-auth-candidate-rpc-disposable-smoke.mjs --disposable-only
```

Expected:

`PASS: disposable app-owned current-candidate RPC: restricted SQL LOGINs, no raw tables, deny defaults, independent epochs and revoked/expired denial; no geometry authorized.`

A clean prompt return is required. **Stop at the first failure** and report only the sanitized error or test summary. No Supabase keys or user tokens are needed for any of these commands; never apply the draft SQL by hand to Supabase or existing PostGIS.

## Operator final validation — November 16, 2026

The operator screenshot confirms **1,210/1,210 complete land regressions PASSED** (zero failures), **Vite production build PASSED** (250 transformed modules in **4.95 seconds**), and the **actual disposable PostgreSQL current-candidate RPC test PASSED**, returning normally to PowerShell:

`PASS: disposable app-owned current-candidate RPC: restricted SQL LOGINs, no raw tables, deny defaults, independent epochs and revoked/expired denial; no geometry authorized.`

This establishes the isolated SQL ACL and candidate-read properties against *synthetic* data. It does not prove live Supabase sign-in, independently verified MFA, production database deployment, application session issuance, county grant provenance or source redistribution permission. **Step 40C-59 is verified as a disposable proof only.**

## Security limitations and next milestone

Even a successful real SQL candidate probe **cannot authenticate a user**. A fabricated row saying `mfa_state='verified'` is not provider-signed AAL assurance, and a matching county-grant row is not a license to redistribute property GIS data. Row-status checks are also not atomic with network response bytes; revocation immediately after the lookup remains a real risk. A SECURITY DEFINER function must be reviewed for ownership, RLS and privilege consequences before use.

Step 40C-60 should prioritize **connecting the already real Supabase Auth `/auth/v1/user` verifier to a server-owned session exchange and an independently hosted app-owned PostgreSQL current account/permission store**, after choosing the backend hosting and approval workflow. No human sign-in, MFA/rights claims or geometry release should be activated ahead of those decisions and audits. Retain the separate private PostGIS geometry/review reader principals.

The original God’s Eye View/Cesium interface, 2.4 km Free Explorer, Travis County public browsing and Property Intelligence panel are unchanged.
