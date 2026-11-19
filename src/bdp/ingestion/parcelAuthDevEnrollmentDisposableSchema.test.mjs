import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  C14B_DB,C14B_IMAGE,C14B_PASS,C14B_SQL_BLOB,c14bGitBlob,
  requireC14BDisposableOnly,validC14BSource,
} from '../../../scripts/bdp/app-auth-enrollment-schema-disposable-smoke.mjs';

const sql=readFileSync(new URL(
  '../../../server/standalone/sql/landOsEnrollmentReviewDisposable.sql',
  import.meta.url),'utf8');
const smoke=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-enrollment-schema-disposable-smoke.mjs',
  import.meta.url),'utf8');

test('62D-C14B1 requires exactly disposable-only flag',()=>{
  assert.equal(requireC14BDisposableOnly(['--disposable-only']),true);
  for(const x of [null,undefined,[],['--plan-only'],['--apply-local-auth-only'],
    ['--prod'],['--disposable-only','--force']])
    assert.throws(()=>requireC14BDisposableOnly(x),TypeError);
});
test('62D-C14B1 SQL is review-shaped and includes exact disposable-only guard',()=>{
  assert.equal(validC14BSource(sql),true);
  assert.equal(C14B_DB,'ldos_c14b_disposable');
  assert.equal(C14B_IMAGE,'postgres:17');
  assert.ok(sql.includes("current_database() <> 'ldos_c14b_disposable'"));
  assert.ok(sql.includes("current_user <> 'postgres'"));
  assert.ok(sql.includes("pg_is_in_recovery()"));
});
test('62D-C14B1 never accepts persistent auth-dev as the SQL target',()=>{
  const unsafe=sql.replaceAll('ldos_c14b_disposable','ldos_auth_dev');
  assert.equal(validC14BSource(unsafe),false);
  assert.doesNotMatch(smoke,/ldos-auth-dev-auth-postgres-1|--apply-local-auth-only|54338/);
});
test('62D-C14B1 rejects missing source or a modified SQL schema',()=>{
  for(const s of ['',null,undefined,{},sql.replace(
    'CREATE TABLE ldos_app_auth.enrollment_approvals',
    'CREATE TABLE ldos_app_auth.bad_approvals'),sql.slice(0,-8)])
    assert.equal(validC14BSource(s),false);
});
test('62D-C14B1 SQL stays atomic and time-bounded',()=>{
  assert.match(sql,/^BEGIN;$/m);
  assert.match(sql,/^COMMIT;$/m);
  assert.match(sql,/SET LOCAL lock_timeout = '5s';/);
  assert.match(sql,/SET LOCAL statement_timeout = '30s';/);
  assert.match(sql,/DO \$c14b_disposable_guard\$/);
  assert.match(sql,/END;\n\$c14b_disposable_guard\$;/);
});
test('62D-C14B1 SQL rejects missing app ledger and nonempty authority tables',()=>{
  for(const t of ['accounts','sessions','county_grants'])
    assert.ok(sql.includes('EXISTS (SELECT 1 FROM ldos_app_auth.'+t+')'),t);
  assert.match(sql,/to_regnamespace\('ldos_app_auth'\) IS NULL/);
  assert.match(sql,/to_regclass\('ldos_app_auth.accounts'\) IS NULL/);
});
test('62D-C14B1 creates exact five enrollment-only relations',()=>{
  const names=['enrollment_reviewer_authorities','enrollment_invitations',
    'enrollment_requests','enrollment_approvals','enrollment_audit_events'];
  for(const n of names)assert.ok(sql.includes('CREATE TABLE ldos_app_auth.'+n),n);
  assert.equal((sql.match(/^CREATE TABLE /gm)||[]).length,5);
  assert.doesNotMatch(sql,/CREATE TABLE ldos_app_auth\.(?:accounts|sessions|county_grants)/);
});
test('62D-C14B1 invitation and approval digests are lower-hex and unique',()=>{
  assert.equal((sql.match(/nonce_digest text NOT NULL UNIQUE CHECK \(nonce_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/g)||[]).length,2);
  assert.doesNotMatch(sql,/raw_token|access_token|refresh_token|password_hash/);
});
test('62D-C14B1 reviewer is revoked by default with no scope',()=>{
  assert.match(sql,/authority_state text NOT NULL DEFAULT 'revoked'/);
  assert.match(sql,/authority_scope text NOT NULL DEFAULT 'none'/);
  assert.match(sql,/OLD.authority_state='revoked' AND NEW.authority_state='active'/);
});
test('62D-C14B1 invitation is revoked by default and bound to independent inviter',()=>{
  assert.match(sql,/invitation_state text NOT NULL DEFAULT 'revoked'/);
  assert.match(sql,/CHECK \(issued_by <> subject\)/);
  assert.match(sql,/UNIQUE \(invite_id, subject, issuer\)/);
});
test('62D-C14B1 request is pending by default with immutable subject/issuer FK',()=>{
  assert.match(sql,/request_state text NOT NULL DEFAULT 'pending'/);
  assert.match(sql,/FOREIGN KEY \(invite_id, subject, issuer\)/);
  assert.match(sql,/REFERENCES ldos_app_auth.enrollment_invitations\(invite_id, subject, issuer\)/);
});
test('62D-C14B1 reviewer cannot self-approve; approval has separate purposes',()=>{
  assert.match(sql,/CHECK \(reviewer_subject <> subject\)/);
  assert.match(sql,/purpose IN \('enroll_suspended','activate'\)/);
  assert.match(sql,/UNIQUE \(request_id,purpose\)/);
});
test('62D-C14B1 approvals deny first and have one-use consumed state',()=>{
  assert.match(sql,/decision text NOT NULL DEFAULT 'deny'/);
  assert.match(sql,/approval_state text NOT NULL DEFAULT 'revoked'/);
  assert.match(sql,/CHECK \(\(approval_state='consumed'\) = \(consumed_at IS NOT NULL\)\)/);
  assert.match(sql,/OLD.approval_state <> 'unconsumed'/);
});
test('62D-C14B1 invitations and requests limited to 24 hours',()=>{
  assert.equal((sql.match(/interval '24 hours'/g)||[]).length,2);
  assert.match(sql,/CHECK \(expires_at > created_at\)/);
});
test('62D-C14B1 approvals limited to 15 minutes and cannot consume expired',()=>{
  assert.match(sql,/interval '15 minutes'/);
  assert.match(sql,/OLD.expires_at <= clock_timestamp\(\)/);
});
test('62D-C14B1 all review rows start revision one and bump under trigger',()=>{
  assert.equal((sql.match(/revision bigint NOT NULL DEFAULT 1 CHECK \(revision > 0\)/g)||[]).length,4);
  assert.match(sql,/NEW.revision IS DISTINCT FROM OLD.revision/);
  assert.match(sql,/NEW.revision := OLD.revision \+ 1;/);
  assert.match(sql,/9223372036854775807/);
});
test('62D-C14B1 terminal states cannot be inserted or replayed',()=>{
  for(const t of ["NEW.invitation_state='redeemed'",
    "NEW.request_state<>'pending'","NEW.approval_state='consumed'",
    "OLD.invitation_state='pending'","OLD.request_state='enrolled_suspended'"])
    assert.ok(sql.includes(t),t);
});
test('62D-C14B1 prevents rebind of reviewer, request and approval identity',()=>{
  for(const k of ['NEW.issued_by IS DISTINCT FROM OLD.issued_by',
    'NEW.request_id IS DISTINCT FROM OLD.request_id',
    'NEW.reviewer_subject IS DISTINCT FROM OLD.reviewer_subject',
    'NEW.nonce_digest IS DISTINCT FROM OLD.nonce_digest'])
    assert.ok(sql.includes(k),k);
});
test('62D-C14B1 audit is append-only, FK-bound and requires account revision',()=>{
  assert.match(sql,/CREATE FUNCTION ldos_app_auth.guard_enrollment_audit\(\)/);
  assert.match(sql,/IF TG_OP <> 'INSERT' THEN/);
  assert.match(sql,/enrollment audit is append-only/);
  assert.match(sql,/FOREIGN KEY \(request_id,subject\)/);
  assert.match(sql,/event_type IN \('enrolled_suspended','activated'\)/);
});
test('62D-C14B1 all review tables reject physical delete and truncate',()=>{
  assert.equal((sql.match(/^CREATE TRIGGER c14b_.*_no_truncate /gm)||[]).length,5);
  assert.equal((sql.match(/^CREATE TRIGGER c14b_(?:reviewer|invitation|request|approval)_revision /gm)||[]).length,4);
  assert.match(sql,/IF TG_OP IN \('DELETE','TRUNCATE'\) THEN/);
});
test('62D-C14B1 SQL gives no app, public, SQL role or GIS grants',()=>{
  assert.match(sql,/REVOKE ALL ON ALL TABLES IN SCHEMA ldos_app_auth FROM PUBLIC/);
  assert.match(sql,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ldos_app_auth FROM PUBLIC/);
  assert.doesNotMatch(sql,/^\s*GRANT\s+|^\s*CREATE ROLE|^\s*CREATE POLICY|^\s*INSERT INTO /gm);
  assert.doesNotMatch(sql,/ST_AsGeoJSON|auth\.users|ALTER TABLE bdp_parcel/);
});
test('62D-C14B1 disposable container has zero network and no host mounts',()=>{
  assert.match(smoke,/'--network','none'/);
  assert.match(smoke,/'--pull','never'/);
  assert.doesNotMatch(smoke,/'--publish'|'--mount'|'--volume'|'--network','bridge'/);
  assert.match(smoke,/'image','inspect',C14B_IMAGE/);
});
test('62D-C14B1 fixture uses random scoped container and destroys only itself',()=>{
  assert.match(smoke,/'ldos-c14b-review-'\+randomBytes\(6\)/);
  assert.match(smoke,/if\(created\)\{/);
  assert.match(smoke,/\['rm','--force','--volumes',name\]/);
  assert.doesNotMatch(smoke,/docker compose down|docker system prune/);
});
test('62D-C14B1 fixture checks duplicate/denied requests, replay and audit rollback',()=>{
  for(const s of ['denied(reqInsert','denied(approve',
    "enrollment_audit_events SET event_type='revoked'",
    'TRUNCATE ','rollback after invalid audit',
    "accounts SET revision=50", "county_grants);"])
    assert.ok(smoke.includes(s),s);
  assert.match(C14B_PASS,/no persistent databases touched/);
});
test('62D-C14B1 has no privileged persistent writer or HTTP connectivity',()=>{
  assert.doesNotMatch(smoke,/createServer\(|fetch\(|SUPABASE|sb_secret_|process\.env|ldos_auth_dev/);
  assert.doesNotMatch(sql,/^\s*CREATE ROLE|^\s*GRANT |^\s*ALTER ROLE/gm);
});

test('62D-C14B1 exact SQL blob is pinned before any Docker operation',()=>{
  assert.equal(c14bGitBlob(sql),C14B_SQL_BLOB);
  assert.equal(C14B_SQL_BLOB.length,40);
  assert.equal(validC14BSource(sql+' '),false);
  assert.match(smoke,/c14bGitBlob\(s\)===C14B_SQL_BLOB/);
});
test('62D-C14B1 audit FK references exact unique request and subject pair',()=>{
  assert.match(sql,/UNIQUE \(request_id, subject\)/);
  assert.match(sql,/FOREIGN KEY \(request_id,subject\)/);
  assert.match(sql,/REFERENCES ldos_app_auth.enrollment_requests\(request_id,subject\)/);
});
