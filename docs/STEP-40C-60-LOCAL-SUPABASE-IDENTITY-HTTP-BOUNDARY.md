# Step 40C-60 — First local HTTP route to real Supabase identity verifier

**Status: OPERATOR VERIFIED — 17/17 focused, 1,227/1,227 full land regressions, Vite production build PASSED (November 17, 2026). Local HTTP Supabase user route only; NO live test-user login or GIS release.**
**Date: November 16, 2026.** No production login, cookies, app-owned database connection, MFA authority, GIS route or public deployment.

## Step 40C-59 verified

Operator screenshot confirms **1,210/1,210 complete land regression tests PASSED**, zero failures, and **Vite production build PASSED** (250 modules, **4.95 seconds**). The actual **isolated disposable PostgreSQL current-candidate RPC smoke PASSED**, returning to PowerShell:

\`PASS: disposable app-owned current-candidate RPC: restricted SQL LOGINs, no raw tables, deny defaults, independent epochs and revoked/expired denial; no geometry authorized.\`

This means the synthetic app-ledger candidate read performed as tested in a networkless, disposable database. It does **not** mean the Supabase Auth development project's user identities are linked to that database or a county license exists.

## Implemented: local HTTP identity verification boundary

\`server/standalone/land-os-identity-verification-dev.mjs\` is a **separate** dev-only Node HTTP server, using the **already implemented** \`server/providers/bdp-supabase-auth-user-verifier.js\`, which requests \`GET /auth/v1/user\` from Supabase Auth with an actual signed-in user's access JWT. Supabase documents this as server validation of Supabase Auth access tokens. This is not a login form or a new JWT implementation.

- Requires exact CLI argument \`--dev-only\`, and dev-only project URL and **publishable** API key via \`LDOS_SUPABASE_DEV_URL\` and \`LDOS_SUPABASE_DEV_PUBLISHABLE_KEY\`. No keys, URLs, access JWTs or secret DB credentials are embedded in source. Never use \`sb_secret_...\`, service-role, DB password or personally sensitive information in chat.
- Binds **only 127.0.0.1**, default TCP port **8788**; it is not the existing \`127.0.0.1:8787\` health server and does not change that service. Do NOT expose through a tunnel, proxy, Docker port or public host.
- Accepts **only GET /dev/identity/check** with exactly one \`Authorization: Bearer <user access JWT>\` and a strict local Host. Rejects other paths, methods, Origins, cookies, bodies, malformed tokens, forged Host, duplicate Authorization, unavailable Supabase and anonymous users. Sends no CORS allow-origin or cookies, no redirects, no logs of credentials or user details.
- Calls the real existing **server-side** Supabase Auth verifier and returns only fixed generic JSON. A positive response means the *remote Supabase Auth user endpoint accepted that token* and the verifier returned a confirmed subject; it **never** returns the subject UUID, email, user_metadata, token or API key.
- Both responses permanently set \`mfaConfirmed:false\`, \`appAccountAuthorized:false\`, \`appCountyGrantConfirmed:false\`, \`appSessionIssued:false\`, \`releaseAuthorized:false\`. A response from this server is not sufficient evidence for access to any protected parcel records or geography.
- There is **no** login/signup/password route, session issuing/cookie rotation, app-owned PostgreSQL connection, county-grant writer or reader, PostGIS geometry, private source redistribution gate, account admin, public export or existing front-end modification. The \`vite build\` success alone still is not a deployed Node backend.

\`src/bdp/ingestion/parcelLocalSupabaseIdentityApi.test.mjs\` adds **17 actual local HTTP contract tests** (with mocked Supabase outbound HTTP): loopback binding, strict dev-only opt-in, successful remote-auth user mapping without exposing subject or granting permissions, 401 denial for absent/invalid/revoked/anonymous/outage evidence, no other API paths, no browser Origin/CORS, duplicate headers denied, forged Host/method/cookie/body denial, and hardening headers. One lightweight in-context JavaScript check of the handler's happy and fail-closed responses succeeded, but the actual Node full suite is not yet operator-confirmed.

## Operator commands

Execute from the already used Windows PowerShell repository directory, individually:

\`\`\`powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelLocalSupabaseIdentityApi.test.mjs
npm.cmd run test:land
npm.cmd run build
\`\`\`

**Expected focused: 17/17** and **predicted full land suite: 1,227/1,227** (operator-confirmed baseline 1,210 + 17 new tests), plus a green Vite production build. **Do not report these as passed until the operator sends the results.**

For this step, all tests use **mocked Supabase user responses** and **actual local Node HTTP sockets**. They need **no actual user JWT**, no Docker, no Supabase admin key or DB access. Do **not** enter or screenshot real user tokens yet.

## Operator verification — November 17, 2026

The operator's fresh PowerShell screenshots confirm the **17/17 focused Node tests PASSED**, **1,227/1,227 land regression tests PASSED** (zero failures) and a successful **Vite production build**, with 250 transformed modules in **9.57 seconds**. The previous `URL is not a constructor` test bug was corrected by renaming a constant to `PROJECT_URL`; the operator reran the focused suite and obtained 17/17. The existing oversized Vite chunk warning is nonfatal.

**40C-60 is complete as a local HTTP contract**, not a live human-authentication integration. The 17 tests use an actual loopback Node server but mocked responses from Supabase's external Auth service. A real dedicated development test-user flow is now staged separately in Step 40C-61.

## Next: controlled dev-only real user proof & backend decision

After local tests pass, prepare a test-only sign-in flow using official Supabase Auth rather than asking the operator to paste JWTs into command history. Any authorized test account should be owned and handled privately through a secure local workflow. The development server can then be pointed at the real Supabase project's URL and publishable key and verified against a signed-in test account, still with **zero app account, county permissions or GIS release**.

Then make the blocking architecture choice for the **trusted production backend host, database primary and separately owned account/session/county-grant authority**. Add a durable server-side session exchange, independently verified MFA assurance, secure cookies, CSRF/Origin protections, revocation audit, licensing approval and network response-release ordering before activating any protected route. The currently staged SQL ledger and candidate RPC are NOT production migrations and must not be applied to \`land-os-auth-dev\` without an independent review.

**Preserved:** original God’s Eye View/Cesium UI, Free Explorer at 2.4 km, public Travis County CAD browsing, Property Intelligence panel, no-forged-GIS-evidence policy.

Official Supabase documentation: https://supabase.com/docs/guides/auth/jwts and https://supabase.com/docs/reference/javascript/auth-getuser .
