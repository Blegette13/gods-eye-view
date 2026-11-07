import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./regulatoryEvidenceParcelIsolation.sql', import.meta.url), 'utf8');
const smoke = readFileSync(new URL('./regulatoryEvidenceParcelIsolationSmoke.sql', import.meta.url), 'utf8');

test('RLS grant decision keys off session_user and exact, unexpired parcels', () => {
  assert.match(migration, /g\.login_role = SESSION_USER::NAME/);
  assert.match(migration, /g\.county_fips = p_county_fips/);
  assert.match(migration, /g\.parcel_id = p_parcel_id/);
  assert.match(migration, /g\.expires_at > CURRENT_TIMESTAMP/);
  assert.match(migration, /p_operation IN \('read-index', 'append-event'\)/);
  assert.doesNotMatch(migration, /g\.login_role = CURRENT_USER/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FOR SELECT TO bdp_evidence_reader/);
  assert.match(migration, /FOR INSERT TO bdp_evidence_owner/);
  assert.match(migration, /FOR SELECT TO bdp_evidence_owner/);
});

test('no login, credential, operator membership or parcel grant is automatically provisioned', () => {
  assert.match(migration, /CREATE ROLE bdp_evidence_acl_owner NOLOGIN/);
  assert.doesNotMatch(migration, /CREATE ROLE [^\n]* LOGIN\b/i);
  assert.doesNotMatch(migration, /PASSWORD\s+'/i);
  assert.doesNotMatch(migration, /GRANT bdp_evidence_reader TO/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.bdp_evidence_parcel_acl/);
  assert.match(migration, /REVOKE ALL ON public\.bdp_evidence_parcel_acl FROM PUBLIC/);
  assert.match(migration, /GRANT SELECT ON public\.bdp_evidence_parcel_acl TO bdp_evidence_acl_owner/);
  assert.match(migration, /OWNER TO bdp_evidence_acl_owner/);
});

test('database smoke is transaction-scoped, uses simulated logins and rolls back', () => {
  assert.match(smoke, /^BEGIN;/m);
  assert.match(smoke, /CREATE ROLE bdp_acl_smoke_reader LOGIN/);
  assert.match(smoke, /CREATE ROLE bdp_acl_smoke_appender LOGIN/);
  assert.match(smoke, /SET SESSION AUTHORIZATION bdp_acl_smoke_reader/);
  assert.match(smoke, /SET SESSION AUTHORIZATION bdp_acl_smoke_appender/);
  assert.match(smoke, /blocked_cross_parcel/);
  assert.match(smoke, /blocked_direct_read/);
  assert.match(smoke.trim(), /ROLLBACK;$/);
});
