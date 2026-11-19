# Step 40C-62D-C14 — Controlled application-account enrollment / activation: security architecture

**Status November 18, 2026: DESIGN STAGED for review. No account data, SQL role, migration, application-session route, GIS grant, Supabase profile or production deployment created by this document.**

## Verified baseline

Operator screenshots confirm **22/22 C13 focused integration contract tests**, **1,521/1,521 total land tests** (zero failures/skips) and a green Vite v6.4.5 production build (250 modules, ~4.35 seconds, 2 GiB Node old-space). C13 composes a real restricted account reader architecture with a trusted Supabase identity verifier, but remains **server-only/unrouted**. Previously, C12's real persistent restricted node-postgres connection passed independently. As of C12, local `ldos_auth_dev` had **no accounts, sessions or county grants**; C13 only ran mocks and did not change database rows.

## Objective: add the first real app-owned account *safely*, not automatically

Identity verification by Supabase `/auth/v1/user` says who holds the provider token. It **does not mean** that person has a Land Development Operating System account, active status, county access, MFA assurance, a session, or GIS redistribution rights.

The next substantive implementation must separate **intake**, **operator review**, **denied-first enrollment**, and **activation**. An account created in `ldos_app_auth.accounts` must default to `suspended` at revision 1 until a separately authenticated and auditable operator action approves activation.

## Proposed trust boundaries

1. **Provider identity:** server verifies the Supabase access token through the exact trusted /user boundary and pins the expected issuer. Never trust browser-supplied UUID, role, county, metadata or asserted MFA.
2. **Review intake:** record only a request intent, with a server-generated random request ID and verified `subject`/issuer. Intake creates **no app account** and requires an anti-replay, time-limited operator workflow.
3. **Operator authority:** a different server-held verifier must establish an authorized approver, independent of the requesting identity; reviewer cannot self-approve. Authorization must be tied to a revocable organization/role policy defined on the app-owned primary, not to untrusted Supabase user metadata. An independent approval receipt must have explicit purpose, subject, nonce, expiry, reviewer identity and state.
4. **Durable audit before rights:** use append-only, server-owned audit events recording request, review, denial, enrollment and activation transitions. Store only necessary pseudonymous identifiers; never raw bearer tokens, password, DPAPI secret, access claims or GIS data.
5. **Dedicated writer:** prepare a different, restricted role with only specifically reviewed `INSERT`/controlled `UPDATE` capability for app-owned accounts, not the existing `ldos_auth_gateway_login`. Avoid granting table ownership, session/county table rights, schema DDL or generic `SECURITY DEFINER` rights. Design a transactionally enforced writer procedure that validates approval evidence under server control, not a client-supplied Boolean.
6. **Persist suspended first:** enrollment of an approved, previously absent verified subject creates `ldos_app_auth.accounts(subject)` with DB-default `account_state='suspended'` and `revision=1`. Concurrent duplicate/replayed attempts must be safe and cannot reset revision or overwrite existing status.
7. **Activation separately:** an approved, current primary transaction changes only an enrolled suspended row to active. The existing revision trigger bumps revision monotonically. Closed, already-active, missing, stale/replica, restored or corrupt state fail closed; no physical delete or row recreation. Reviewer authorization and audit event must be enforced in the same logical workflow as the state change.
8. **Freshness/revocation:** a valid provider identity plus active app account gives only an **unrouted candidate**. A production auth session requires separate recent MFA assurance and session integrity; every parcel release requires current county entitlement and separate documented source licensing/GIS distribution authorization.

## Proposed implementation order — no persistent database writes in initial stages

**C14-A: source contracts and schema review.** Define exact enrollment-request/approval/audit schema, trusted admin authority, replay prevention, account writer privilege matrix and rejection cases. Review cross-database identity binding, transaction isolation and rollback/restore epoch fencing. No HTTP handler or actual database write.

**C14-B: disposable real PostgreSQL 17 proof.** In a brand-new isolated synthetic Docker database, exercise duplicate requests, default suspended enrollment, independent approval, controlled activation, account ABA revisions, audit consistency, denial under restricted reader, race/replay cases and rollback. No real Supabase UUID/account subject in this stage.

