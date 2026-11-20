# Step 40C-56 — Loopback-only Node API foundation (NO authentication or GIS routes)

**Checkpoint: November 16, 2026. STAGED, UNROUTED, LOCAL DEV ONLY; operator Node/land/build validation PENDING.**

## Confirmed Step 40C-55 live proof

Operator screenshot shows the real development Supabase Auth health smoke printed:

`PASS: development Supabase Auth health endpoint reachable using publishable key; no user or land permissions tested.`

and returned to the PowerShell prompt. This is **real Auth service reachability** with a public publishable key. It is **not** verification of a signed-in user, MFA, account, county grant, Postgres app ledger, license or GIS response. The 40C-55 14-case focused/full suite/build summaries were not shown, so they remain independently unconfirmed. Last displayed full regression baseline was **1,133/1,133** for 40C-53.

After the live smoke, remove the local variables without printing their values:

```powershell
Remove-Item Env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:LDOS_SUPABASE_DEV_URL -ErrorAction SilentlyContinue
```

## Why this milestone exists

The existing original God's Eye View experience is a **Vite/Cesium browser application**. Server-only provider files are NOT a deployed trusted API. A secure future user login/grant system requires an independently operated server process and backend deployment. We will build the local-only server boundary *before* passing any real tokens or connecting application-owned account databases.

**New module:** `server/standalone/land-os-api-dev.mjs`.

- Node built-in HTTP server, requiring **`--dev-only`** from the CLI. It binds explicitly to **IPv4 `127.0.0.1`** only, default port **8787**. It does not listen on `0.0.0.0`, any public address, or any LAN interface.
- Exactly one route: `GET /health`. Returns constant JSON: `service:'land-os-api-dev'`, `status:'running'`, **`identityProviderConnected:false`**, **`accountAuthorizationConnected:false`**, **`privateGeometryAvailable:false`**, **`releaseAuthorized:false`**. Unknown paths, HTTP methods, credential-bearing requests, forged Host headers, Origin headers, or requests with request-body headers receive empty HTTP 404. No reflected request data.
- Contains **NO Supabase project URL, publishable key, user token, database secret, PostGIS client, GIS endpoint, login, cookie, CORS allow-origin header or private geometry provider import**. No server is started merely by importing its module; command-line opt-in is mandatory.
- Uses no third-party dependencies and does not alter Vite, package scripts, existing maps, Travis County browsing, Free Explorer cutoff, Property Intelligence panel, source rights or PostGIS data.
- This is a **real loopback HTTP process foundation**, not a production authentication service. Its `/health` status is about this local process only; it does NOT connect to Supabase or verify an actual user. Do not share it via a reverse proxy, ngrok, cloud tunnel or live domain.

**New tests:** `src/bdp/ingestion/parcelLocalDevApiFoundation.test.mjs` contains **14 actual local Node HTTP cases** (not just source regex guards), including localhost binding, strict dev-only opt-in, constant health output, all auth/GIS/admin path denial, method/Host/Cookie/Origin/Bearer-header denial, no CORS or cookies, no header reflection and module boundary checks. Internal staged JS syntax and request-handler checks succeeded; actual Node TCP suite still needs operator verification.

**Expected full land suite if all 40C-55 + 40C-56 tests are discovered: 1,161/1,161** (last confirmed 1,133 + 14 + 14). This is a **prediction**; the most recent operator screenshot shows only 40C-55's live health PASS, not the 1,147 or 1,161 test summaries.

## Operator commands — one at a time

In existing PowerShell at the repo:

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelLocalDevApiFoundation.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **14/14 focused tests**, **1,161/1,161 land regression tests**, and a green Vite build. Stop at first failure and share only sanitized output.

After all checks are green, open one PowerShell window **A** and run:

```powershell
node server/standalone/land-os-api-dev.mjs --dev-only
```

Expected **development-only** startup message:

`DEV ONLY: local API health at http://127.0.0.1:8787/health; no auth or parcels enabled.`

Keep that window open. In a **second** PowerShell window **B**, run:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

Expected JSON keys include `status:running` and all four permission/connection flags **false**. In window A press **Ctrl+C** to stop the development server. Do not run `node server/standalone/land-os-api-dev.mjs` without `--dev-only`; it will refuse to listen.

## Next actual feature delivery

Step 40C-57 should draft a **review-only, app-owned PostgreSQL current account/session/county grant ledger** with durable per-dimension revision counters and careful transactional revocation semantics, then build a server-only provider binding that uses the real Supabase verified subject, not browser-declared roles. Choose secure deployment hosting and application-owned database location before moving any production secrets or enabling real login. Real MFA (trusted AAL evidence), CSRF/Origin/cookie sessions, active logout, full identity revocation, and an independently audited **atomic final release policy** remain undone. **No authenticated parcel geometry, export or licensed source data may be returned until those controls are reviewed and tested.**
