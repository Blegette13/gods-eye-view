# Step 40C-50 — Production identity-authority & response-release security design

**Checkpoint: November 15, 2026. DESIGN + REVIEW-ONLY CANONICAL CONTRACT STAGED; NO real provider, privileges, migrations, UI or public geometry. Operator validation PENDING.**

## Operator-confirmed prior milestone — 40C-49

The operator's screenshots confirm **13/13 focused Node guard tests**, **1,070/1,070 complete land regressions**, and **Vite build** all PASSED. After correcting the `SELECT count(*)` zero-versus-empty-string expectation, the REAL single-container, six-password-LOGIN disposable PostGIS smoke printed:

`PASS: disposable PostGIS six independent SQL LOGINS, sealed source, publication, geometry, policy/run/session epochs and revocation isolation.`

The test exited cleanly to PowerShell. **40C-49 is complete as an isolated synthetic database test only**; there is still no live account/MFA authority, no real GIS redistribution approval, and no HTTP/on-wire release gate.

## Why Step 40C-50 is architectural, not a new fake login

The current `createTrustedParcelCountySessionVerifier` receives `findSessionByDigest`, but the callback is still a trusted synthetic injection. Step 40C-43/47 session/county epoch tables contain artificial flags, not an authentic account record. The six SQL login principals control *database function privileges*, not *which human user is entitled to view a parcel*. Source-seal, publishing-rights and epoch proofs are necessary, but none turns a synthetic session into real authentication.

**No real provider is connected in this milestone.** We must select an actual account system and design ownership of credentials, MFA evidence, logout and county grant revocation before any production implementation. Do not create an apparently working "admin" bypass or trust browser-provided `accountStatus`, `mfaVerified`, `countyGrants` or epoch numbers.

## New source-controlled design artifact

`server/providers/bdp-parcel-identity-authority-contract.js` is a **REVIEW-ONLY, UNROUTED** pure candidate response-shape inspector. It has **no network, session issuer, cookies, database connection or authorization output**. It checks exact candidate fields for a server HMAC session digest, Texas county FIPS, active account/session, verified MFA, an allowed county-grant state, four canonical positive PostgreSQL BIGINT revision strings (account, session, MFA, grant) and plausible 8-hour-bounded session timestamps. It rejects malformed, extra, unknown, inherited, symbol-bearing, accessor, untrusted-proxy and expired/future data. A revision-comparison helper marks A→B→A epoch changes and decreasing observation times as mismatches. **It deliberately always reports `releaseAuthorized:false` and `actualProviderConnected:false`**, even when `contractMatches:true`. A plausible shape is not a trusted origin; a forged response can pass any shape check.

`src/bdp/ingestion/parcelIdentityAuthorityContract.test.mjs` stages **18 new contract tests**. A lightweight local code simulation of these 18 pure checks passed, but the repository's Node runner, land suite and production build have NOT yet been executed for this change. Expected land suite is **1,088/1,088** (1,070 last confirmed + 18 new).

## Required decisions / minimum system-of-record contract

1. **Identity provider and account system.** Select a managed or self-operated identity issuer; document identity proofing, session issuance/renewal, MFA enforcement and recovery, service accounts, audit and breach response. The public browser is not an authority. Only a server-owned cookie/session verifier may compute the HMAC digest used by the private readers.
2. **Durable source of truth.** Map the issuer's authenticated subject to one application account, with authoritative account status, enforced MFA status, session issued/expiry/revocation, and county-specific grants. All checks must read current primary/writable authority (or a proved linearizable equivalent), **not read replicas, stale caches, JWT-only entitlements or unsigned claims**. On any database outage/lag/inconsistency, deny. Distinguish the actual identity records from Step 40C-43's synthetic test fixtures.
3. **Monotonic revocation and ABA.** Account disable, login/session rotation, MFA removal, logout, county grant removal, expiration and later re-approval must update durable, never-reused revisions in the same authority transaction that changes the facts. Deletion and recreation must not resurrect old versions. Define concurrency ordering, restoration, archival and backup rollback/fencing policies. A claim in an OIDC/JWT is not by itself an immediately revocable current county grant.
4. **Specific authorization policy.** Distinguish `canDiscoverParcelMetadata`, `canReadPrivateGeometry`, `canExport` and `canPublish` permissions, with an explicit deny-by-default matrix for anonymous, invited, suspended, revoked, county-mismatched, MFA-not-current and expired sessions. The existing private read path still returns only counts and opaque cursors. No real GIS rights are implicitly supplied by any account role.
5. **Independent source and redistribution rights.** The separate source caching license, immutable run seal, legal publication review, policy epochs and geometry SQL role remain independent of identity. Missing GIS redistribution license or review always denies any future geometry delivery, even if a user is active.
6. **Final release decision is a separate problem.** Pre/post SQL rechecks mitigate stale reads but do not make the network response atomic with concurrent revocations. Define an auditable authorization **linearization point** and a transport protocol such that an access revocation can be ordered against the event at which response data is committed to release. Evaluate a shared transactional authorization fence / gate, how delivery is buffered before that point, and what a mid-stream revocation means. Never start streaming private geometry before the release protocol is reviewed. A simple last-moment `SELECT` or `AbortSignal` is not sufficient proof of no disclosure race.
7. **Operations and verification.** Define role provisioning outside source code, secrets management, key rotation, error and audit logging without identifiers, permission-review SLA, incident workflow, multi-process contention/races, cross-region replica lag, outage fail-closed tests, and revocation-vs-response race tests with the **real** identity store and transport. Test only synthetic fixtures in this repository until licensed, approved and independently audited.

## Non-goals / existing UX preservation

This step does **not** deploy real MFA, password handling, session issuer, cookies, HTTP routes, private polygons or public geospatial data. It does not turn county GIS or parcel acreage into verified zoning, title, fair-market value, legal access or buildability. The original Cesium God’s Eye View foundation, 2.4 km Free Explorer transition, Travis County browsing and Property Intelligence panel remain unchanged.

## Operator validation — existing repository PowerShell, one at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelIdentityAuthorityContract.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **18/18 focused and 1,088/1,088 complete land suite**, subject to discovery, plus a passing Vite build. All numbers here are predictions until operator screenshots confirm them. Stop on the first failure. **No Docker integration or production account configuration is requested in 40C-50.**

## Next checkpoint — 40C-51

Evaluate/select the real identity and grant authority against the above contract; stage a non-issuing provider integration adapter with negative tests and a separate release-race design review, keeping every new module UNROUTED and deny-by-default until independently verified. Do not pretend the draft shape inspector or synthetic SQL epochs proves actual authentication or on-wire disclosure safety.
