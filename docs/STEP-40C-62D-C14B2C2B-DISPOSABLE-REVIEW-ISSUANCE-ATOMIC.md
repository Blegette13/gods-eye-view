# Step 40C-62D-C14B2C2B — Synthetic PostgreSQL 17 review issuance + audit

**Status November 19, 2026: OPERATOR VERIFIED — 1,717/1,717 complete land regressions (zero failures/skips), Vite v6.4.5 production build PASS (250 transformed modules, ~5.17s), and exact real isolated PostgreSQL 17 C14B2C2B issuance/atomic-audit smoke PASS. Focused 27/27 test summary is not visible in the supplied screenshot and remains separately unconfirmed. No real reviewer identity or persistent database writer was deployed.**

## Verified C14B2C2A foundation

Operator screenshots confirm **32/32 C14B2C2A focused security tests passed**, **1,690/1,690 land regressions passed** with zero failures/skips, and **Vite 6.4.5 build succeeded** (250 modules, ~4.40s using the established 2-GiB Node heap workaround). The previous C14B2C1 isolated role-isolation PostgreSQL test also passed. These successes verify non-authorizing source contracts and locked-down synthetic roles—not real administrator authority.

## New C14B2C2B implementation

**`server/standalone/sql/landOsReviewIssuanceAtomicDisposable.sql`** — creates exactly one disposable-only `SECURITY INVOKER`, **PostgreSQL-owner-gated** review-issuance prototype (`ldos_app_auth.disposable_issue_enrollment_review`). Source pinned by exact Git blob `5d2fa6edc6bd530931ecbbdcc5c5c70e8311f0e8`. The install transaction refuses the persistent database, replica, missing reviewed schema/previous atomic transition, existing gateway/reader/issuer/executor roles or preinstalled function; it grants **no** app or public execution rights.

Within a **writable SERIALIZABLE transaction**, the prototype validates purpose, fixed issuer shape, applicant subject, reviewer subject, 64-character lowercase hexadecimal nonce digest and optional expected suspended account revision. It locks request, invitation, reviewer authority and account in fixed order, checks request state, app-owned reviewer active review scope, independent applicant/inviter/reviewer, redeemed unexpired invitation, no previous same-purpose approval, and distinct nonce. It creates a **10-minute-or-shorter unconsumed approval**, moves a pending enrollment request to `approved_for_enrollment` only for that purpose, and appends a mandatory `reviewed` audit event **before returning**. A failure before COMMIT (including duplicate audit ID) rolls back approval and request changes.

**`scripts/bdp/app-auth-review-issuance-atomic-disposable-smoke.mjs`** — accepts **only `--disposable-only`**; uses a fresh randomly named `postgres:17` container with **`--network none`**, no published ports, no persistent volumes, no external service and no shared PostgreSQL instance. It loads the previously validated app-owned ledger, C14B1 schema, C14B2A account transition, new review issuance prototype, and C14B2C1 zero-grant synthetic roles. It verifies both synthetic SQL LOGIN principals **cannot** invoke issuance; only disposable database owner calls the prototype. It checks non-serializable, reviewer=inviter/applicant and replay denial; then issues and consumes an enrollment approval, separately issues and consumes activation approval, verifies independent `reviewed` audit entries, and demonstrates audit conflict rolls back a second pending issuance without a leftover approval. It checks no sessions/county grants and always attempts to remove only its own new container.

**`src/bdp/ingestion/parcelAuthDevReviewIssuanceAtomicDisposable.test.mjs`** — 27 new offline contract tests. A local isolated V8 assertion replay found **27/27** passing; this is not an operator's Node-test result or a live PostgreSQL test.

### Critical distinction: synthetic reviewer != independent authorization

This PostgreSQL function does **NOT** authenticate a real reviewer or validate a Supabase operator token. The reviewer UUID in the SQL prototype is **supplied by its synthetic owner-only fixture**. Its app LOGINs have zero EXECUTE rights by design. Real independent issuer/executor functionality still requires an independently authenticated reviewer, a carefully controlled first-admin bootstrap, a separate function owner with least-privilege grants, and concurrency/restore/credential rotation testing. **Do not expose the owner-gated prototype as an HTTP API or use it for real account enrollment.** An active account still grants no private GIS access or county entitlement.

## Safe operator verification — existing PowerShell checkout

Run each separately and stop on any failure:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevReviewIssuanceAtomicDisposable.test.mjs
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

Expected: **27/27 focused** and predicted **1,717/1,717 full land tests** (1,690 last confirmed + 27), with another successful production build. The known larger-than-1,500-kB Vite chunk warning is advisory.

**Only after those pass**, with Docker Desktop running, run the isolated real PostgreSQL test:

```powershell
node scripts/bdp/app-auth-review-issuance-atomic-disposable-smoke.mjs --disposable-only
```

Expected:

```text
PASS: C14B2C2B isolated PG17 synthetic reviewer issuance, purpose-specific approval, atomic reviewed audit, denied replay and audit rollback, suspended enrollment and separate activation; no real reviewer authentication or persistent auth-dev writes.
```

If it fails, report the sanitized stage text and any scoped cleanup warning; do not blindly retry. Never run new SQL manually on `ldos_auth_dev`, rerun C11 apply, paste real Supabase token/DPAPI credentials, or remove existing Docker containers.

## Next: trusted reviewer bootstrap and restricted issuer (C14B2C3)

After C14B2C2B real PostgreSQL proof, build a **separate issuer authority** whose caller identity is independently verified from server-held provider evidence and constrained by a distinct audited reviewer bootstrap. Verify actual role privilege matrix and concurrency against disposable PostgreSQL before considering any persistent migration. No user-facing enrollment/activation route, cookie session, county grant or GIS access is approved by this source-only work.

## Operator proof — November 19, 2026

The supplied PowerShell screenshot confirms **1,717/1,717 complete land tests PASS** with 0 failed, canceled or skipped; the **Vite production build PASSED** (250 transformed modules; ~5.17 seconds); and the **exact `--disposable-only` PostgreSQL 17 review-issuance smoke PASS**, including purpose-specific synthetic approval, mandatory `reviewed` audit, replay denial, audit rollback, suspended enrollment, and independently purposed activation. The screenshot **does not show the standalone focused 27-test run**, even though the full suite auto-discovers those tests. Treat the complete suite and isolated runtime as verified; do not claim separately observed 27/27 without the focused output. This proves an owner-gated synthetic transaction, **not** independently authenticated operator approval, privilege grants or a real administrator workflow.
