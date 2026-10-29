import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const audit = readFileSync(
  new URL('./auditRegulatoryEvidenceSecurity.sql', import.meta.url), 'utf8',
);

test('Step 48 database security audit is read-only and transaction-bound', () => {
  assert.match(audit, /^BEGIN READ ONLY;/m);
  assert.match(audit.trim(), /ROLLBACK;$/);
  assert.match(audit, /\bDO \$bdp_audit\$/);
  // No DDL/DML statements appear at the start of any non-comment line.
  const statements = audit.split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  assert.doesNotMatch(statements,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|CREATE\s+|ALTER\s+|DROP\s+|TRUNCATE\s+)/gmi);
});

test('audit checks all group roles and rejects privileged LOGIN/BYPASSRLS', () => {
  for (const role of [
    'bdp_evidence_reader', 'bdp_evidence_appender',
    'bdp_evidence_owner', 'bdp_evidence_acl_owner',
  ]) assert.ok(audit.includes(role));
  for (const attribute of [
    'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole',
    'rolreplication', 'rolbypassrls',
  ]) assert.ok(audit.includes(attribute));
});

test('audit checks actual RLS state, three policies and both function owners', () => {
  assert.match(audit, /relrowsecurity/);
  for (const policy of [
    'bdp_evidence_reader_parcel_isolation',
    'bdp_evidence_owner_insert_parcel_isolation',
    'bdp_evidence_owner_returning_parcel_isolation',
  ]) assert.ok(audit.includes(policy));
  assert.match(audit, /pg_get_expr/);
  assert.match(audit, /bdp_evidence_has_parcel_access/);
  assert.match(audit, /v_append_definer IS DISTINCT FROM TRUE/);
  assert.match(audit, /v_access_definer IS DISTINCT FROM TRUE/);
});

test('audit checks restricted privileges and prints only grant counts', () => {
  assert.match(audit, /has_any_column_privilege/);
  assert.match(audit, /has_function_privilege/);
  assert.match(audit, /has_table_privilege/);
  assert.match(audit, /has_column_privilege/);
  assert.match(audit, /count\(\*\) FILTER \(WHERE expires_at > CURRENT_TIMESTAMP\)/);
  assert.match(audit, /count\(\*\) FILTER \(WHERE expires_at <= CURRENT_TIMESTAMP\)/);
  assert.doesNotMatch(audit, /RAISE NOTICE[^\n]*login_role/);
  assert.doesNotMatch(audit, /RAISE NOTICE[^\n]*source_url/);
  assert.doesNotMatch(audit, /RAISE NOTICE[^\n]*entered_by/);
});
