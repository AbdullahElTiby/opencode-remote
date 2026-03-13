param(
  [switch]$EnsureFirewallOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "remote-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
$firewallRuleName = "OpenCode Remote 8787"
$manualFirewallCommand = Get-ManualFirewallCommand -Port 8787

if ($EnsureFirewallOnly) {
  Ensure-FirewallRule -Port 8787 -RuleName $firewallRuleName
  exit 0
}

function Install-NodeJs {
  $wingetPath = Resolve-CommandPath -Name "winget"
  if (-not $wingetPath) {
    throw "Node.js is required. Install it from https://nodejs.org/ or run `winget install OpenJS.NodeJS.LTS`, then rerun this script."
  }

  Write-Step "Installing Node.js LTS with winget"
  & $wingetPath install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js installation did not complete. Install it from https://nodejs.org/ or rerun `winget install OpenJS.NodeJS.LTS`, then rerun this script."
  }
}

function Install-OpenCode {
  param([string]$NpmPath)
  if (-not $NpmPath) {
    throw "OpenCode is required. Install Node.js first, then run `npm install -g opencode-ai`, and rerun this script."
  }

  Write-Step "Installing OpenCode globally with npm"
  & $NpmPath install -g opencode-ai
  if ($LASTEXITCODE -ne 0) {
    throw "OpenCode installation did not complete. Run `npm install -g opencode-ai` and rerun this script."
  }
}

function Resolve-OpenCodePath {
  param([string]$NpmPath)

  $commandPath = Resolve-CommandPath -Name "opencode.cmd"
  if (-not $commandPath) {
    $commandPath = Resolve-CommandPath -Name "opencode"
  }
  if ($commandPath) {
    return $commandPath
  }

  if (-not $NpmPath) {
    return $null
  }

  try {
    $prefix = (& $NpmPath prefix -g 2>$null | Select-Object -First 1).Trim()
    if ($prefix) {
      foreach ($candidate in @((Join-Path $prefix "opencode.cmd"), (Join-Path $prefix "opencode"))) {
        if (Test-Path $candidate) {
          return $candidate
        }
      }
    }
  } catch {
    return $null
  }

  return $null
}

function Invoke-NpmInstall {
  param([string]$NpmPath, [string]$RootPath)
  Write-Step "Installing workspace dependencies"
  Push-Location $RootPath
  try {
    & $NpmPath install
    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed. Fix the npm errors above, then rerun this script."
    }
  } finally {
    Pop-Location
  }
}

function Ensure-FirewallAccess {
  if (Test-IsAdministrator) {
    Write-Step "Ensuring Windows firewall rule for port 8787"
    Ensure-FirewallRule -Port 8787 -RuleName $firewallRuleName
    return
  }

  Write-Step "Requesting Windows firewall access"
  try {
    $argumentList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -EnsureFirewallOnly"
    $process = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argumentList -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "The elevated firewall step exited with code $($process.ExitCode)."
    }
  } catch {
    throw "Firewall access was not granted. Run this command in an Administrator PowerShell window, then rerun setup:`n$manualFirewallCommand"
  }
}

function Read-WindowsStartupPreference {
  param([bool]$CurrentlyEnabled)

  $currentState = if ($CurrentlyEnabled) { "currently enabled" } else { "currently disabled" }

  while ($true) {
    Write-Host ""
    $response = Read-Host "Start OpenCode Remote automatically when you turn on this PC and sign in to Windows? This launches the full host stack in the background. [$currentState] (Y/N)"
    $normalized = $response.Trim().ToLowerInvariant()

    switch ($normalized) {
      "y" { return $true }
      "yes" { return $true }
      "n" { return $false }
      "no" { return $false }
      default {
        Write-WarnStep "Please answer Y, Yes, N, or No."
      }
    }
  }
}

