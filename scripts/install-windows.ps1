[CmdletBinding()]
param(
  [string]$AppRootOverride,
  [string]$TaskName = 'KMCBServiceControl',
  [switch]$SkipPathUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $AppRootOverride -and -not $env:LOCALAPPDATA) {
  throw 'LOCALAPPDATA is unavailable. Run this installer from a normal Windows user session.'
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path
$NodeCommand = Get-Command node.exe -ErrorAction Stop
$NodePath = $NodeCommand.Source
$AppRoot = if ($AppRootOverride) {
  [IO.Path]::GetFullPath($AppRootOverride)
} else {
  Join-Path $env:LOCALAPPDATA 'KMCBServiceControl'
}
$RuntimeDir = Join-Path $AppRoot 'runtime'
$BinDir = Join-Path $AppRoot 'bin'
$ConfigPath = Join-Path $ToolRoot 'config\services.json'
$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$ControlPort = [int]$Config.port
$ControlUrl = "http://127.0.0.1:$ControlPort"

function Test-CommandLineOwnedByControlCentre {
  param(
    [AllowNull()][string]$CommandLine,
    [string[]]$AllowedRoots
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }

  foreach ($Root in $AllowedRoots) {
    $NormalizedRoot = $Root.TrimEnd('\', '/')
    foreach ($Prefix in @("$NormalizedRoot\", "$NormalizedRoot/")) {
      if ($CommandLine.IndexOf($Prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $true
      }
    }
  }
  return $false
}

function Write-Ascii {
  param(
    [string]$Path,
    [string]$Content
  )

  [IO.File]::WriteAllText($Path, $Content, [Text.Encoding]::ASCII)
}

function Write-Utf8WithBom {
  param(
    [string]$Path,
    [string]$Content
  )

  $Encoding = New-Object System.Text.UTF8Encoding($true)
  [IO.File]::WriteAllText($Path, $Content, $Encoding)
}

function Copy-ControlDirectory {
  param(
    [string]$Name
  )

  $Source = Join-Path $ToolRoot $Name
  $Destination = Join-Path $AppRoot $Name
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
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
  $CommandLine = if ($ProcessInfo) { [string]$ProcessInfo.CommandLine } else { $null }
  if (-not (Test-CommandLineOwnedByControlCentre -CommandLine $CommandLine -AllowedRoots @($ToolRoot, $AppRoot))) {
    throw "Refusing installation: port $ControlPort belongs to an unrelated process (PID $ProcessId)."
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $AppRoot, $RuntimeDir, $BinDir -Force | Out-Null
foreach ($Directory in @('src', 'public', 'config', 'bin')) {
  Copy-ControlDirectory -Name $Directory
}
Copy-Item -LiteralPath (Join-Path $ToolRoot 'package.json') -Destination (Join-Path $AppRoot 'package.json') -Force

$CliWrapper = Join-Path $BinDir 'kmcb-svc.cmd'
$CliContent = @"
@echo off
node "%~dp0svc.mjs" %*
"@
Write-Ascii -Path $CliWrapper -Content $CliContent

$ServerWrapper = Join-Path $BinDir 'start-control-centre.ps1'
$EscapedNodePath = $NodePath.Replace("'", "''")
$ServerContent = @"
`$ErrorActionPreference = 'Stop'
`$AppRoot = (Resolve-Path (Join-Path `$PSScriptRoot '..')).Path
`$RuntimeDir = Join-Path `$AppRoot 'runtime'
Set-Location `$AppRoot
& '$EscapedNodePath' (Join-Path `$AppRoot 'src\server.mjs') *>> (Join-Path `$RuntimeDir 'control-center.log')
"@
Write-Utf8WithBom -Path $ServerWrapper -Content $ServerContent

if (-not $SkipPathUpdate) {
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $UserPathParts = @($UserPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $BinAlreadyPresent = $UserPathParts | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') }
  if (-not $BinAlreadyPresent) {
    $NewUserPath = (@($UserPathParts) + $BinDir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $NewUserPath, 'User')
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') })) {
    $env:Path = "$BinDir;$env:Path"
  }
}

$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$TaskArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $ServerWrapper
$Action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument $TaskArguments -WorkingDirectory $AppRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description 'KMCB localhost service control centre' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

$Ready = $false
for ($Attempt = 0; $Attempt -lt 50; $Attempt += 1) {
  try {
    Invoke-RestMethod -Uri "$ControlUrl/api/status" -TimeoutSec 1 | Out-Null
    $Ready = $true
    break
  } catch {
    Start-Sleep -Milliseconds 200
  }
}

if (-not $Ready) {
  throw "The scheduled task was installed, but the dashboard did not become ready. Check $RuntimeDir\control-center.log"
}

Write-Host "Installed $TaskName"
Write-Host "Dashboard: $ControlUrl"
if ($SkipPathUpdate) {
  Write-Host "CLI: $CliWrapper status"
} else {
  Write-Host "CLI for this PowerShell session: kmcb-svc status"
  Write-Host 'Open a new terminal if kmcb-svc is not found in another existing shell.'
}
