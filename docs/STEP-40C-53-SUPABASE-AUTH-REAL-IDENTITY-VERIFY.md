# Step 40C-53 — Real Supabase Auth identity verification foundation

**Status: OPERATOR-VALIDATED CODE CONTRACT (1,133/1,133 LAND TESTS, VITE BUILD PASSED) / UNROUTED / NOT LIVE CONFIGURED.**
**Decision:** Operator approved Supabase Auth for user identity and separate app-owned PostgreSQL for current account/session/county entitlements. Date: November 15, 2026.

## What is real, what is not

The existing six SQL principals protect database RPCs, not human identities. Step 40C-50/51 identity candidate contracts are synthetic review-only evidence. The new **server-only** `server/providers/bdp-supabase-auth-user-verifier.js` is the FIRST adapter that can make a genuine, fresh HTTP request to **Supabase Auth**:

`GET https://<project-ref>.supabase.co/auth/v1/user`

using `apikey: sb_publishable_...` and `Authorization: Bearer <signed-in user's access JWT>`. Supabase documents this endpoint as a method of validating the token with the project's Auth service; this code does **not** decode or authorize the JWT locally. The endpoint and its project-host origin are tightly allowlisted. The response is only accepted on HTTP 200 JSON, with a canonical user UUID, authenticated role and explicit non-anonymous status, bounded body, no redirects, no caches, no cookies, short timeout and AbortSignal support. Failures return `null` without logging keys or tokens.

**Crucial:** This confirms an identity from a *remote Auth service when deployed with a genuine project*. It is **not an app-owned session, current logout/disable proof, MFA assurance proof, or county grant**. The successful result always says `mfaConfirmed:false`, `appCountyGrantConfirmed:false`, `appSessionIssued:false`, and `releaseAuthorized:false`. The adapter is UNROUTED and NOT connected to the Cesium app, the six-principal geometry service, or an external identity project. The test suite uses fake network responses; no real Supabase user or project was contacted.

Supabase guidance distinguishes `getUser` (network call and current user record) from `getSession` (local session object, unsafe to trust as an independent server authority), and says the server may validate HS256 tokens by calling `/auth/v1/user`. It also describes the JWT `aal` claim for MFA. **This adapter does not validate the signed AAL claim**, so it intentionally refuses to claim MFA completion. A real MFA-enforcement integration using a trusted JWT claims-verification library or separately verified session assurance must be added later.

Primary vendor documentation:
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/getting-started/api-keys

## Source-controlled changes

1. `server/providers/bdp-supabase-auth-user-verifier.js` — dependency-free, **server-only**, explicit project URL and **publishable** key, calls actual Supabase Auth user-validation endpoint with the caller's token via `fetch` (or a test-injected fetch); returns only frozen identity evidence without PII, MFA, grants, app session or release permission. Restricts arbitrary hosts, redirects, non-GET methods, extra arguments, extra config, oversized bodies and tokens, network failure, HTTP errors, anonymous users, wrong roles and bad IDs. No admin/service keys, secret APIs, migrations or route mount.
2. `src/bdp/ingestion/parcelSupabaseAuthUserVerifier.test.mjs` — **19 new Node tests** with mocked HTTP responses to verify valid/invalid identities, exact request headers, token/session isolation, key pinning, invalid config/token/host, cancellations, network outages, oversized responses, no role/MFA inference and no HTTP/browser/geometry route.

Previous confirmed baseline: **1,114/1,114 land tests and Vite build passed** (250 modules, 4.35 seconds). **Operator screenshot now confirms 1,133/1,133 full land regression tests PASSED** (zero failures, 24.56 seconds) and **Vite production build PASSED** (250 transformed modules, 5.15 seconds). The standalone 19-case focused summary is not visible in the submitted screenshot, but these tests are included in the full suite. The previous in-context simulation is supplemental. No real Supabase Auth service, user session or provider project was contacted by these mocked tests.

## What an authorized project owner will need to do later

1. Set up a Supabase project in an account permitted by Supabase's terms. Use a separate **development/test** project first; do not create production user accounts or import county GIS data.
2. From the project's Connect / API Keys settings, obtain the project's **https://<ref>.supabase.co Project URL** and **`sb_publishable_...` publishable key**. These identify the *client application*; they are NOT the user's access JWT and do not grant service-role permissions. **Never send or store `sb_secret_...`, legacy service-role keys, signing secrets, user passwords, or access/refresh tokens in ChatGPT, GitHub, screenshots or the Vite bundle.**
3. Keep the future Node application's environment configuration in ignored local environment/hosting secrets. The server factory accepts values directly; no hardcoded project ref or key appears in the repo. Because no trusted API deployment is selected yet, there is **no route/cookie/session exchange to configure or test live** in this step.
4. Choose a backend deployment region and HTTPS origin near the hosted Supabase project and the app-owned authorization database. Plan secure cookies and CSRF/Origin safeguards, rate limits, audit without tokens, and account recovery before enabling real login screens.
5. Define the authoritative app-owned PostgreSQL user/account/session/county grant schema, durable revocation epochs and recovery/restore constraints. MFA must be verified from trusted Auth token claims and current app policy, not from user metadata. Anonymous 3D map browsing can remain separate; private parcel functions require an independent verified county grant plus independently licensed source publication rights.
6. Approve and implement an audited final authorization/release gate before allowing any parcel geometry to leave a private service. Two reads (even two verified ones) cannot make an HTTP response atomic with revocation.

## Operator validation — PowerShell, one command at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelSupabaseAuthUserVerifier.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected: **19/19 focused**, **1,133/1,133 land regressions**, and successful Vite build. These are *predictions*, not observed operator results. There is **NO external Supabase connection or secret required** for these tests. Stop at the first failure, share only sanitized test output.

## Next step (after tests and project availability)

Implement the **real server-side app-owned account/session/county grant service** and a trusted MFA-assurance verification mechanism. Keep private GIS readers UNROUTED until actual permission and legal data-rights reviews pass. Do not falsely call Supabase's publishable key a user identity or treat a valid Supabase access JWT as a land-data publication license.

The existing God's Eye View/Cesium interface, 2.4 km Free Explorer threshold, Travis County parcel browsing and Property Intelligence panel remain untouched.
