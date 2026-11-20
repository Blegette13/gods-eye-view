# Step 40C-62D-C — Persistent local app authorization DB: READ-ONLY target preflight (NO schema change)

**Status: operator read-only target verification PASSED, November 18, 2026: `ldos_auth_dev|f|t|t`. The correct primary database exists, but `ldos_app_auth` schema and `ldos_auth_account_reader` SQL role do not. No migration or account creation has occurred.**

## Confirmed from the operator's November 18 PowerShell screenshot

- Project `ldos-auth-dev`, service `auth-postgres` on the official `postgres:17` image.
- Container name `ldos-auth-dev-auth-postgres-1` started and showed `Up (healthy)`.
- Local TCP binding `127.0.0.1:54338->5432/tcp`, and `docker compose ... port` confirmed `127.0.0.1:54338`.
- SQL `SELECT current_database(), pg_is_in_recovery();` returned `ldos_auth_dev|f`.
- Independent named volume `ldos-auth-dev_ldos_auth_dev_pgdata` was created. **Persistence across restart and a restore drill have not yet been tested.**
- The PowerShell owner-password environment variable was removed after startup. Nothing in this document requires revealing or re-entering the password. Docker keeps its configured container environment and operator must retain the original password privately.
- Nothing in that screenshot proves `ldos_app_auth` was created or that SQL reader roles exist; no schema/permission migrations have been performed.

## Step C-1 — Read-only, exact-target preflight

In the same Windows PowerShell repository directory, run **only this single read-only query** against the *already confirmed separate persistent auth-dev container*:

```powershell
docker exec ldos-auth-dev-auth-postgres-1 psql -X -U postgres -d ldos_auth_dev -v ON_ERROR_STOP=1 -tAc "SELECT current_database(), pg_is_in_recovery(), to_regnamespace('ldos_app_auth') IS NULL, NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ldos_auth_account_reader');"
```

**Expected for an untouched new auth-dev database:** `ldos_auth_dev|f|t|t`.

Read the four columns as:
1. Exact target DB `ldos_auth_dev`.
2. `f`: PostgreSQL is primary, not a standby.
3. `t`: the proposed `ldos_app_auth` schema does **not** exist yet.
4. `t`: the proposed restricted SQL LOGIN `ldos_auth_account_reader` does **not** exist yet.

If either of the last two checks is `f`, **stop**. A pre-existing account schema or role may belong to an earlier migration and must not be overwritten. If `docker exec` fails or returns another DB name, stop. This check neither creates nor modifies roles, tables, accounts or GIS content. It does not prove the ability to connect via the external password-authenticated Node driver; that proof came from an *earlier disposable database only*.

Because the Compose file requires the initial owner password variable even for `docker compose ps`, this step uses the exact verified container name with `docker exec` and deliberately does **not** reintroduce any password or call Compose.

## Step C-1 operator results — VERIFIED November 18, 2026

The operator ran the exact read-only Docker `exec` SQL probe above against `ldos-auth-dev-auth-postgres-1` and obtained **`ldos_auth_dev|f|t|t`**. This establishes the intended empty persistent target, confirms the SQL session is on a primary and establishes that the proposed new account schema and reader principal do not currently exist. This is **not** an installed app schema or a role permission proof.

The operator also cleared `LDOS_AUTH_DEV_POSTGRES_PASSWORD` from the PowerShell environment after initial startup. No database password, Supabase access token or user credentials are needed for the read-only preflight. Stop and re-check the exact target immediately before any future mutation.

## Step C-2 — Migration review (pending, not authorized)

After C-1 confirms an empty separate database, review `server/standalone/sql/landOsAccountAuthorityFoundation.sql` and the relevant prior disposable Postgres smoke tests:

- The source-controlled SQL is explicitly labeled **review-only / disposable** and has been tested in disposable Postgres, but it has not been approved or applied to this *persistent* auth-dev instance.
- A controlled, operator-approved local-dev migration should use an **exact target attestation immediately before writing**, transactional DDL with `ON_ERROR_STOP=1`, a tested rollback/backup route, and separate restricted principal provisioning. No direct SQL from user-controlled data.
- Tables default to denial: `accounts` suspended, `sessions` revoked/unverified, `county_grants` denied. Triggers guard monotonic revision changes and mutation. The schema is only application authorization data, **not Supabase's `auth.users`**, and the drafts grant no account/tenant/GIS access by themselves.
- A restricted role that reads only `ldos_app_auth.accounts`, and a separate trusted account-enrollment/activation workflow, must be reviewed before any real application user records are inserted. Do not assume existing Supabase identities automatically gain application accounts.
- Database owner password handling (including backup and recovery), staged migration history/rollback and authentication/authorization audit trails need deliberate design before any persistence deployment beyond this local machine.

**Do not run any staged ledger SQL, role grants or container cleanup as part of C-1.** In particular do not run `docker compose down -v`, broad Docker prune or SQL `DROP` commands. The first step simply checks the target and shows whether the app schema and reader principal are absent.

## Scope retained

Original God’s Eye View/Cesium UI, 2.4 km Free Explorer, Travis County public parcels, Property Intelligence, independent PostGIS and real Supabase Auth development project remain unchanged. No verified MFA, issued app sessions, county entitlements, legally licensed source publication or private geometry is enabled.
