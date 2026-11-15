# Step 40C-51 — Identity candidate two-read consistency and release-race counterexample

**Checkpoint: November 15, 2026. STAGED / UNROUTED / REVIEW-ONLY. Operator test validation PENDING.**

## Confirmed 40C-50 baseline

The latest operator screenshot confirms **1,088/1,088 complete land regressions PASSED**, zero failures, and **Vite production build PASSED** (250 transformed modules, 4.84 seconds). This confirms the **review-only** identity snapshot shape inspector added in Step 40C-50; it does not establish a real identity provider.

## What is staged in 40C-51

`server/providers/bdp-parcel-identity-candidate-probe.js` is an intentionally **unrouted, synthetic, server-only review harness**. It accepts an explicitly injected *candidate fixture source* and clock; it neither creates nor contacts a real account issuer and **cannot authorize parcel geometry**. On a request containing only a canonical server-side HMAC digest, Texas county FIPS and an AbortSignal, it makes two candidate reads, checks the shape of the first record, immediately snapshots its values to protect against mutable returned objects, checks the shape of the second, and compares account/session/MFA/grant revisions, expiry and observation time. It returns only one of two immutable results:

- `{candidateConsistent:true,releaseAuthorized:false,actualProviderConnected:false}` if the *two fabricated candidate snapshots* are internally consistent.
- `{candidateConsistent:false,releaseAuthorized:false,actualProviderConnected:false}` for missing, inconsistent, stale, revoked, malformed, cancelled, throwing or otherwise uncertain inputs.

**No return value means the candidate is a real authenticated user, an authoritative county grant, or safe to publish.** Even the `candidateConsistent:true` result **never permits** a private database query, HMAC cursor issuance, HTTP transport, export, public GIS polygon or release operation. This adapter is not imported by the actual Cesium application or any mounted server route.

`src/bdp/ingestion/parcelIdentityCandidateProbe.test.mjs` adds **26 new synthetic review regressions** for strict dependency and input shapes, all four epoch ABA changes, suspension, logout/revocation, stale MFA and county grant, wrong county or digest, empty/malformed responses, unsafe clocks, mid-request AbortSignal cancellation, exceptions without secret disclosure, mutable provider object changes and frozen minimal request arguments. A deliberate **counterexample test** makes both earlier reads return matching candidates, then revokes access immediately afterward; `candidateConsistent:true` remains possible, but `releaseAuthorized:false` is permanent. This demonstrates why even two validated current reads do not create an atomic response-release gate.

Lightweight in-context JavaScript source-contract simulation for **26/26 cases succeeded**; this is **not a Node test run on the operator's machine or a database/identity integration test**. Expected full land suite is **1,114/1,114** (1,088 previously confirmed + 26), pending the operator.

## Production identity integration decision (NOT made yet)

The production system still needs selection of a real sign-in provider and an **authoritative application account/session/county grants store**. Provider selection cannot be inferred from having PostgreSQL/PostGIS: SQL login roles protect database functions, not app users. A managed OIDC/MFA provider may simplify human login, but the application's signed-in subject still needs a server-owned durable current session and grant revision; the provider's cached JWT alone cannot establish immediate logout, MFA removal, or county grant revocation. We must specify data residency, cost, enterprise SSO needs, account recovery, multi-tenant boundaries, anonymous exploration permissions and operational ownership before choosing or integrating one.

Before an implementation can claim to be a real identity authority, the project must document and separately test: verification of issuer/audience/signature and nonce, secure cookie issuance/rotation and CSRF, account subject mapping, required MFA, county grant administration, disabled accounts, immediate logout, authoritative strongly-current lookup on every private page, monotonic revision persistence through delete/recreate/restore, server-side per-county audit and concurrency handling. No fake user flags may substitute for these controls.

## Release-time race model — still UNRESOLVED

The two-read probe is **not a solution** to the race between private SQL checks and sending response bytes. An actual deployment needs a precise authorization/revocation ordering protocol:

1. Keep any sensitive geometry response buffered and non-streamed until reviewed authorization and data rights are established.
2. Establish a serializable, authoritative release gate or equivalent ordered fence that compares current account/session/MFA/county grant, source-caching and independent GIS redistribution epochs against the response's bound revisions at an auditable decision point. The gate must define what happens when a revocation commits concurrently.
3. Define whether the response is atomically committed to release, or whether multi-chunk delivery requires repeated checks, revocation-aware stream cancellation and a clear disclosure/commit policy. A database transaction cannot magically revoke network bytes already sent.
4. Verify the design under multiple processes, primary/replica lag, backups/restore ABA, timeouts and revocation immediately before, during and after release. Default to no release on missing or unknown evidence. **A final SELECT or matching pair of snapshots is insufficient.**

Do not call the six PostGIS test logins real user authentication, do not imply county GIS legal redistribution rights, and do not advertise verified completeness, valuation, title, access, zoning or buildability.

**Existing application unchanged:** God’s Eye View/Cesium, 2.4 km Free Explorer behavior, Travis County public CAD browsing and the Property Intelligence panel.

## Operator commands — PowerShell, one at a time

```powershell
cd C:\Users\brand\gods-eye-view
git pull --ff-only origin bdp-development
node --test src/bdp/ingestion/parcelIdentityCandidateProbe.test.mjs
npm.cmd run test:land
npm.cmd run build
```

Expected **26/26 focused tests** and **1,114/1,114 full land tests**, plus a successful build. Predicted only until the operator confirms. No Docker required; no SQL schema, role, user, account secret or real MFA enrollment is provisioned.

## Next checkpoint — Step 40C-52

Evaluate the actual user sign-in architecture and strongly current account/county grant store against the checklist, choose an initial identity provider with the operator, and design a complete isolated release-gate concurrency fixture rather than pretending a two-read synthetic probe is deployable. **Do not enable public parcel geometry or production authentication without implementation and independent security/legal review.**
