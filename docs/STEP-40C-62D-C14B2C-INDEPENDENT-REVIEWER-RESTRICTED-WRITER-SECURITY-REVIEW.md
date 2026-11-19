# Step 40C-62D-C14B2C — Independent reviewer authority and restricted enrollment writer: pre-implementation security review

**Status: design checkpoint (November 19, 2026). NOT a migration, executable SQL, source of authentication authority, or production authorization.** This document may be reviewed without PostgreSQL or Docker. No account data, login, reviewer credential, schema, Supabase user, or GIS privileges are changed here.

## Verified foundation

Operator screenshot confirms **C14B2B real isolated PostgreSQL 17 `--disposable-only` PASS**, demonstrating serializable suspended enrollment, independent-purpose activation, consumed approval, audit insert in the same transaction, replay denial and audit failure rollback using **synthetic data under a disposable database owner**. The same screenshot shows Vite 6.4.5 build PASS (250 modules, 4.30s). The screenshot does **not** show the 22 C14B2B focused Node contracts nor the full 1,632 land-test summary; these remain separate evidence gates.

The existing persistent local `ldos_auth_dev` database contains only the previously installed authentication ledger, NOLOGIN reader, and restricted gateway LOGIN established in C11. None of the C14B schema and function prototypes have been applied there. Do not rerun C11 Apply or apply C14B SQL to a persistent database.

## Principal separation — mandatory

**Keep existing roles unchanged:**

- `ldos_auth_gateway_login`: existing restricted LOGIN, NOINHERIT, only SET-only membership in `ldos_auth_account_reader`. **No** enrollment INSERT, UPDATE, approval issuance, audit writes or access to new review tables.
- `ldos_auth_account_reader`: existing NOLOGIN; only the fixed primary-account columns `subject`, `account_state`, `revision`, read under a verified READ ONLY transaction. **Never** grant it enrollment writers' rights.

**Future roles (not yet created; proposed names):**

| Principal | SQL LOGIN? | May use trusted procedure | Direct table privileges | Other |
| --- | --- | --- | --- | --- |
| `ldos_auth_enrollment_executor_login` | Yes; protected server-only credential, NOINHERIT | EXECUTE **only** an audited, state-checked transition entry point | **None** on accounts/approvals/invitations/requests/audit; no county or sessions | Never issue/revoke approvals or change reviewer authority |
| `ldos_auth_review_issuer_login` | Yes; separate server-owned credential, NOINHERIT | EXECUTE **only** a guarded review/approval issuance entry point | **None** on accounts, sessions, county grants or GIS; no generic review-table writes | Cannot call transition entry point |
| `ldos_auth_enrollment_writer` | **NOLOGIN**; function owner under controlled migration | Owner of narrowly scoped transition routine | Only the columns/relations required to validate evidence, transition accounts, consume approvals and append audit; no DDL, ownership of tables, BYPASSRLS or session/county/GIS rights | No LOGIN membership to app subjects; do not grant this role wholesale to executor |
| `ldos_auth_review_issuer_writer` | **NOLOGIN**; distinct routine owner | Owner of narrowly scoped approval issuance routine | Only specific approval issuance and validation requirements; never account activation | No role escalation, table ownership, sessions, county or GIS |

The table describes *future minimum rights*, not PostgreSQL grants. A schema USAGE grant may be necessary for procedure execution, but must not imply SELECT/INSERT/UPDATE/DELETE on any auth or enrollment table. PostgreSQL's default function EXECUTE to PUBLIC must be revoked **within the creating transaction** before any app role is granted EXECUTE. Function owner must not be superuser, `CREATEROLE`, `CREATEDB`, `BYPASSRLS`, or hold inherited privileges.

## Approval authority cannot come from request metadata

A verified Supabase identity proves the **applicant's identity**, not reviewer permission. The executor cannot accept or trust a caller-supplied `approved=true`, admin role string, arbitrary reviewer UUID, county code, JWT metadata or a C14A non-authorizing proposal as a capability to write.

