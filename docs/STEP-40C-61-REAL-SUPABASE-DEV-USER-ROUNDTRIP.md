# Step 40C-61 — Real Supabase development user round-trip (LOCAL ONLY)

**Status: PHASE A OPERATOR VERIFIED — 20/20 FOCUSED TESTS, 1,247/1,247 LAND REGRESSIONS, VITE BUILD PASSED. REAL SUPABASE TEST-USER SIGN-IN STILL PENDING. November 17, 2026.**

## Completed 40C-60 baseline

Operator screenshots confirm **17/17 focused Node tests**, **1,227/1,227 land regressions**, zero failures, and **Vite build PASS** (250 modules, 9.57 seconds). The corrected URL-shadowing test passes. Previous local HTTP tests mocked outbound Supabase responses, and did not authenticate an actual user.

## Step 40C-61 new implementation

- **scripts/bdp/supabase-dev-user-identity-roundtrip.mjs**: One-time, explicitly opted-in development test-user sign-in probe. It uses only an operator-provided development Project URL and public publishable key, and reads a *dedicated non-admin development user* email/password from a bounded stdin JSON stream. It rejects unexpected arguments, malformed input, secret/service-role keys, and arbitrary network destinations.
- Starts a **temporary, in-process 127.0.0.1 Node service** using the already tested 40C-60 identity-only route on a random local port. Before attempting sign-in, an intentionally invalid JWT must be refused with HTTP 401 and no permissions; otherwise the probe stops.
- Uses HTTPS POST to the documented Supabase Auth **/auth/v1/token?grant_type=password** endpoint once, then passes the returned access JWT **in process memory only** to the temporary local server via a bearer header. The server independently contacts the real **/auth/v1/user** endpoint. No access JWT, refresh token, email, password or user subject is printed or saved.
- Success requires a fixed generic **providerIdentityConfirmed:true** verdict, with **mfaConfirmed:false**, **appAccountAuthorized:false**, **appCountyGrantConfirmed:false**, **appSessionIssued:false**, and **releaseAuthorized:false**. Never a GIS authorization or user-login application. The temporary local server is closed on success or failure. Generic errors do not expose credentials.
- This direct password grant is **test-only**, not the intended production/browser login design. The test user must be dedicated and disposable, never the Supabase dashboard administrator. Access tokens still expire according to Supabase; exiting the process does not guarantee global revocation.
- **src/bdp/ingestion/parcelSupabaseDevUserRoundtrip.test.mjs**: 20 new Node tests for opt-in, safe stdin, malformed inputs, local and remote positive/negative exchanges, invalid/revoked/anonymous users, no permissions, no reflected secrets, and no public GIS. An isolated development Node harness with stand-in dependency modules passed 20/20; **the actual operator repository tests and live Supabase test-user flow have not been run or confirmed**.

Nothing has been added to the God’s Eye View/Cesium UI, Vite client, production database, the live Supabase Auth project, private PostGIS readers, or the county-grant publication pathway.

## Phase A — Validate the new source changes

From the existing PowerShell repository directory, one command at a time:

    git pull --ff-only origin bdp-development
    node --test src/bdp/ingestion/parcelSupabaseDevUserRoundtrip.test.mjs
    npm.cmd run test:land
    npm.cmd run build

Predicted: **20/20 focused**, **1,247/1,247 land regressions** (previous verified 1,227 + 20), and a green Vite build. Predictions are not verified operator results. If any check fails, stop and share only sanitized output.

## Phase A — Verified operator results

Latest operator screenshots confirm **20/20 new focused tests PASSED**, **1,247/1,247 complete land regression tests PASSED** with zero failures/skips, and the **Vite build PASSED** with 250 modules in **9.37 seconds**. The preexisting large-chunk warning is nonfatal. These test results use **mocked outbound Supabase responses** and a genuine local Node HTTP socket. No actual test user's Supabase Auth password login has occurred yet; do not call Step 40C-61 fully complete until the separately authorized live test-user proof succeeds.

## Phase B — Prepare a dedicated development test account

With the authorized project owner, visit the development project dashboard **Authentication → Users** and use **Add user** to create/invite a **separate, confirmed development test user** with a development-only email and password. Follow the on-screen email verification and password setup instructions. Never disable verification or MFA requirements just to obtain a passing test. Do NOT use the Supabase dashboard login, an organization administrator login, or a personal password.

Supabase documents dashboard invitations and the need to verify emails:
https://supabase.com/docs/guides/auth/users
https://supabase.com/docs/guides/auth/passwords

## Phase C — Private real user round-trip in one Windows PowerShell window

The script starts and stops its temporary local API automatically, so no second window or port 8788 server is necessary. The same previously proven Supabase development project URL and publishable key must be configured again if the environment variables were cleared after the earlier health check.

Enter each command separately in the PowerShell repo directory:

    $env:LDOS_SUPABASE_DEV_URL = Read-Host 'Paste development Supabase Project URL'

    $key = Read-Host 'Paste development sb_publishable key (hidden)' -AsSecureString

    $env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY = ([System.Net.NetworkCredential]::new('', $key)).Password

    Remove-Variable key -ErrorAction SilentlyContinue

Then securely prompt for the **dedicated development test-user identity and password**, not for the dashboard administrator:

    $testCred = Get-Credential -Message 'Supabase development TEST user ONLY (not dashboard administrator)'

Pipe the one-time credential values directly to the development CLI without putting them into command history:

    @{ email = $testCred.UserName; password = $testCred.GetNetworkCredential().Password } | ConvertTo-Json -Compress | node scripts/bdp/supabase-dev-user-identity-roundtrip.mjs --dev-only --stdin-credentials

Success message, only when a real test-user login and remote user verification succeeded:

    PASS: development test user authenticated with Supabase and reverified by local Node API; MFA, app sessions, county grants and geometry remain disabled.

Finally erase the PowerShell variables:

    Remove-Variable testCred -ErrorAction SilentlyContinue
    Remove-Item Env:LDOS_SUPABASE_DEV_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:LDOS_SUPABASE_DEV_URL -ErrorAction SilentlyContinue

**Security:** The PowerShell-to-Node pipe and short-lived Node process temporarily contain the test user's plaintext password; the CLI neither prints nor persists it, and the public publishable key cannot act as a service-role key. Use a disposable development account, never a real organization administrator or personal password. Never paste the email/password, verification codes, bearer/refresh JWTs, or secret keys into chat, GitHub, screenshots or browser-console logs. If the CLI fails, share only the generic one-line error. The script does not use Supabase Admin APIs, does not sign out globally, and cannot guarantee JWT revocation by exiting.

## What remains for production

Actual app sign-in UI, trusted production backend hosting, strongly current app-owned Postgres accounts and county grants, audited secure cookies, CSRF and origin protection, signed MFA assurance, safe revocation races, and separate legal GIS redistribution approval remain **unimplemented**. Neither a provider-verified subject nor a candidate county-grant database record permits private parcel delivery. Never apply the staged app-auth SQL to the real Supabase project or production PostGIS until separately reviewed.

The original Cesium God’s Eye View interface, 2.4 km Free Explorer, Travis County browsing and Property Intelligence panel remain unchanged.
