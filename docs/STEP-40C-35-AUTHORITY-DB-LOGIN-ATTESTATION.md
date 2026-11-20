# Step 40C-35 — Pinned authority-only database LOGIN (STAGED / UNROUTED)

## Operator checkpoint: November 2, 2026

The preceding Step 40C-34 now has **22/22** focused tests, **774/774** land regression tests, an explicitly verified land-test discovery list, a **passing Vite production build** (250 modules, 16.82 seconds), and a **real isolated disposable PostGIS security smoke PASS**. The last proof printed exactly:
`PASS: disposable PostGIS sealed-source authority, isolated EXECUTE, latest-run gating and revocation.`

Operator screenshots on November 4, 2026 confirm the post-pull Step 40C-35 land regression suite **794/794 PASSED**, the **Vite production build PASSED** (250 transformed modules, 12.35 seconds), the **real isolated password-authenticated disposable PostGIS authority LOGIN smoke PASSED twice**, and `git pull --ff-only origin bdp-development` reported **Already up to date**. The isolated 20/20 focused test command was not shown in the latest image; their inclusion in the land-suite count is consistent with the prior 774 total, but do not assert that a standalone focused command was observed. No real BDP database migration or production grant/login was executed by this change.

## What was staged

1. `server/providers/bdp-parcel-sealed-source-authority-db.js` is a server-only, UNROUTED, **pinned read-only PostgreSQL transaction executor** for exactly the Step 40C-34 authority RPC (`parcel_sealed_source_authority_rpc($1::text)`). The trusted caller injects `connect` and a fixed expected LOGIN in the dedicated `ldos_parcel_authority_...` namespace. The module never imports `pg`, creates a pool, issues credentials, makes migrations, or mounts an HTTP endpoint. It rejects noncanonical counties, caller-provided SQL/roles, mutable statements and unexpected result columns. It caps rows at 2 and private result JSON at 12,000 UTF-8 bytes. Abort checks prevent return of cancelled results; *active driver cancellation remains future work*.
2. On every pinned connection the executor executes `BEGIN TRANSACTION READ ONLY` with bounded PostgreSQL statement, lock and idle transaction timeouts. **Before the only fixed authority SQL**, `SEALED_SOURCE_AUTHORITY_ROLE_ATTESTATION_SQL` checks `current_user = session_user = expectedLogin`, actual `rolcanlogin`, NOINHERIT, absence of superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, **no role memberships**, schema USAGE but no CREATE, no direct privileges on *any* table or sequence under `bdp_parcel_index`, permission to execute precisely the fixed sealed-source RPC, and denial of every other callable routine in the parcel-index schema. Any missing/false/extra catalog proof forces rollback and pinned-client discard; raw PostgreSQL error details are never passed to a caller. Other DB schemas, `SECURITY DEFINER` ownership, `pg_hba.conf`, global privilege grants, RLS and actual authority callbacks still require DBA/security audit.
3. `src/bdp/ingestion/parcelSealedSourceAuthorityDb.test.mjs` stages **12 synthetic unit tests**, including exact expected LOGIN, allowlisted RPC, pinned transaction, role privilege drift, row budgets, malformed SQL, cancellation, and safe composition with the earlier strict source adapter.
4. `scripts/bdp/parcel-authority-login-disposable-smoke.mjs` stages an **opt-in, disposable PostGIS security smoke**. It uses a new Docker container with no networking, mapped ports, mounts or persistent storage; creates only invented fixture records and a one-use SCRAM password-authenticated `ldos_parcel_authority_test` LOGIN within that disposable database; directly exercises the exact role-attestation SQL as the login itself (**not** by `SET ROLE` through the owner). It checks default denial before EXECUTE, SQL access before/after sealing, county mismatch, rejected table SELECT, rejected additional metadata RPC, rejected schema CREATE, rejected role membership, and source caching revocation. All fixture credentials/roles disappear when Docker removes the container. This does not test a live `node-postgres` pool or production session provider.
5. `src/bdp/ingestion/parcelAuthorityDbLoginDisposableSmoke.test.mjs` stages **8 static/offline safety tests** for the disposable runner's opt-in flag, isolation, role login, credential scrubbing and negative privileges.

## Critical limitations

The newly staged SQL executor is **NOT wired to the live app or even to the Step 40C-33 trusted session runtime**. The source adapter still expects the independently reviewed RPC executor to be injected after a real authentication and county-grant check. A real multi-user release also needs a strongly current session store and revocation, an **independent GIS geometry redistribution rights review**, bounded pool connections and active driver cancellation, distributed quotas, DBA-reviewed function owner/login policies and security tests across PostgreSQL isolation/revocation races. A SQL transaction and role proof do NOT independently authorize publishing parcel geometry.

Do not apply `parcelSealedSourceAuthorityRpcFoundation.sql` or grant roles in a real BDP database without a separate DBA and source-licensing review. Do not connect this module to the Vite/browser service. A lack of SQL rows remains UNKNOWN source coverage, never an empty county.

## PowerShell: operator validation in order

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSealedSourceAuthorityDb.test.mjs src/bdp/ingestion/parcelAuthorityDbLoginDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

The full land suite including the newly staged tests was **operator-confirmed 794/794**, with **no failures**. A separate standalone 20-test focused transcript was not supplied.

**If and only if Docker Desktop is available and all prior checks passed**, run the disposable synthetic actual-LOGIN test:

```powershell
node scripts/bdp/parcel-authority-login-disposable-smoke.mjs --disposable-only
```

Expected success:
`PASS: disposable PostGIS authority-only LOGIN, pinned-principal attestation, least privilege and revocation.`

If any test fails, STOP; share the failing output for a targeted correction. Never run SQL migration or `psql` against the local service merely to complete these checks.

The original God’s Eye View / Cesium UI, 2.4 km free Explorer height, Travis CAD free-browse boundaries and Property Intelligence panel remain untouched.

## Next milestone

Step 40C-36: independent, strictly fixed and least-privileged **geometry publication review** lookup, DB principal separation, live rights revocation and read-side policy coherency; still no public polygons or countywide completeness promises.
