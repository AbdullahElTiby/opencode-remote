$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[..] $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "[ok] $Message" -ForegroundColor Green
}

function Write-WarnStep {
  param([string]$Message)
  Write-Host "[warn] $Message" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Message)
  Write-Host "[!!] $Message" -ForegroundColor Red
}

function Write-OpenCodeBanner {
  $bannerLines = @(
    @{ Icon = "  +------------+"; Label = "" },
    @{ Icon = "  |            |"; Label = "" },
    @{ Icon = "  |  +------+  |"; Label = "OpenCode Remote" },
    @{ Icon = "  |  |      |  |"; Label = "Windows Host Setup" },
    @{ Icon = "  |  |      |  |"; Label = "" },
    @{ Icon = "  |  +------+  |"; Label = "" },
    @{ Icon = "  |            |"; Label = "" },
    @{ Icon = "  +------------+"; Label = "" }
  )

  Write-Host ""
  foreach ($line in $bannerLines) {
    Write-Host $line.Icon -ForegroundColor White -NoNewline
    if ([string]::IsNullOrWhiteSpace($line.Label)) {
      Write-Host ""
      continue
    }

    Write-Host "  $($line.Label)" -ForegroundColor Cyan
  }
  Write-Host ""
}

function Assert-PowerShellVersion {
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "PowerShell 5 or newer is required."
  }
}

function Assert-RepoRoot {
  param([string]$Root)
  if (-not (Test-Path (Join-Path $Root "package.json"))) {
    throw "Could not find package.json in $Root. Run this script from the repository checkout."
  }
}

function Ensure-Directory {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Resolve-CommandPath {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) {
    return $null
  }
  return $command.Source
}

function Test-ListeningPort {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $listener
}

function Get-ActiveListenerProcessId {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    return $null
  }
  return $listener.OwningProcess
}

function Read-EnvFile {
  param([string]$Path)
  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') {
      continue
    }
    $parts = $line -split '=', 2
    if ($parts.Length -eq 2) {
      $values[$parts[0].Trim()] = $parts[1]
    }
  }
  return $values
}

function Get-EnvOrder {
  param([string]$ExamplePath, [hashtable]$Values)
  $order = New-Object System.Collections.Generic.List[string]
  if (Test-Path $ExamplePath) {
    foreach ($line in Get-Content $ExamplePath) {
      if ($line -match '^\s*#' -or $line -match '^\s*$') {
        continue
      }
      $parts = $line -split '=', 2
      if ($parts.Length -eq 2 -and -not $order.Contains($parts[0].Trim())) {
        [void]$order.Add($parts[0].Trim())
      }
    }
  }
  foreach ($key in $Values.Keys) {
    if (-not $order.Contains([string]$key)) {
      [void]$order.Add([string]$key)
    }
  }
  return $order
}

function Write-EnvFile {
  param(
    [string]$Path,
    [hashtable]$Values,
    [string]$ExamplePath
  )

  $order = Get-EnvOrder -ExamplePath $ExamplePath -Values $Values
  $lines = foreach ($key in $order) {
    if ($Values.ContainsKey($key)) {
      "$key=$($Values[$key])"
    }
  }
  [System.IO.File]::WriteAllLines($Path, $lines)
}

function Import-EnvToProcess {
  param([hashtable]$Values)
  foreach ($key in $Values.Keys) {
    [Environment]::SetEnvironmentVariable([string]$key, [string]$Values[$key], "Process")
  }
}

function Ensure-EnvFile {
  param([string]$Root)
  $envPath = Join-Path $Root ".env"
  $examplePath = Join-Path $Root ".env.example"
  if (-not (Test-Path $examplePath)) {
    throw "Missing .env.example at $examplePath"
  }
  if (-not (Test-Path $envPath)) {
    Copy-Item $examplePath $envPath
  }
  return @{
    EnvPath = $envPath
    ExamplePath = $examplePath
  }
}

