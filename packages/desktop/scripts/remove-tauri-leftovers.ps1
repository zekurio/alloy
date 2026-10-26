# Removes what the Tauri build of Alloy leaves behind after the Electron build
# has replaced it. Temporary: delete this script together with latest.json once
# no Tauri installs remain (see .github/RELEASING.md).
#
# Run it after installing the Electron build:
#
#   powershell -ExecutionPolicy Bypass -File remove-tauri-leftovers.ps1
#
# Add -WhatIf to list what it would remove. It removes only what the Tauri
# build owned:
#
# - %LOCALAPPDATA%\Alloy, the Tauri build's install folder
# - %LOCALAPPDATA%\dev.zekurio.alloy\EBWebView and \webviews, its WebView2
#   profiles, which still hold its session cookies
# - HKCU\Software\zekurio\Alloy, its installer's settings
#
# Settings, saved servers, the capture library, and logs are shared with the
# Electron build and stay.

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = "Stop"

if (Get-Process -Name "alloy-desktop" -ErrorAction SilentlyContinue) {
  throw "The Tauri build of Alloy is running. Quit it from the tray, then run this again."
}
$tauriInstall = Get-ItemProperty `
  -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Alloy" `
  -Name "MainBinaryName" `
  -ErrorAction SilentlyContinue
if ($tauriInstall.MainBinaryName -eq "alloy-desktop.exe") {
  throw "The Tauri build of Alloy is still installed. Install the new Alloy first; its installer removes the Tauri build."
}

$local = [Environment]::GetFolderPath("LocalApplicationData")
$removed = 0
foreach ($path in @(
    (Join-Path $local "Alloy"),
    (Join-Path $local "dev.zekurio.alloy\EBWebView"),
    (Join-Path $local "dev.zekurio.alloy\webviews")
  )) {
  if ((Test-Path -LiteralPath $path) -and $PSCmdlet.ShouldProcess($path, "Remove folder")) {
    Remove-Item -LiteralPath $path -Recurse -Force
    Write-Host "Removed $path"
    $removed++
  }
}

$installerKey = "HKCU:\Software\zekurio\Alloy"
if ((Test-Path $installerKey) -and $PSCmdlet.ShouldProcess($installerKey, "Remove registry key")) {
  Remove-Item -Path $installerKey -Recurse -Force
  Write-Host "Removed $installerKey"
  $removed++
  $publisherKey = "HKCU:\Software\zekurio"
  if (-not (Get-ChildItem -Path $publisherKey) -and -not (Get-Item -Path $publisherKey).Property) {
    Remove-Item -Path $publisherKey -Force
  }
}

if ($removed -eq 0 -and -not $WhatIfPreference) {
  Write-Host "No Tauri leftovers found."
}
