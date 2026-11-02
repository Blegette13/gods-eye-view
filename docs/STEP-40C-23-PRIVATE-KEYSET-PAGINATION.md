# Step 40C-23 — Private, signed parcel keyset continuation (STAGED / UNROUTED)

## Operator checkpoint: November 1, 2026

The operator's latest screenshot confirms the Step 40C-22 source-window coverage contract passed as part of **637/637** land-development tests (**zero failures, zero skipped**; roughly **50.58 seconds**). The separate **Vite 6.4.5 build passed** (250 transformed modules in **9.82 seconds**). Large bundle chunks still generate pre-existing nonfatal performance warnings. This focused test result does not resolve intermittent inherited overlay timeouts in the full release suite.

## Newly committed code

- `src/bdp/ingestion/parcelKeysetPagination.js`: **unrouted, server-only** HMAC-SHA256 continuation-token codec plus a parameterized *draft* call to a **not-yet-created** `bdp_parcel_index.parcel_geometry_keyset_rpc`. No PostgreSQL function, database privilege, HTTP route, cookie issuer, GIS source, Cesium overlay, or real-county data right is added.
- `src/bdp/ingestion/parcelKeysetPagination.test.mjs`: **12 targeted tests** for the signed cursor contract, session/source/run/counties/extent/limit/review binding, tamper and expiry rejection, PostgreSQL int8 position validation, untrusted request parameters, overflow sentinel discipline, fixed SQL binds and UNKNOWN coverage. The tests are committed and syntax-checked but **not yet executed by the operator**.

The short-lived (default **60-second**, maximum **120-second**) continuation token uses a server-controlled random **at-least-32-byte HMAC key**. The opaque token is bound to the validated county, exact WGS84 extent, page limit, source ID, positive trusted ingestion run, **server-provided session HMAC digest**, and an **authoritative publication-rights revision**. These sensitive binding values are hashed into a context fingerprint, rather than emitted as raw token claims. Verification checks the HMAC in constant time, canonical base64url, exact version and fields, issued/expiry times, and full trusted-context fingerprint. Rejected tokens cannot generate a query.

A token is minted only after a **privately validated and overflowing page** returns exactly `limit+1` *ordered* records. The continuation position is the **last accepted parcel**, **not** the extra overflow sentinel. Sort order matches the existing SQL: source parcel ID in `C` collation and numeric PostgreSQL BIGINT parcel-version ID, avoiding the incorrect lexical order where `10` precedes `9`. Continuation SQL binds the two keyset values as `$9::text` and `$10::bigint`, preserving eight trusted existing spatial/source parameters.

### Critical limitations and release blockers

**A signed cursor is NOT authorization or a transaction snapshot.** Before and after every future keyset query, a separate reviewed server must verify current user/county entitlements, source and independent geometry-publication rights, any change in the trusted review revision, source/run immutability or proven frozen snapshot, distributed quotas, byte/feature budgets, and active database cancellation. Tokens are not single-use; expiry bounds replay duration but replay detection is **not** implemented. A new signed token does not prove that county GIS polygons may be commercially redistributed.

The new `parcel_geometry_keyset_rpc` is **only a fixed statement name** in a design contract. It **does not exist** in PostGIS yet and cannot be executed, even by the synthetic role, until a distinct DBA-reviewed rights-gated SQL function has been implemented and tested in disposable PostGIS. The current map API rejects arbitrary user cursor fields; do not change that gate or add HTTP pagination yet. No client geometry is authorized, and `viewportCoverage` remains **`unknown`**, including after the last page. Source-exact coverage evidence from 40C-22 is a separate matter.

Do not grant the existing metadata-only database role access to raw parcel geometry or the future keyset RPC. Preserve the original God's Eye View/Cesium map, **2.4 km Free Explorer discovery**, Travis parcel behavior and Property Intelligence panel.

## Operator validation (one command at a time in PowerShell)

```powershell
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelKeysetPagination.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Do not consider Step 40C-23 validated until the operator confirms those tests. The full `npm.cmd test` run, with the outstanding intermittent inherited world-overlay benchmarks, remains an additional pre-release gate.
