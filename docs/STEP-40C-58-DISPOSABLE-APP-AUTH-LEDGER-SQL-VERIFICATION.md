# Step 40C-58 — Disposable PostgreSQL app-account ledger integration proof

**Checkpoint: November 16, 2026 — STAGED / NOT YET OPERATOR-VERIFIED. No live Supabase/PostGIS database or public API changed.**

## Step 40C-57 completed source/build checks

Operator screenshot confirms **1,177/1,177 complete land regression tests PASSED**, zero failures/skips, and **Vite production build PASSED** (250 modules transformed, 4.54 seconds). That validates the 40C-57 draft SQL **source contract**, not its actual behavior in a PostgreSQL server. The draft schema remains **unapplied** to any Supabase or existing GIS database.

## What Step 40C-58 adds

`scripts/bdp/app-auth-ledger-disposable-smoke.mjs` is an explicit `--disposable-only` integration smoke for the **existing 40C-57 draft** `server/standalone/sql/landOsAccountAuthorityFoundation.sql`. It runs against a **new, randomly named, disposable `postgis/postgis:17-3.5` container** only. That local image already featured in earlier isolated security tests. It requires Docker Desktop to be running and the image to be available locally. There are **no network interfaces attached to the container (`--network none`)**, no host ports, mounts, persistent volumes, remote DB URLs, user tokens, GIS geometry, authentic Supabase users, external secrets or existing container changes. The container is removed on normal exit or failure in a `finally` block.

**One fresh synthetic database, two actual password-authenticated PostgreSQL LOGINs:** a test writer with DML permissions on the **fabricated** app-auth tables, and a test reader that has schema usage but no table SELECT, INSERT, ownership or direct trigger-function EXECUTE. The elevated *test writer* permissions exist only inside this disposable container; they are not added to the versioned production draft.

The integration smoke is designed to verify against **real PostgreSQL**, not only mocked source assertions:

- Brand-new `ldos_app_auth` schema and three empty private tables (accounts, sessions, county grants).
- Synthetic account defaults to `suspended`, synthetic session defaults to `revoked/unverified`, and Texas-shaped county grant defaults to `denied`.
- Independent password LOGIN denies raw reads/inserts for the reader and denies schema creation, trigger disablement and owner-level bypass for the writer.
- Each synthetic account, session and county `active → suspended/revoked/denied → restored` change is reflected by a monotonically increasing row revision, so identical restored flags cannot masquerade as unchanged.
- Caller-provided revision rollback, immutable account UUID, bound session HMAC digest, immutable session issue time, county key swap, invalid county and overlong session expiry all fail in SQL.
- Real granted writer DELETE and TRUNCATE (including CASCADE) operations fail because trigger guards reject them; permission denial alone would not prove those safeguards.
- A synthetic uncommitted UPDATE followed by `ROLLBACK` leaves the committed revision unchanged. Two separate actual concurrent PostgreSQL backend connections update the same county-grant row; final revision must advance twice without a lost increment.
- Errors deliberately show only a coarse **sanitized test phase**, never SQL parameters or fixture passwords. No misleading success result is printed if a check fails.

`src/bdp/ingestion/parcelAppAuthLedgerDisposableSmoke.test.mjs` adds **15 source/opt-in safety-contract tests**. A lightweight in-context source-level simulation of these tests passed **15/15** and both JS files parsed, but the actual Node test runner and the Docker SQL integration have **not** yet been executed by the operator. Source-level tests are not substitutes for the SQL smoke.

## Operator sequence (PowerShell; one command at a time)

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAppAuthLedgerDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **15/15 focused tests**, **1,192/1,192 full land regression tests** (previous operator-confirmed 1,177 + 15), and a green Vite production build. These are **predictions until operator-confirmed**.

Then, with Docker Desktop running and the image present, execute **only this isolated smoke**:

```powershell
node scripts/bdp/app-auth-ledger-disposable-smoke.mjs --disposable-only
```

Expected final PASS:

`PASS: disposable app-owned PostgreSQL ledger: deny-default rows, independent LOGINs, monotonic ABA revisions, immutable bindings, rollback, concurrent updates and delete/truncate denial.`

It must also return normally to PowerShell. At the first failure, **stop and share only the sanitized error message**. Do not manually run draft SQL against Supabase or `bdp-postgis`. The Docker test creates and removes its **own isolated test container**; no local Supabase variables or API keys are required.

## Hard limitations

Passing a synthetic database test **does not create or verify real user identities, Supabase MFA, county eligibility, licensing or browser-visible GIS authorization**. Trigger guards do not prevent override by a privileged table owner/superuser or a database restore; backups, restore fencing, transaction isolation and role-separation design need independent production review. The placeholder county regular expression validates `48xxx` format, **not the membership of all 254 Texas counties**. SQL row revisions detect ABA within this database, but do not solve an HTTP response-versus-revocation race.

All private GIS readers and geometry remain UNROUTED. Original God's Eye View/Cesium interface, Free Explorer 2.4 km behavior, Travis County public parcel browsing, and Property Intelligence panel are unchanged.

## Next candidate — Step 40C-59

After real disposable SQL PASS, specify **separate actual application DB owner / writer / current read roles**, restricted server-side provisioning policy, authoritative Supabase subject and MFA verification binding, and the deployment decision for the app-owned authorization PostgreSQL primary. No user-facing login or GIS delivery should be activated before these controls and an independently reviewed final release protocol.
