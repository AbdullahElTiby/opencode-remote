$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $repoRoot "apps/mobile"
$androidRoot = Join-Path $mobileRoot "android"
$toolchainsRoot = Join-Path $repoRoot ".toolchains"

$env:JAVA_HOME = Join-Path $toolchainsRoot "jdk-17.0.18+8"
$env:ANDROID_SDK_ROOT = Join-Path $toolchainsRoot "android-sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:EXPO_NO_METRO_WORKSPACE_ROOT = "1"
$env:NODE_ENV = "production"

Push-Location $androidRoot
try {
  & .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle assembleRelease failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$releaseApk = Join-Path $androidRoot "app/build/outputs/apk/release/app-release.apk"
$copiedApk = Join-Path $repoRoot "OpenCodeRemote-release.apk"

Copy-Item $releaseApk $copiedApk -Force
$hash = Get-FileHash $copiedApk -Algorithm SHA256

Write-Output "Release APK: $copiedApk"
Write-Output "SHA256: $($hash.Hash)"
