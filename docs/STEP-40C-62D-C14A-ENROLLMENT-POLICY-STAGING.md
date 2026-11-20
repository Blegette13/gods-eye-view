# Step 40C-62D-C14A — Invitation-only enrollment policy (source-only)

**Status November 18, 2026: OPERATOR VERIFIED C14A — 31/31 focused Node tests, 1,552/1,552 full land tests (0 failures/skips), Vite v6.4.5 production build PASSED (250 modules, ~4.68s) using 2-GiB Node heap. C14A remains source-only, unrouted and NON-AUTHORIZING.**

## Previously verified baseline

The operator's latest screenshots showed **22/22 C13 focused tests**, **1,521/1,521 complete land regressions** (zero failures/skips) and a successful production Vite build (250 transformed modules, ~4.35 s, 2,048-MB Node old-space). C13's trusted Supabase verifier + read-only restricted app-account bridge remains **unrouted**. The persistent account ledger was empty at the last real C12 database check; C13 and C14A introduce no persistent data writes.

## What was added

- **`server/providers/bdp-unrouted-account-enrollment-review-policy.js`** — a pure, server-only proposal evaluator for `enroll_suspended` and `activate`. It requires the fixed verified Supabase issuer, exact server-verified identity shape with all MFA/session/county/release flags false, unexpired matched invitation and request, primary-backed currently active reviewer independent from both applicant and inviter, a purpose-bound independent short-lived unconsumed approval and a one-use distinct nonce digest. Enrollment requires **no existing account**; activation requires an exact suspended current-primary account and a positive non-overflowed revision. Extra or forged metadata, bad epoch, time mismatch, replay flags, privilege uncertainty and invalid inputs all return `null`.
- A successful evaluator result is an immutable **review proposal only** with `accountMutation:'none'`, `requiresPrimaryTransaction:true`, `requiresDurableAudit:true`, and explicitly `mfaConfirmed:false`, `appSessionIssued:false`, `countyGrantConfirmed:false`, `releaseAuthorized:false`. **It is not authorization or proof that the underlying evidence was fresh or DB-locked.** The proposal is never an instruction that can directly create or activate a real account.
- **`docs/STEP-40C-62D-C14A-ENROLLMENT-SCHEMA-PRIVILEGE-REVIEW.md`** — a **non-executable**, review-only table design covering `enrollment_reviewer_authorities`, `enrollment_invitations`, `enrollment_requests`, `enrollment_approvals`, and append-only `enrollment_audit_events`. It documents composite invitation/identity FK, per-purpose one-use approval uniqueness, future locked primary-only transactions, audit-before-commit, reviewer bootstrapping and revocation, and a principal-by-table privilege matrix. The current `ldos_auth_gateway_login` and `ldos_auth_account_reader` must retain existing read-only rights.
- **`src/bdp/ingestion/parcelAuthDevEnrollmentReviewPolicy.test.mjs`** — **31** focused source-policy and schema-review contracts; deliberately no DB, network, Docker or Windows credential access.

## What remains unresolved (deliberately)

These new tables and reviewer roles are **not deployed**. The C14A policy accepts input described as trusted server-side snapshots, but no actual trusted reviewer authority, invitation issuance, approval receipt store or atomic writer exists yet. A JavaScript review proposal alone cannot prevent concurrent replay, prevent spoofed server dependencies, prove Supabase MFA or provide durable audit; those must be checked in C14B real disposable PostgreSQL tests and later operator-approved persistent changes.

**Current security defaults:** invitation-only, no self-approval, inviter cannot be the approving reviewer, approval is purpose-specific, 24-hour freshness cap for invitation/request, 15-minute approval cap, active applicant account never created automatically, suspended-first enrollment, separate reviewed activation, no county grants and no GIS rights. Business decisions (approver bootstrap, review governance, organization policy and hosted backend) must still be approved before public use.

## Operator C14A test steps — safe, source-only

From your existing `C:\Users\brand\gods-eye-view` PowerShell window:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevEnrollmentReviewPolicy.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

**Expected**: 31/31 focused tests, predicted **1,552/1,552** full land tests (1,521 prior operator-confirmed + 31) and a successful Vite production build. Predictions are **not verification**. If any step fails, stop and send the sanitized output. No PostgreSQL migration, permanent login role, DPAPI decryption, Supabase token, actual reviewer or account data is involved. The existing large-chunk Vite warning is unrelated and nonfatal.

## Next: C14B

After the C14A tests and build are confirmed, stage a separate, isolated PostgreSQL 17 synthetic enrollment/activation contract. It must exercise duplicate/replayed approvals, issuer/subject binding, independent reviewer authority, durable audit, account suspension and activation, monotonic revision under race, and rollback on failure, with no host network/ports/volumes and no exposure of the actual `ldos_auth_dev` database. Do not apply the proposed enrollment schema to the persistent database. The original God’s Eye View/Cesium interface, 2.4-km Free Explorer, Travis public boundaries and PostGIS remain untouched.

## Operator final verification — November 18, 2026

The two operator PowerShell screenshots confirm **31/31 C14A focused policy/security contracts passed**, **1,552/1,552 land regressions passed with zero failures, cancellations or skips**, and **Vite v6.4.5 build PASS** (250 transformed modules, ~4.68 s) using the previously successful 2,048-MB Node old-space override. The existing chunk-size warning remains nonfatal. These checks validate source and a non-executable schema design only; no enrollment tables, writer roles, requests, approvals, real account subjects, sessions or county grants have been created in persistent PostgreSQL. C14B now begins with new isolated synthetic PG-only evidence.
