# Step 40C-52 — Identity provider and server deployment decision record

**Status: USER APPROVED PROVIDER DIRECTION — Supabase Auth + separate app-owned PostgreSQL authorization. Backend hosting, account model, and live project setup still UNDECIDED.**
**Date: November 15, 2026. No provider was connected, no credentials requested, and no database or UI was modified.**

## Why this is a decision gate, not another synthetic test milestone

Step 40C-51 was operator-verified: **26/26 focused tests**, **1,114/1,114 land regression tests**, zero failures, and **Vite build PASS** (250 modules in **4.35 seconds**). Those prove the existing server-side *synthetic* contracts behave as tested. They do not supply a real login, persistence or an on-wire release gate.

The current repository's `package.json` describes a **Vite/Cesium browser app**, not a deployed application API. The `server/providers/bdp-parcel-*.js` modules are mostly private, unmapped foundations; a successful `vite build` validates the browser bundle, not a secure deployed Node backend. The six existing restricted SQL logins are database service principals, **not human users**.

We must not build more purported 'production authentication' code without deciding what is authenticating the user, where the backend runs, and who owns the current authoritative county-grant record.

## Candidates verified against vendor documentation (November 15, 2026)

### Preferred MVP candidate: Supabase Auth + application-owned PostgreSQL authorization

- Supabase Auth supports passwords, OTP/magic-link, social sign-in and SSO, and has a JavaScript SDK usable from a Vite SPA; MFA is available. Basic MFA is included in the published Free plan, which currently lists 50,000 monthly active users and a 500 MB hosted database allocation. These quotas and pricing can change; review the pricing page before committing to it.
- The Supabase **Auth** issuer authenticates *who* logged in. An **independently hosted application backend** performs server-side identity verification, issues/manages its own opaque HTTP-only application session, maps the issuer subject to the account, and uses a strongly current primary PostgreSQL **app-owned** transaction for account state, MFA requirements and explicit per-Texas-county grants and their durable revisions. This does **not** assume that the current Docker/PostGIS database is a managed Supabase instance or that Supabase's auth tables are automatically available to it.
- For particularly sensitive actions, require fresh identity verification as documented by the provider, but **do not** use a JWT or a delayed webhook as sole authority for immediate account, county-grant or session revocation. The app-owned current store must be checked synchronously for every private access.
- Consider user recovery, email delivery, service location, account export, MFA enrollment, multi-organization needs and provider outage behavior before operationalizing.

### Alternate: Clerk managed sign-in + the same app-owned PostgreSQL authorization

- Clerk provides prebuilt sign-in/sign-up UI and organization workflows, and a backend Express SDK for authentication; it also supports MFA enforcement. As of this review, its published Hobby/Free pricing **does not include MFA**; enforced MFA requires an eligible paid tier. This is an important constraint if the initial goal is no-cost development with strong MFA.
- Clerk sign-in, organization's membership and tokens **must not** replace our application-owned county-grant, source-caching or GIS redistribution authority. Need separate strongly current database checks regardless of provider.

### Other option: self-hosted identity stack

- A self-managed OIDC provider could avoid hosted vendor dependence but adds significantly more operator responsibility for patching, credentials, MFA, backup, recovery, availability, audit and incident response. Not recommended for the first MVP without a dedicated security operator.

**Operator-approved direction: Supabase Auth for identity, app-owned PostgreSQL for current county grants and sessions**, preserving the existing Vite/JavaScript front end and PostGIS investment. This is **not** a configured Supabase tenant or approved production deployment: backend hosting, provider project setup, MFA enforcement, account authorization and release security are still required. Step 40C-53 stages an unrouted real Auth-server user validation adapter.

Sources checked:
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/pricing
- https://clerk.com/docs/reference/express/overview
- https://clerk.com/pricing

## Proposed system boundaries (no implementation yet)

```text
Browser: existing Vite/Cesium God's Eye UI
   |
   | trusted sign-in return only (NO browser county-role authority)
   v
Identity issuer (candidate: Supabase Auth; subject, MFA evidence)
   |
   | server-only verified identity -> opaque app session (no credentials in URL)
   v
NEW dedicated application backend (deployment target TBD)
   |
   | account/session status, grant revision from PRIMARY only
   v
App-owned durable PostgreSQL authorization ledger
   |
   | separates user entitlement from GIS legal rights
   v
Six previously staged restricted PostGIS private readers
   |
   | still PRIVATE and UNROUTED until independent review
   v
Future buffered, audited release gate -> only approved output
```

We must first choose a real Node backend deployment pattern: single origin for authenticated cookies and API is preferred where possible, no trusted client-side roles, HTTPS, CSRF defense, Origin checks, secure HttpOnly cookies, session rotation, rate limits, safe audit logs, minimum secret privileges, test/prod isolation, primary DB connectivity and clearly defined timeout/rollback semantics. An SPA-only static Vite deployment is insufficient for server-held credentials and strong revocation.

## Remaining operator decisions BEFORE live identity wiring

1. **Provider:** RESOLVED — Supabase Auth selected for MVP; revisit only if requirements change.
2. **Backend hosting:** where the trusted Node API and durable PostgreSQL authorization store will run; the existing desktop Docker environment is for development only.
3. **Launch permissions:** will anonymous users only explore the 3D map/publicly licensed layers, while signed-in verified organizations receive gated parcel intelligence? Are exports an independently reviewable privileged action?
4. **Account model:** individual users only to begin, or organization/workspace accounts with multiple members, paid tiers and per-county roles from day one?
5. **Data rights:** independent legal approval for any GIS redistribution; even authenticated users cannot receive unapproved source polygons.

## Acceptance criteria for actual 40C-52 implementation (after decisions)

- Server independently validates the issuer and never relies on browser status, unsigned claims or unverified ID tokens.
- App-owned session and county-grant records exist on one durable current authority with monotonic revisions that survive revoke/reapprove, deletion/recreation and restore.
- Protected endpoints fail closed when issuer/store unavailable; primary reads (or an independently proven linearizable service) are required, not stale cache/replica values.
- Logout, MFA revocation, account disablement and county grant revocation are tested with concurrent access and invalidate sessions/cursors appropriately.
- The six-restricted-reader private stage remains UNROUTED until approved legal/publication rights and a separate final release/abort design pass security review.
- The original Cesium God’s Eye View UI, 2.4 km Free Explorer behavior, Travis CAD browsing, Property Intelligence panel and unrelated map source categories must remain unaffected.

**Do not create Supabase/Clerk accounts, API keys, secret files, hosted DB projects or migrations automatically. Do not implement public geometry delivery at this step.**
