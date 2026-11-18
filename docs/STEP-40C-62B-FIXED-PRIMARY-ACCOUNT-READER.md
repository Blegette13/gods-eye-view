# Step 40C-62B — Fixed current-primary app-account SQL reader contract

**Status: OPERATOR-VERIFIED November 17, 2026 — 1,287/1,287 full land tests, 0 failures/skips and Vite production build PASSED; no real DB connection, MFA or GIS delivery.**

## Operator-confirmed Step 40C-62A

Operator screenshots verify **20/20 focused Node tests**, **1,267/1,267 full land regression tests**, zero failed/skipped, and **Vite production build PASSED** (250 modules, **8.78 seconds**). They verify the identity-to-application-account *contract*, not an actual deployed app-owned PostgreSQL database.

## New implementation

**`server/providers/bdp-primary-account-reader.js`** provides an unmounted, server-only, parameterized fixed SELECT intended for the **separately hosted current-primary application authorization PostgreSQL database**. The SQL reads only the canonical `ldos_app_auth.accounts` account UUID, state and exact revision (as text), by **one `$1::uuid` parameter**. It requires the SQL session's actual `current_user` to equal `ldos_auth_account_reader` and `NOT pg_is_in_recovery()`. No requester can choose the SQL, DB role, schema, county or output fields.

The factory `createUnroutedPrimaryAccountReader({query})` requires a **trusted server-held query adapter**. It never creates a network connection, database, application session, browser endpoint or table. It rejects bad UUIDs, extra request fields, aborted requests, thrown DB errors, multiple/empty/malformed SQL rows, wrong account subjects, non-active state, malformed/overflowed BIGINT revisions and unexpected fields. A valid result is immutable, contains exactly `{subject,account_state,revision,source:'app-owned-primary',current:true}`, and is still **candidate evidence only**.

There is **NO database client, host, pool, SQL LOGIN provisioning, connection string or deployed database in this milestone**. The literal `source` and `current` returned by this adapter reflect the SQL role and primary-server checks in its fixed query; they cannot establish an authoritative primary without a real correctly configured and verified server-held connection. No MFA, county grants, source redistribution, GIS or data-release authority is added. All existing 40C-57/59 SQL drafts remain undeployed.

**`src/bdp/ingestion/parcelPrimaryAccountReader.test.mjs`** introduces **20 Node unit tests** covering the fixed SQL text, login and primary constraints, injection-resistant parameter passing, input validation, missing/suspended/closed accounts, exact row counts/columns, revision preservation, cancellation and lack of GIS/API side effects. The source and tests were run in a standalone local Node 22 environment with **20/20 passed**, but the operator's own repository and all-regression/build results remain unconfirmed. This is not a real PostgreSQL runtime proof.

## Focused operator test failure and correction — November 17, 2026

The operator ran the first focused 40C-62B Node test and reported **17/20 PASS, three failures**, all in happy-path account lookups (parameterized adapter, frozen result, exact BIGINT revision). The cause was a missing fourth UUID segment in the primary reader's input pattern (`8-4-4-12` instead of the required `8-4-4-4-12`). This erroneously rejected valid verified subjects **before** executing the injected query. Fixed in `server/providers/bdp-primary-account-reader.js`, commit `db34fdd65e2e723be29b0dfbdc14536046c3ef18`. A small in-process verification now returns the expected active account evidence for a synthetic valid UUID while rejecting incomplete UUIDs and overflow revisions. **Operator re-run of focused 20 tests, complete 1,287 land tests and Vite build remains PENDING.** Do not mark 62B verified yet.

## Operator validation

From PowerShell in `C:\Users\brand\gods-eye-view`, run each command individually:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrimaryAccountReader.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Predicted **20/20 focused** and **1,287/1,287 complete land tests** (verified 1,267 + 20 new), and successful Vite build. Predictions are not confirmations. **No Supabase keys, real users, PostGIS Docker containers or passwords are necessary**. If a test fails, stop and report the sanitized failure.

## Operator validation after UUID fix — November 17, 2026

The operator's newest PowerShell screenshot confirms **1,287/1,287 full land regression tests passed**, **0 failed, skipped, or cancelled**, and **Vite production build succeeded** (250 transformed modules, **8.26 seconds**). The screenshot does not show the focused 20/20 summary separately; its tests are included in the full discovered land suite. The known UUID validation defect was corrected before this successful full suite. Large Vite chunks still trigger a nonfatal warning. **Step 40C-62B is verified as a source/adapter contract, not as an actual PostgreSQL connection.**

## Step 40C-62C — Real development database decision and integration

The next move should be substantive: set up an **actual separate app-owned PostgreSQL development primary**, restricted `ldos_auth_account_reader` SQL LOGIN with schema USAGE and read-only account SELECT, a distinct authorized account-creation/activation workflow, and a server-held Node PostgreSQL driver. Keep the existing parcel/PostGIS database and Supabase Auth development project separate. Use a local Docker-only application database for first integration, **only after the operator approves this data-store choice**, then a reviewed hosted backend/storage design for production.

Before any real account provisioning or public login release: agree on backend hosting, persistent primary DB, migrations and rollback, role credentials/rotation, backup/restore epochs, admin approval and audit. Browser sign-in, real MFA assurance, county grants, legal redistribution rights, private polygons, and secure application sessions remain UNIMPLEMENTED. **Do not run the draft SQL against the Supabase Auth project, production database, or existing parcel database.**

## UI and data continuity

Original God’s Eye View/Cesium screen, 2.4 km Free Explorer behavior, Travis County public parcel browsing, property analysis, and fail-closed GIS evidence rules remain unchanged.
