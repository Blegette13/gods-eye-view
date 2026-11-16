# Step 40C-55 — Real development Supabase Auth health check

**Status: OPERATOR-CONFIRMED LIVE SUPABASE AUTH HEALTH PASS / NEW LOCAL REGRESSION AND BUILD SUMMARIES NOT SHOWN / NO USER AUTHENTICATION OR PUBLIC GIS.**
**Date: November 15–16, 2026.**

## Confirmed external setup: Step 40C-54

The operator provided Supabase dashboard screenshots showing a **healthy** development-named project `land-os-auth-dev`, under a **Free** plan, with a **default publishable key**, and a **US East (North Virginia), us-east-1** primary database. The Supabase dashboard also labels the project's default `main` branch `PRODUCTION`; this is the platform's branch label, **not** evidence that the Land OS application is live. No identity provider session, MFA, GIS grant, migrations or deployed backend are established. The secret key is masked and remains unused.

## This stage

We have a first **real network-only, read-only, development-only** integration smoke:

`scripts/bdp/supabase-dev-auth-health-smoke.mjs`

- Uses **only** the operator's environment-supplied Supabase Project URL (`LDOS_SUPABASE_DEV_URL`) and the `sb_publishable_...` key (`LDOS_SUPABASE_DEV_PUBLISHABLE_KEY`).
- Requires the explicit **`--dev-only`** opt-in flag. Rejects all other arguments and extra configuration. No project URL, key or user JWT is committed.
- Makes one bounded, non-redirecting, no-store HTTPS `GET https://<project-ref>.supabase.co/auth/v1/health` request containing only the **publishable `apikey`**. Supabase officially documents this endpoint as a way to check the running GoTrue version and service availability. No username, password, Auth user token, DB connection or SQL is involved.
- On a real HTTP 200 JSON health response that identifies the GoTrue service, prints only the fixed PASS line below; otherwise outputs a generic failure, without printing any key, URL, server response, token or private data.
- **A successful health check does not prove a valid user session, authentication, MFA, account/county authorization, application account store, real session revocation, or GIS redistribution rights.** The Step 40C-53 `/auth/v1/user` verifier remains **unrouted**.

`src/bdp/ingestion/parcelSupabaseDevAuthHealthSmoke.test.mjs` adds **14 network-mocked automated safety and protocol tests**. An internal isolated JavaScript source simulation of these tests passed **14/14**. The operator still must run the actual Node suite and the real remote health smoke.

`.gitignore` now ignores `.env.*` variants, protecting future local environment configuration files from accidental Git tracking (while permitting `.env.example` as a documentation template). **No environment file or key was committed.**

## Operator validation in existing PowerShell

Execute individually:

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSupabaseDevAuthHealthSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

**Expected: 14/14 focused and 1,147/1,147 full land regression tests** (previous 1,133 + 14), plus a green Vite production build. These are **predictions until operator-confirmed**.

After all checks are green, run the first REAL development Auth health test. Copy the **Project URL** from your Supabase project overview; use the **publishable** key from Project Settings → API Keys. **Do not paste the key into chat or screenshots.** On your local PowerShell, enter one command at a time:

```powershell
$env:LDOS_SUPABASE_DEV_URL = 'https://<your-project-ref>.supabase.co'
$publishable = Read-Host 'Paste the Supabase sb_publishable key (input hidden)' -AsSecureString
$env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY = ([System.Net.NetworkCredential]::new('', $publishable)).Password
Remove-Variable publishable
node scripts/bdp/supabase-dev-auth-health-smoke.mjs --dev-only
Remove-Item Env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:LDOS_SUPABASE_DEV_URL -ErrorAction SilentlyContinue
```

**The project URL above is a placeholder**, not a domain to run literally. Do not use `sb_secret_...`, any legacy `service_role` value, personal user access tokens, the Supabase database password or other privileged secrets. If the smoke fails, report only the fixed generic error and whether Docker/PowerShell is still responsive; never send key values or SQL connection strings. A health PASS is expected if the owner-provided development URL/key and service are functional, but it is **not yet operator confirmed**.

Expected success text:

`PASS: development Supabase Auth health endpoint reachable using publishable key; no user or land permissions tested.`

## Operator live connectivity confirmation — November 16, 2026

The operator provided a PowerShell screenshot of the actual local script completing with:

`PASS: development Supabase Auth health endpoint reachable using publishable key; no user or land permissions tested.`

The process returned normally to the PowerShell prompt. This confirms **the developer machine successfully reached a live Supabase Auth GoTrue health endpoint with the development project's publishable key**, beyond the previously mocked responses. The screenshot shows no access token, secret, database connection or real user authentication. **The standalone 14-test summary, 1,147-test full land suite, and new build result are not shown here** and should not be represented as separately operator-confirmed.

After the health proof, remove both ephemeral PowerShell environment variables with `Remove-Item Env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY -ErrorAction SilentlyContinue` and `Remove-Item Env:LDOS_SUPABASE_DEV_URL -ErrorAction SilentlyContinue`. Do not preserve them in GitHub or the browser bundle.

**Step 40C-55's real health-connectivity gate is met.** It is NOT a login/MFA/grant or GIS authorization test.

## What's next

Step 40C-56 must choose a trustworthy, independently hosted **server-side Node API** and design the application-owned current account/session/county grant ledger. The existing Vite SPA is **not** the right place to store privileged credentials or perform authoritative county entitlement checks. Prepare only code and migrations that can be reviewed before live deployment. Actual client sign-in screens, current MFA enforcement, session revocation, audited final release checks and GIS publication rights remain separate tasks.

**Preserve:** God's Eye View/Cesium, Free Explorer at 2.4 km, Travis County public browsing, the Property Intelligence panel, source provenance and deny-on-unknown GIS behavior.

Sources:
- https://supabase.com/kb/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/getting-started/api-keys
