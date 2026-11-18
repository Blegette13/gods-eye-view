import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL(
  '../../../scripts/bdp/app-auth-dev-protected-recovery.ps1',
  import.meta.url,
),'utf8');

test('62D-C10 PowerShell entry accepts exactly one deliberate mode',()=>{
  for(const flag of ['$PlanOnly','$SealLocalOnly','$CheckSealsOnly'])
    assert.ok(source.includes('[switch]'+flag),flag);
  assert.match(source,/IsPresent\) -ne 1/);
});
test('62D-C10 plan leaves files and database untouched',()=>{
  assert.match(source,/if \(\$PlanOnly\) \{\s*Write-Output \$PlanMessage\s*return\s*\}/);
  assert.match(source,/no SQL writes/);
});
test('62D-C10 only permits Windows local-account DPAPI operations',()=>{
  assert.match(source,/\$env:OS -ne 'Windows_NT'/);
  assert.match(source,/DataProtectionScope\]::CurrentUser/);
});
test('62D-C10 secret files are outside checkout in the user home',()=>{
  assert.match(source,/GetFolderPath\('UserProfile'\)/);
  assert.match(source,/'ldos-local-secrets'/);
  assert.match(source,/'auth-gateway-v1\.dpapi'/);
  assert.match(source,/'auth-globals-no-passwords-v1\.dpapi'/);
  assert.doesNotMatch(source,/Join-Path \$PSScriptRoot 'auth-gateway/);
});
test('62D-C10 no password enters shell argv, env, logs or SQL role creation',()=>{
  assert.doesNotMatch(source,/POSTGRES_PASSWORD|PGPASSWORD|CREATE ROLE|ALTER ROLE|GRANT .*TO|Write-Output \$password|Write-Host \$password|SetEnvironmentVariable/);
});
test('62D-C10 generates a 32-byte CSPRNG future gateway password',()=>{
  assert.match(source,/New-Object byte\[\] 32/);
  assert.match(source,/RandomNumberGenerator\]::Create\(\)/);
  assert.match(source,/\$rng\.GetBytes\(\$random\)/);
  assert.match(source,/\^\[0-9a-f\]\{64\}\$/);
});
test('62D-C10 DPAPI protects secret bytes, not plaintext disk',()=>{
  assert.match(source,/ProtectedData\]::Protect\(/);
  assert.match(source,/DataProtectionScope\]::CurrentUser/);
  assert.match(source,/Write-NewProtectedFile \$SecretPath \$sealedSecret/);
  assert.doesNotMatch(source,/Set-Content|Out-File|WriteAllText|ConvertFrom-Json/);
});
test('62D-C10 sealed globals are captured with password hashes omitted',()=>{
  assert.match(source,/pg_dumpall -U postgres --globals-only --no-role-passwords/);
  assert.match(source,/Protect-Text \$globals/);
  assert.doesNotMatch(source,/Write-Output \$globals|Write-Host \$globals/);
});
test('62D-C10 capture targets only exact authentication Docker container',()=>{
  assert.match(source,/docker exec ldos-auth-dev-auth-postgres-1/);
  assert.doesNotMatch(source,/docker run|docker stop|docker rm|docker compose down|bdp-postgis/);
});
test('62D-C10 refuses global dumps missing the NOLOGIN reader or containing gateway',()=>{
  assert.match(source,/CREATE ROLE ldos_auth_account_reader;/);
  assert.match(source,/CREATE ROLE ldos_auth_gateway_login;/);
  assert.match(source,/Assert-GlobalSnapshot \$globals/);
});
test('62D-C10 refuses possible passwords in global role dumps',()=>{
  assert.match(source,/PASSWORD\\s\+/);
  assert.match(source,/\$text\.Length -lt 100/);
});
test('62D-C10 first attests exact read-only C8 primary and ACLs',()=>{
  assert.match(source,/app-auth-local-gateway-preflight\.mjs/);
  assert.match(source,/--check-local-auth-only/);
  assert.match(source,/\$preflightOutput\[0\] -cne \$ExpectedPreflight/);
});
test('62D-C10 file creation never overwrites existing recovery secrets',()=>{
  assert.match(source,/FileMode\]::CreateNew/);
  assert.match(source,/C10 recovery files already exist/);
});
test('62D-C10 restricts local folder ACL and prevents junctions',()=>{
  assert.match(source,/FileAttributes\]::ReparsePoint/);
  assert.match(source,/SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(source,/Set-Acl -LiteralPath \$Root/);
  assert.match(source,/SecurityIdentifier\]::new\('S-1-5-18'\)/);
});
test('62D-C10 read-only check mode unseals both files and denies malformed secret',()=>{
  assert.match(source,/if \(\$CheckSealsOnly\)/);
  assert.match(source,/Unprotect-Text \$SecretPath/);
  assert.match(source,/Unprotect-Text \$GlobalsPath/);
  assert.match(source,/Assert-GlobalSnapshot \$roleSql/);
});
test('62D-C10 failure cleanup applies only to files from this invocation',()=>{
  assert.match(source,/if \(\$createdSecret\)/);
  assert.match(source,/if \(\$createdGlobals\)/);
  assert.doesNotMatch(source,/Remove-Item -Recurse|docker system prune|down -v/);
});
test('62D-C10 code is unmounted, no HTTP, auth login or GIS permissions',()=>{
  assert.doesNotMatch(source,/createServer\(|new Pool\(|Set-LocalRole|ST_AsGeoJSON|SUPABASE|sb_secret_|localhost:5432/);
  assert.match(source,/auth database unchanged/);
});
