# Step 40C-62D-C14B2C3A — First Reviewer Bootstrap Ceremony: Non-Authorizing Review Gate

**Status November 19, 2026: STAGED on `bdp-development`; the operator's focused Node tests, complete regression suite and production build are PENDING. A sandboxed JavaScript assertion replay passed 28/28 checks; this is not real identity-provider verification or an administrator account.**

## Verified foundation

The operator's screenshot confirms C14B2C2B **1,717/1,717 complete land tests passed** (zero failed/skipped/cancelled), **real isolated PostgreSQL 17 review-issuance smoke PASS** (mandatory `reviewed` audit, purpose separation, replay denial, rollback), and **Vite v6.4.5 build PASS** (250 transformed modules, ~5.17 seconds). The separate focused C14B2C2B 27-test command was not visible; its tests are automatically included in the full land suite.

The existing C14B2C2B SQL function is **owner-only and disposable**. It accepts a synthetic reviewer UUID but does not independently authenticate that reviewer. Neither synthetic app LOGIN can execute the procedure. No reviewed enrollment schema, issuer function, SQL LOGIN or administrator is installed in persistent `ldos_auth_dev`.

## First administrator trust problem

A brand-new platform has **zero active application reviewers**, so its first reviewer cannot be approved by a reviewer that already exists. This bootstrap is an exceptional administrative operation, not an ordinary invitation. Automatically treating a successful Supabase login, self-declared administrator role, or a review-snapshot flag as permission to create the first reviewer would enable unauthorized privilege escalation.

Before creating a real first reviewer, the system needs a **deliberate, audited operator bootstrap ceremony**, with separate responsible custodians and independently authenticated operator evidence, protected credential transport, a restricted one-time local bootstrap operation, an expiry window, an explicit rollback/revocation path, and before/after privilege attestations. A dual-custodian plan is not a substitute for validating independent evidence via protected services or physical procedures.

## New source-only gate

**`server/providers/bdp-unrouted-first-reviewer-bootstrap-review.js`** exports a frozen, pure, unrouted `createUnroutedFirstReviewerBootstrapReview({expectedIssuer})` with one `reviewPlan(input)` method. It accepts only exact-shape *claimed* information: a candidate subject and fixed issuer, two distinct suggested out-of-band custodian reviews on different security/operations channels, digest-only review references with a maximum 15-minute lifetime, and an explicitly `untrusted-review-snapshot` describing an empty `ldos_c14b_disposable` fixture. It denies stale, duplicated, self-custodied, conflicting, extra-field, invalid UUID/issuer/digest, non-read-only, nonempty-reviewer or active-session/counties claims.

**The returned proposal NEVER authorizes execution.** Every successful return includes:

```text
authorization: none
reviewerAuthorityMutation: none
accountMutation: none
credentialCreation: none
auditMutation: none
canExecute: false
requiresOperatorCeremony: true
requiresIndependentProviderVerification: true
requiresProtectedCredentialChannels: true
requiresLivePrimaryAttestation: true
requiresAuditedAtomicBootstrap: true
requiresRecoveryAndRevocationDrill: true
sessionIssued: false
countyPermissionGranted: false
gisAccessGranted: false
```

Critically, **every input may still be fabricated by its caller**. A passing review proposal only demonstrates that a planned ceremony record has the expected structure. The code contains no real Supabase token verification, database read, SQL mutation, secret, HTTP route, admin grant or GIS query. **Never use a non-null result as a writer capability.**

**`src/bdp/ingestion/parcelAuthDevFirstReviewerBootstrapReview.test.mjs`** adds **28** source/behavior tests for zero-authority outcomes, separate parties and channels, time/nonce limits, wrong issuer, malicious getter/prototype/extra-field rejection, revision bounds and no privileges. An isolated static JavaScript assertion replay passed **28/28**; this does not replace running the actual Node test suite in the operator's environment.

## Operator commands — SAFE SOURCE-ONLY checks

From `C:\Users\brand\gods-eye-view`, run each separately and stop if any fails:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevFirstReviewerBootstrapReview.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected **28 focused tests** and predicted **1,745 complete land tests** (1,717 previously screenshot-verified + 28 newly staged), plus successful Vite build. These next operator results are not yet observed. The known Vite large-chunk warning remains nonblocking.

**No Docker commands, migrations, JWTs, roles, credentials or real administrator invitations are needed for C14B2C3A.** Never execute the existing owner-only SQL against persistent `ldos_auth_dev`, disclose DPAPI/Supabase secrets, reuse a disposable synthetic role as a live admin, or bypass the independent reviewer trust boundary.

## Next checkpoint — C14B2C3B

Before any persistent changes, implement an independently authenticated operator evidence service and a separately reviewed *disposable-only* bootstrap authority transaction. Demonstrate that no single reviewer, client-submitted metadata or leaked service credential can manufacture authorization; prove independent custody, short-lived single-use operation, frozen full audit, SQL privilege isolation and recovery/role revocation. Use real PostgreSQL 17 isolation tests under non-superuser principals only after proving who can authorize them. The old account reader and the God’s Eye View/Cesium 2.4-km Free Explorer, Travis County parcel layers, TCEQ and county GIS permissions remain unchanged.
