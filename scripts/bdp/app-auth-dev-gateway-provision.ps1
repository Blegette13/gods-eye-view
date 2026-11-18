param(
  [switch]$PlanOnly,
  [switch]$ValidateLocalAuthOnly,
  [switch]$ApplyLocalAuthOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Step 40C-62D-C11: guarded, one-time local auth-dev LOGIN migration.
# -PlanOnly: only print a static plan. No filesystem or database access.
# -ValidateLocalAuthOnly: C8 read-only DB preflight and sealed DPAPI input
#   validation; no SQL mutation, credential disclosure, or file writes.
# -ApplyLocalAuthOnly: operator-opt-in persistent local PostgreSQL role DDL.
#   Secrets are read from Windows current-user DPAPI and sent to docker psql
#   ONLY over its redirected stdin. No passwords in argv, stdout, env, files
#   or logs. NEVER run against Supabase or parcel PostGIS.
$PlanMessage = 'PLAN: C11 exact local auth-dev gateway LOGIN migration prepared; validate protected inputs and current SQL permissions before separately approved apply; NO database changes.'
$ValidateMessage = 'PASS: C11 protected gateway credential and local auth-dev primary/role preflight verified; no database writes.'
$ApplyMessage = 'PASS: C11 local gateway LOGIN installed with SET-only NOLOGIN reader membership, no direct table rights, empty ledger and no GIS access.'
$ExpectedPreflight = 'PASS: local persistent auth-dev primary and NOLOGIN account-reader privileges verified; gateway LOGIN absent, ledger empty, candidate RPC absent; no database writes.'

if (([int]$PlanOnly.IsPresent + [int]$ValidateLocalAuthOnly.IsPresent +
    [int]$ApplyLocalAuthOnly.IsPresent) -ne 1) {
  throw 'Choose exactly one C11 operation: -PlanOnly, -ValidateLocalAuthOnly, -ApplyLocalAuthOnly.'
}
if ($PlanOnly) {
  Write-Output $PlanMessage
  return
}
if ($env:OS -ne 'Windows_NT') {
  throw 'C11 only supports the approved local Windows DPAPI environment.'
}
try {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
  }
} catch {
  throw 'C11 Windows DPAPI assembly missing; no database writes.'
}

$Root = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'ldos-local-secrets'
$SecretPath = Join-Path $Root 'auth-gateway-v1.dpapi'
$GlobalsPath = Join-Path $Root 'auth-globals-no-passwords-v1.dpapi'

function Read-SealedText([string]$path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  try {
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
      $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    try { return [Text.Encoding]::UTF8.GetString($plain) }
    finally { [Array]::Clear($plain, 0, $plain.Length) }
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}
function Verify-SecretLocations {
  if (-not (Test-Path -LiteralPath $Root -PathType Container) -or
      -not (Test-Path -LiteralPath $SecretPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $GlobalsPath -PathType Leaf)) {
    throw 'C11 sealed DPAPI inputs missing; no database writes.'
  }
  foreach ($path in @($Root,$SecretPath,$GlobalsPath)) {
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'C11 unexpected recovery path; no database writes.'
    }
  }
  foreach ($path in @($SecretPath,$GlobalsPath)) {
    $size = (Get-Item -LiteralPath $path).Length
    if ($size -lt 32 -or $size -gt 1048576) {
      throw 'C11 protected file size unexpected; no database writes.'
    }
  }
}
function Invoke-ScopedSql([string]$query) {
  # Docker/psql command arguments are *fixed*; credential-bearing SQL is
  # passed ONLY through redirected stdin. Never echo stdout/stderr on errors.
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'docker.exe'
  $start.Arguments = 'exec -i ldos-auth-dev-auth-postgres-1 psql -X -q -t -A -U postgres -d ldos_auth_dev -v ON_ERROR_STOP=1'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::new()
  $proc.StartInfo = $start
  try {
    if (-not $proc.Start()) { throw 'Could not start local SQL probe.' }
    $proc.StandardInput.Write($query)
    $proc.StandardInput.Close()
    $out = $proc.StandardOutput.ReadToEnd()
    $null = $proc.StandardError.ReadToEnd()
    if (-not $proc.WaitForExit(60000) -or $proc.ExitCode -ne 0) {
      throw 'Local SQL step failed.'
    }
    return $out.Trim()
  } catch {
    throw 'C11 scoped SQL operation failed; STOP and inspect before retrying.'
  } finally {
    # HasExited throws if Start itself failed. Never mask the sanitized error.
    try {
      if ($proc.Id -gt 0 -and -not $proc.HasExited) {
        $proc.Kill()
      }
    } catch {}
    $proc.Dispose()
  }
}

