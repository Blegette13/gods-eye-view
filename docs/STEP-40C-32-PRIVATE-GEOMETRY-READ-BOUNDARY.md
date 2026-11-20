# Step 40C-32 — Private sealed-geometry read composition (STAGED / UNROUTED)

## Operator checkpoint — November 2, 2026

The user's latest screenshots show **13/13 focused Step 40C-31 Node tests passing**, **724/724 previously completed land-development regression tests**, and a successful Vite v6.4.5 production build (250 transformed modules, 4.80 s). They also show a NEW `npm.cmd run test:land` started after pulling Step 40C-31; **its final result is not visible**. Do not mark the latest post-pull suite as passed until the operator shares its summary.

The prior Step 40C-30 disposable PostGIS first/next-page validation was confirmed separately. There is NO new PostGIS migration or live database interaction in Step 40C-32.

## Changes committed (NOT yet verified by user-local Node)

- `src/bdp/ingestion/parcelPrivateGeometryReadBoundary.js`: **unrouted, private-only factory** requiring explicitly injected trusted collaborators (`loadCurrentAuthority`, `consumeQuota`, `querySealedRpc`), 32+ byte HMAC key and clock. It strictly validates the shape of inputs, bounds, real 32-byte opaque session handle, and AbortSignal. Missing or forged session/county/geometry authority fails CLOSED, before a query.
- **Before SQL:** re-read trusted opaque-session county entitlement, exact approved source caching and **independent** approved geometry redistribution rights using the previously tested private validator, then consume an atomic server-side quota (must return EXACT `true`).
- **SQL:** construct only the committed fixed `parcel_geometry_sealed_initial_rpc` (eight bind variables) or short-lived server-signed `parcel_geometry_keyset_rpc` (ten variables). The caller-supplied cursor may only contain a signed keyset position and cannot supply a database role, source, rights, session, or arbitrary query. The fixed RPC itself—not this JavaScript module—enforces the completed immutable source run seal and SQL read-time rights gates. The injected database collaborator MUST use an independently security-reviewed, least-privileged geometry role, not the metadata-only role.
- **After SQL:** validate each row including the overflow sentinel for shape, provenance, source/county/run, BIGINT order, WGS84 geometry budgets, independently approved rights, and strictly-after position; re-read the current session/county/source and legal rights and reject if the permission or publication revision changed or expired. Exceptions and aborts return only generic `unavailable`/`cancelled` results. The validated candidate GeoJSON is intentionally **never returned from this boundary**, even on success.
- Successful private return includes ONLY `status: 'validated-private'`, bounded feature count, overflow, optional private short-lived signed continuation cursor, `publishAuthorized:false`, `geometryDelivered:false`, and `viewportCoverage:'unknown'`. Neither geometry nor private source identifiers, SQL, usernames, passwords or full county coverage is exposed.
- `src/bdp/ingestion/parcelPrivateGeometryReadBoundary.test.mjs`: **13 new Node test cases** exercise initial and continuation planning, exact input rejection, quota enforcement, pre-/post-query permission and revision revocation, malformed SQL rows, geometry not emitted, cancellation, empty page unknown, and absence of route/DB client. The files parse successfully in isolated JavaScript syntax checks, but **operator Node tests, land suite and Vite build are pending**.

## Not yet authorized for deployment

**No HTTP handler, persistent DB connection, user session resolver, actually distributed quota store, real authenticated post-query policy provider, migration, application login, actual county GIS geometry right, or Cesium frontend integration has been created in this step.** This is a dependency-injection boundary and a set of safety contracts, NOT a running geometry server. Its callbacks could be wired incorrectly; they MUST NOT be treated as a security guarantee without a real authenticated integration and independent review. A PRIVATE status is not GIS publishing authorization. Never mount or serialize an internal `candidateGeoJson` from a lower layer. Existing original unsealed snapshot SQL is not safe for first-page production use.

Before release, separate work remains for a concrete trusted HttpOnly cookie/session identity, county entitlement and GIS license authority, server-side HMAC key lifecycle, atomic quotas, database statement timeouts / cancellation, least-privileged reviewed geometry LOGIN and SQL upgrade/rollback, transaction-level post-read rights checks and adversarial end-to-end security tests. The existing world overlay performance test suite `npm.cmd test` is a separate pre-release gate.

## Operator commands (PowerShell, individually)

After the in-progress `npm.cmd run test:land` finishes and its final summary is recorded:

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelPrivateGeometryReadBoundary.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected new focused test count: **13/13**. Do not claim it until the local Node run passes. The previous Vite large-chunk advisory is nonfatal.

The God’s Eye View / Cesium interface, 2.4 km Free Explorer entry altitude, Travis parcel display and Property Intelligence panel remain unchanged.
