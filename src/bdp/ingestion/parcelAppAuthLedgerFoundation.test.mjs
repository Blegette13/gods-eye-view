import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL(
  '../../../server/standalone/sql/landOsAccountAuthorityFoundation.sql',
  import.meta.url,
),'utf8');

test('57 draft migration is explicit review-only and never applied by import',()=>{
  assert.match(sql,/REVIEW-ONLY APP-OWNED AUTHORIZATION LEDGER/);
  assert.match(sql,/DO NOT APPLY TO A SUPABASE PROJECT/);
  assert.match(sql,/^BEGIN;$/m);
  assert.match(sql,/^COMMIT;$/m);
  assert.doesNotMatch(sql,/\\connect|CREATE EXTENSION|COPY .* FROM PROGRAM/);
});

test('57 app identity lives in a separate schema, not Supabase Auth or parcel indexes',()=>{
  assert.match(sql,/CREATE SCHEMA ldos_app_auth;/);
  assert.match(sql,/CREATE TABLE ldos_app_auth\.accounts/);
  assert.match(sql,/CREATE TABLE ldos_app_auth\.sessions/);
  assert.match(sql,/CREATE TABLE ldos_app_auth\.county_grants/);
  assert.doesNotMatch(sql,/CREATE TABLE auth\.|ALTER TABLE auth\.|ALTER TABLE bdp_parcel_index\./);
});

test('57 account identities are server-verified UUID subjects, not browser metadata',()=>{
  assert.match(sql,/subject uuid PRIMARY KEY/);
  assert.match(sql,/account_state text NOT NULL DEFAULT 'suspended'/);
  assert.match(sql,/account_state IN \('active','suspended','closed'\)/);
  assert.match(sql,/revision bigint NOT NULL DEFAULT 1 CHECK \(revision > 0\)/);
  assert.doesNotMatch(sql,/browser_role|email_address|password_hash|auth_token/);
});

test('57 sessions contain HMAC digests rather than raw Supabase tokens',()=>{
  assert.match(sql,/session_digest text PRIMARY KEY/);
  assert.match(sql,/session_digest ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql,/REFERENCES ldos_app_auth\.accounts\(subject\)/);
  assert.doesNotMatch(sql,/access_token\s+text|refresh_token\s+text|jwt\s+text/);
});

test('57 sessions default to revoked and unverified, never silently active',()=>{
  assert.match(sql,/session_state text NOT NULL DEFAULT 'revoked'/);
  assert.match(sql,/mfa_state text NOT NULL DEFAULT 'unverified'/);
  assert.match(sql,/session_state IN \('active','revoked'\)/);
  assert.match(sql,/mfa_state IN \('verified','unverified'\)/);
});

test('57 session issue/expiry are bounded with an eight-hour maximum',()=>{
  assert.match(sql,/issued_at timestamptz NOT NULL/);
  assert.match(sql,/expires_at timestamptz NOT NULL/);
  assert.match(sql,/CHECK \(expires_at > issued_at\)/);
  assert.match(sql,/CHECK \(expires_at <= issued_at \+ interval '8 hours'\)/);
});

test('57 county grants are per subject and Texas county with deny-by-default',()=>{
  assert.match(sql,/county_fips text NOT NULL CHECK/);
  assert.ok(sql.includes("county_fips ~ '^48[0-9]{3}$'"));
  assert.match(sql,/grant_state text NOT NULL DEFAULT 'denied'/);
  assert.match(sql,/PRIMARY KEY \(subject, county_fips\)/);
  assert.match(sql,/grant_state IN \('allowed','denied'\)/);
});

test('57 county grants must not masquerade as independent GIS redistribution license',()=>{
  assert.match(sql,/distinct from GIS-source licensing/);
  assert.doesNotMatch(sql,/allow_geometry_redistribution\s+(?:boolean|true)/i);
  assert.doesNotMatch(sql,/CREATE TABLE .*geometry_publication_reviews/);
});

test('57 all three authority rows have monotonic bigint revisions',()=>{
  const tables=['accounts','sessions','county_grants'];
  for(const t of tables){
    const start=sql.indexOf('CREATE TABLE ldos_app_auth.'+t+' (');
    assert.ok(start>=0,t);
    const end=sql.indexOf('\n);',start);
    assert.ok(end>start,t);
    const table=sql.slice(start,end);
    assert.match(table,/revision bigint NOT NULL DEFAULT 1 CHECK \(revision > 0\)/,t);
  }
});

test('57 revision must begin at one; callers cannot set arbitrary revisions',()=>{
  assert.match(sql,/IF TG_OP = 'INSERT' THEN/);
  assert.match(sql,/NEW\.revision IS DISTINCT FROM 1/);
  assert.match(sql,/NEW\.revision IS DISTINCT FROM OLD\.revision/);
  assert.match(sql,/NEW\.revision := OLD\.revision \+ 1/);
});

test('57 revision overflows fail closed and do not wrap',()=>{
  assert.match(sql,/OLD\.revision = 9223372036854775807/);
  assert.match(sql,/authority revision exhausted/);
  assert.match(sql,/USING ERRCODE = '22003'/);
});

test('57 account, session and county immutable identifiers cannot be rebound',()=>{
  assert.match(sql,/NEW\.subject IS DISTINCT FROM OLD\.subject/);
  assert.match(sql,/NEW\.created_at IS DISTINCT FROM OLD\.created_at/);
  assert.match(sql,/NEW\.session_digest IS DISTINCT FROM OLD\.session_digest/);
  assert.match(sql,/NEW\.issued_at IS DISTINCT FROM OLD\.issued_at/);
  assert.match(sql,/NEW\.county_fips IS DISTINCT FROM OLD\.county_fips/);
});

test('57 three row triggers force revision bumps on every mutation',()=>{
  for(const t of ['account','session','county_grant']){
    assert.match(sql,new RegExp('CREATE TRIGGER '+t+'_revision[\\s\\S]*?BEFORE INSERT OR UPDATE OR DELETE ON ldos_app_auth\\.'+
      (t==='account'?'accounts':t==='session'?'sessions':'county_grants')));
  }
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/SET search_path = pg_catalog, pg_temp/);
});

test('57 physical deletions and statement truncate do not reset ABA revisions',()=>{
  assert.match(sql,/IF TG_OP IN \('DELETE','TRUNCATE'\) THEN/);
  assert.match(sql,/authority rows must be retained/);
  for(const t of ['accounts','sessions','county_grants']){
    assert.match(sql,new RegExp('BEFORE TRUNCATE ON ldos_app_auth\\.'+t));
    assert.match(sql,new RegExp('ON ldos_app_auth\\.'+t+'[\\s\\S]*?FOR EACH STATEMENT'));
  }
});

test('57 public access is revoked and no role grants or security definer functions exist',()=>{
  assert.match(sql,/REVOKE ALL ON SCHEMA ldos_app_auth FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ldos_app_auth FROM PUBLIC/);
  assert.doesNotMatch(sql,/^\s*GRANT\s+/m);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE ROLE|CREATE POLICY/);
});

test('57 migration creates no user rows, web routes, test grants or HTTP geometry',()=>{
  assert.doesNotMatch(sql,/^\s*INSERT INTO /m);
  assert.doesNotMatch(sql,/^\s*UPDATE ldos_app_auth\./m);
  assert.doesNotMatch(sql,/http\.get|fetch\(|ST_AsGeoJSON|CREATE VIEW.*public/);
});
