param(
  [switch]$PlanOnly,
  [switch]$VerifyLocalAuthOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Step 40C-62D-C12: Windows-only, ONE-SHOT READ-ONLY node-postgres proof.
# No writes, no user enrollment, no SQL-role DDL. The credential is unsealed
# under the current Windows user and passed to Node only via process stdin.
# Never reveal the secret/role dump or run the C11 migration again.
$PlanMessage = 'PLAN: C12 real local node-postgres gateway reader probe through protected stdin; no app accounts or database writes.'
$ExpectedPreflight = 'PASS: C12 persistent local auth primary, restricted gateway LOGIN and SET-only NOLOGIN reader attested; empty ledger; no database writes.'
$ExpectedDriver = 'PASS: C12 real restricted node-postgres gateway on local auth-dev; exact primary account read denied for absent synthetic UUID, role-switch privilege proof passed, raw table and role escalation denied; no database writes.'

if (([int]$PlanOnly.IsPresent + [int]$VerifyLocalAuthOnly.IsPresent) -ne 1) {
  throw 'C12 requires exactly -PlanOnly or -VerifyLocalAuthOnly.'
}
if ($PlanOnly) {
  Write-Output $PlanMessage
  return
}
if ($env:OS -ne 'Windows_NT') {
  throw 'C12 requires the approved local Windows DPAPI account.'
}
try {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    Add-Type -AssemblyName System.Security -ErrorAction Stop
  }
} catch {
  throw 'C12 Windows DPAPI is unavailable; no database writes.'
}

# Read-only exact Docker identity and post-C11 SQL role/ACL/empty-table proof.
$preflight = Join-Path $PSScriptRoot 'app-auth-gateway-installed-preflight.mjs'
$preflightResult = @(& node $preflight --check-local-auth-only 2>$null)
if ($LASTEXITCODE -ne 0 -or $preflightResult.Count -ne 1 -or
    $preflightResult[0] -cne $ExpectedPreflight) {
  throw 'C12 exact persistent gateway preflight rejected; no database writes.'
}

$folder = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'ldos-local-secrets'
$secretPath = Join-Path $folder 'auth-gateway-v1.dpapi'
if (-not (Test-Path -LiteralPath $folder -PathType Container) -or
    -not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
  throw 'C12 protected local gateway credential absent.'
}
foreach ($p in @($folder,$secretPath)) {
  $entry = Get-Item -LiteralPath $p -Force
  if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'C12 refuses reparse-point protected credential.'
  }
}
$fileLen = (Get-Item -LiteralPath $secretPath).Length
if ($fileLen -lt 32 -or $fileLen -gt 4096) {
  throw 'C12 protected credential file size rejected.'
}
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app-auth-dev-pg-driver-live-check.mjs'))
if (-not (Test-Path -LiteralPath $runner -PathType Leaf) -or
    $runner -match '["\r\n]') {
  throw 'C12 fixed Node entry point rejected.'
}

$password = $null
$cipher = $null
$plain = $null
$proc = $null
try {
  $cipher = [IO.File]::ReadAllBytes($secretPath)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $password = [Text.Encoding]::UTF8.GetString($plain)
  if ($password -cnotmatch '^[0-9a-f]{64}$') {
    throw 'C12 protected credential format rejected.'
  }

  # .NET ProcessStartInfo uses fixed argv: NO password or untrusted SQL in it.
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = 'node.exe'
  $start.Arguments = '"' + $runner + '" --local-auth-dev-only'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::new()
  $proc.StartInfo = $start
  if (-not $proc.Start()) { throw 'Node process unavailable.' }
  $proc.StandardInput.Write($password)
  $proc.StandardInput.Close()
  $output = $proc.StandardOutput.ReadToEnd()
  $null = $proc.StandardError.ReadToEnd()
  if (-not $proc.WaitForExit(60000) -or
      $proc.ExitCode -ne 0 -or $output.Trim() -cne $ExpectedDriver) {
    throw 'Restricted driver did not confirm full SQL proof.'
  }
  Write-Output $ExpectedDriver
} catch {
  throw 'C12 local protected node-postgres reader check failed; STOP without any database changes.'
} finally {
  if ($null -ne $proc) {
    try {
      if ($proc.Id -gt 0 -and -not $proc.HasExited) { $proc.Kill() }
    } catch {}
    $proc.Dispose()
  }
  if ($null -ne $cipher) { [Array]::Clear($cipher,0,$cipher.Length) }
  if ($null -ne $plain) { [Array]::Clear($plain,0,$plain.Length) }
  $password = $null
}
