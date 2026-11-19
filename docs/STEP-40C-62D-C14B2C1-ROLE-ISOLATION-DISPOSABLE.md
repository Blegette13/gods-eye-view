# Step 40C-62D-C14B2C1 — Disposable PostgreSQL 17 role-isolation matrix

**Status November 19, 2026: SOURCE STAGED on `bdp-development`. 24/24 source assertions satisfied in a local static V8 replay; operator Node runner, full regression, Vite build and REAL PostgreSQL role smoke are NOT YET VERIFIED. No persistent database, actual SQL LOGIN, user account or app permission has been changed by this staging.**

## Starting evidence

The operator explicitly confirms **both outstanding C14B2B suites passed**: 22 focused contracts and 1,632 full land regressions. The earlier screenshot separately confirmed the real isolated PostgreSQL 17 C14B2B serializable synthetic enrollment/activation/rollback smoke and successful production Vite build (250 modules, ~4.30 seconds). C14B2B therefore completes the **synthetic database-owner atomicity demo**, not trusted application enrollment.

## What is newly staged

**`server/standalone/sql/landOsEnrollmentRolesDisposable.sql`** — a disposable-only SQL migration with a hard `ldos_c14b_disposable` database guard, `postgres` SQL operator, writable primary, SCRAM-SHA-256, required existing C14B1 relations and C14B2A synthetic function, absent preexisting roles, and empty authority tables. It creates exactly **four synthetic PostgreSQL principals**, all `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`:

- `ldos_auth_enrollment_executor_login` — LOGIN, randomized synthetic 64-hex fixture password.
- `ldos_auth_review_issuer_login` — a **different** LOGIN with a separately randomized synthetic password.
- `ldos_auth_enrollment_writer` — NOLOGIN, no membership or grants.
- `ldos_auth_review_issuer_writer` — a separate NOLOGIN, no membership or grants.

**No SQL privileges or membership are granted yet.** The roles cannot read or alter accounts, sessions, county grants, invitations, requests, approvals, reviewer authority or audit tables; neither login can execute the existing disposable atomic prototype or `SET ROLE` to a writer, another login or `postgres`. This is a **deny-first identity separation test**, not a functional issuer/executor or deployable writer. The existing persistent gateway and reader are never targeted or modified. Source Git blob is pinned to `ab9b9c61362832dca9522b80f70ccf2a13fd0965`.

**`scripts/bdp/app-auth-enrollment-roles-disposable-smoke.mjs`** — opt-in `--disposable-only` runner. It creates only a randomly named `--network none`, `--pull never`, no-port, no-mount disposable `postgres:17` container and loads the previously pinned C14B1 review schema/C14B2A atomic prototype. It generates random synthetic PostgreSQL secrets at runtime and substitutes the two role passwords in memory; no secret is committed. It then executes the reviewed role SQL and verifies actual password-authenticated login through TCP **inside the container**, SCRAM hashes, lack of role membership/elevated role attributes, lack of table/schema/function privileges and SQLSTATE `42501` denials for unauthorized reads, writes, prototype function calls and role escalation. It checks empty app-ledger tables and attempts to remove only its own new container in `finally`.

**`src/bdp/ingestion/parcelAuthDevEnrollmentRoleMatrixDisposable.test.mjs`** — **24 offline** unit/source contracts. A static V8 assertion replay satisfied **24/24**, but real Node execution and Docker/PG17 behavior are **pending**.

### Credential handling caveat

All test credentials are newly generated **synthetic disposable values**, not the real DPAPI credential or Supabase token. The smoke uses Docker's `-e PGPASSWORD=<synthetic>` argument to authenticate only inside its temporary container; as with typical command-line environment switches this may be visible in local process inspection during the test. **Do not put a real, reused or production credential into this runner.** It does not read Windows DPAPI or local environment secrets.

## Operator instructions

In the existing `C:\Users\brand\gods-eye-view` PowerShell window, run these commands one at a time and stop if a command fails:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevEnrollmentRoleMatrixDisposable.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected focused **24/24** and predicted full **1,656/1,656** (prior operator-confirmed 1,632 + 24). Successful Vite build should follow; the known large-chunk warning is nonfatal. Those are **predictions**, not yet observed operator results.

**Only if all tests/build pass**, with Docker Desktop running, run:

```powershell
node scripts/bdp/app-auth-enrollment-roles-disposable-smoke.mjs --disposable-only
```

Expected sanitized confirmation:

```text
PASS: C14B2C1 isolated PG17 synthetic executor and review-issuer LOGINs, two NOLOGIN roles, distinct SCRAM credentials, zero membership, denied direct auth table and prototype EXECUTE rights, denied SET ROLE; persistent auth-dev untouched.
```

Do **not** run the SQL manually, create roles on persistent `ldos_auth_dev`, rerun the old C11 apply, attach real passwords or delete any existing Docker container. On failure, share only the sanitized stage message and any scoped cleanup warning, then stop.

## Next security milestone — C14B2C2

After a real C14B2C1 PASS, implement **separately authorized approval issuance** with independent operator identity, proof of reviewer authority, and constrained privilege boundaries. That requires new disposable-only issuer procedure/owner and permissions, plus revoked/self-approval/duplicate/expiry tests. Only after that should a function owner and restricted executor be designed. The new principal separation alone cannot authorize a real user.

Existing God’s Eye View/Cesium 2.4-km Explorer, Travis County parcel browsing, TCEQ, PostGIS, stored auth reader and private-geometry gating remain unchanged.
