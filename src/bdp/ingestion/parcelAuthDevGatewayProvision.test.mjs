import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-gateway-provision.ps1', import.meta.url,
), 'utf8');

test('62D-C11 only allows one of Plan, Validate or Apply',()=>{
  for(const flag of ['$PlanOnly','$ValidateLocalAuthOnly','$ApplyLocalAuthOnly'])
    assert.ok(source.includes('[switch]'+flag),flag);
  assert.match(source,/IsPresent\) -ne 1/);
});
test('62D-C11 plan-only exits before any Windows or database access',()=>{
  const plan=source.indexOf('if ($PlanOnly) {');
  const windows=source.indexOf("if ($env:OS -ne 'Windows_NT')");
  assert.ok(plan>=0 && windows>plan);
  assert.match(source.slice(plan,windows),/Write-Output \$PlanMessage\s+return/);
});
test('62D-C11 credential migration requires Windows user DPAPI',()=>{
  assert.match(source,/C11 only supports the approved local Windows DPAPI environment/);
  assert.match(source,/Add-Type -AssemblyName System\.Security -ErrorAction Stop/);
  assert.match(source,/ProtectedData\]::Unprotect\(/);
  assert.match(source,/DataProtectionScope\]::CurrentUser/);
});
test('62D-C11 requires two existing local protected files outside GitHub',()=>{
  for(const phrase of ["'ldos-local-secrets'","'auth-gateway-v1.dpapi'",
    "'auth-globals-no-passwords-v1.dpapi'"])
    assert.ok(source.includes(phrase),phrase);
  assert.match(source,/Test-Path -LiteralPath \$SecretPath -PathType Leaf/);
  assert.match(source,/Test-Path -LiteralPath \$GlobalsPath -PathType Leaf/);
});
test('62D-C11 protected input validation rejects reparse points and odd sizes',()=>{
  assert.match(source,/FileAttributes\]::ReparsePoint/);
  assert.match(source,/size -lt 32 -or \$size -gt 1048576/);
});
test('62D-C11 secret only decrypted in memory and checked as 64 lower hex',()=>{
  assert.match(source,/\$password = Read-SealedText \$SecretPath/);
  assert.match(source,/\$password -cnotmatch '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(source,/\[Array\]::Clear\(\$plain/);
  assert.doesNotMatch(source,/Write-Output \$password|Write-Host \$password|Set-Content|Out-File|New-Item/);
});
test('62D-C11 protected global snapshot must contain reader but not gateway',()=>{
  assert.match(source,/CREATE ROLE ldos_auth_account_reader;/);
  assert.match(source,/CREATE ROLE ldos_auth_gateway_login;/);
  assert.match(source,/\$globalRoleSnapshot\.Length -lt 100/);
  assert.match(source,/\$globalRoleSnapshot -match '\(\?im\)/);
});
test('62D-C11 preflight requires exact C8 local primary, ACLs and empty tables',()=>{
  assert.match(source,/app-auth-local-gateway-preflight\.mjs/);
  assert.match(source,/--check-local-auth-only/);
  assert.match(source,/\$preflightOutput\[0\] -cne \$ExpectedPreflight/);
});
test('62D-C11 refuses non-SCRAM PostgreSQL password encryption',()=>{
  assert.match(source,/current_setting\(''password_encryption''\)/);
  assert.match(source,/ldos_auth_dev\|postgres\|f\|scram-sha-256/);
  assert.match(source,/current_setting\('password_encryption'\) <> 'scram-sha-256'/);
});
test('62D-C11 validate path returns before SQL mutation',()=>{
  const validate=source.indexOf('if ($ValidateLocalAuthOnly) {');
  const mutate=source.indexOf('$null = Invoke-ScopedSql $sql');
  assert.ok(validate>=0 && mutate>validate);
  assert.match(source.slice(validate,mutate),/Write-Output \$ValidateMessage\s+return/);
});
test('62D-C11 uses exact Docker container and database only',()=>{
  assert.match(source,/ldos-auth-dev-auth-postgres-1 psql/);
  assert.match(source,/-U postgres -d ldos_auth_dev -v ON_ERROR_STOP=1/);
  assert.doesNotMatch(source,/docker compose down|docker system prune|docker rm/);
});
test('62D-C11 redirects SQL over stdin, not password-bearing argv',()=>{
  assert.match(source,/RedirectStandardInput = \$true/);
  assert.match(source,/RedirectStandardOutput = \$true/);
  assert.match(source,/RedirectStandardError = \$true/);
  assert.match(source,/StandardInput\.Write\(\$query\)/);
  assert.doesNotMatch(source,/PGPASSWORD|POSTGRES_PASSWORD|--password|ArgumentList\.Add\(\$password\)/);
});
test('62D-C11 Docker errors are sanitized without leaking SQL',()=>{
  assert.match(source,/C11 scoped SQL operation failed; STOP and inspect before retrying/);
  assert.match(source,/\$null = \$proc\.StandardError\.ReadToEnd\(\)/);
  assert.doesNotMatch(source,/Write-Host \$query|Write-Output \$query|Write-Output \$out|Write-Error \$sql/);
});
test('62D-C11 migration has a single transaction with lock and statement timeout',()=>{
  assert.match(source,/BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';/);
  assert.match(source,/END;\n\$ldos_c11_guard\$;/);
  assert.match(source,/COMMIT;\n'@/);
});
test('62D-C11 DB-side guard requires exact primary and role state',()=>{
  for(const clause of ["current_database() <> 'ldos_auth_dev'",
    "current_user <> 'postgres'","pg_is_in_recovery()",
    "rolname='ldos_auth_gateway_login'",
    "rolname='ldos_auth_account_reader'",
    "to_regnamespace('ldos_app_auth') IS NULL"])
    assert.ok(source.includes(clause),clause);
});
test('62D-C11 DB guard denies populated ledger and pre-installed candidate RPC',()=>{
  for(const name of ['accounts','sessions','county_grants'])
    assert.ok(source.includes('EXISTS (SELECT 1 FROM ldos_app_auth.'+name+')'),name);
  assert.match(source,/current_county_candidate_rpc\(text,text\)/);
});
test('62D-C11 creates only one no-inherit restricted SQL LOGIN',()=>{
  assert.match(source,/CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER/);
  for(const attribute of ['NOCREATEDB','NOCREATEROLE','NOREPLICATION','NOBYPASSRLS'])
    assert.ok(source.includes(attribute),attribute);
  assert.doesNotMatch(source,/CREATE ROLE ldos_auth_account_reader LOGIN/);
});
test('62D-C11 gives only SET TRUE INHERIT FALSE ADMIN FALSE reader membership',()=>{
  assert.match(source,/GRANT ldos_auth_account_reader TO ldos_auth_gateway_login\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/);
  assert.doesNotMatch(source,/GRANT SELECT|GRANT UPDATE|GRANT INSERT|GRANT ALL/);
});
test('62D-C11 postflight checks no direct schema, account, session, or county read',()=>{
  for(const x of ["has_schema_privilege('ldos_auth_gateway_login'",
    "has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.accounts','SELECT')",
    "has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.sessions','SELECT')",
    "has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.county_grants','SELECT')"])
    assert.ok(source.includes(x),x);
  assert.match(source,/ldos_auth_dev\|f\|t\|t\|t\|t\|t\|t\|t\|t/);
});
test('62D-C11 never enables HTTP, GIS, Supabase, app accounts or sessions',()=>{
  assert.doesNotMatch(source,/createServer\(|new Pool\(|ST_AsGeoJSON|sb_secret_|SUPABASE|INSERT INTO ldos_app_auth|UPDATE ldos_app_auth/);
});
test('62D-C11 failures after commit must stop and never reapply',()=>{
  assert.match(source,/Failure after COMMIT may mean the role exists: NEVER blindly re-run/);
  assert.match(source,/STOP without retrying/);
});
