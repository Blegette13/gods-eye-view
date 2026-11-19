# Step 40C-62D-C13 — Server-only verified identity → restricted primary-account candidate

**Status November 18, 2026: C13 source and 22 focused mocked security-contract tests STAGED on `bdp-development`, operator validation PENDING.** This is deliberately **unrouted composition**—not real app-account enrollment, not a user login/session API, not MFA, not county entitlement and not GIS access.

## Starting point: C12 operator PASS

Operator PowerShell screenshot confirms **both exact C12 runtime PASS messages**: persistent `ldos_auth_dev` gateway LOGIN / SET-only NOLOGIN reader postflight passed, and a real restricted **node-postgres** connection passed fixed synthetic-UUID empty account checks, per-read role-switch/privilege attestation, and denial of raw auth-table reads or role escalation. Earlier screenshots confirm the full **1,499/1,499** land tests and a successful production Vite build. The persistent app-authorization ledger remains empty. No real user, app session or county grant has been created.

## What C13 adds

**`server/providers/bdp-auth-dev-verified-account-bridge.js`** composes three pre-existing server-only components, without adding a new access policy:

1. **`createUnroutedCurrentAccountLink`** from 62A: accepts only the provider-verified Supabase UUID and exact known issuer, requires strictly shaped identity proof and a current active app account, otherwise null.
2. **`createUnroutedPrimaryAccountReader`** from 62B: uses the fixed parameterized 3-column account `SELECT`, accepts only exact UUID and AbortSignal, returns active/current evidence or null.
3. **`createUnroutedAuthDevRoleSwitchPg`** from 62D-C6/C12: creates one fixed trusted `pg.Pool` object for loopback local auth dev. When asked to read, checks `BEGIN READ ONLY`, `SET LOCAL ROLE`, 19 privileges and schema constraints and rolls back before releasing the SQL session. DB password comes only from trusted server-supplied protected settings; nothing is loaded from a browser or committed to source.

The new `createUnroutedAuthDevIdentityAccountBridge({identityVerifier,expectedIssuer,Pool,settings})` has only `getCandidate({accessToken,signal})` and `close()` operations. It never issues application cookies, SQL writes, real account rows, Supabase service-role calls, county grants, private geometry or public HTTP routes. The returned successful candidate is frozen and explicitly **`mfaConfirmed:false`**, **`appSessionIssued:false`**, **`countyGrantConfirmed:false`**, **`releaseAuthorized:false`**; it is **not permission to release anything**. If no active, separately provisioned account exists, it returns **null**. `close()` closes the underlying pool and denies further lookups. Factory creation does not open an actual database connection.

**`src/bdp/ingestion/parcelAuthDevVerifiedAccountBridge.test.mjs`** adds 22 focused mocks/source-contract tests. They exercise trusted dependency checks, zero-connection construction, exact input shapes and issuer, provider-before-account ordering, verified UUID-only SQL parameter, active immutable candidate, session rollback, absent/closed/suspended account denial, epoch mismatch, invalid provider/extra metadata rejection, cancellation, per-read privilege mismatch, generic error handling and shutdown. **The tests do not themselves call real Supabase or persistent PostgreSQL; the real C12 driver evidence exists separately.**

## Operator Phase A — source-only validation; no credentials or DB changes

From `C:\Users\brand\gods-eye-view` in the existing PowerShell window, run:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevVerifiedAccountBridge.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected **22/22** focused tests, predicted **1,521** total land tests (prior operator-confirmed 1,499 + 22), and successful Vite build with the 2,048-MB Node old-space allowance. These are expected results **not yet operator-verified**. No SQL migrations, Docker writes, DPAPI unsealing, real Supabase tokens or app-user provisioning are necessary. Stop and send sanitized output if a check fails.

## What's deliberately not done

C13 doesn't yet exercise the live Supabase `/user` response alongside the real private app account reader. That's a separate security-reviewed integration requiring an approved synthetic/controlled account enrollment process, audited issuer/subject consistency, account activation lifecycle, currently enforced MFA and durable session rules. **Never equate a valid Supabase identity with approval to read parcels or county data**. Our existing Cesium interface, Travis public boundaries, 2.4-km Explorer altitude and PostGIS screens are unaffected.

The next stage should design account enrollment/activation with explicit approver and audit safeguards (deny-first by default), preferably first tested in disposable PG with wholly synthetic subjects, then separately approve a controlled dev-only account record. Still no GIS delivery until independently verified county/source rights.
