# Step 40C-36 — Independent GIS geometry-publication review (STAGED / UNROUTED)

## Operator checkpoint: November 4, 2026

The screenshots show **794/794 land-development tests PASSED**, **Vite production build PASSED** (250 modules, 12.35 seconds), and the opt-in **real disposable password-authenticated source-authority LOGIN PostGIS smoke PASSED twice** for Step 40C-35. The user's `git pull --ff-only origin bdp-development` printed `Already up to date`. The separate focused 20-test transcript was not included; the 794 result is consistent with all 20 new cases being discovered.

**Step 40C-36 is operator-validated November 4, 2026:** screenshots show **25/25 focused tests passed**, **819/819 land regression tests passed** with zero failures, **Vite production build passed** (250 modules, 18.67 seconds), and the opt-in **real disposable PostGIS independent geometry-review LOGIN smoke passed**, including rights expiry/revocation and privilege isolation. These are tests with synthetic records and do not grant production GIS publication rights.

## Code added

- `src/bdp/ingestion/sql/parcelGeometryPublicationReviewRpcFoundation.sql` — DBA-review-only, UNDEPLOYED PostgreSQL `SECURITY DEFINER` fixed RPC against **only** `geometry_publication_reviews`. Requires exact county/source, `review_state='approved'`, **independent `allow_geometry_redistribution=TRUE`**, valid referenced written review, reviewed timestamp no later than now, and non-expired approval. Returns seven private rights metadata fields, NEVER geometry or owner information. `REVOKE ... FROM PUBLIC` and from the existing metadata role are part of the same creation transaction. **No GRANT, role, account, GIS license, user authentication or source-caching inference.** Expiration returns zero SQL rows, not a safe/empty map.
- `server/providers/bdp-parcel-geometry-publication-review.js` — UNROUTED, exact-county/source + AbortSignal private adapter; wraps only the fixed parameterized RPC, accepts exactly ONE seven-column approval row, verifies its identity and timestamp coherence against a trusted clock, and normalizes the exact approval object expected by the existing Step 40C-33 pre/post-authentication checks. Returns null for missing/revoked/ambiguous/expired/malformed rights. A callback fake is not legal permission or source evidence.
- `server/providers/bdp-parcel-geometry-publication-review-db.js` — UNROUTED, injected pinned PostgreSQL client for a distinct `ldos_parcel_publication_...` LOGIN, NOT the source-authority, metadata or geometry role. One read-only transaction with local statement/lock/idle timeouts, principal attestation, no memberships, no schema CREATE or raw parcel-index table/sequence rights, no other index RPC privileges, and one fixed rights lookup. All returned rows/columns/bytes are bounded; failures rollback and discard the pinned client. Does not create a pool, provision credentials, guarantee active driver cancellation or mount HTTP.
- `src/bdp/ingestion/parcelGeometryPublicationReview.test.mjs` — **17 new** source SQL, adapter and pinned-reader tests.
- `scripts/bdp/parcel-publication-review-disposable-smoke.mjs` — strictly opt-in, entirely disposable PostGIS security smoke: synthetic fixtures only, NO Docker networking/host ports/mounts/persistent database; tests a **real one-use password-authenticated publication-only LOGIN** (not owner `SET ROLE`), default denial, privilege attestation, current review approval, expiry, reference changes, revocation, denied raw table/other RPC, and separate source-caching revocation. It then deletes the test container and its volumes.
- `src/bdp/ingestion/parcelPublicationReviewDisposableSmoke.test.mjs` — **8 additional** static isolation/opt-in safety tests.

## Important dual-gate distinction

A positive geometry-publication review RPC means **ONLY that the synthetic record's separate redistribution policy is current**. It does NOT authorize a user or a browser, establish source-caching rights, prove an immutable run seal or show all parcels in a county. Step 40C-33 already requires **all** of these independent facts before and after the sealed geometry read. In the new disposable test, caching rights are deliberately revoked while a publication review remains positive, demonstrating why the separate cache/run-seal gate MUST still deny a geometry result. Absence of publication review must never be treated as GIS clearance.

The new review reader is NOT wired to the live Step 40C-33 runtime; neither the server's authentication store, production GIS licensing, live DB grants, pool capacity, independent HMAC secret lifecycle, active in-flight driver cancellation, distributed quotas nor security/audit reviews are finished. Any PostgreSQL SECURITY DEFINER owner and production role grants need separate review. **No official Travis County or other Texas county GIS redistribution rights are presumed.**

## Operator validation — PowerShell (one command at a time)

```powershell
cd "$HOME\gods-eye-view"
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelGeometryPublicationReview.test.mjs src/bdp/ingestion/parcelPublicationReviewDisposableSmoke.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Confirmed focused tests: **25/25 passed**. Confirmed post-pull land suite: **819/819 passed** and production Vite build succeeded. The SQL smoke completed successfully. Stop and share the first failing test, if any.

If Docker Desktop is running and all earlier checks pass, the real opt-in synthetic security smoke is:

```powershell
node scripts/bdp/parcel-publication-review-disposable-smoke.mjs --disposable-only
```

Expected message:

`PASS: disposable PostGIS independent geometry-review LOGIN, current rights, least privilege and revocation.`

No production SQL migration, role creation or `psql` against the existing land-development service is authorized by this test. The original God's Eye View / Cesium experience, **2.4 km Free Explorer discovery**, existing Travis CAD overlays and Property Intelligence panel are unchanged.

## Next

Step 40C-37 should join the two separately authenticated server-only authority readers to the pre/post private boundary **ONLY AFTER** designing authoritative session persistence, separate credentials, safe transaction/revocation races and independent license review. Still no browser-delivered polygons, complete-viewport claims or tile API.