# First attest the exact named container and current empty primary ACL state.
# C8 emits only one fixed success line, never account data or secrets.
$preflight = Join-Path $PSScriptRoot 'app-auth-local-gateway-preflight.mjs'
$preflightOutput = @(& node $preflight --check-local-auth-only 2>$null)
if ($LASTEXITCODE -ne 0 -or $preflightOutput.Count -ne 1 -or
    $preflightOutput[0] -cne $ExpectedPreflight) {
  throw 'C11 local auth DB preflight rejected; no database writes.'
}

Verify-SecretLocations
$password = $null
$globalRoleSnapshot = $null
$sql = $null
try {
  $password = Read-SealedText $SecretPath
  $globalRoleSnapshot = Read-SealedText $GlobalsPath
  if ($password -cnotmatch '^[0-9a-f]{64}$') {
    throw 'Protected C11 credential invalid; no database writes.'
  }
  if ($globalRoleSnapshot.Length -lt 100 -or
      $globalRoleSnapshot -notmatch '(?m)^CREATE ROLE ldos_auth_account_reader;' -or
      $globalRoleSnapshot -match '(?m)^CREATE ROLE ldos_auth_gateway_login;' -or
      $globalRoleSnapshot -match '(?im)\bPASSWORD\s+''') {
    throw 'Protected C11 global-role snapshot invalid; no database writes.'
  }

  # Re-assert credential hashing policy and session identity read-only.
  $environmentCheck = Invoke-ScopedSql 'SELECT current_database(),current_user,pg_is_in_recovery(),current_setting(''password_encryption'');'
  if ($environmentCheck -cne 'ldos_auth_dev|postgres|f|scram-sha-256') {
    throw 'C11 database encryption policy mismatch; no database writes.'
  }

  # SQL block is deliberately fixed apart from one validated 64-hex local
  # credential. It never uses user input, web requests or app identities.
  $sql = @'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $ldos_c11_guard$
BEGIN
  IF current_database() <> 'ldos_auth_dev'
     OR current_user <> 'postgres'
     OR pg_is_in_recovery()
     OR current_setting('password_encryption') <> 'scram-sha-256'
     OR to_regnamespace('ldos_app_auth') IS NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='ldos_auth_gateway_login')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname='ldos_auth_account_reader' AND NOT rolcanlogin
         AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
         AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles r ON r.oid=m.member OR r.oid=m.roleid
       WHERE r.rolname='ldos_auth_account_reader')
     OR to_regprocedure('ldos_app_auth.current_county_candidate_rpc(text,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM ldos_app_auth.accounts)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.sessions)
     OR EXISTS (SELECT 1 FROM ldos_app_auth.county_grants) THEN
    RAISE EXCEPTION 'Unapproved local auth gateway role target';
  END IF;
END
$ldos_c11_guard$;
CREATE ROLE ldos_auth_gateway_login LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD '__C11_HEX_CREDENTIAL__';
GRANT ldos_auth_account_reader TO ldos_auth_gateway_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMIT;
'@
  $sql = $sql.Replace('__C11_HEX_CREDENTIAL__',$password)

  if ($ValidateLocalAuthOnly) {
    Write-Output $ValidateMessage
    return
  }

  # Explicit -ApplyLocalAuthOnly is the only path to PostgreSQL mutation.
  # Failure after COMMIT may mean the role exists: NEVER blindly re-run.
  $null = Invoke-ScopedSql $sql

  $postflight = @'
SELECT
  current_database(),
  pg_is_in_recovery(),
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname='ldos_auth_gateway_login'
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls),
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
    JOIN pg_catalog.pg_roles g ON g.oid=m.member
    WHERE r.rolname='ldos_auth_account_reader'
      AND g.rolname='ldos_auth_gateway_login'
      AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option),
  (SELECT count(*)=1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles g ON g.oid=m.member
    WHERE g.rolname='ldos_auth_gateway_login'),
  NOT has_schema_privilege('ldos_auth_gateway_login','ldos_app_auth','USAGE'),
  NOT has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.accounts','SELECT'),
  NOT has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.sessions','SELECT'),
  NOT has_table_privilege('ldos_auth_gateway_login','ldos_app_auth.county_grants','SELECT'),
  (SELECT count(*)=0 FROM ldos_app_auth.accounts)
    AND (SELECT count(*)=0 FROM ldos_app_auth.sessions)
    AND (SELECT count(*)=0 FROM ldos_app_auth.county_grants);
'@
  if ((Invoke-ScopedSql $postflight) -cne 'ldos_auth_dev|f|t|t|t|t|t|t|t|t') {
    throw 'C11 postflight did not confirm restricted role; STOP without retrying.'
  }
  Write-Output $ApplyMessage
} finally {
  # Strings cannot be deterministically zeroed in .NET; drop all references.
  $sql = $null
  $password = $null
  $globalRoleSnapshot = $null
}