Approval issuance must instead require **an independently authenticated active reviewer**, current authority from the app-owned primary, issuer/project binding, a purpose-specific request and nonce digest, short expiry, independent inviter/reviewer/applicant, and an auditable state transition. Authorizing reviewer access cannot be self-bootstrapped via a web token. First reviewer bootstrap requires an explicit audited operator ceremony (separate approval, protected operator credentials, rollback and revocation plan) before real deployment.

The executor consumes an already issued, independently verified approval. It must **re-read and lock the reviewer authority, request, invitation, approval and account rows** within its transaction. This is a fail-closed snapshot check, not an opportunity to mint an approval or infer MFA. The C14B2A disposable owner-gated function is **not** suitable for direct deployment or for simply changing `current_user='postgres'` to a LOGIN.

## Transition requirements for the future restricted function

1. Run on an attested writable **current primary** with a fixed database/schema, `SERIALIZABLE` transaction and short lock/statement timeouts. All SQL identifiers and search paths must be fixed and audited. Avoid unsafe dynamic SQL and unreviewed SECURITY DEFINER ownership.
2. The **enroll_suspended** path requires an absent subject and consumed-once, purpose-bound approval. Insert only `accounts(subject)` and rely on DB defaults `suspended`, revision 1. Never UPSERT/restore a previously closed account to active.
3. The **activate** path must use a distinct fresh approval, an existing suspended account and the exact current account revision. Update only account_state to active; revision increments through the existing DB guard. Review primary status and revocation atomically.
4. Transition the request state, consume the approval, and append the mandatory audit event **within the same transaction**. If any statement or audit insert fails, rollback every change. No response on a partial state.
5. Enforce one-use approval uniqueness and replay denial with DB constraints and locked current state; on `40001` serialization failures, retry only the **complete** transaction with bounded attempts and fresh revalidation—never an individual account update or stale approval.
6. Fail closed for revoked/stale reviewers, mismatched issuer/subject, expired/consumed approvals, missing audit receipt, missing account, closed/active account, revision overflow, duplicated nonces, unexpected table privileges and recovery/replica targets.
7. Separately require verified MFA and a real app session **before** any future application-wide authenticated endpoint; independently verify county entitlements, licensed source rights and GIS release rights for every protected property response. Account activation alone does not grant any county access.

## C14B2C implementation gates (in order)

**C14B2C1 — disposable role and grant matrix:** Build exact PostgreSQL 17 role definitions under `--network none`, no host ports or persistent volumes. Prove two LOGIN identities (disposable synthetic credentials) cannot directly SELECT or mutate accounts, sessions, counties, reviewer authority, invitations, requests, approvals or audit. Prove they cannot SET ROLE to a privileged owner or to each other. Prove current reader role remains unchanged.

**C14B2C2 — independent issuance procedure:** Separate a review-issuer function from enrollment execution. Verify issuance can be initiated only by an independently authorized reviewer and cannot be forged by executor, user metadata or applicant. Test revoked/self-approving reviewer, different inviter requirement, expiry and consumed/duplicate nonce under real SQL.

**C14B2C3 — restricted atomic writer and concurrency:** Use separate NOLOGIN function owners, locked primary rows and serializable transactions; test two racing enrollments, duplicate activation, replay after revocation, audit-write failure and full rollback. An actual PostgreSQL privilege postflight must verify precisely the intended EXECUTE grants and no direct table access. The prior C14B2B owner test alone is insufficient.

**C14B2C4 — recovery, operator approval and limited persistent dev deployment:** Only after a new disaster-recovery/restore drill, role backup, explicit operator authorization, audit/revocation/credential rotation plan and confirmed C14B2C1–C3 tests. Until then **do not apply any new C14B SQL to persistent `ldos_auth_dev`**.

## Stop conditions and current next action

Before any C14B2C implementation or live operator action, confirm the focused C14B2B test and complete land suite from the existing checkout if they were not already executed:

```powershell
node --test src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposableSmoke.test.mjs
npm.cmd run test:land
```

Expected from the staged sources: **22 focused tests** and **1,632 total**. These are predictions, not verified screenshots. If either fails, stop and review the sanitized output; do not operate on the persistent auth database.

This security review makes no changes to God’s Eye View/Cesium, 2.4-km Free Explorer, Travis County parcel boundaries, PostGIS, TCEQ data, account reader or protected gateway.