function Test-NeedsOpenCodeBinRefresh {
  param(
    [string]$ConfiguredPath,
    [string]$ResolvedPath
  )

  if ([string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    return $true
  }

  if ($ConfiguredPath -eq "opencode") {
    return $true
  }

  if ($ConfiguredPath.EndsWith(".ps1", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  if (-not [System.IO.Path]::IsPathRooted($ConfiguredPath)) {
    return $false
  }

  if (-not (Test-Path $ConfiguredPath)) {
    return $true
  }

  return ($ConfiguredPath -ne $ResolvedPath)
}

function Write-Summary {
  param(
    [hashtable]$EnvValues,
    [hashtable]$Logs,
    [bool]$GeneratedPassword,
    [string]$WindowsStartupStatus
  )

  Write-Host ""
  Write-Ok "OpenCode Remote is ready."
  Write-Host "Pairing page: http://localhost:8787"
  Write-Host "Phone URL: $($EnvValues['PUBLIC_BASE_URL'])"
  if ($GeneratedPassword) {
    Write-Host "OpenCode password: generated and saved to .env"
  }
  if (-not [string]::IsNullOrWhiteSpace($WindowsStartupStatus)) {
    Write-Host "Windows startup: $WindowsStartupStatus"
  }
  Write-Host "Logs:"
  Write-Host "  $($Logs.OpenCodeOut)"
  Write-Host "  $($Logs.OpenCodeErr)"
  Write-Host "  $($Logs.GatewayOut)"
  Write-Host "  $($Logs.GatewayErr)"
  Write-Host "Recovery:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\start-remote.ps1"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\stop-remote.ps1"
}

try {
  Assert-PowerShellVersion
  Assert-RepoRoot -Root $root
  Write-OpenCodeBanner

  Write-Step "Checking Node.js and npm"
  $nodePath = Resolve-CommandPath -Name "node"
  $npmPath = Resolve-CommandPath -Name "npm.cmd"
  if (-not $npmPath) {
    $npmPath = Resolve-CommandPath -Name "npm"
  }
  if (-not $nodePath -or -not $npmPath) {
    Install-NodeJs
    $nodePath = Resolve-CommandPath -Name "node"
    $npmPath = Resolve-CommandPath -Name "npm.cmd"
    if (-not $npmPath) {
      $npmPath = Resolve-CommandPath -Name "npm"
    }
  }
  if (-not $nodePath -or -not $npmPath) {
    throw "Node.js and npm are still unavailable. Install them, then rerun this script."
  }
  Write-Ok "Node.js and npm are available"

  Write-Step "Checking OpenCode"
  $opencodePath = Resolve-OpenCodePath -NpmPath $npmPath
  if (-not $opencodePath) {
    Install-OpenCode -NpmPath $npmPath
    $opencodePath = Resolve-OpenCodePath -NpmPath $npmPath
  }
  if (-not $opencodePath) {
    throw "OpenCode is still unavailable. Run `npm install -g opencode-ai`, then rerun this script."
  }
  Write-Ok "OpenCode is available"

  Invoke-NpmInstall -NpmPath $npmPath -RootPath $root
  Write-Ok "Workspace dependencies are installed"

  Write-Step "Preparing environment"
  $envState = Initialize-RemoteEnv -Root $root
  if (Test-NeedsOpenCodeBinRefresh -ConfiguredPath ([string]$envState.Values["OPENCODE_BIN"]) -ResolvedPath $opencodePath) {
    $envState.Values["OPENCODE_BIN"] = $opencodePath
    Write-EnvFile -Path $envState.EnvPath -Values $envState.Values -ExamplePath $envState.ExamplePath
    Import-EnvToProcess -Values $envState.Values
  }
  Ensure-StateDirectory -EnvValues $envState.Values -Root $root
  $logs = Get-LogPaths -Root $root
  Write-Ok "Environment is ready for $($envState.Values['PUBLIC_BASE_URL'])"

  Ensure-FirewallAccess
  Write-Ok "Windows firewall allows inbound access on port 8787"

  Write-Step "Starting OpenCode and the gateway"
  $openCodeResult = Start-OpenCodeService -Root $root -EnvValues $envState.Values -Logs $logs
  $gatewayResult = Start-GatewayService -Root $root -Logs $logs
  if ($openCodeResult.Started) {
    Write-Ok "Started OpenCode on 127.0.0.1:4096"
  } else {
    Write-Ok "Reusing the existing OpenCode listener on 127.0.0.1:4096"
  }
  if ($gatewayResult.Started) {
    Write-Ok "Started the gateway on 0.0.0.0:8787"
  } else {
    Write-Ok "Reusing the existing gateway listener on 0.0.0.0:8787"
  }

  Write-Step "Waiting for the gateway health check"
  if (-not (Wait-ForHttpOk -Url "http://localhost:8787/healthz" -TimeoutSeconds 45)) {
    throw "The gateway did not become healthy at http://localhost:8787/healthz. Check the gateway logs and rerun the script."
  }
  Write-Ok "Gateway is healthy"

  Write-Step "Configuring optional Windows startup"
  $startupWasEnabled = Test-RemoteStartupShortcut
  $enableWindowsStartup = Read-WindowsStartupPreference -CurrentlyEnabled $startupWasEnabled
  if ($enableWindowsStartup) {
    $startupShortcutPath = Set-RemoteStartupShortcut -Root $root
    Write-Ok "Windows startup is enabled through $startupShortcutPath"
    $windowsStartupStatus = "enabled"
  } else {
    $removedStartupShortcut = Remove-RemoteStartupShortcut
    if ($removedStartupShortcut) {
      Write-Ok "Windows startup is disabled"
    } else {
      Write-Ok "Windows startup remains disabled"
    }
    $windowsStartupStatus = "disabled"
  }

  Write-Step "Opening the pairing page"
  Start-Process "http://localhost:8787" | Out-Null

  Write-Summary -EnvValues $envState.Values -Logs $logs -GeneratedPassword $envState.GeneratedPassword -WindowsStartupStatus $windowsStartupStatus
  exit 0
} catch {
  Write-Fail $_.Exception.Message
  exit 1
}
