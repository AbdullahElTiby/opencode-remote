$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "remote-common.ps1")

$root = Split-Path -Parent $PSScriptRoot
Assert-PowerShellVersion
Assert-RepoRoot -Root $root

$envPaths = Ensure-EnvFile -Root $root
$envValues = Read-EnvFile -Path $envPaths.EnvPath
Import-EnvToProcess -Values $envValues
Ensure-StateDirectory -EnvValues $envValues -Root $root
$logs = Get-LogPaths -Root $root

$openCodeResult = Start-OpenCodeService -Root $root -EnvValues $envValues -Logs $logs
$gatewayResult = Start-GatewayService -Root $root -Logs $logs

Write-Output "OpenCode Remote startup triggered."
Write-Output "Pairing page: http://localhost:8787"
Write-Output "Phone server URL: $($envValues['PUBLIC_BASE_URL'])"
Write-Output "OpenCode: $($openCodeResult.Reason)"
Write-Output "Gateway: $($gatewayResult.Reason)"
Write-Output "Logs:"
Write-Output "  $($logs.OpenCodeOut)"
Write-Output "  $($logs.OpenCodeErr)"
Write-Output "  $($logs.GatewayOut)"
Write-Output "  $($logs.GatewayErr)"
