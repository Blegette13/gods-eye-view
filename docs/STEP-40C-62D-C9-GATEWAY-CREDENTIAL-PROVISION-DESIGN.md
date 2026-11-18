# Step 40C-62D-C9 — Local restricted gateway credential/SQL role design (NO APPLY)

**Status: proposed source-only SQL design and 15 offline Node security-contract tests staged on `bdp-development`; operator tests pending. Nothing has been provisioned or written to a persistent PostgreSQL database.**

## Prior operator evidence

On November 18, 2026, the C8 operator screenshot confirmed **12/12 focused tests**, 0 failures, and an exact PASS from the persistent auth-dev read-only preflight. It established that `ldos_auth_dev` is an expected local primary; all authorization tables are empty; `ldos_auth_account_reader` is a NOLOGIN reader with column-limited privileges; `ldos_auth_gateway_login` is absent; and the candidate RPC is absent.

## C9 changes

- `scripts/bdp/app-auth-local-gateway-provision-plan.mjs` — a **source-only proposal** for the future restricted gateway PostgreSQL LOGIN and role membership. The **only** executable CLI flag is `--plan-only`. There is **no apply route, Docker invocation, generated credential, credential file, role creation or network connection**.
- `src/bdp/ingestion/parcelAuthDevGatewayProvisionPlan.test.mjs` — 15 offline security and design contracts.
- The proposed SQL is an atomic, guarded, local-dev-only transaction: exact `ldos_auth_dev` primary/operator, existing unprivileged NOLOGIN reader, absent gateway LOGIN, no candidate RPC, and no persistent ledger rows. It creates one `ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` and grants exactly `ldos_auth_account_reader TO ldos_auth_gateway_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`. **This SQL is not yet executable from the CLI**.
- A future migration must generate its own CSPRNG credential; protect/rotate it using a reviewed Windows DPAPI local user-secret workflow outside the GitHub checkout, **never write plaintext to logs, argv, code or GitHub**, and confirm Postgres 17 permissions after provisioning.
- The existing `pg_dump` database backup does **not** independently preserve cluster-global roles and grants. Before a persistent role mutation, stage and test a protected global-role backup/recovery procedure, plus plan for role rollback/rotation. Do not publish `pg_dumpall --globals-only` output because it can include password hashes.
- The next separately approved step must integrate the exact container attestation and C8 read-only preflight, ensure protected secret storage and recovery first, apply once with fail-closed guard, then verify the actual LOGIN without a browser/HTTP endpoint or GIS/data release.

## Operator C9 Phase A — safe source-only validation

From the repository root in PowerShell:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelAuthDevGatewayProvisionPlan.test.mjs
node scripts/bdp/app-auth-local-gateway-provision-plan.mjs --plan-only
npm.cmd run test:land
node --max-old-space-size=2048 .\node_modules\vite\bin\vite.js build
```

**Predicted:** 15 focused tests, 0 failures; full suite **1,415** if no other changes (previous verified 1,388, plus 12 C8 tests and 15 C9 tests); successful Vite build; and exactly:

```text
PLAN: C9 restricted local gateway LOGIN SQL staged; requires separate protected-credential, cluster-role backup and apply review; NO database changes.
```

These counts are predictions, not operator-verified results. Do **not** run hand-written CREATE ROLE statements against the persistent local database. A `--apply-local-auth-only` argument to C9 intentionally fails.

## Unchanged

No real app accounts, sessions, county grants, Supabase-to-app enrollment, verified MFA, HTTP authentication, private parcel releases or licensed GIS publication. The separate parcel PostGIS and original God’s Eye View Cesium Free Explorer remain untouched.
