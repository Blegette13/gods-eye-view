# Step 40C-40 — Durable transaction-serialized policy epochs (STAGED / NO PRODUCTION MIGRATION)

**Checkpoint: November 6, 2026**

Operator screenshot confirms Step 40C-39 **869/869 land-development regression tests PASSED**, Vite **production build PASSED** (250 modules; 4.92 s), and the actual opt-in **disposable PostGIS three-independent-LOGIN smoke PASSED**. The separate focused 14-case transcript was not included in the screenshot, but the land suite total rose by 14 from the previous 855. The Vite large-chunk warning remains nonfatal. Three database identities were verified in one test database with sequential, fresh SQL sessions; concurrent pooled-connection races remain untested.

## Why Step 40C-40 exists

The staged private geometry runtime currently hashes current source/run/legal-review facts before and after a SQL read. That hash cannot distinguish a policy that remained approved from a policy revoked and subsequently restored to identical fields (A→B→A). This phase stages a **transactional policy-change epoch proof-of-concept**, not a live replacement for the existing source/rights readers.

## Staged files

1. `src/bdp/ingestion/sql/parcelPolicyEpochFoundation.sql` — **DBA REVIEW ONLY, NEVER AUTO-MIGRATED.** Creates a private, deny-default `bdp_parcel_index.parcel_policy_epochs` table with two independent scopes (`source_cache`, `geometry_publication`), canonical source IDs, durable positive BIGINT counters and timestamps. Existing rights records are backfilled to epoch **1 only**, without pretending to recover historical changes. Separate AFTER INSERT/UPDATE/DELETE triggers observe every source registry and independent redistribution-review write, including no-op updates and deletes. A locked, transactional UPSERT (`epoch = existing.epoch + 1`) increments each key serially; aborted SQL transactions roll back both rights and revision atomically, unlike independent `nextval()` sequence allocation. A source key move invalidates the old key as well as the new key. The trigger is a fixed-search-path, privileged DB-owner implementation; DBAs MUST audit function ownership, trigger tamper permissions, backups, role grants and policy update paths before any live usage.
2. `scripts/bdp/parcel-policy-epoch-disposable-smoke.mjs` — requires the exact `--disposable-only` flag. Builds a **fresh, network-disabled, portless, unmounted temporary PostGIS container**, loads synthetic parcel/right-review fixtures and the draft SQL, and tests that initial counters are 1, caching revoke/reapprove A→B→A increments despite identical restored fields, legal publication revoke/reapprove independently increments, no-op writes increment, rolled-back writes leave policy and epoch unchanged, and deleting/reinserting a review never resets its epoch. Checks that an ordinary schema-usage role cannot directly SELECT epochs. Removes the temporary container and its volumes after the test.
3. `src/bdp/ingestion/parcelPolicyEpoch.test.mjs` — **16 new no-Docker safety/contract tests** covering private SQL/no grants, exact scopes, atomic UPSERT rather than sequences, triggers, backfill, ABA, rollback, opt-in guard and Docker isolation.

These files **do not** add browser access, an authenticated HTTP service, a live database role, an endpoint, any production migration, an actual GIS license approval, live county ingestion, runtime cursor-epoch binding, a policy-release linearization gate or coverage assertions. Everything remains UNROUTED and STAGED. The original God’s Eye View/Cesium UI, the **2.4 km Free Explorer** handoff, Travis County browsing and Property Intelligence panel are unaffected.

## Limitations and production blockers

The epochs above protect **only future source-caching and independent publication-review writes made through two specific PostgreSQL tables after installation**. The initial backfill is not evidence of prior rights transitions. There is no current integration with the HMAC session/county-grant store, latest-finished-run/seal changes, trusted fixed-policy RPCs, source/review/geometry login grants, signed cursors, or safe delivery release. Existing source authority and publication-review readers still return the prior record shapes; the runtime is **not yet epoch-aware**. A SQL owner or tampered trigger could defeat the counters without separate DBA monitoring. Rollback, crash durability and cross-store replication must be reviewed in actual production arrangements. A final check and public response still have a time-of-check/time-of-use race.

**Do not enable public geometry or claim ABA is solved in the deployed platform.** The next steps must define audited fixed read-only epoch RPCs with genuinely least-privileged SQL principals; enforce session/county-grant epochs in an independently strongly current account store; bind immutable epochs into server-side cursor policy and post-query/release gates; and stress concurrent transactions and active query cancellation. Actual GIS redistribution rights remain unknown unless independently licensed and approved.

## Operator validation (PowerShell, in order)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPolicyEpoch.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **16/16 focused checks**, **885 total land tests** if all new tests are discovered (869 previous + 16 new), and a successful production build. None of these outcomes are operator-confirmed yet.

With Docker Desktop running and ONLY if those checks are green:

```powershell
node scripts/bdp/parcel-policy-epoch-disposable-smoke.mjs --disposable-only
```

Expected success:

`PASS: disposable PostGIS policy epochs advance on ABA, rollback atomically, and remain denied to application roles.`

**Stop at the first failure and share the output.** Do not run any migration or GRANT against the existing land-development database.

## Next milestone

**Step 40C-41 — Fixed epoch-read privilege design and adversarial transaction testing.** Make a private, independently attested epoch lookup design (with explicit source/review/session domain separation), test actual PostgreSQL concurrent transaction ordering and abort behavior, and plan fully epoch-aware private cursor and release validation. Still no public parcel geometry.
