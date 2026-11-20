# Step 40C-62D-C14B2B — Disposable PostgreSQL atomic transition smoke

**Status November 19, 2026: OPERATOR VERIFIED real isolated PostgreSQL 17 C14B2B atomic enrollment/activation smoke PASS and Vite v6.4.5 production build PASS (250 modules, ~4.30s). The operator subsequently confirmed that both the focused 22-test suite and full 1,632-test land regression passed (reported in chat; screenshots not provided for those two commands). No persistent auth-dev database write, real account enrollment, or app activation occurred.**

## Starting evidence and scope

The operator's newest PowerShell screenshot confirms **29/29 C14B2A focused tests**, **safe plan-only PASS**, and **Vite build PASS** (~4.46s; 250 transformed modules). The separate `npm.cmd run test:land` result is **not present** in that screenshot. The previously verified baseline was 1,581/1,581 full land tests and real C14B1 disposable schema smoke PASS. Current predicted count after C14B2A's 29 source tests plus C14B2B's 22 tests: **1,632** full land tests, if no further changes.

## Newly staged C14B2B

- `scripts/bdp/app-auth-enrollment-atomic-disposable-smoke.mjs` only accepts `--disposable-only`. It creates a **randomly named** `postgres:17` container with `--pull never`, `--network none`, no published ports, no bind/named mounts, and DB `ldos_c14b_disposable`. It checks exact reviewed C14B1 schema Git blob `5f10c530c7c5e801e7ad0d9733fcb48a2abcf5f8` and C14B2A atomic prototype Git blob `ce88fe8f4aeda3077fe3a03d19a0b4085a3e0004` before executing either.
- It installs only the separate original app-owned ledger, disposable enrollment schema, and an **owner-gated SECURITY INVOKER** function; it does **not** install or create any local persistent gateway/writer role or actual user.
- It seeds fixed, synthetic inviter, reviewer, identity, invitation, request, and approval records with distinct 64-character nonce digests. It tests rejection without SERIALIZABLE isolation and with the wrong subject; then executes a suspended-first enrollment in a single SERIALIZABLE transaction, requires a revision-1 account, consumed approval, correct request state and an audit entry; denies replay.
- It separately seeds an **activation-purpose** approval, denies a wrong revision, then activates the synthetic suspended account in a **second SERIALIZABLE transaction**, requires revision 2, and a second audit event. It then tests that a second synthetic account enrollment using a duplicate audit-event ID is **fully rolled back**, leaving that account absent, its approval unconsumed and its request unchanged. Checks session and county-grant tables remain empty and no existing gateway/writer SQL role was created.
- `src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposableSmoke.test.mjs` adds **22** offline fail-closed source and fixture contracts. A local V8 static assertion replay passed **22/22**; this is **not** an operator Node pass or an actual Docker result.

## Critical security boundaries

This test still runs as the **temporary synthetic PostgreSQL owner**. Its function is not a deployable real enrollment writer; no independently authenticated administrator bootstrap, account invitation endpoint, real Supabase /user proof, MFA, durable production reviewer authority, concurrent race proof, credential rotation, HTTP API, county grant or GIS rights exist. In particular, success will demonstrate sequential transaction atomicity and rollback under controlled fixtures; it **will not** prove independent review approval or concurrent serializable retry handling. Do not treat the simulated operator's synthetic approval as authority to onboard a real account.

## Operator verification — Windows PowerShell

From the existing `C:\Users\brand\gods-eye-view` checkout, run each command separately. Stop if any step fails:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposableSmoke.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected: **22/22** focused contracts, **1,632/1,632** full land tests and successful Vite build. These are **predictions, not verified results**. The previous Vite chunk warning remains nonfatal.

Only after all of these pass, with Docker Desktop running, execute the explicitly disposable PostgreSQL proof:

```powershell
node scripts/bdp/app-auth-enrollment-atomic-disposable-smoke.mjs --disposable-only
```

Expected one-line result:

```text
PASS: C14B2B isolated PostgreSQL 17 serializable synthetic enrollment and activation, separate approval, audit-in-transaction, replay denial and rollback verified; no persistent databases touched.
```

The script attempts to remove only its own new container in `finally`. If it fails, **do not blindly rerun** or manually run Docker cleanup against other containers; report its sanitized stage, and check any temporary-container cleanup warning. Never run the prototype SQL manually against persistent `ldos_auth_dev`, Supabase, or parcel PostGIS.

## Next: C14B2C

After operator-verified real C14B2B PG17 PASS, design a **distinct least-privilege writer with independently established reviewer/operator authority**, more rigorous concurrent race/replay/serialization proof, and a full restore/role-privilege drill—**still in disposable environments** before any persistent migration. The existing God’s Eye View/Cesium UI, 2.4-km Explorer, public parcel boundaries, separate PostGIS and restricted reader role stay unchanged.

## Operator observed C14B2B proof — November 19, 2026

The provided screenshot explicitly shows the command `node scripts/bdp/app-auth-enrollment-atomic-disposable-smoke.mjs --disposable-only` returning the **exact expected PASS** for PostgreSQL 17 serializable synthetic enrollment, activation, separate approval, audit-in-transaction, replay denial, and rollback, with no persistent databases touched. It also shows Vite v6.4.5 production build completed successfully (250 transformed modules, ~4.30s). Chunk-size warnings are advisory. **It does not show the focused 22/22 tests or complete 1,632/1,632 land regression summary**; do not mark those separately complete without evidence. C14B2B's disposable transactional proof is now operator-verified, but a deployable restricted writer and independently authenticated administrator approval remain unimplemented.

## Operator confirmation — November 19, 2026

The operator explicitly reports that the two outstanding checks — `node --test src/bdp/ingestion/parcelAuthDevAtomicEnrollmentDisposableSmoke.test.mjs` and `npm.cmd run test:land` — **both passed**. Record **22 focused tests and 1,632 complete land tests as operator-reported PASS**, alongside the earlier screenshot-supported isolated PostgreSQL smoke and Vite build PASS. Neither suite is being rerun remotely by GitHub. C14B2B is now complete as a synthetic/owner-gated disposable atomicity demonstration; this does **not** establish a trusted reviewer, deployable restricted writer, or persistent account workflow.
