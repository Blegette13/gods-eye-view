# Step 40C-45 — Exact latest FINISHED sealed-run epoch (STAGED / UNDEPLOYED)

**Checkpoint: November 7, 2026. Operator validation pending for this step.**

## Verified Step 40C-44

PowerShell screenshots show **19/19 focused Node tests PASSED**, **966/966 full land regression tests PASSED**, and the actual isolated concurrent PostGIS transaction smoke **printed PASS and returned normally to the PowerShell prompt**. The earlier cleanup crash is resolved. The screenshots do **not** include a new Vite build after the cleanup patch; the previous build passed before that change. This is a synthetic integration milestone, not approval to publish county geometry.

## Step 40C-45: source-controlled additions

1. `src/bdp/ingestion/sql/parcelCurrentSealedRunEpochRpcFoundation.sql` is a **DBA-review-only, NO-GRANT, transactionally created fixed `SECURITY DEFINER` SQL RPC**. It takes exactly canonical Texas county FIPS, a specific source ID, and a requested positive BIGINT run ID. The SQL selects the **ONE newest FINISHED run first** (order by `finished_at DESC,id DESC`), then checks its immutable run seal, matching source/version/county/count, seal time, successful complete outcome, zero omitted records and nontruncated ingestion. A newer failed/unsealed/partial finished run blocks an older otherwise valid sealed run; **no fallback**. It joins the 40C-43 transactionally maintained source/run-selection epoch, returning only four text columns: source ID, county FIPS, exact sealed run ID and epoch. A missing/ambiguous/mismatched run yields no rows. Neither an epoch nor a seal implies a legal GIS license, source caching approval, user entitlement or parcel coverage.
2. `server/providers/bdp-parcel-current-sealed-run-epoch.js` stages an **UNROUTED PRIVATE** adapter that binds exact county/source/run inputs, a required AbortSignal, a frozen fixed SQL statement, one-row/four-column output validation, a canonical positive 64-bit epoch in decimal string form, strict run ID matching, and a fail-closed equality comparator (including ABA changes). The adapter's output shape matches the Step 40C-42 private runtime's injected `readSealedRunEpoch` contract but the new SQL role is **not wired to the real application**.
3. `server/providers/bdp-parcel-current-sealed-run-epoch-db.js` stages a pinned read-only SQL adapter for a **fifth separate run-epoch-only LOGIN** (distinct from sealed-source, independent publication review, geometry-only, and policy-epoch-only principals). The login is not actually created or provisioned. Every request must verify exact session/current identity and least privilege: no role membership, schema CREATE, index-table/sequence access, or unrelated parcel-index EXECUTE. Only the exact parameterized run-epoch RPC is allowed. Abort, row bounds, byte caps and SQL errors discard the pinned connection; an invalid request never reaches SQL.
4. `src/bdp/ingestion/parcelCurrentSealedRunEpoch.test.mjs`: **19 new Node tests** for SQL policy, latest-finished nonfallback, sealed-run requirements, exact identity, epoch parsing and ABA, extra/malformed results, wrong roles, privilege drift, cancellation and generic errors.
5. `scripts/bdp/parcel-current-run-epoch-disposable-smoke.mjs`: strict opt-in **real password-authenticated disposable PostgreSQL test** with a fresh random `--network none` PostGIS container, no exposed ports, no mounts and ONLY synthetic source/parcel fixtures. It validates that an unsealed run cannot qualify, a valid sealed latest completed run qualifies with a correct epoch, incorrect county/source/run IDs are denied, a newer still-running ingest changes the epoch without superseding the latest finished seal, and a newer FINISHED failed run fails closed instead of falling back to the older seal. A dedicated run-epoch LOGIN can call only the reviewed function, cannot SELECT raw tables, and fails catalog attestation after privilege drift. All container resources are removed after the test.
6. `src/bdp/ingestion/parcelCurrentSealedRunEpochDisposableSmoke.test.mjs`: **8 additional Node safety contracts** for explicit opt-in, isolated Docker, actual SQL identity, the fixed latest-run protocol and cleanup.

**Total NEW contracts: 27**. JavaScript source parsing and lightweight source-contract simulations were performed before staging, but these are **NOT** operator Node executions or real PostgreSQL test results. No production migration, pg pool, account, credential, privileged grant, server endpoint, signed cursor wiring, new UI or browser polygon delivery has been added.

## Remaining blockers

The source/run epoch authority is STILL a staged, synthetic database-only component. The Step 40C-42 `readSealedRunEpoch` dependency is not connected to any production SQL principal, and the existing Step 40C-43 synthetic session/county epoch schema is **not a real user identity/MFA/county-grant store**. Before deployment, a DBA/security review must validate ownership, cross-role permissions, PostgreSQL advisory and row locks, failed ingestion semantics, backups and version rollback; a separate session provider must maintain durable strongly-current revocation epochs in its real authoritative store; the final release-time output gate and live licensing approval remain absent. Never infer county coverage, market value, zoning permission or development feasibility from run state.

## Operator commands — existing PowerShell (run one at a time)

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelCurrentSealedRunEpoch.test.mjs src/bdp/ingestion/parcelCurrentSealedRunEpochDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **27/27 new tests** and **993/993 full land regression tests** (previously 966, plus 27), subject to normal test discovery. These are predicted, not verified; stop at the first failure.

With Docker Desktop running and all prior commands green:

```powershell
node scripts/bdp/parcel-current-run-epoch-disposable-smoke.mjs --disposable-only
```

Expected success:

`PASS: disposable PostGIS current sealed-run epoch LOGIN, exact latest run, stale-run denial and privilege isolation.`

A clean exit back to the `PS ... >` prompt is also required.

## Next — Step 40C-46

Review integration of the fifth SQL role into a strict, private epoch-guarded geometry factory; stress newest finished-run changes and stale cursor invalidation through the real disposable DB; design a real independently versioned account/session/county grant authority and security-reviewed release-time linearization barrier. No public geometry without legal redistribution rights, operational authentication, audit/revocation and DBA approval. Existing God's Eye View/Cesium UI, 2.4 km Free Explorer handoff, Travis CAD browsing and Property Intelligence panel remain untouched.
