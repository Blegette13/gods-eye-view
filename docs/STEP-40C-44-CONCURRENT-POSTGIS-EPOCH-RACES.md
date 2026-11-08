# Step 40C-44 — Concurrent PostGIS epoch races (STAGED / UNROUTED)

**Checkpoint: November 7, 2026. Operator 961/961 regression + build VERIFIED; SQL smoke cleanup bug FIX STAGED, CLEAN EXIT PENDING.**

## Verified Step 40C-43

Operator screenshot confirms **947/947 land regression tests passed**, **Vite production build succeeded** (250 modules, **4.33 seconds**) and **real disposable PostGIS session/county and sealed-run epoch smoke PASSED**. The screenshot did not include the separate 19-case focused output, though all 19 were included in the increased full suite. The yellow Vite bundle-size warning is advisory. Nothing in those tests creates a real county GIS redistribution license or production session store.

## Scope of 40C-44

- `scripts/bdp/parcel-epoch-concurrency-disposable-smoke.mjs`: a NEW **strict opt-in** synthetic PostGIS smoke, creating a fresh random Docker container with `--network none`, no exposed port, no bind mount and no existing database connection. It installs only reviewed synthetic index, publication-rights, sealed-run, dual-policy-epoch, session/county-epoch and run-selection-epoch draft SQL.
- Unlike the earlier sequential multi-login smokes, this test creates **two independently live PostgreSQL backend processes** via `docker exec -i ... psql`. The first holds an UPDATE transaction uncommitted; the second starts a conflicting UPDATE on the same domain key. A separate PostgreSQL session must observe the second backend in `pg_stat_activity.wait_event_type = 'Lock'`. This proves genuine database-level overlap without relying on an arbitrary `pg_sleep` delay.
- While the second writer is actually waiting, an independent committed read must still see the PREVIOUS epoch and rights facts. Only after the first commit may the second UPDATE complete. Before the second commit an independent read must see exactly the first committed epoch. After both transactions commit the durable version must have increased by **two**, even if the final rights facts are identical to their original values (**ABA**).
- Three independent domains are tested: session/county discovery permission, geometry-publication legal-review state (synthetic and initially unreviewed), and unsealed ingest-run/source-selection state. A separate fourth race forces the first session/county writer to **ROLLBACK**; only the second committed update is allowed to increment the epoch.
- Strict final cleanup ends open psql workers and deletes the disposable container plus volume. No actual county data, user MFA, real DB credentials, persistent role, HTTP endpoint or browser geometry is involved.
- `src/bdp/ingestion/parcelEpochConcurrency.test.mjs`: **14 new Node tests** for exact opt-in, isolated Docker invocation, separate live backends, lock proof, committed visibility, epoch ABA, rollback, no private data leak and cleanup. Source-level simulated verification was **14/14** and the script JavaScript parsed successfully when staged; these are **NOT** a real Node execution or concurrent PostGIS smoke result.

## Operator-discovered cleanup bug and 40C-44 patch

The operator screenshot shows **961/961 land tests PASSED**, **Vite production build PASSED** (250 modules, **5.09 s**), and the real concurrent SQL smoke printed its intended `PASS: disposable PostGIS concurrent epoch writers serialize...` line. **However, Node subsequently crashed with an unhandled `ERR_STREAM_WRITE_AFTER_END`** at `createDisposableEpochSqlWorker.close()`; therefore the full smoke is **NOT YET VERIFIED AS A CLEAN PROCESS EXIT** despite its SQL assertions passing.

**Cause:** each SQL backend was closed on the success path and closed again in the `finally` block. The old `close()` wrote an extra `ROLLBACK;\\q` to a stream that had already ended. The thrown EventEmitter error was asynchronous and escaped the local try/catch.

**Patch committed:** `createDisposableEpochWorkerHandle(child)` now owns the psql child lifecycle; shutdown is **idempotent**, marks `closing` before ending stdin, **never sends SQL after EOF**, listens for asynchronous stdin errors, rejects marker waits on broken input, and waits for the child `close` event before reporting success. Any nonzero child exit fails the smoke. The normal flow awaits both child closures, and the `finally` cleanup awaits safe repeated close attempts before removing the isolated container. **Five new mock-child regression tests** explicitly reproduce double-close, async `ERR_STREAM_WRITE_AFTER_END`, early EPIPE, abnormal child close and cleanup invariants, increasing the focused guard suite from **14 to 19 tests**. A simulated mock preflight ran **19/19**, but **real Node and real SQL reruns are still required**.

## What this does NOT yet prove

This experiment checks PostgreSQL transaction locking and version increments within a **single disposable DB** for three synthetic policy-change tables. It does not prove distributed session-store consistency, cross-service snapshots, replica freshness, real current-run RPC authority, runtime cancellation, concurrent HTTP response authorization, or secure client-facing polygon delivery. A version increment by itself is not source/redistribution permission. Database-owner trigger tampering, restore-to-old-backup versions, access-role creation, online migrations and crash recovery remain separate DBA work. The 40C-43 session-grant store is synthetic, not integrated with a real identity provider.

**A database race test cannot eliminate the final time-of-check/time-of-use window between authorization and network response release.** Future public geometry requires a separate, agreed-upon linearization point tied to an authoritative current session, county grant, seal and GIS rights state, plus explicit post-revocation behavior. Do not claim that pre/post checks alone solve this.

## Operator commands — existing PowerShell (run individually)

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelEpochConcurrency.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**After the cleanup patch**, expected **19/19 focused tests** and **966/966 full land tests** (961 previously verified + 5 new regression cases). The previous 961/961 suite and successful 5.09-second build are operator-confirmed. **The patched smoke's clean exit is NOT yet verified.** Stop at the first failure; the Vite chunk warning remains nonfatal.

**Only with Docker Desktop running and all previous commands green:**

```powershell
node scripts/bdp/parcel-epoch-concurrency-disposable-smoke.mjs --disposable-only
```

Expected message:

`PASS: disposable PostGIS concurrent epoch writers serialize, ABA increments and rollback preserves committed state.`

This command creates a fresh isolated PostGIS instance and does **not** connect to the local land-development DB.

## Next phase: 40C-45

Stage a private, fixed, separately attested source/run-epoch RPC that checks the **specific newest finished sealed run**; design the real session/county grant epoch trust boundary; test cancellation and controlled release-time decisions; address DB-level backup/revision rollback risk. No production geometry until DBA, authentication and GIS licensing review is independently completed.

**God’s Eye View/Cesium UI, Free Explorer 2.4 km threshold, Travis County browse boundaries and Property Intelligence panel are unchanged.**
