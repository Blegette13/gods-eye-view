# Step 40C-62D-A — Source-controlled, OFF by default, separate persistent LOCAL app-account PostgreSQL

**Status: SOURCE VALIDATED — operator screenshot confirms 1,322/1,322 land tests PASS, 0 failures/skips, and Vite production build PASS (250 modules, 8.73s). Dedicated PostgreSQL container NOT YET started; no persistent DB created, migration, app account, or new login provisioned. November 17, 2026.**

## Previous step verified in real operator environment

Operator screenshots confirm **1,306/1,306 land regression tests**, zero failures, **Vite build PASS** (250 modules, 16.72 seconds), and this **real disposable driver-to-PostgreSQL** integration success:

`PASS: disposable real pg driver and restricted primary account reader; deny-first, exact UUID/revision, revocation, no sessions, no counties, no GIS.`

This proves the disposable test's actual restricted SQL login and Postgres TCP connection, but **does not** provision a reusable database or create any real application account.

## Why a separate persistent database?

A land operating system needs a **durable, application-owned account/authorization primary database** independent of both the Supabase Auth provider and the existing parcel PostGIS repository. Authority for app accounts/sessions/counties cannot be inferred from county data or provider user metadata. This staging **does not authorize sessions, MFA assertions, county access, or private GIS output**.

### Source-only staging (nothing launched)

**`docker-compose.auth-dev.yml`** is a new, independent Compose project (`name: ldos-auth-dev`) with only one service `auth-postgres`. Key constraints:

- Official `postgres:17` image, **not** the existing `postgis/postgis:17-3.5` parcel server. Local development only; image digest pinning and updates need review before any production use.
- Local TCP bind **literal `127.0.0.1:54338:5432`**, never environment-controlled public bind; no production host, HTTP service, Supabase key, or parcel network.
- Distinct persistent named volume **`ldos_auth_dev_pgdata`** at PostgreSQL 17's `/var/lib/postgresql/data`; no use of `bdp_postgis_data`. Data will survive an ordinary `docker compose down`; **never use `down -v`** unless explicitly deciding to permanently destroy local test data.
- New local DB named **`ldos_auth_dev`**, admin login initially `postgres` (ONLY for initial setup/migration), unique required `LDOS_AUTH_DEV_POSTGRES_PASSWORD`. The Compose file has **no hard-coded default password** and enforces SCRAM for remote TCP clients. The value is NOT recorded in the repository. Note: this development-only method passes the password through a Docker environment variable that can be visible to the local Docker administrator; production must use a hardened secret manager.
- Does **not** mount `docker-entrypoint-initdb.d`, install the previously staged `ldos_app_auth` SQL, seed accounts, create reader/writer roles, connect to any network API, enable app login, or automatically start when Git code is pulled. Local container startup must be separately authorized.

**`src/bdp/ingestion/parcelAuthDevDatabaseCompose.test.mjs`** adds **16 static-source Node regressions** covering isolated service/project, loopback port, required password, official PG17 path, unique persistent volume, absence of auto migrations/admin grants, and no GIS/API side effects. The exact source and tests passed **16/16 in an in-context JS mock evaluation**. These are **static checks only**, not a successful Compose deployment, schema migration, role privilege proof, restart/recovery test, or Docker functional test.

## Phase A — operator source-only validation NOW (no credentials or Docker)

Run individually from `C:\Users\brand\gods-eye-view`:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevDatabaseCompose.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Predicted **16/16 focused**, **1,322/1,322 land regressions** (previous operator-confirmed 1,306 + 16), and green Vite build. Predictions are **not** operator verification. None of these commands starts Docker, writes a persistent database or needs keys. Share redacted failure logs on the first failed command.

## Operator validation — November 17, 2026

Latest PowerShell screenshot shows **1,322/1,322 complete land regression tests PASSED**, **0 failures, 0 cancelled, 0 skipped**, and **Vite production build PASSED** (250 modules, **8.73 seconds**). The focused 16/16 output is not independently visible, but the complete land suite includes these tests. Large Vite chunks produce only a nonfatal warning. **Step 40C-62D-A source staging is complete; this is not PostgreSQL startup or a persistence test.**

## Phase B — a separate operator decision BEFORE persistent startup

If source-only tests pass, explicitly decide whether to **create the separate local persistent app authorization development database**. This will allocate a named Docker volume, a locally stored DB password and a loopback port (54338) and may require downloading `postgres:17`. It must **not** be confused with an already deployed service or with Supabase Auth production.

Before operator authorization and startup:
- Confirm Docker Desktop is working and port 54338 is unoccupied; verify the existing parcel PostGIS container is unaffected.
- Obtain a **new, unique, local development-only admin password** using a secure Windows prompt; never send it to chat, place it into GitHub, commit an env file, or paste into a screenshot. Never reuse a Supabase dashboard or production database password.
- Review the Compose file and local Docker security model. A Docker administrator can inspect the container environment, so never treat this as production-grade secret storage.
- Run `docker compose config --quiet` only with private settings configured and do **not** show the expanded config, which can expose the password.
- Only then opt in to `docker compose -f docker-compose.auth-dev.yml up -d` with a dedicated project name and password prepared by the operator. **This command is intentionally not part of Phase A or currently authorized.**
- Backup, restore drill, schema migration approval, grants/role attestations, schema ownership and secure app-only DB client connection are later independent tasks. The current 40C-57 ledger draft is **NOT** approved to run automatically or in Supabase/parcel production.

## Remaining authority boundaries

Even after a local persistent DB is running, no account is automatically linked to a real Supabase identity. Only explicit, audited, verified enrollment can provision an account. MFA status, session cookie signing/expiry, county grants, and source-redistribution permissions each need separate trusted proofs. Missing evidence stays unknown and private geometry remains denied. Keep original God's Eye/Cesium interface, 2.4 km Free Explorer, Travis County public parcels, and the Property Intelligence UI unchanged.
