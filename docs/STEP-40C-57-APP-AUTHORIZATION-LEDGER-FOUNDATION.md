# Step 40C-57 — Private application account/session/Texas-county ledger foundation

**Status (November 16, 2026): SQL DRAFT + 16 NODE SOURCE-CONTRACT TESTS STAGED; OPERATOR NODE/BUILD/POSTGRES VALIDATION PENDING. DO NOT APPLY TO LIVE DATABASE.**

## Operator-confirmed Step 40C-56

Operator screenshots confirm:

- **1,161/1,161 land regression tests PASSED**, zero failed/cancelled/skipped (this includes the 40C-55 and 40C-56 staged tests).
- **Vite production build PASSED**, 250 transformed modules in **4.95 seconds** (nonfatal preexisting large-chunk warning).
- `node server/standalone/land-os-api-dev.mjs --dev-only` printed the expected loopback startup status; an independent PowerShell `Invoke-RestMethod http://127.0.0.1:8787/health` returned `service=land-os-api-dev`, `status=running`, and all four security flags (`identityProviderConnected`, `accountAuthorizationConnected`, `privateGeometryAvailable`, `releaseAuthorized`) **False**.

**Step 40C-56 is verified.** These observations prove a working loopback-only health API, not any actual authenticated service endpoint or county grant. Server window can be stopped with Ctrl+C.

## Step 40C-57 staged scope

A **new, separate, review-only PostgreSQL SQL migration** lives in:

`server/standalone/sql/landOsAccountAuthorityFoundation.sql`

This models a future app-owned account/session/county-grant source of truth. It is **NOT a migration for Supabase Auth**, it does not reference or modify `auth.users`, it is not related to staged `ldos_private_auth` synthetic session flags, and it must not be run against the operator's `land-os-auth-dev` or an existing PostGIS database.

It creates **`ldos_app_auth`** with three private tables:

1. **`accounts`**: `subject UUID` from a separately verified Supabase identity, default `suspended`; durable BIGINT `revision`.
2. **`sessions`**: unique **HMAC digest** (not bearer/refresh tokens) bound to account subject, default `revoked`, MFA default `unverified`, bounded issue/expiry timestamps (maximum eight hours), separate BIGINT `revision`.
3. **`county_grants`**: subject + Texas-style county FIPS, deny-by-default `grant_state`, separate BIGINT `revision`. This is **application authorization only**, NOT GIS data redistribution rights or zoning approval. The `48xxx` shape alone is NOT a verified list of Texas county FIPS; a separately maintained allowlist and authorization provisioning process are required.

Each accepted UPDATE increments the table row's BIGINT revision transactionally via an UPDATE trigger (including revoked → allowed → revoked ABA state changes), while rejecting caller-chosen revisions, key swaps, timestamp rebinding and signed BIGINT overflow. DELETE and TRUNCATE triggers prohibit ordinary physical deletions, avoiding recreation with the same row identity/revision under a normally privileged writer. **Trigger controls are not an anti-superuser, anti-table-owner or backup-rollback guarantee**; production role provisioning and globally fenced restore policy remain separate work.

The SQL uses `BEGIN`/`COMMIT`, refuses to reuse a preexisting unknown `ldos_app_auth` schema, grants **NO positive privileges**, and revokes PUBLIC schema/table/function privileges inside the same transaction. There are no fake users, credentials, data inserts, endpoint mounts, schema migrations on Supabase, or public GIS geometry.

**New tests** in `src/bdp/ingestion/parcelAppAuthLedgerFoundation.test.mjs`: **16 Node source-contract tests** covering schema boundaries, deny-by-default, no tokens or public roles, immutable bindings, monotonic/overflow/ABA revision guards, no delete/truncate, and no live DDL execution. A lightweight *in-context source simulation* found **16/16 checks satisfied**; the operator must still run the Node suite. No Postgres SQL has been executed in this milestone.

## Limitations and security work before any real account use

- This is a *schema design*, not an authenticated authority. It has no user self-enrollment, Supabase subject signature verification, AAL/MFA proof, login callback, app session issuer, logout, county grant administrator, trusted read/write role, SQL function grants, or deployed backend. Do not let a Vite client write these rows.
- A future **application-owned PostgreSQL primary** and migrations/role privileges must be selected independently of the Supabase Auth project. Supabase Auth identities live at the identity provider; no implicit linkage to a different Postgres instance exists.
- Authorized county access must combine strongly current account/session/MFA/county-grant facts **AND** independently reviewed source/GIS redistribution rights; a future private reader must reject missing/stale/corrupt evidence. SQL row updates alone don't prove atomic HTTP release under concurrent revocation.
- Even though this schema rejects ordinary DELETE/TRUNCATE, privileged DB owners, physical restores and external provider identities can change authority unexpectedly. Plan independent restore fencing, audit, safe write procedures, transaction isolation, MFA assurance verification, audit without personal identifiers, and endpoint CSRF/session protection before deployment.
- Keep the six restricted PostGIS roles, unreleased private geometry and source-rights approval separate from login.

## Operator commands — run in PowerShell one command at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAppAuthLedgerFoundation.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **16/16 focused tests** and **1,177/1,177 full land regressions** (previous operator-confirmed 1,161 + 16), and a successful Vite production build. These are predictions until confirmed. **No Docker, database connection, SQL execution, Supabase keys or other secrets are needed for 40C-57.**

### Next checkpoint — Step 40C-58

Create an **isolated, synthetic, no-network Postgres test harness** for this draft SQL. Exercise database-enforced denial defaults, concurrent row revision increments, rejected caller-chosen revisions, frozen identities, revoked/restore ABA and forbidden DELETE/TRUNCATE with real password-restricted roles. Only after independent disposable SQL validation should account writer/reader privileges and hosting decisions be addressed. Never apply draft SQL to live Supabase Auth or distribute GIS data based on an unverified app identity.

**Preserved:** original God’s Eye View/Cesium interface, 2.4 km Free Explorer, Travis County CAD browsing, Property Intelligence panel, GIS provenance and unknown/rights-deny safety requirements.

PostgreSQL 17 reference:
- https://www.postgresql.org/docs/17/sql-createtrigger.html
- https://www.postgresql.org/docs/17/sql-revoke.html
- https://www.postgresql.org/docs/17/ddl-schemas.html
