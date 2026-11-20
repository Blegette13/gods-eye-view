# Step 40C-62D-C14B1 — Disposable enrollment schema and deny-first constraints

**Status November 18–19, 2026: C14B1 OPERATOR VERIFIED — 29/29 focused tests, isolated PostgreSQL 17 synthetic enrollment smoke PASS, 1,581/1,581 complete land tests (zero failures/skips) and successful Vite production build (250 modules, ~4.06s). Persistent auth-dev and GIS remained untouched by the disposable exercise.** This stage has **NO persistent migrations, no SQL LOGIN/writer credentials, no real Supabase users, no app sessions/county grants, and no GIS access.**

## Prior operator verification

The latest two operator screenshots confirm **31/31 C14A policy tests**, **1,552/1,552 full land tests** (zero failures, skipped or cancelled) and **successful Vite v6.4.5 build** (250 transformed modules, ~4.68s with `--max-old-space-size=2048`). That is the complete approved baseline before the new C14B1 files.

## What is staged

- `server/standalone/sql/landOsEnrollmentReviewDisposable.sql`: guarded, **disposable-only** PostgreSQL 17 SQL. It refuses all DB names other than `ldos_c14b_disposable`, standby databases, missing `ldos_app_auth` ledger relations, nonempty account/session/county tables, wrong SQL principal, or preexisting `ldos_auth_gateway_login` role. It starts one transaction with 5s lock timeout/30s statement timeout and creates **only** 5 review tables: `enrollment_reviewer_authorities`, `enrollment_invitations`, `enrollment_requests`, `enrollment_approvals`, and `enrollment_audit_events`.
- Schema enforces reviewer default-revoked/no-scope, invitations default-revoked, requests default-pending, approvals default-deny/revoked, account/identity foreign-key bindings, uniqueness of invitation and approval nonce digests, `UNIQUE(request_id,purpose)` approval reuse prevention, 24-hour invitation/request lifetime and 15-minute approval lifetime. It uses PostgreSQL revision and state-transition trigger functions for immutable identities/nonce/expiry, nonzero monotonic revisions, terminal-state and DELETE/TRUNCATE rejection, and append-only audit rows. It adds the exact `UNIQUE(request_id,subject)` needed for the audit composite FK and revokes PUBLIC table/function rights.
- **`scripts/bdp/app-auth-enrollment-schema-disposable-smoke.mjs`**: requires precisely `--disposable-only`. It checks local `postgres:17` image without pulling, creates a **new randomly named** `--network none` container with no host port, no mounts or persistent named volume and new DB `ldos_c14b_disposable`, loads the original ledger and the reviewed C14B1 schema (pinned to the revised exact Git blob `5f10c530c7c5e801e7ad0d9733fcb48a2abcf5f8`), and runs a disposable synthetic review fixture. It probes default-deny, subject/issuer FK and duplicate request, self-review denial, two separate approval purposes, one-use consumption/replay denial, suspended-first account, revision increments, append-only audit, failed audit insert rollback, empty session/county tables, and no created persistent gateway/writer role. Any failure returns a sanitized stage summary without synthetic SQL/passwords; it attempts to remove **only its newly created container**.
- **`src/bdp/ingestion/parcelAuthDevEnrollmentDisposableSchema.test.mjs`**: **29** source-contract tests for exact staging/DB guard, role and table boundaries, referential constraints, revision/audit semantics and Docker containment.

### Critical limitation — this is NOT yet an authorized account enrollment transaction

The synthetic fixture uses the **disposable database superuser** to insert/transition test records in multiple individual transactions. This proves **schema, trigger and foreign-key behavior**, but it **does not** establish a trusted writer, a currently verified independent reviewer, a transactional identity-to-approval lock, guaranteed audit append on every real account write, or replay safety under concurrent requests. The fixture demonstrates an intentionally rejected transaction rolling back, **not** an atomic app-enrollment writer. The schema alone cannot prevent a database owner from bypassing guards or creating an approval without an independent policy check.

**C14B2 must** separately design and test a confined, purpose-specific transaction/writer and an independent reviewer authority/bootstrap protocol. Until that happens, do not apply this schema to persistent `ldos_auth_dev` or create any real application account. The existing `ldos_auth_gateway_login` and NOLOGIN reader rights remain unchanged.

