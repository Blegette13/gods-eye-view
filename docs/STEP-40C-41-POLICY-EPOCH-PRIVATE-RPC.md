# Step 40C-41 — Privileged fixed policy-epoch reads (STAGED / NOT DEPLOYED)

**Checkpoint: November 7, 2026**

## Confirmed Step 40C-40

The operator's screenshot shows **885/885 land-development tests passed**, **Vite production build passed** (250 modules, 5.25 seconds), and a **real isolated PostGIS policy-epoch smoke PASS** demonstrating transactional version advances across ABA (revoke/reapprove), rollback, and denial to ordinary application roles. The standalone 16-case transcript was not shown, but the full suite rose by 16 from the preceding 869. The large-Vite-chunk warning remains nonfatal. **No live database migration, GIS approval, or new public geometry service has been authorized.**

## What is now committed for Step 40C-41

1. `src/bdp/ingestion/sql/parcelPolicyEpochSnapshotRpcFoundation.sql` — **DBA-review-only, transactional, no-GRANT** `SECURITY DEFINER` fixed read-only PostgreSQL RPC, taking exactly Texas `county_fips` and approved-format `source_id` parameters. It requires matching source and independent publication-review records and the two separate version rows (source caching and geometry publication). It returns **only** four strings: `source_id`, `county_fips`, `source_cache_epoch`, and `publication_epoch`. BIGINT counters are converted to decimal text, preserving exact values above JS Number safe integer range. Missing rows or wrong source/county return zero rows; there is no fallback or fabricated zero. It **deliberately does not claim source or GIS rights approval**: a revoked policy retains an epoch, so separately approved source, licensed publication, seal and live session checks remain mandatory. PUBLIC/metadata EXECUTE are revoked in the same CREATE transaction. Nothing is auto-migrated, no SQL role is created, and no service is granted access.
2. `server/providers/bdp-parcel-policy-epoch-reader.js` — UNROUTED, server-only, fixed SQL contract that requires exact county, source and AbortSignal, strict row-shape and unique-row checks, positive canonical PostgreSQL signed BIGINT decimal strings, and freezes the normalized four-field snapshot. `samePrivatePolicyEpochSnapshot` compares exact epoch values for **both scopes**, so a correctly maintained epoch distinguishes A→B→A despite identical rights fields. This comparison alone is **NOT a production authorization decision or a race-free delivery gate**.
3. `server/providers/bdp-parcel-policy-epoch-db.js` — UNROUTED, separate pinned, read-only SQL executor for a new **epoch-only dedicated LOGIN**, never reused source, publication or geometry principals. No actual account, credential, pool or HTTP route is created. It attests `session_user = current_user = expectedLogin`, login/nonprivileged role flags, no role memberships, schema USAGE but no CREATE, no raw index tables, partitions, views or sequences, exactly one allowed epoch RPC, and no other parcel-index callable routines. It enforces statement/lock/idle timeouts, exact parameterized SQL, a one-row/four-column result budget, rollback, and client discard on failure. No active in-flight driver cancellation or distributed pool backpressure is claimed.
4. `src/bdp/ingestion/parcelPolicyEpochReader.test.mjs` — **18 new no-database tests** of no-grant SQL, source/county scope, strict 64-bit epoch parsing, ABA comparison, separate LOGIN attestation, denied privilege drift, errors, cancellation and private-only interfaces.
5. `scripts/bdp/parcel-epoch-login-disposable-smoke.mjs` — opt-in synthetic real PostGIS test using one fresh network-disabled Docker container, no mapped ports, no host mounts and no existing database. It creates a one-time password-authenticated epoch-only LOGIN and grants only the fixed epoch RPC, proves raw table/function denial, exact role attestation, source and legal review version changes through A→B→A, exact unknown county/source handling, and fail-closed results after privilege creep. Removes the disposable container and its volumes afterward.
6. `src/bdp/ingestion/parcelPolicyEpochLoginDisposableSmoke.test.mjs` — **8 new safety checks** for Docker isolation, explicit `--disposable-only`, synthetic fixtures, exact principal, privilege drift, separate policy versions, cleanup and credential redaction.

**Total NEW automated tests: 26**. These are staged but **NOT operator validated yet**. A source-level contract simulation of the 18 reader tests and 8 smoke-guard tests was performed when staged, but that is **not** a Node execution, real PostgreSQL test, or production security review.

## Mandatory remaining work

The epoch reader is **NOT YET CONNECTED** to Step 40C-37's multi-principal private geometry runtime or to signed cursors. The existing runtime still hashes present rights fields, so **the production ABA gap is NOT fixed** merely by creating epoch tables/readers. Run-seal and session/county-grant revision authorities still need independently approved design; `SECURITY DEFINER` ownership, DB/pg_hba/default grants, same-source transaction consistency, concurrent writer/read races, strict session invalidation and a final output release boundary need DBA/security review and real tests. A revoked right's stored epoch can still be read: it **must never be treated as publication approval**. A client must not see polygon data based on this module alone.

## Operator validation — PowerShell (one command at a time)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPolicyEpochReader.test.mjs src/bdp/ingestion/parcelPolicyEpochLoginDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **26/26 focused tests**, and **911/911 land tests** if all new tests are discovered (previous 885 + 26). Stop at the first failure and share the error. Do not execute any migration against the existing land-development database.

Once the above are green and Docker Desktop is running, execute the strictly isolated **real SQL** probe:

```powershell
node scripts/bdp/parcel-epoch-login-disposable-smoke.mjs --disposable-only
```

Expected success line:

`PASS: disposable PostGIS epoch-only LOGIN, exact privileges, ABA epochs and independent rights.`

This test does **not** install anything into the real database.

## Next milestone — Step 40C-42 (design)

Extend the **unrouted private** runtime to capture and compare approved, monotonic epochs for session/county grants, source/run and geometry-publication rights before query, after query, and during a separately audited release decision, then stress real transaction interleavings and revocation races. Do not expose any browser polygons, claim full Travis County coverage, or infer legal GIS redistribution privileges during this phase.

Original God’s Eye View/Cesium UI, **2.4 km Free Explorer**, Travis CAD browsing and Property Intelligence panel remain unchanged.
