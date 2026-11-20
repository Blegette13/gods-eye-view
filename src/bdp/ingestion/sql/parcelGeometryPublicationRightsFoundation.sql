-- Step 40C-16 — REVIEW-ONLY, NO AUTOMATIC MIGRATION OR GIS RIGHTS.
-- This is an independent geometry REDISTRIBUTION policy registry, separate
-- from the existing source_registry caching/ingestion rights.
-- Do not run on production without legal/DBA review, and NEVER automatically
-- turn public county REST availability into commercial republication approval.
-- This file does not add a database login, SECURITY DEFINER function,
-- browser/HTTP API, any role membership, or data redistribution grant.
BEGIN;

CREATE TABLE IF NOT EXISTS bdp_parcel_index.geometry_publication_reviews (
  source_id text PRIMARY KEY REFERENCES bdp_parcel_index.source_registry(source_id),
  county_fips char(5) NOT NULL CHECK (county_fips ~ '^48[0-9]{3}$'),
  review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_state IN ('unreviewed', 'approved', 'restricted', 'revoked')),
  allow_geometry_redistribution boolean NOT NULL DEFAULT FALSE,
  review_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT geometry_publication_approval_requires_evidence CHECK (
    review_state <> 'approved'
    OR (
      allow_geometry_redistribution = TRUE
      AND review_reference IS NOT NULL
      AND length(btrim(review_reference)) BETWEEN 5 AND 160
      AND reviewed_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > reviewed_at
    )
  )
);

-- Explicitly no rights for PUBLIC or the existing metadata-only application.
REVOKE ALL ON TABLE bdp_parcel_index.geometry_publication_reviews FROM PUBLIC;
REVOKE ALL ON TABLE bdp_parcel_index.geometry_publication_reviews FROM ldos_parcel_rpc_client;

COMMENT ON TABLE bdp_parcel_index.geometry_publication_reviews IS
  'Independent legal/commercial geometry redistribution review. Defaults to unreviewed/false; do not infer permissions from CAD public access. No automatic approval.';

COMMIT;
