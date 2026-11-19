# Step 40C-62D-C14B2C2A — Independent reviewer issuance: server-only review contract

**Status November 19, 2026: SOURCE STAGED on `bdp-development`, operator Node suite/full regressions/build PENDING. Local isolated static JavaScript assertion replay passed 32/32. No real reviewer authorization, SQL writer, database migration, account approval, application login/session, or GIS rights.**

## Verified starting point

Operator PowerShell screenshots confirm **26/26 C14B2C1 focused security tests**, the **exact real isolated `postgres:17` role-isolation smoke PASS** for separate synthetic executor/review-issuer LOGINs and NOLOGIN principals, **1,658/1,658 complete land regressions** (0 failures/skips/cancellations), and a successful Vite v6.4.5 production build (250 modules; ~4.17s). The role smoke granted **zero privileges**, making both LOGINs deliberately unable to write approvals or activate accounts. The existing persistent `ldos_auth_dev` gateway reader and county/PostGIS services remain unchanged.

## What C14B2C2A adds — no operational authority

- **`server/providers/bdp-unrouted-reviewer-issuance-review.js`** provides the frozen `createUnroutedReviewerIssuanceReview({expectedIssuer})` with one pure `reviewSnapshots(input)` function. The evaluator demands exact-shape snapshots of **two separately verified Supabase identities** (applicant and reviewer) pinned to a single issuer, **app-owned primary reviewer authority** with active enrollment-review scope and positive revision, a redeemed invitation issued by a *third* independent identity, an exact bound request, and a purpose-specific not-yet-issued approval intent.
- A proposed **enroll_suspended** review requires request state `pending` and **no preexisting account**. A proposed **activate** review requires request state `enrolled_suspended` and an exact still-suspended primary account with safe revision. Approval intent must contain a unique-looking 64-lowercase-hex nonce digest distinct from the invitation digest, be scoped to the requested purpose/subject/reviewer/issuer/request ID and expire within **15 minutes**, before invitation and request expiration. Invitation and request must be currently fresh within **24 hours**. A reported existing approval for that same request/purpose fails closed.
- **The result is explicitly a frozen non-authorizing proposal:** `authorization:'none'`, `approvalMutation:'none'`, `accountMutation:'none'`, `requiresIndependentLiveVerification:true`, `requiresPrimaryRowLocks:true`, `requiresAtomicAudit:true`, `reviewerMfaConfirmed:false`, `appSessionIssued:false`, `countyGrantConfirmed:false`, `releaseAuthorized:false`. It cannot issue an approval, mint a session or release parcel information. Snapshots may be fabricated by their caller; therefore an actual service **MUST NOT treat a non-null result as a capability to mutate records**.
- **`src/bdp/ingestion/parcelAuthDevReviewerIssuanceReview.test.mjs`** adds **32** offline Node contracts for independent identities, strict issuer, metadata rejection, expiry, state binding, purpose/replay mismatch, untrusted clock, revision overflow, account state, zero authority and no database/network accesses. An isolated V8 assertion replay found **32/32** passing; actual operator Node execution remains pending.

## Pending trust architecture (do not bypass)

The first real *issuer* must not accept `reviewerIdentity`, `reviewerAuthority`, or `existingPurposeApproval:null` as raw browser input. Those fields require a **server-held provider-token verifier** for a distinct reviewer, a **read-only current app-owned primary query under lock**, and a separately audited SQL transaction with `UNIQUE(request_id,purpose)` enforcement and replay/cross-project tests. A reviewer cannot approve their own application or an invitation they themselves issued. The operator must create the **first reviewer authority** through a separate audited bootstrap procedure; a user's Supabase metadata can never confer it. Review issuance and account transition must belong to separate least-privilege SQL writer identities. Actual MFA assurance, real app sessions, county-grant policy and GIS distribution remain separate future boundaries.

C14B2C2A deliberately introduces **NO SQL, account rows, app roles, authentication provider calls, HTTP endpoints, secrets, tokens or credentials**. This is an enforceable **source shape/denial contract for later design**, not deployment-ready authorization.

## Operator checks — safe, source-only

From the existing PowerShell checkout:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevReviewerIssuanceReview.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected: **32/32** focused, predicted full **1,690/1,690** land tests (1,658 previously confirmed + 32) and successful Vite build using the 2048-MB Node old-space setting. The existing large-chunk warning is nonfatal. **These new operator results have not been observed yet**.

There is **NO Docker or PostgreSQL command for this source-only checkpoint**. Do not run any C14B SQL manually, run C11 apply again, grant PostgreSQL permissions, create actual Supabase/admin accounts, or modify persistent `ldos_auth_dev`. Stop and provide the sanitized output if a test fails.

## Following this checkpoint

**C14B2C2B** must independently stage a new *disposable-only* PostgreSQL 17 **approval issuance** prototype and synthetic runtime tests with distinct app-owned reviewer authority, transactionally locked request/reviewer/invitation, one-use approval issuance and mandatory audit, and a denied-first privilege matrix. No real admin or production login is authorized until the bootstrap and credential rotation design is reviewed, and no county GIS rights follow from a valid approval.

The God’s Eye View Cesium interface, 2.4-km Explorer height, Travis public boundaries, GIS unknown-data safeguards, TCEQ integration and private-geometry permission controls remain unchanged.
