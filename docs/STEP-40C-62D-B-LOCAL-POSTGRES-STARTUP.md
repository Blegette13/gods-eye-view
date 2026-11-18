# Step 40C-62D-B — Operator-controlled LOCAL persistent app PostgreSQL startup

**Status: OPERATOR STARTUP INSTRUCTIONS STAGED; NOT EXECUTED BY CHATGPT. November 17, 2026.**
**Prerequisite:** Step 40C-62D-A source checks are verified: 1,322/1,322 land regressions, Vite build 250 modules in 8.73 seconds. No persistent database yet.

## Scope

Startup of the separately named **`ldos-auth-dev`** Compose project from `docker-compose.auth-dev.yml`. One official `postgres:17` service, data volume `ldos_auth_dev_pgdata`, localhost-only `127.0.0.1:54338`. This is a **persistent local development** instance with a fresh, operator-held dev-only PostgreSQL owner password, not the existing parcel PostGIS server or Supabase Auth.

This step deliberately **does not** apply draft `ldos_app_auth` schema SQL, create reader/writer roles, add real accounts, establish any browser login, claim MFA assurance, grant counties, or release GIS geometry. Those are later separately reviewed tasks. Only a local dev database is created.

## Preflight in a single Windows PowerShell repo window

Run commands separately. Do not print an unmasked Docker Compose configuration or share credentials.

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
docker info --format '{{.ServerVersion}}'
Get-NetTCPConnection -LocalPort 54338 -State Listen -ErrorAction SilentlyContinue
docker compose -f docker-compose.auth-dev.yml ps --all
```

The TCP check **should return no listening process**. If any listener is shown, stop and investigate instead of overwriting its port. Compose `ps --all` should have no existing `auth-postgres` for the *first* startup; if an old container exists, do not initialize again or delete it. Confirm that all commands refer to `docker-compose.auth-dev.yml`, **never `docker-compose.bdp.yml`**.

## Private operator password, not GitHub

Generate and save a **unique, strong development-only** password in a locally trusted password manager. It is used to initialize the `postgres` OWNER account and must be preserved for future restarts and DB recovery. Never reuse a Supabase account/admin password or paste the password into command history, chat, screenshots, an `.env` or a tracked file.

```powershell
$authDbPassword = Read-Host 'Enter NEW local auth-dev PostgreSQL OWNER password' -AsSecureString
$env:LDOS_AUTH_DEV_POSTGRES_PASSWORD = ([System.Net.NetworkCredential]::new('', $authDbPassword)).Password
Remove-Variable authDbPassword -ErrorAction SilentlyContinue
```

**Security limitations:** Docker engine administrators can inspect the running container's environment; temporary PowerShell variables may also be accessible to local privileged processes. This is *local development only*, not a production secret-management model. `POSTGRES_PASSWORD` initializes a newly empty data directory, **not a rotation mechanism** for an existing volume.

## Review resolved config privately, then explicitly start

```powershell
docker compose -f docker-compose.auth-dev.yml config --quiet
docker compose -f docker-compose.auth-dev.yml up -d
```

The first `up -d` may download the official PostgreSQL 17 image. It should only create the independent local `ldos-auth-dev` database service and data volume. If a Docker or port error appears, stop; do not prune containers or delete volumes.

## Verify the actual listener, health and primary identity

```powershell
docker compose -f docker-compose.auth-dev.yml ps
docker compose -f docker-compose.auth-dev.yml port auth-postgres 5432
docker compose -f docker-compose.auth-dev.yml exec -T auth-postgres psql -X -U postgres -d ldos_auth_dev -v ON_ERROR_STOP=1 -tAc "SELECT current_database(), pg_is_in_recovery();"
```

Expected endpoint: **`127.0.0.1:54338`**. The SQL result should be **`ldos_auth_dev|f`**, showing the new local database is accessible and its server is not a standby. Health should read **healthy** after initialization. Docker's in-container `psql` may use socket authentication; this local read-only SQL probe does not by itself prove an external password-authenticated Node driver login.

Stop if any check is wrong. **Never paste connection strings, full Docker config, passwords or tokens into chat.**

## Clean the shell; do not delete the DB

```powershell
Remove-Item Env:LDOS_AUTH_DEV_POSTGRES_PASSWORD -ErrorAction SilentlyContinue
```

The initialized database is persistent. **Do not run `docker compose down -v`, `docker volume rm`, `docker system prune --volumes`, or broad cleanup scripts**; these can permanently destroy local data. A plain `docker compose -f docker-compose.auth-dev.yml stop` stops this service without deleting the volume. Future `docker compose ... up` or `start` may require re-setting the owner password variable to satisfy Compose interpolation, even though this variable alone does not change the existing database password.

## Exit criteria and next phase

Mark 40C-62D-B **complete only once the operator confirms** the actual Compose instance is healthy, bound to loopback, SQL reports `ldos_auth_dev|f`, and the service is isolated from existing parcel PostGIS.

Next, separately review and deploy the app-owned ledger schema and **least-privilege** roles into this *explicitly selected local dev database only*; add backup/restart durability evidence, then test actual `pg.Pool` account reads with a restricted login. **Do not apply account schema drafts to Supabase Auth, the parcel database, or any production target.** Original Cesium God’s Eye View, Free Explorer at 2.4 km, Travis CAD and Property Intelligence remain unchanged.