**C14-C: explicit operator gate.** Before a local persistent dev migration, independently prove a new backup/restore and cluster-role snapshot; review the exact DDL, writer credentials/rotation, scope, rollback and real operator approval control. Never run new privileged SQL on Supabase Auth, parcel PostGIS, or a production database.

**C14-D: controlled local development account only after approval.** Link an explicitly approved real development Supabase subject to the private app ledger; enroll suspended, verify denied C13 candidate, and only separately approve active state. No automatic registration, default active account, cookie session, MFA bypass, county entitlement or private geometry.

## Open product/security decisions (to be resolved before implementation is activated)

- Who can approve new application accounts (single administrator vs. independent second reviewer, organization scope and break-glass policy)?
- Will enrollment be invitation-only initially? **Recommended: yes**, since self-signup should not imply land intelligence entitlements.
- Which audit retention, privileged access review and recovery requirements apply before production launch?
- Which hosted backend and private primary PostgreSQL deployment will replace the local Windows-DPAPI/Docker development environment?

**Safe interim defaults:** invitation-only, no auto-activation, no self-approval, short-lived one-use approvals, primary-only writes, no county grants, no GIS release, fail closed on unknown evidence.

## Deliberately unchanged

Existing God’s Eye View/Cesium 2.4 km Explorer, Travis County public browsing, property panels, boundary quality and explicit unknown-data behavior remain untouched. C14 planning must not repurpose `ldos_auth_gateway_login` into a writable account role or route the C13 candidate to the browser.

## Acceptance criteria to start the next code phase

C14-A is ready for implementation when the exact review schema, separate admin writer threat model, table-grant matrix, trusted approval authority and restore-safety tests are specified. All source code should first be tested offline/disposably and separately run through `npm.cmd run test:land` and the 2-GiB Vite build. There is no reason to run an SQL migration or provide any secret as part of this design checkpoint.

## C14-A source and schema checkpoint — November 18, 2026

C14A has now been **staged** on `bdp-development`: `server/providers/bdp-unrouted-account-enrollment-review-policy.js`, `src/bdp/ingestion/parcelAuthDevEnrollmentReviewPolicy.test.mjs` (31 offline contracts), `docs/STEP-40C-62D-C14A-ENROLLMENT-SCHEMA-PRIVILEGE-REVIEW.md` (non-executable proposed schema and privilege matrix) and `docs/STEP-40C-62D-C14A-ENROLLMENT-POLICY-STAGING.md` (operator checklist). An isolated V8 assertion replay found **31/31** tests satisfied, but the operator's Node runner and full regressions/build are **not yet verified**. A positive output is explicitly a **non-authorizing review proposal**, not an account enrollment or activation. No real database, SQL role, approval, session, county grant or GIS modifications occur. Once operator verification passes, the next safe phase is a new synthetic disposable PostgreSQL 17 design and test of atomic audited enrollment/replay refusal, before any persistent DDL or actual app-user state.

## C14B1 staged — isolated PostgreSQL 17 schema and constraint proof (November 18, 2026)

C14A was operator-verified (31/31 focused tests, 1,552/1,552 full land tests, successful Vite build). **C14B1 is now staged but not yet operator-verified:** a reviewed SQL source restricted by a database-name guard to the new `ldos_c14b_disposable`, a `--network none`/no-port disposable PostgreSQL 17 smoke, and 27 offline contracts. The smoke includes only synthetic subject/reviewer/invitation/request/approval/audit data, denied defaults, FKs, one-use approval/purpose constraints, immutable revision guards, audit-row append-only behavior, and rollback after a rejected audit. It deliberately uses a fixture database owner, **not a production-safe enrollment writer or authorized review workflow**; it cannot prove atomic enrollment or approval issuance. No persistent `ldos_auth_dev`, GIS, Supabase, app user or browser changes. Detailed operator instructions: `docs/STEP-40C-62D-C14B1-DISPOSABLE-ENROLLMENT-SCHEMA.md`. After C14B1 validation, C14B2 must create independently verified restricted writer/atomic audit enforcement in another disposable-only gate before any persistent migration is considered.

