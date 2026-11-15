# Step 40C-47 — Current session/county revision RPC (SYNTHETIC, STAGED, UNROUTED)

**Checkpoint: November 15, 2026. Operator validation for Step 40C-47 PENDING.**

## Step 40C-46 independently validated

Operator screenshots confirm **50/50 focused integration cases PASSED**, **1,010/1,010 complete land-development regression cases PASSED**, and **Vite production build PASSED** (250 transformed modules, **6.34 seconds**, no build errors). The existing Vite oversized-chunk warning is nonfatal. No real five-principal production database login provisioning or parcel-geometry serving occurred.

## This step's actual code and boundaries

The greatest outstanding security gap is **NOT** whether a read-only GIS query executes: it is that `findSessionByDigest` and `readSessionCountyEpoch` still rely on unimplemented **real** identity, MFA, logout and county-grant authorities. A PostgreSQL test table by itself is **not** an authentic user. This milestone deliberately stages ONLY a verifiable **synthetic** session/county revision *reader*, so we can test the expected shape and database isolation without inventing a production account system.

1. `src/bdp/ingestion/sql/parcelSessionCountyEpochRpcFoundation.sql` — **DBA-REVIEW-ONLY, NOT APPLIED** fixed `SECURITY DEFINER` RPC `ldos_private_auth.parcel_session_county_epoch_rpc(text,text)`. It returns **exactly** a lowercase HMAC session digest, Texas county FIPS, and a strictly positive BIGINT epoch as text. The one SQL statement joins the Step 40C-43 synthetic `session_county_decisions` and `session_county_epochs` rows by both exact keys, and requires **account_active, mfa_verified, session_active and allow_discovery ALL TRUE**. Missing, revoked, unreviewed, wrong-county or missing-epoch records return no rows. A transactionally increased epoch survives A→B→A and deletion/recreation. Nothing creates a role, grants PUBLIC, makes a browser endpoint, or returns account identifiers/polygons.
2. `server/providers/bdp-parcel-session-county-epoch.js` — **UNROUTED PRIVATE** strict exact input/output adapter to that fixed SQL. Its input must be a server-side *HMAC-derived digest*, canonical county FIPS and an AbortSignal; **do not accept browser-supplied hashes, grants or MFA flags**. It rejects extra/missing/duplicate rows, wrong identities, malformed/zero/overflowing epoch values and cancellation, returning `null` on uncertainty. An equality helper detects changed revisions without floating-point rounding.
3. `server/providers/bdp-parcel-session-county-epoch-db.js` — pinned read-only SQL executor expecting one dedicated `ldos_parcel_session_epoch_...` LOGIN, a verified exact principal and strict catalog privileges. Attestation disallows raw table or sequence access, schema CREATE, unrelated RPC execute privileges, superuser, BYPASSRLS, role inheritance or role membership. Exact frozen parameterized SQL, statement/lock timeouts, one-row bounded result, safe release/discard and generic errors are enforced. **No actual role or pool is created.**
4. `src/bdp/ingestion/parcelSessionCountyEpochReader.test.mjs` — **18 new Node tests** covering the SQL contract, all four current synthetic flags, strict separate role, exact epoch identity, ABA comparison, wrong county/digest, duplicate/malformed data, privilege drift, cancelled request and generic failures.
5. `scripts/bdp/parcel-session-county-epoch-reader-disposable-smoke.mjs` — opt-in **real password-authenticated disposable PostGIS smoke** with randomized `--network none` Docker container, no ports/mounts, local PostGIS image preflight and name-scoped cleanup. Only synthetic `ldos_private_auth` tables are installed. It proves deny-by-default, approved current flags, revoke→reapprove increment, rollback, MFA revoke, delete/recreate version continuity, raw-table denial and actual role-attestation privilege drift. Returns a PASS string only if all checks finish, then removes the container.
6. `src/bdp/ingestion/parcelSessionCountyEpochDisposableSmoke.test.mjs` — **9 additional Node guard tests** for opt-in, Docker isolation, approval denial, revision/rollback behavior, distinct password LOGIN, and safe cleanup.

**Total NEW tests: 27**; expected full regression suite **1,037** (previous 1,010 + 27). JavaScript smoke syntax parsed during staging, but **actual Node, real Docker/PostGIS, and build results are NOT yet operator-confirmed for this step**.

## What remains NOT implemented

This synthetic schema cannot prove real sign-in, account status, MFA, identity federation, logout or county-grant revocation. The current five-principal geometry runtime still takes a **trusted-injected** `readSessionCountyEpoch`; this new private SQL adapter is **NOT YET wired into that factory**. The DB draft remains uninstalled in the actual land-development DB. The final release/abort decision across concurrent sources and the network response is still missing; even real pre/post SQL checks alone cannot eliminate a last-instant revocation race. Separate published GIS redistribution licenses, safe use limitations, source provenance and DBA-approved identity isolation are necessary before publishing polygons.

**No UI changes:** original Cesium God's Eye View experience, 2.4 km Free Explorer threshold, Travis County browsing, Property Intelligence panel and all prior land features stay unchanged.

## Operator validation — one command at a time, existing PowerShell

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSessionCountyEpochReader.test.mjs src/bdp/ingestion/parcelSessionCountyEpochDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **27/27 focused**, **1,037/1,037 full** and a green build, subject to test discovery. These are predictions, not confirmed results. Stop at the first failure.

With Docker Desktop healthy, `postgis/postgis:17-3.5` locally present, and all previous checks green:

```powershell
node scripts/bdp/parcel-session-county-epoch-reader-disposable-smoke.mjs --disposable-only
```

Expected:

`PASS: disposable PostGIS session/county epoch LOGIN, deny-default grant, ABA revisions and privilege isolation.`

A clean exit back to PowerShell is required. This smoke never accesses real user accounts or real GIS polygons.

## Step 40C-48 — proposed continuation

Only after real SQL smoke passes: stage a **strict six-principal PRIVATE factory** that obtains both source/run and **synthetic session/county epochs** exclusively from fixed separate attested SQL reader accounts. Then design a real account authority implementation (instead of pretending the synthetic table is real), and test concurrent grant revocation versus final output release. The absence of an identity integration or legally authorized GIS publication must remain explicit and fail closed.