function New-RandomSecret {
  param([int]$Bytes = 32)
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-PlaceholderEnvValue {
  param(
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }

  switch ($Key) {
    "PUBLIC_BASE_URL" {
      return $Value -eq "https://remote.example.com" -or $Value -eq "http://localhost:8787"
    }
    "JWT_SECRET" {
      return $Value -eq "change-me" -or $Value -eq "change-me-now-change-me-now" -or $Value.Length -lt 16
    }
    "OPENCODE_PASSWORD" {
      return [string]::IsNullOrWhiteSpace($Value)
    }
    default {
      return $false
    }
  }
}

function Get-BestLanIPv4 {
  $preferred = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object {
      $_.NetAdapter.Status -eq "Up" -and
      $_.IPv4Address -and
      $_.IPv4DefaultGateway
    } |
    ForEach-Object { $_.IPv4Address } |
    Where-Object {
      $_.IPAddress -and
      $_.IPAddress -notmatch '^127\.' -and
      $_.IPAddress -notmatch '^169\.254\.'
    } |
    Select-Object -ExpandProperty IPAddress -First 1

  if ($preferred) {
    return $preferred
  }

  $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notmatch '^127\.' -and
      $_.IPAddress -notmatch '^169\.254\.' -and
      $_.InterfaceAlias -notmatch 'Loopback'
    } |
    Select-Object -ExpandProperty IPAddress -First 1

  return $fallback
}

function Initialize-RemoteEnv {
  param([string]$Root)

  $paths = Ensure-EnvFile -Root $Root
  $values = Read-EnvFile -Path $paths.EnvPath
  $lanIp = Get-BestLanIPv4

  if (-not $lanIp) {
    throw "Could not detect a LAN IPv4 address. Connect this PC to Wi-Fi or Ethernet, then rerun setup."
  }

  $desired = [ordered]@{
    PUBLIC_BASE_URL = "http://$lanIp`:8787"
    OPENCODE_BASE_URL = "http://127.0.0.1:4096"
    GATEWAY_HOST = "0.0.0.0"
    GATEWAY_PORT = "8787"
    STATE_FILE = "./data/gateway-state.json"
  }

  foreach ($key in $desired.Keys) {
    if ((-not $values.ContainsKey($key)) -or (Test-PlaceholderEnvValue -Key $key -Value ([string]$values[$key]))) {
      $values[$key] = $desired[$key]
    }
  }

  $generatedPassword = $false
  if ((-not $values.ContainsKey("OPENCODE_PASSWORD")) -or (Test-PlaceholderEnvValue -Key "OPENCODE_PASSWORD" -Value ([string]$values["OPENCODE_PASSWORD"]))) {
    $values["OPENCODE_PASSWORD"] = New-RandomSecret -Bytes 18
    $generatedPassword = $true
  }

  $generatedJwt = $false
  if ((-not $values.ContainsKey("JWT_SECRET")) -or (Test-PlaceholderEnvValue -Key "JWT_SECRET" -Value ([string]$values["JWT_SECRET"]))) {
    $values["JWT_SECRET"] = New-RandomSecret -Bytes 32
    $generatedJwt = $true
  }

  if (-not $values.ContainsKey("OPENCODE_BIN") -or [string]::IsNullOrWhiteSpace([string]$values["OPENCODE_BIN"])) {
    $values["OPENCODE_BIN"] = "opencode"
  }

  Write-EnvFile -Path $paths.EnvPath -Values $values -ExamplePath $paths.ExamplePath
  Import-EnvToProcess -Values $values

  return @{
    EnvPath = $paths.EnvPath
    ExamplePath = $paths.ExamplePath
    Values = $values
    LanIp = $lanIp
    GeneratedPassword = $generatedPassword
    GeneratedJwt = $generatedJwt
  }
}

function Get-LogPaths {
  param([string]$Root)
  $logsDir = Join-Path $Root "data\logs"
  Ensure-Directory -Path $logsDir
  return @{
    LogsDir = $logsDir
    OpenCodeOut = (Join-Path $logsDir "opencode.out.log")
    OpenCodeErr = (Join-Path $logsDir "opencode.err.log")
    GatewayOut = (Join-Path $logsDir "gateway.out.log")
    GatewayErr = (Join-Path $logsDir "gateway.err.log")
  }
}

function Ensure-StateDirectory {
  param([hashtable]$EnvValues, [string]$Root)
  $statePath = [string]$EnvValues["STATE_FILE"]
  if (-not [System.IO.Path]::IsPathRooted($statePath)) {
    $statePath = Join-Path $Root $statePath
  }
  $stateDir = Split-Path -Parent $statePath
  Ensure-Directory -Path $stateDir
}

