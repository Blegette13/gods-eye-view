param(
  [switch]$PlanOnly,
  [switch]$SealLocalOnly,
  [switch]$CheckSealsOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Step 40C-62D-C10: Windows-only local development recovery.
# -PlanOnly: no IO beyond printing a fixed description.
# -SealLocalOnly: C8 read-only attestation and password-free pg_dumpall
#  globals, followed by creation of two user-DPAPI protected local files.
# -CheckSealsOnly: local DPAPI decrypt/integrity check, no DB connection.
# No SQL or role writes. No plaintext secret in stdout or process arguments.
$ExpectedPreflight = 'PASS: local persistent auth-dev primary and NOLOGIN account-reader privileges verified; gateway LOGIN absent, ledger empty, candidate RPC absent; no database writes.'
$PlanMessage = 'PLAN: C10 Windows DPAPI local gateway secret and password-free global-role recovery snapshot; no SQL writes; C8 preflight required before creating protected files.'
$SealMessage = 'PASS: C10 local DPAPI gateway secret and no-password global-role recovery snapshot sealed outside repository; auth database unchanged.'
$CheckMessage = 'PASS: C10 two local Windows DPAPI recovery files decrypt and validate under current account; no database access.'

if (([int]$PlanOnly.IsPresent + [int]$SealLocalOnly.IsPresent +
    [int]$CheckSealsOnly.IsPresent) -ne 1) {
  throw 'Choose exactly one: -PlanOnly, -SealLocalOnly, or -CheckSealsOnly.'
}
if ($PlanOnly) {
  Write-Output $PlanMessage
  return
}
if ($env:OS -ne 'Windows_NT') {
  throw 'C10 DPAPI operation requires Windows under the intended local account.'
}

$Root = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'ldos-local-secrets'
$SecretPath = Join-Path $Root 'auth-gateway-v1.dpapi'
$GlobalsPath = Join-Path $Root 'auth-globals-no-passwords-v1.dpapi'

function Assert-PrivateDirectory {
  if (-not (Test-Path -LiteralPath $Root)) {
    [void](New-Item -ItemType Directory -Path $Root -ErrorAction Stop)
  }
  $item = Get-Item -LiteralPath $Root -Force
  if (-not $item.PSIsContainer -or
      (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw 'Refusing unexpected recovery directory.'
  }
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($sid)
  $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  foreach ($owner in @($sid, $system)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $owner,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Root -AclObject $acl
}
function Protect-Text([string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  try {
    return ,([Security.Cryptography.ProtectedData]::Protect(
      $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    ))
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}
function Unprotect-Text([string]$path) {
  $cipher = [IO.File]::ReadAllBytes($path)
  try {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    try {
      return [Text.Encoding]::UTF8.GetString($bytes)
    } finally {
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
  } finally {
    [Array]::Clear($cipher, 0, $cipher.Length)
  }
}
function Assert-GlobalSnapshot([string]$text) {
  if ($text.Length -lt 100 -or
      $text -notmatch '(?m)^CREATE ROLE ldos_auth_account_reader;' -or
      $text -match '(?m)^CREATE ROLE ldos_auth_gateway_login;' -or
      $text -match '(?im)\bPASSWORD\s+''') {
    throw 'Global-role snapshot is unexpected or contains a possible credential.'
  }
}
function Write-NewProtectedFile([string]$path, [byte[]]$cipher) {
  $stream = [System.IO.FileStream]::new(
    $path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $stream.Write($cipher, 0, $cipher.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
}
if ($CheckSealsOnly) {
  if (-not (Test-Path -LiteralPath $SecretPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $GlobalsPath -PathType Leaf)) {
    throw 'Expected sealed recovery material not present. No file changes.'
  }
  $password = Unprotect-Text $SecretPath
  $roleSql = Unprotect-Text $GlobalsPath
  if ($password -cnotmatch '^[0-9a-f]{64}$') {
    throw 'Protected credential integrity check failed.'
  }
  Assert-GlobalSnapshot $roleSql
  Write-Output $CheckMessage
  return
}

# Seal ONLY. Never overwrite, repeat a partial seal or delete other files.
if ((Test-Path -LiteralPath $SecretPath) -or
    (Test-Path -LiteralPath $GlobalsPath)) {
  throw 'C10 recovery files already exist. Do not overwrite; inspect first.'
}
$preflightScript = Join-Path $PSScriptRoot 'app-auth-local-gateway-preflight.mjs'
$preflightOutput = @(& node $preflightScript --check-local-auth-only 2>$null)
if ($LASTEXITCODE -ne 0 -or $preflightOutput.Count -ne 1 -or
    $preflightOutput[0] -cne $ExpectedPreflight) {
  throw 'Exact C8 persistent read-only preflight failed. No files written.'
}

# The only DB operation is a SELECT-equivalent globals DDL export, with
# --no-role-passwords to omit role password hashes and plaintext passwords.
$globalsLines = @(& docker exec ldos-auth-dev-auth-postgres-1 pg_dumpall -U postgres --globals-only --no-role-passwords 2>$null)
if ($LASTEXITCODE -ne 0) {
  throw 'Read-only global-role export failed. No files written.'
}
$globals = [string]::Join([Environment]::NewLine, [string[]]$globalsLines)
Assert-GlobalSnapshot $globals

# Generate a future gateway secret with a CSPRNG. There is no LOGIN yet.
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$password = [BitConverter]::ToString($random).Replace('-', '').ToLowerInvariant()
[Array]::Clear($random, 0, $random.Length)
if ($password -cnotmatch '^[0-9a-f]{64}$') {
  throw 'Local random credential format invalid.'
}
$sealedSecret = Protect-Text $password
$sealedGlobals = Protect-Text $globals
Assert-PrivateDirectory
$createdSecret = $false
$createdGlobals = $false
try {
  Write-NewProtectedFile $SecretPath $sealedSecret
  $createdSecret = $true
  Write-NewProtectedFile $GlobalsPath $sealedGlobals
  $createdGlobals = $true
} catch {
  # Scope cleanup only to files newly created by this exact invocation.
  if ($createdSecret) {
    Remove-Item -LiteralPath $SecretPath -Force -ErrorAction SilentlyContinue
  }
  if ($createdGlobals) {
    Remove-Item -LiteralPath $GlobalsPath -Force -ErrorAction SilentlyContinue
  }
  throw 'Protected local recovery file creation failed; inspect before retry.'
} finally {
  [Array]::Clear($sealedSecret, 0, $sealedSecret.Length)
  [Array]::Clear($sealedGlobals, 0, $sealedGlobals.Length)
}
Write-Output $SealMessage
