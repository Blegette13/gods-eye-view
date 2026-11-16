# Step 40C-54 — Authorized Supabase development project onboarding

**Status: OPERATOR-CONFIRMED DEVELOPMENT SUPABASE PROJECT CREATED / HEALTHY; PUBLISHABLE KEY PRESENT. NO LIVE LOGIN OR API DEPLOYED.**
**Date: November 15, 2026.** Step 40C-53 is operator-validated: **1,133/1,133 land regression tests PASSED**, zero failures; **Vite build PASSED** (250 modules, 5.15 sec). These tests use fake Supabase network responses.

## Why this milestone is a setup step

The project selected Supabase Auth as the human identity issuer, with a **separate application-owned PostgreSQL ledger** for authoritative account/session/county grants and the established PostGIS GIS readers. Source-controlled `server/providers/bdp-supabase-auth-user-verifier.js` is an **UNROUTED** server-only verifier, not an active API. Without an authorized hosted Supabase development project and trusted backend deployment, it has nowhere real to send its verification request. Do not generate more fake identity milestones in place of this setup.

## Dashboard checklist for authorized organization project owner

1. Sign into **https://supabase.com/dashboard** as an owner permitted to manage the project under the service's terms. Use a development/test organization, not an unrelated personal project. If an organization account requires an eligible adult administrator or billing owner, have the appropriate administrator complete setup and manage credentials.
2. Select **New project**, choose the correct organization, and name it **`land-os-auth-dev`** (suggested, not a hardcoded requirement). Choose the Free plan if available and appropriate. Select a US region close to the *future* trusted backend; avoid treating the current developer's computer as permanent deployment.
3. Choose and privately store a unique database password using the organization password manager. **Never paste or screenshot any password, recovery code, service-role/secret key, or bearer/refresh token into ChatGPT, GitHub, terminal logs or screen captures**.
4. Once the project is ready, open **Connect** for its Project URL, and **Project Settings → API Keys** to confirm a **`sb_publishable_...`** key exists. Those are development configuration for a future backend/client; they do NOT prove an authenticated user. **Do not add them to GitHub yet**, and do not share the key in chat. Never expose `sb_secret_...` or any legacy service-role key.
5. Review **Authentication → Providers** and **URL Configuration** for the development project. Keep initial sign-in strictly for a **test account operated by the authorized project owner** and a test environment. Define real application callback/base URL only after the trusted backend and origin are chosen. Leave email verification/MFA protections enabled or require them before private features; do not enable anonymous access to protected GIS.
6. **Do not** create public parcel tables, run our staged SQL foundation migrations, import production/real GIS parcels, expose raw PostGIS roles via Data API, disable RLS, or grant public geometry read permissions.
7. Tell the development assistant only **'development Supabase project created'**, and optionally the general region selected and whether the dashboard shows a publishable key (without its value). A screenshot is optional only if all secrets/tokens/user emails are hidden.

Official UI docs checked:
- https://supabase.com/docs/guides/getting-started/quickstarts/reactjs
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/auth/quickstarts/react

## Operator project confirmation — November 15–16, 2026

The operator's two Supabase dashboard screenshots confirm the development-named project **`land-os-auth-dev`** exists under the organization's Free plan, displays **Healthy** status, shows a **default `sb_publishable_...` key**, and has primary database region **East US (North Virginia), us-east-1**. No migrations or GitHub integration are shown. The dashboard displays **main / PRODUCTION** as the project's default branch label; this is **not** a live production deployment of the Land Development OS. Treat the entire Supabase project as a development-only resource with dummy users and no real GIS datasets. The secret key was masked in the screenshot; its value must never be copied into chat or the public repository.

**Step 40C-54's setup condition is satisfied.** This is a dashboard-status observation, not a successful independent network reachability check, real user sign-in, app session or county grant. Step 40C-55 stages a narrowly scoped, opt-in local Auth health test using only the project's public publishable key. No production database or GIS migration was applied.

## Next engineering actions AFTER owner setup

1. Pick trusted Node backend hosting and HTTPS origin (independent from Vite bundle); implement an app-owned current account/session/county authorization ledger using separate PostgreSQL roles and explicit migrations reviewed before execution.
2. Add server-only Supabase project URL/publishable-key configuration from environment variables in a secret-safe deployment (the *publishable* key itself is not a privileged credential, but avoid unnecessary copied data).
3. Add provider verification through `/auth/v1/user`, a separately verified MFA assurance layer, server-side session binding, account lifecycle, logout, rate limiting, strict CSRF/Origin controls and fail-closed protected routes. Never infer county permission or GIS redistribution from provider identity alone.
4. Design and independently test the release-time revocation ordering/serialization boundary before delivering private geometry, GIS exports or source-licensed parcel datasets to a browser.
5. Preserve the existing Cesium/God's Eye experience, 2.4 km free-browse boundary, Travis County public browsing and Property Intelligence UI. New development must not silently enable private polygons or replace original UX.

**Acceptance condition for Step 40C-54:** Authorized owner reports a *development-only* Supabase project exists and the publishable key is visible privately in the dashboard, without any secrets disclosed in chat. No new PowerShell tests are necessary for project creation. The next coding integration remains blocked on selecting a trusted backend deployment and the account-authorization store.
