# Step 40C-62D-C14B2A — Atomic account transition prototype (disposable SQL only)

**Status November 18–19, 2026: operator-verified 29/29 focused C14B2A source tests, exact `--plan-only` PASS, and successful Vite production build (250 modules, ~4.46 seconds). The screenshot does NOT show the separate full land-regression count. Real atomic SQL execution remains UNVERIFIED until C14B2B; persistent auth-dev untouched.**

## Confirmed starting point

The operator's two PowerShell screenshots confirm **29/29 focused C14B1 source tests passed**, the **real disposable PostgreSQL 17 enrollment schema smoke passed**, **1,581/1,581 complete land tests passed** (0 failures/skips), and **Vite v6.4.5 production build passed** (250 modules, ~4.06 seconds, using 2,048-MB Node heap). C14B1 exercised schema/FK/revision/audit behavior on synthetic records under a temporary database owner, but it did **not** prove a single atomic enrollment or activation transaction or a restricted writer.

## Source now staged

- `server/standalone/sql/landOsEnrollmentAtomicDisposable.sql` — a **PostgreSQL 17 disposable-only prototype** that must be manually reviewed and later tested exclusively in a brand-new `ldos_c14b_disposable` instance. The top-level DDL refuses the production auth-dev name, standby, unexpected SQL operator, missing C14B1 tables, existing gateway/writer roles or preexisting prototype. Creates **one** `SECURITY INVOKER` function, `ldos_app_auth.disposable_enrollment_transition`, and revokes PUBLIC execution. It does **not** create any app LOGIN, grant, new table, row, account, session, county grant or GIS privilege at install time.
- The prototype function is deliberately **synthetic-owner-only**, not a deployable writer. Every invocation demands `SERIALIZABLE`, writable primary, exact disposable database, and the synthetic SQL operator; a future trusted enrollment writer must use a separately reviewed authorization boundary. It locks request → invitation → reviewer authority → approval → account (fixed order), validates subject+issuer, separate reviewer/inviter/applicant, active reviewer permission, unexpired independent one-use approval bound to a distinct purpose, and current account/approval/revision state. In one caller-owned transaction it would insert an account using its database-default **suspended** state *or* update a suspended account with exact revision to active; consume one approval; advance request state; append an audit event; and return the new account revision. A failure before COMMIT must roll back the entire transaction, including the audit. It **does not run any transaction here**.
- `scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs` — accepts **only `--plan-only`**, validates exact reviewed Git blob **`ce88fe8f4aeda3077fe3a03d19a0b4085a3e0004`** and fixed security strings, prints one static message. It does not invoke PostgreSQL, Docker, shell, network, environment secrets or filesystem writes.
- `src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposablePlan.test.mjs` — **29 new offline source contracts**. An isolated static JavaScript assertion replay found 29/29 passing, but **the operator's actual Node runner has not yet been run**.

**Important limitations:** Source-only checks and a prototype without real SQL execution are not proof of correct atomicity, privilege enforcement, concurrent replay protection, trusted reviewer bootstrapping, or actual application authorization. This function is `SECURITY INVOKER` and owner-gated, with **no grant** for any app role. The C14A review proposal alone is never sufficient authority to execute an account write.

## Operator commands — safe review only

In the existing `C:\Users\brand\gods-eye-view` PowerShell window, run separately:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposablePlan.test.mjs
node scripts/bdp/app-auth-enrollment-atomic-disposable-plan.mjs --plan-only
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Predicted: **29/29** focused tests, exact plan message below, **1,610/1,610** complete land regressions (1,581 previous operator-confirmed + 29 new), and a successful Vite production build.

```text
PLAN: C14B2A guarded serializable enrollment/activation SQL reviewed for isolated synthetic PostgreSQL only; no database connection or writes.
```

**Do not run the SQL manually or against persistent `ldos_auth_dev`.** There is currently **no C14B2A disposable integration runner** and no approved persistent migration. No reason to inspect or send DPAPI secrets, real Supabase tokens, account UUIDs, reviewer identities or database backups in chat. If a focused test or plan fails, stop and send sanitized failure output.

## Next separately staged test

**C14B2B: fresh isolated PostgreSQL 17 integration exercise.** Create a new `--network none`, no-port, no-volume randomly scoped container, load C14B1 reviewed schema and this pinned C14B2A SQL, seed only synthetic reviewer/invite/request/approval fixtures, and explicitly test two separate `BEGIN ISOLATION LEVEL SERIALIZABLE` transactions: suspended account + audit on enrollment, activation only with a fresh approval and expected revision. Prove rollback on duplicate audit, consumed/expired or mismatched approvals, stale reviewer, subject mismatch, duplicate account and replay; verify no session/county grants. Then separately design/test an independent restricted writer **with trusted reviewer authorization**. C14B2A approval is **not** authorization to publish API routes or activate real accounts.

The existing God’s Eye View/Cesium 2.4-km Explorer, Travis County public parcels, separate PostGIS and local protected gateway reader are unchanged.

## Operator C14B2A validation evidence

Latest PowerShell screenshot independently verifies **29/29 focused C14B2A tests (0 failures)**, **`--plan-only` exact fixed PASS line**, and a **successful Vite 6.4.5 production build** (250 modules, ~4.46s). The screenshot does **not** show the `npm.cmd run test:land` result, so **1,610 full regressions remain unconfirmed** from the provided evidence. The focused result is only a source contract and plan check—not real PostgreSQL execution. A new isolated disposable PostgreSQL 17 runner is staged in C14B2B for that proof, without changing the persistent database.
