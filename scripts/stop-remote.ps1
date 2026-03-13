$ErrorActionPreference = "SilentlyContinue"

$ports = 4096, 8787
foreach ($port in $ports) {
  Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force
  }
}

Write-Output "Stopped listeners on ports 4096 and 8787 if they were running."
