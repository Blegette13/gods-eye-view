# Step 40C-62D-B — Operator-controlled LOCAL persistent app PostgreSQL startup

**Status: OPERATOR VERIFIED — persistent local PostgreSQL 17 started November 18, 2026; healthy, localhost-only 127.0.0.1:54338, ldos_auth_dev|f primary SQL probe PASSED; password variable cleared. No app-auth schema migration, app-account SQL role, user account or county grants created.**
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

## November 18, 2026 — REAL OPERATOR STARTUP CONFIRMED

The operator's fresh PowerShell screenshot confirms all Step 40C-62D-B acceptance criteria:

- `docker compose -f docker-compose.auth-dev.yml config --quiet` exited successfully after `LDOS_AUTH_DEV_POSTGRES_PASSWORD` was supplied using a hidden PowerShell prompt.
- `docker compose ... ps --all` displayed no existing service before first initialization; `docker compose ... up -d` pulled `postgres:17`, created `ldos-auth-dev_default`, created the **persistent named volume** `ldos-auth-dev_ldos_auth_dev_pgdata`, and started `ldos-auth-dev-auth-postgres-1`.
- `docker compose ... ps` displayed **Up (healthy)** and **127.0.0.1:54338->5432/tcp**; `docker compose ... port auth-postgres 5432` returned **127.0.0.1:54338**.
- `docker compose ... exec -T auth-postgres psql -X -U postgres -d ldos_auth_dev -v ON_ERROR_STOP=1 -tAc "SELECT current_database(), pg_is_in_recovery();"` returned **`ldos_auth_dev|f`**; an ordinary PostgreSQL primary, not a standby.
- The shell's `LDOS_AUTH_DEV_POSTGRES_PASSWORD` variable was removed after checks. The operator is responsible for retaining the initial owner password in a private password manager. This removal does not rotate the password already installed in the database and does not remove Docker's environment metadata.
- No screenshot confirms any `ldos_app_auth` schema, restricted login roles, sessions, permissions, user records, migrations, or GIS rights. **No migration was requested or performed.** Container/volume durability across restart is not yet separately demonstrated.

**40C-62D-B is complete as local database startup/health validation.** Subsequent inspection can use read-only `docker exec` with the **specific container name** `ldos-auth-dev-auth-postgres-1` to avoid requiring the removed Compose interpolation password. Do not create or alter tables/roles until Step 40C-62D-C preflight and controlled migration have been reviewed.

## Exit criteria and next phase

Mark 40C-62D-B **complete only once the operator confirms** the actual Compose instance is healthy, bound to loopback, SQL reports `ldos_auth_dev|f`, and the service is isolated from existing parcel PostGIS.

Next, separately review and deploy the app-owned ledger schema and **least-privilege** roles into this *explicitly selected local dev database only*; add backup/restart durability evidence, then test actual `pg.Pool` account reads with a restricted login. **Do not apply account schema drafts to Supabase Auth, the parcel database, or any production target.** Original Cesium God’s Eye View, Free Explorer at 2.4 km, Travis CAD and Property Intelligence remain unchanged.
