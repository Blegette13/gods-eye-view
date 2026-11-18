# Step 40C-62D-C2 — Operator-controlled first local app-auth ledger migration

**Status: STAGED IN SOURCE; local primary preflight PASS; 17 focused source/test contracts mocked 17/17 in isolated JS evaluation; operator Node/full suite/build/plan validation PENDING. November 18, 2026. NO PERSISTENT SCHEMA CHANGES HAVE BEEN MADE.**

## Why this exists

The operator's November 18 read-only `docker exec` SQL query against the healthy, localhost-only persistent `ldos-auth-dev-auth-postgres-1` returned:

`ldos_auth_dev|f|t|t`

That means: correct local auth-dev database; primary (not standby); `ldos_app_auth` schema not yet installed; `ldos_auth_account_reader` SQL login does not exist. No real Supabase user, application account, session, or county grant has been written.

The existing `server/standalone/sql/landOsAccountAuthorityFoundation.sql` was developed and validated as a **disposable-only SQL draft**. It must **not** be blindly piped into the permanent database. We therefore stage a strict **new local-dev-only migration wrapper** with a separate operator-controlled apply step. The original SQL file is unchanged.

## New source

`scripts/bdp/app-auth-local-ledger-first-migration.mjs`

- Accepts **only** `--plan-only` (read local reviewed SQL, print a safe fixed plan, **no Docker access**) or `--apply-local-auth-only` (explicit operator-directed migration).
- Pins the reviewed SQL by the exact Git blob SHA `e0b2be7140e9abcbfa0d6a0ac47beca86d7f9fa7`; any changed ledger source fails closed.
- For apply, inspects the **single exact existing local dev container** `ldos-auth-dev-auth-postgres-1` without printing container credentials. Requires matching Docker Compose labels `ldos-auth-dev`/`auth-postgres`, image `postgres:17`, `healthy`, sole literal port `127.0.0.1:54338`, and the exact persistent volume `ldos-auth-dev_ldos_auth_dev_pgdata` mounted at `/var/lib/postgresql/data`.
- Does a fresh **read-only** SQL preflight requiring `ldos_auth_dev|f|t|t` and then wraps the **unchanged body** of the previously reviewed draft SQL in one transaction with strict local DB/current role/primary/empty-schema checks, lock and execution timeouts, and `psql -X -v ON_ERROR_STOP=1`. Never contacts parcel PostGIS, Supabase or a public API.
- After a successful transaction, requires the exact read-only postflight `ldos_auth_dev|f|t|0|0|0|t`: ledger schema exists, all three account/session/county-grant tables are empty, and the restricted reader SQL role still does **not** exist. No user is enrolled or allowed, and no GIS rights are authorized.
- Uses the existing running Docker container's local `postgres` Unix-socket access for this tightly scoped first DDL; it needs **no shell environment password**. This does not configure a persistent application SQL client, account reader LOGIN, production admin account, or app session service.
- Any error is handled fail-closed with a generic phase label; source SQL, Docker inspect environment and stored secrets are never echoed to standard output. If the mutation fails, stop to investigate rather than rerunning blindly.

**Important:** `--apply-local-auth-only` changes the persistent database and MUST NOT be run as part of routine test commands. We will obtain separate operator authorization after review/test evidence. A PostgreSQL transactional failure rolls back uncommitted DDL, but a postflight failure may follow a committed migration and needs inspection. **Never delete the named Docker volume or run any destructive cleanup.**

## Tests added

`src/bdp/ingestion/parcelAuthDevFirstSchemaMigration.test.mjs` contains **17 real Node test cases** for explicit opt-in, exact pinned source, immutable deny-first defaults, guarded transaction framing, all required table definitions and revocation triggers, correct local Docker metadata, wrong-port/volume denial, exact SQL preflight/postflight and lack of account/GIS privileges. The staged code and tests executed **17/17 under an in-context JavaScript mock evaluation**, not an operator Node or live-Docker execution; results still need verification in the user's Windows checkout.

## Operator Phase A — safe source-only checks (NO SCHEMA WRITES)

Run each separately from `C:\Users\brand\gods-eye-view`:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevFirstSchemaMigration.test.mjs
npm.cmd run test:land
npm.cmd run build
node scripts/bdp/app-auth-local-ledger-first-migration.mjs --plan-only
```

Expected: **17/17 focused**, predicted **1,339/1,339 complete land tests** (1,322 previously confirmed + 17 staged), Vite build PASS, and a single safe `PLAN:` output with source blob. **None of these commands creates schema, roles, accounts or sessions.** No credentials are needed. If a command fails, stop and share sanitized error output.

## Operator Phase B — first persistent schema installation (PENDING / DO NOT EXECUTE YET)

After green Phase A and confirmation of the target/backup strategy, the separately approved command will be:

```powershell
node scripts/bdp/app-auth-local-ledger-first-migration.mjs --apply-local-auth-only
```

**This command is documented for later; do not execute until separately agreed**. It creates an empty denial-default app authorization ledger in the existing local persistent development database. It does **not** create actual app accounts, Auth users, reader roles, sessions, county permissions, SQL GIS functions or public endpoints. No application schema migration is applied to Supabase or the parcel GIS database.

## What follows

Step 40C-62D-C3 will separately review role grants, owner versus restricted read-only SQL LOGIN, local credential retention/rotation, and a persistent role attestation. A backup/restore drill and restart durability test are needed before relying on any durable real user enrollment. Application sessions, independently verified MFA, per-county entitlements, and permitted GIS publication remain disabled. Original God’s Eye View/Cesium interface, 2.4 km Free Explorer, Travis County and Property Intelligence UI are unchanged.
