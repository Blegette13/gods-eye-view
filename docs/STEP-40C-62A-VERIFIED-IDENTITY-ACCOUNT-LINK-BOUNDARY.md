# Step 40C-62A — Verified Supabase identity → application account candidate boundary

**Checkpoint: November 17, 2026. OPERATOR VERIFIED — 20/20 focused Node tests, 1,267/1,267 complete land regressions, and Vite production build PASS. No deployed account database, login session, MFA proof, county grant, private GIS endpoint, or production deployment.**

## Step 40C-61 real provider round-trip: OPERATOR PASS

The operator's actual PowerShell screenshot confirms:

`PASS: development test user authenticated with Supabase and reverified by local Node API; MFA, app sessions, county grants and geometry remain disabled.`

They corrected the development project URL and `sb_publishable_` key, verified both values' formats, used a secure local credential prompt, and ran the opt-in test-user client. The output returned cleanly to the PowerShell prompt; the operator then removed the local credentials and environment variables. **This is real Supabase Auth password login and `/auth/v1/user` verification, not an authorization or public login.**

The last operator-confirmed code baseline remains **20/20 focused Step 40C-61 tests, 1,247/1,247 full land regressions and successful Vite build (250 modules, 9.37s)**. No real user credentials were copied to GitHub.

## Step 40C-62A: a new server-only identity/account linking seam

**New file:** `server/providers/bdp-current-account-link-candidate.js`

- Composes the **existing server-side Supabase identity verifier** (the component which already returned a verified subject for an actual development user) with a **separately injected, trusted, current-primary app account reader**.
- Does **not** accept a browser-declared subject, role, group, county, organization or email. The account reader receives **only the provider-verified UUID subject and an AbortSignal**.
- Requires expected Supabase Auth issuer equality, provider confirmation and exactly shaped security evidence. A malicious/expired/unverified/malformed provider response never reaches the account reader.
- Requires an **active app account** in the private primary database, with the **same subject**, a positive exact decimal BIGINT revision and a current-primary source indication. Missing, suspended, closed, stale-replica, mismatched, invalid-epoch or interrupted reads produce **null**, with no authorization.
- Returns a frozen **internal-only candidate** consisting of issuer, subject, current account epoch and explicitly false `mfaConfirmed`, `appSessionIssued`, `countyGrantConfirmed`, `releaseAuthorized`. It cannot authorize an action or deliver parcel geometry, and is not attached to any HTTP route.
- The `readPrimaryAccount` argument is **dependency injection only**: there is deliberately **NO real database implementation** in Step 40C-62A, no DB connection pool, no SQL query, no account provisioning, no API cookies, no real session issuer, no exported bearer token and no browser import. Nothing was applied to Supabase or the existing PostGIS instance.

**New test file:** `src/bdp/ingestion/parcelCurrentAccountLinkCandidate.test.mjs` with **20 actual Node tests** covering fail-closed behavior, input shape rejection, exact issuer/sub identity binding, private primary data contract, no browser claims, account suspended/closed denial, BIGINT revision validation, cancellation, provider and adapter errors and no downstream permissions.

The exact files committed to GitHub were byte-for-byte cross-checked against files executed in a **local isolated Node 22 test harness**. That harness returned **20/20 PASS**, zero failures. The operator should now test on the repository's own Node installation and run full regression/build. Expected land suite **1,267/1,267** (operator baseline 1,247 + 20 staged), still unverified in the operator's environment.

## Next operator commands

Run each in the existing PowerShell repository window:

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelCurrentAccountLinkCandidate.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected: **20 focused passes**, **1,267 full land passes** (prediction), and a green Vite build. **No credentials, test-user password, Supabase API key, Docker or new test account is needed.** Stop at any failure and share sanitized test output. Existing Vite large-chunk warnings may continue but do not indicate a failed build.

## Operator verification — November 17, 2026

The operator's latest PowerShell screenshots confirm **20/20 Step 40C-62A focused Node tests PASSED**, **1,267/1,267 complete land tests PASSED**, **0 failed, cancelled or skipped**, and **Vite production build PASSED** (250 modules, **8.78 seconds**). Existing large-chunk warnings are nonfatal. These tests validate the server-only *contract* but still use an injected account reader and prove neither a real database deployment nor county permissions.

## Critical Step 40C-62B decision — before real account or cookie sessions

The actual trusted backend and app-owned database deployment are **not selected**. Step 40C-62A is an intentionally **unrouted integration boundary**, not a production authority. We must choose where to operate the Node API, private app-owned primary PostgreSQL, network restrictions, migrations, backups, and restricted DB role management. There is no approved public deployment target, so no live DB connection, auto-registration or actual human account provisioning should be introduced yet.

**Development recommendation:** keep Supabase solely for the already working Auth development project; keep the original God’s Eye View/Cesium browser experience unchanged; use a **separate isolated local PostgreSQL app-authorization database** for development, distinct from parcel PostGIS and the Supabase Auth provider. This is only a recommendation, not an operator-approved new database. The real hosted backend/database choice remains to be made before production.

**Acceptance before any private read:** trusted subject verification, separately approved account creation/activation, issuer-bound durable opaque sessions, independently verified MFA assurance, strongly current DB account/county grant checks, restore-safe revisions, logout/revocation and an audited legally authorized GIS release policy. County grants do not confer source redistribution rights. No parcel geometry endpoint, export or other private release is authorized by the 40C-62A candidate.

## Preserved

Original God’s Eye View/Cesium UI, 2.4 km Free Explorer camera/parcel behavior, Travis County browsing, Property Intelligence panel, explicit unknown GIS evidence, six private PostGIS role separation, and unapproved geometry withholding are **unchanged**.
