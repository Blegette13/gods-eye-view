# Step 40C-62D-C14A — Enrollment schema and privilege review (NON-EXECUTABLE DESIGN)

**REVIEW ONLY. Not PostgreSQL SQL, not a migration and not permission to create accounts.** No DDL or credentials are required to inspect this contract. C14B must write and test an independent, exact-target, isolated PostgreSQL 17 migration before any persistent authorization changes.

## Scope and invariants

An identity verified by the trusted Supabase `/auth/v1/user` server remains **unentitled** until a separately controlled account enrollment is reviewed and activated. All decisions must be re-read under one primary PostgreSQL transaction, with row locks, unique replay protection, a separate approver (distinct from the applicant and inviter), and a durable audit event. The existing `ldos_app_auth.accounts` table remains the only application-account authority. No HTTP cookie, MFA state, GIS license, county grant or permission is inferred.

The following proposed tables are **new** relations in the existing **separate** `ldos_app_auth` schema; they do not belong in Supabase Auth or the parcel PostGIS schema. Names, fields, constraints and rights must be checked again before implementing C14B SQL.

## Proposed database tables (design contracts, not executable commands)

**`ldos_app_auth.enrollment_reviewer_authorities`**

| Column | PostgreSQL type | Requirement |
|---|---|---|
| `reviewer_subject` | `uuid` | Primary key, independently verified reviewer identity |
| `authority_state` | `text` | NOT NULL, DEFAULT `'revoked'`, CHECK `IN ('active','revoked')` |
| `authority_scope` | `text` | NOT NULL, DEFAULT `'none'`, CHECK `IN ('none','account_enrollment_review')` |
| `revision` | `bigint` | NOT NULL, DEFAULT `1`, positive, immutable for callers and bumped atomically by a DB revision guard |
| `created_at` | `timestamptz` | Server-owned timestamp, never user-supplied |

**`ldos_app_auth.enrollment_invitations`**

| Column | PostgreSQL type | Requirement |
|---|---|---|
| `invite_id` | `uuid` | Server-generated, PRIMARY KEY |
| `subject` | `uuid` | Verified invitee subject, NOT NULL |
| `issuer` | `text` | Exact, pinned Supabase project `/auth/v1` issuer, NOT NULL |
| `issued_by` | `uuid` | REFERENCES `enrollment_reviewer_authorities(reviewer_subject)` |
| `nonce_digest` | `text` | UNIQUE, 64 lowercase hexadecimal characters; **digest only**, no raw invitation secret |
| `invitation_state` | `text` | NOT NULL, DEFAULT `'revoked'`, CHECK `IN ('pending','redeemed','revoked')` |
| `expires_at` / `created_at` | `timestamptz` | NOT NULL, controlled window `0 < expires_at-created_at <= interval '24 hours'` |
| `revision` | `bigint` | NOT NULL, DEFAULT `1`, positive; DB-managed monotonic updates |
| Composite identity | `UNIQUE(invite_id,subject,issuer)` | Allows request-to-invitation binding without changing the applicant |

**`ldos_app_auth.enrollment_requests`**

| Column | PostgreSQL type | Requirement |
|---|---|---|
| `request_id` | `uuid` | Server-generated PRIMARY KEY |
| `invite_id` | `uuid` | NOT NULL, UNIQUE: one request per invitation |
| `subject`, `issuer` | `uuid`, `text` | NOT NULL, `FOREIGN KEY(invite_id,subject,issuer)` REFERENCES `enrollment_invitations(invite_id,subject,issuer)` |
| `request_state` | `text` | NOT NULL, DEFAULT `'pending'`, CHECK `IN ('pending','approved_for_enrollment','denied','enrolled_suspended','activated','revoked')` |
| `expires_at` / `created_at` | `timestamptz` | NOT NULL, bounded at 24 hours |
| `revision` | `bigint` | NOT NULL, DEFAULT `1`, DB-managed monotonic updates |

**`ldos_app_auth.enrollment_approvals`**

| Column | PostgreSQL type | Requirement |
|---|---|---|
| `approval_id` | `uuid` | Server-generated PRIMARY KEY |
| `request_id` | `uuid` | NOT NULL, REFERENCES `enrollment_requests(request_id)` |
| `reviewer_subject` | `uuid` | NOT NULL, REFERENCES `enrollment_reviewer_authorities(reviewer_subject)`; reviewer MUST differ from invitee and inviter |
| `purpose` | `text` | NOT NULL, CHECK `IN ('enroll_suspended','activate')`; **separate approval for activation** |
| `decision` | `text` | NOT NULL, DEFAULT `'deny'`, CHECK `IN ('approve','deny')` |
| `approval_state` | `text` | NOT NULL, DEFAULT `'revoked'`, CHECK `IN ('unconsumed','consumed','revoked')` |
| `nonce_digest` | `text` | UNIQUE, 64-char hex digest, distinct from invitation nonce |
| `expires_at` / `created_at` | `timestamptz` | NOT NULL, at most 15 minutes |
| `consumed_at` | `timestamptz` | NULL before use; write once under the same transaction that changes account/request and writes the audit event |
| `revision` | `bigint` | NOT NULL, DEFAULT `1`, DB-managed monotonic updates |
| Replay index | `UNIQUE(request_id,purpose)` | One terminal approval per transition; denied or expired attempts require a newly controlled request rather than silent overwrite |