function Start-OpenCodeService {
  param(
    [string]$Root,
    [hashtable]$EnvValues,
    [hashtable]$Logs
  )

  if (Test-ListeningPort -Port 4096) {
    return @{
      Started = $false
      Reason = "already-running"
      Port = 4096
    }
  }

  $commandName = if ($EnvValues.ContainsKey("OPENCODE_BIN") -and -not [string]::IsNullOrWhiteSpace([string]$EnvValues["OPENCODE_BIN"])) {
    [string]$EnvValues["OPENCODE_BIN"]
  } else {
    "opencode"
  }

  $commandPath = if ([System.IO.Path]::IsPathRooted($commandName) -and (Test-Path $commandName)) {
    $commandName
  } else {
    Resolve-CommandPath -Name $commandName
  }
  if (-not $commandPath) {
    throw "Could not find OpenCode binary '$commandName'."
  }

  $startCommandPath = $commandPath
  $startArguments = @("serve", "--hostname", "127.0.0.1", "--port", "4096")

  if ([System.IO.Path]::GetExtension($commandPath).Equals(".ps1", [System.StringComparison]::OrdinalIgnoreCase)) {
    $powerShellPath = Resolve-CommandPath -Name "powershell.exe"
    if (-not $powerShellPath) {
      $powerShellPath = "powershell.exe"
    }

    $startCommandPath = $powerShellPath
    $startArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $commandPath) + $startArguments
  }

  Start-Process -FilePath $startCommandPath `
    -ArgumentList $startArguments `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $Logs.OpenCodeOut `
    -RedirectStandardError $Logs.OpenCodeErr | Out-Null

  return @{
    Started = $true
    Reason = "started"
    Port = 4096
  }
}

function Start-GatewayService {
  param(
    [string]$Root,
    [hashtable]$Logs
  )

  if (Test-ListeningPort -Port 8787) {
    return @{
      Started = $false
      Reason = "already-running"
      Port = 8787
    }
  }

  $npmPath = Resolve-CommandPath -Name "npm.cmd"
  if (-not $npmPath) {
    $npmPath = Resolve-CommandPath -Name "npm"
  }
  if (-not $npmPath) {
    throw "Could not find npm."
  }

  Start-Process -FilePath $npmPath `
    -ArgumentList @("run", "dev:gateway") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $Logs.GatewayOut `
    -RedirectStandardError $Logs.GatewayErr | Out-Null

  return @{
    Started = $true
    Reason = "started"
    Port = 8787
  }
}

function Wait-ForHttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
      if ($response.ok -eq $true) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-FirewallRule {
  param(
    [int]$Port,
    [string]$RuleName = "OpenCode Remote 8787"
  )

  $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($rule) {
    Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Profile Private -Action Allow -Direction Inbound | Out-Null
    return
  }

  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private | Out-Null
}

function Get-ManualFirewallCommand {
  param([int]$Port)
  return "New-NetFirewallRule -DisplayName `"OpenCode Remote $Port`" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private"
}

function Get-StartupFolderPath {
  return [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
}

function Get-RemoteStartupShortcutPath {
  param([string]$ItemName = "OpenCode Remote.lnk")

  $startupFolder = Get-StartupFolderPath
  if ([string]::IsNullOrWhiteSpace($startupFolder)) {
    throw "Could not resolve the current user's Windows Startup folder."
  }

  return (Join-Path $startupFolder $ItemName)
}

function Test-RemoteStartupShortcut {
  param([string]$ItemName = "OpenCode Remote.lnk")

  $shortcutPath = Get-RemoteStartupShortcutPath -ItemName $ItemName
  return (Test-Path $shortcutPath)
}

function Set-RemoteStartupShortcut {
  param(
    [string]$Root,
    [string]$ItemName = "OpenCode Remote.lnk"
  )

  $shortcutPath = Get-RemoteStartupShortcutPath -ItemName $ItemName
  $startScriptPath = Join-Path $Root "scripts\start-remote.ps1"
  if (-not (Test-Path $startScriptPath)) {
    throw "Missing startup script at $startScriptPath"
  }

  $powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path $powerShellPath)) {
    $powerShellPath = "powershell.exe"
  }

  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScriptPath`""
  $shell = $null

  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powerShellPath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = "Starts OpenCode Remote when you sign in to Windows."
    $shortcut.IconLocation = $powerShellPath
    $shortcut.Save()
  } finally {
    if ($null -ne $shell) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    }
  }

  return $shortcutPath
}

function Remove-RemoteStartupShortcut {
  param([string]$ItemName = "OpenCode Remote.lnk")

  $shortcutPath = Get-RemoteStartupShortcutPath -ItemName $ItemName
  if (Test-Path $shortcutPath) {
    Remove-Item -Path $shortcutPath -Force
    return $true
  }

  return $false
}
