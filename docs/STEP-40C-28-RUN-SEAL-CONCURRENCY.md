# Step 40C-28 — Concurrent run-seal integrity (STAGED; DISPOSABLE ONLY)

## Operator checkpoint — November 2, 2026

The operator's screenshot confirms that the previous Step 40C-27 disposable run-seal smoke has **now passed against real PostgreSQL/PostGIS**:

```
tests 8
pass 8
fail 0
PASS: disposable PostGIS immutable run seals, denied mutations and incomplete-run rejection.
```

The previous `npm.cmd run test:land` result showed **685/685 passing** and the preceding Vite build succeeded (250 modules, 4.25 seconds). The new Step 40C-28 code is **not yet validated on the operator's machine**. The earlier Step 40C-25 disposable keyset SQL smoke remains **unconfirmed separately**.

## Why concurrent writers matter

Step 40C-27 validated ordinary post-seal writes and rejected incomplete runs using separate sequential transactions. A seal must ALSO behave correctly when a parcel writer and a sealer execute **simultaneously**, otherwise a supposedly immutable run could be sealed with the wrong count or could accept a late parcel. This opt-in test probes real PostgreSQL parent-run row locks and transaction ordering—not just SQL source text.

### New files

- `scripts/bdp/parcel-run-seal-concurrency-smoke.mjs`: two-phase, **two-session** opt-in PostGIS runtime probe, strictly requiring `--disposable-only`. Spawns new `psql` sessions through `docker exec -i` and the container-local Unix socket, in a fresh randomly named `postgis/postgis:17-3.5` container using `--network none`, a generated password, no exposed ports or persistent volumes, no host database or live CAD files. The tests create **only invented** synthetic parcels. Sessions, container and anonymous volumes are closed in `finally`.
- `src/bdp/ingestion/parcelRunSealConcurrencySmoke.test.mjs`: **11** fast tests covering opt-in enforcement, network/DB isolation, two independent sessions, both lock orders, actual `pg_stat_activity` + `pg_blocking_pids` wait detection, synthetic-only fixtures, safe PID handling, and cleanup. The test source passed an isolated 11-case JavaScript evaluation, **not** Node's actual test runner or Docker runtime.

### Real PostGIS scenarios when executed

1. **Writer wins:** A transaction holds the parent ingest-run row while adding the fourth synthetic parcel. The sealer attempts to finalize the completed run, and the test confirms the sealer is **actually blocked** on PostgreSQL locks via a separate session. Once the writer commits, the sealer must seal **exactly four** parcels. It must not seal three or guess at the in-flight count.
2. **Sealer wins:** A separate versioned run with one completed synthetic parcel is sealed while its transaction is held open. A concurrent writer attempts to append another parcel and must **actually block** until the seal commits. When the lock is released, the writer must receive the run-seal immutability exception. Indexed and sealed counts must remain **one**.

No real GIS rights or backend geometry privileges are created. The migration and its triggers exist **only in the disposable container**, and the tests use the disposable database superuser solely to construct synthetic fixtures. This is NOT production authorization, a commercial redistribution grant, proof against privileged trigger bypass or a cross-request MVCC snapshot. The existing Step 40C-24 keyset geometry RPC **still does not require a seal** and is **not safe for deployment**.

## Local PowerShell checkpoint

Execute **one command at a time**, with Docker Desktop running for the opt-in smoke:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelRunSealConcurrencySmoke.test.mjs
node scripts/bdp/parcel-run-seal-concurrency-smoke.mjs --disposable-only
npm.cmd run test:land
npm.cmd run build
```

Expected first result: **11/11 passing**. Expected second result, **only after real execution**:

```
PASS: disposable PostGIS run-seal concurrency, writer-first and sealer-first ordering.
```

Stop at any failure to inspect the **first** PostgreSQL error. If Step 40C-25 real keyset validation was not previously run, it is still required as a separate gate:

```powershell
node scripts/bdp/parcel-keyset-disposable-smoke.mjs --disposable-only
```

Further steps require a rights-gated **seal-enforcing keyset PostGIS RPC** and source/run immutability and post-query authorization checks before any consumer-facing geometry service. The complete inherited `npm.cmd test` overlay performance suite remains a separate pre-release gate. The original God's Eye View/Cesium UI, **2.4 km Free Explorer**, Travis overlays and Property Intelligence panel remain unchanged.