## Operator steps — no persistent database mutations

In the existing PowerShell checkout `C:\Users\brand\gods-eye-view`, run one at a time and stop on any failure:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevEnrollmentDisposableSchema.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected focused **29/29**, predicted complete land **1,581/1,581** (1,552 previously confirmed + 29) and successful Vite build. These are **predictions**, not completed operator checks. Vite's large chunk warnings are nonblocking.

**Only after all four checks pass**, and Docker Desktop is available, separately run the isolated real PG test:

```powershell
node scripts/bdp/app-auth-enrollment-schema-disposable-smoke.mjs --disposable-only
```

Expected:

```text
PASS: C14B1 isolated PG17 enrollment schema, deny-first defaults, identity/FK bindings, immutable revisions, audit append-only, replay and rollback constraints; no persistent databases touched.
```

If any command fails, stop; do not rerun blindly. Inspect any cleanup warning for the temporary container; **never** run Docker cleanup affecting the persistent `ldos-auth-dev-auth-postgres-1`, its named volume, Supabase or parcel/PostGIS. No real token, UUID, DPAPI file or password should be pasted into chat.

## Next checkpoint

If operator tests and disposable PG proof pass, stage **C14B2**, an atomic, independently authorized suspended enrollment + separate activation transaction in a disposable database. Validate denial of replay, stale reviewer/identity, missing audit, races, and any unintended table access under a restricted new writer. No permanent auth schema/credential changes until a separate backup, recovery, approval and role-review gate.

## Failure investigation and scoped correction — November 18, 2026

Operator screenshots confirm the first C14B1 full regression **1,579/1,579 PASSED** and **Vite build PASSED** (250 modules, ~4.56s). The first real disposable PG17 smoke returned the sanitized failure stage **`defaults and separate reviewers`**. No persistent target was touched, and that isolated smoke cannot be marked complete. Code inspection identified a likely trigger issue: a single shared `BEFORE INSERT` expression combined different enrollment table `NEW.*` attributes with `TG_TABLE_NAME` conditions. On a reviewer row, PostgreSQL may still resolve/evaluate `NEW.consumed_at`, `NEW.invitation_state`, or `NEW.request_state` even though those fields belong to different tables. This can cause an undefined-record-field error when inserting a reviewer. **Likely cause, not yet confirmed by a raw SQLSTATE.**

The SQL has been corrected to branch on `TG_TABLE_NAME` **before** reading any table-specific `NEW` attribute. The new source pin is `5f10c530c7c5e801e7ad0d9733fcb48a2abcf5f8`; the disposable smoke now uses four precise sanitized reviewer substage labels (default insert, default SELECT, revoked-to-active denial, reviewer seed), allowing a safe diagnosis if another failure occurs. Two additional offline checks protect against reintroducing the cross-table field reference and verify diagnostics (new focused count **29**; next full total **1,581**, if no other changes). A static source-assertion replay found 29/29 satisfied, but **real Node/PG17 runtime remains operator pending**.

Do **not** attempt any persistent auth-dev SQL migration or cleanup. Update the branch, run the focused test, then the single scoped disposable proof. Stop if either fails. Re-run the full land regression and build after the focused Docker proof passes; there is no need to rerun the already green original 1,579-test suite to diagnose the PG trigger before the next runtime smoke.

## Operator final C14B1 verification

Two supplied PowerShell screenshots independently confirm **29/29 focused security tests passed**, exact isolated **`--disposable-only` PostgreSQL 17 PASS** covering deny-first enrollment defaults, identity/FK binding, immutable revisions, append-only audit, replay and rollback constraints, and **1,581/1,581** complete land tests passed with zero failures, skips, or cancellations. Vite v6.4.5 completed a production build (250 transformed modules, **4.06 seconds** with the 2,048-MB Node heap workaround). The large chunk warning is nonfatal. The previously diagnosed shared-trigger `NEW` field issue was resolved and live PostgreSQL behavior has now been confirmed. This stage verifies **schema/constraint behavior under a disposable synthetic database owner**, NOT an independently authorized writer or an atomic enrollment/activation procedure. C14B2 must implement and prove those separately.