**`ldos_app_auth.enrollment_audit_events`**

| Column | PostgreSQL type | Requirement |
|---|---|---|
| `event_id` | `uuid` | Server-generated PRIMARY KEY |
| `request_id` | `uuid` | NOT NULL REFERENCES `enrollment_requests(request_id)` |
| `subject` / `reviewer_subject` | `uuid` | NOT NULL; reviewer remains independently verified |
| `event_type` | `text` | CHECK `IN ('requested','reviewed','denied','enrolled_suspended','activated','revoked')` |
| `account_revision` | `bigint` | NULL for intake; positive exact revision when changing an account |
| `occurred_at` | `timestamptz` | NOT NULL, DB-owned timestamp |
| Immutability | Policy/trigger | No UPDATE, DELETE or TRUNCATE by normal writer; append-only; primary transaction must fail if audit append fails |

**No table stores raw access tokens, JWTs, refresh tokens, plaintext invitation/approval secrets, passwords, GIS records, email addresses or personal names.** Digest generation/rotation, reviewer revocation, encryption-at-rest and audit retention policy still require detailed review.

## Privilege and operation matrix (proposed future roles)

| Principal | Existing `accounts` | `sessions` / `county_grants` | Enrollment review tables | DDL / GIS |
|---|---|---|---|---|
| Browser, Supabase user metadata, PUBLIC | DENY | DENY | DENY | DENY |
| Existing `ldos_auth_gateway_login` | **NO CHANGE**: SET-only reader membership; fixed 3-column SELECT after role switch | DENY | DENY | DENY |
| Existing `ldos_auth_account_reader` (NOLOGIN) | SELECT only `subject, account_state, revision` | DENY | DENY | DENY |
| Future enrollment operation LOGIN (not created) | No direct grants; future SET-only specific writer role | DENY | No direct grants | DENY |
| Future `ldos_auth_enrollment_writer` (NOLOGIN, not created) | Minimum `INSERT(subject)`; column-limited controlled `UPDATE(account_state)` only after serializable review | DENY | Purpose-limited access to invitations, requests, approvals, reviewer authority and audit append; avoid broad table rights | DENY |
| DB owner / break-glass operator | Separately audited, never used for app requests | Privileged only during explicit migration/recovery | DDL under dedicated migration review | No automatic GIS/source permission |

These are **proposed grants only**, not SQL commands and not deployed roles. A future writer must never be granted ownership, `SUPERUSER`, `CREATEROLE`, `BYPASSRLS`, account `revision` updates, or arbitrary `DELETE`/`TRUNCATE`. Granting a writer INSERT/UPDATE is dangerous until the DB-enforced approval transaction is proven in a disposable database. The application must not treat the pure C14A JavaScript policy output as permission to call SQL directly.

## Required atomic SQL workflow in C14B (not implemented here)

For **enroll_suspended**: in a single reviewed primary transaction, check verified current identity/issuer, lock the invitation, request, reviewer authority and unique unconsumed `enroll_suspended` approval, enforce short expiry and independent reviewer/issuer, append audit, consume approval, **INSERT `accounts(subject)` only with database-default `account_state='suspended'`, `revision=1`**, advance request state, and commit. Missing audit, duplicate subject, stale authority, concurrent consumption, vanished identity or any check failure **ROLLBACK**. Never use an upsert that reactivates or resets a historical account.

For **activate**: require a **new** unconsumed `activate` approval; re-read/lock current `accounts` and reviewer and request; check request state `enrolled_suspended`, account still suspended, exact expected account revision and primary freshness; append audit and consume approval in the same transaction as column-limited `UPDATE account_state='active'`. The existing account revision trigger must advance monotonically, preventing stale/replayed activation. Closed/active/missing account, self-approval, expired evidence or restored older epoch always denied. No writer can issue app sessions or county grants during this workflow.

## Unresolved release/security gates

- How reviewer identities get initially provisioned and independently authenticated; how to avoid an untrusted self-appointed first admin (bootstrap ceremony).
- Single vs. two reviewers, organization scope and out-of-band escalation; current review policy demands **inviter and reviewer be different people**, in addition to reviewer != applicant.
- Who signs/validates invitation and approval tokens and how digest/nonce replay is enforced under concurrent requests.
- Transaction isolation (`SERIALIZABLE` or explicit locks), backup/restore epoch fencing, monotonic row revisions through restoration, durable audit retention and rotation.
- Production hosting, long-lived PostgreSQL credential rotation, Supabase MFA assurance, county licensing and privacy governance.

**Acceptance for C14B:** no persistent SQL changes; implement and verify isolated `postgres:17` migrations with synthetic UUIDs, strong DB constraints/role grants and rollback tests before even considering development account creation.
