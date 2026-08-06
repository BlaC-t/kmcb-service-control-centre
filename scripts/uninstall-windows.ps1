[CmdletBinding()]
param(
  [switch]$KeepRuntime,
  [string]$AppRootOverride,
  [string]$TaskName = 'KMCBServiceControl',
  [switch]$SkipPathUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $AppRootOverride -and -not $env:LOCALAPPDATA) {
  throw 'LOCALAPPDATA is unavailable. Run this uninstaller from a normal Windows user session.'
}

$AppRoot = if ($AppRootOverride) {
  [IO.Path]::GetFullPath($AppRootOverride)
} else {
  Join-Path $env:LOCALAPPDATA 'KMCBServiceControl'
}
$BinDir = Join-Path $AppRoot 'bin'
$RuntimeDir = Join-Path $AppRoot 'runtime'
$InstalledConfigPath = Join-Path $AppRoot 'config\services.json'
$ControlPort = 17600
if (Test-Path -LiteralPath $InstalledConfigPath) {
  $InstalledConfig = Get-Content -LiteralPath $InstalledConfigPath -Raw | ConvertFrom-Json
  $ControlPort = [int]$InstalledConfig.port
}

function Test-CommandLineOwnedByControlCentre {
  param(
    [AllowNull()][string]$CommandLine,
    [string]$AllowedRoot
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }

  $NormalizedRoot = $AllowedRoot.TrimEnd('\', '/')
  foreach ($Prefix in @("$NormalizedRoot\", "$NormalizedRoot/")) {
    if ($CommandLine.IndexOf($Prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return $true
    }
  }
  return $false
}

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$Listeners = @(Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue)
foreach ($Listener in $Listeners) {
  $ProcessId = [int]$Listener.OwningProcess
  $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  $CommandLine = if ($ProcessInfo) { [string]$ProcessInfo.CommandLine } else { '' }
  if (Test-CommandLineOwnedByControlCentre -CommandLine $CommandLine -AllowedRoot $AppRoot) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not $SkipPathUpdate) {
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $RemainingPathParts = @(
    $UserPath -split ';' |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Where-Object { $_.TrimEnd('\') -ine $BinDir.TrimEnd('\') }
  )
  [Environment]::SetEnvironmentVariable('Path', ($RemainingPathParts -join ';'), 'User')
}

if ($KeepRuntime) {
  foreach ($Name in @('src', 'public', 'config', 'bin', 'package.json')) {
    $Target = Join-Path $AppRoot $Name
    if (Test-Path -LiteralPath $Target) {
      Remove-Item -LiteralPath $Target -Recurse -Force
    }
  }
  Write-Host "Uninstalled $TaskName and retained runtime data at $RuntimeDir"
} elseif (Test-Path -LiteralPath $AppRoot) {
  Remove-Item -LiteralPath $AppRoot -Recurse -Force
  Write-Host "Uninstalled $TaskName and removed $AppRoot"
} else {
  Write-Host "Uninstalled $TaskName"
}

Write-Host 'Open a new terminal to refresh the user PATH.'