## C14B1 final operator PASS → C14B2A source prototype staged

Operator screenshots now confirm the corrected C14B1 **29/29** offline checks, **real isolated PostgreSQL 17 enrollment smoke PASS**, **1,581/1,581** full land regression PASS, and Vite build PASS (~4.06 seconds, 250 modules). C14B1 is complete for synthetic schema/constraint behavior, not a deployed approval/enrollment system. On that baseline, C14B2A adds a strictly disposable, unprivileged-invoker **SERIALIZABLE suspended-enrollment / separate-activation atomic SQL prototype**, a source-pinned **`--plan-only`** checker, **29** offline contract tests, and a separate operator checklist: `docs/STEP-40C-62D-C14B2A-ATOMIC-ENROLLMENT-DISPOSABLE-PLAN.md`. **No real C14B2A PostgreSQL execution has occurred yet**; the SQL has not been deployed to persistent auth-dev. Full regression predicted after these 29 new tests: **1,610**. First verify offline test/plan/build, then stage a separate network-isolated C14B2B live PostgreSQL test. Reviewer bootstrap, real trusted writer identity, MFA and GIS permissions remain unresolved and are not granted by this prototype.

## C14B2A operator checks and C14B2B staged (November 18–19, 2026)

The operator screenshot confirms C14B2A **29/29 focused Node tests**, fixed **plan-only PASS**, and Vite production build PASS (~4.46s). The screenshot does **not** display its full land regression result, so **1,610 full tests are not independently confirmed**. C14B2B now stages a new `--disposable-only` PostgreSQL 17 network-isolated runtime runner for exact reviewed C14B1/C14B2A SQL, two separate SERIALIZABLE synthetic suspended-enrollment/activation transactions, denied wrong subject and stale revision, one-use approvals, two mandatory audit events, replay rejection, and rollback of a failed audit. It adds **22** offline source/fixture contracts (local JS static assertion replay 22/22; operator Node/Docker not yet verified). **Expected full suite 1,632**. Instructions: `docs/STEP-40C-62D-C14B2B-ATOMIC-ENROLLMENT-PG17-SMOKE.md`. There is **still no independent admin reviewer authorization, app-side writer, real user account enrollment or persistent database migration**.

## C14B2B real isolated PG pass; C14B2C review staged (November 19, 2026)

Operator screenshot confirms **real isolated PostgreSQL 17 C14B2B smoke PASS**, with synthetic serializable suspended enrollment, separate activation, audit-in-transaction and rollback, plus **Vite v6.4.5 production build PASS** (250 modules, ~4.30s). The screenshot does **not** show 22 focused C14B2B Node tests or 1,632 complete land tests, so these remain unconfirmed. C14B2C security design is staged in `docs/STEP-40C-62D-C14B2C-INDEPENDENT-REVIEWER-RESTRICTED-WRITER-SECURITY-REVIEW.md`. It separates independent review issuance from privileged atomic execution, keeps current gateway read-only, and requires disposable role and privilege proofs plus concurrent replay/rollback before any persistent migration. No PostgreSQL role, credential, account, API or GIS right was created in this review step.

## C14B2C1 operator PASS / C14B2C2A staged (November 19, 2026)

The operator's supplied screenshots show **26/26 focused**, **1,658/1,658 full land**, **Vite PASS** (~4.17 s, 250 modules) and **real isolated PostgreSQL 17 role-isolation smoke PASS** for the four disposable synthetic principals. No persistent data/roles were changed. C14B2C2A now stages a **pure, unrouted, non-authorizing** dual verified-identity reviewer issuance proposal with 32 new source-security contracts (local static assertion replay 32/32; operator Node tests pending). Instructions in `docs/STEP-40C-62D-C14B2C2A-INDEPENDENT-REVIEWER-ISSUANCE-SOURCE-CONTRACT.md`; expected full test count is **1,690**. It does **not** issue real approvals, authenticate reviewers in a live database, or alter SQL permissions. Next, a separate synthetic PostgreSQL issuer proof, restricted writer/audit transaction, and an audited first-reviewer bootstrap are required before any real app accounts.
