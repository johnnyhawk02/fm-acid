# Installs (or updates) the 303 Circuit Model VST3 on Windows from the latest GitHub release. In PowerShell:
#   irm https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.ps1 | iex
# It goes in C:\Program Files\Common Files\VST3, the folder every DAW scans, so Windows asks once for admin rights.
# To remove it, delete "C:\Program Files\Common Files\VST3\303 Circuit Model.vst3".
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on
$name = '303 Circuit Model'
$url = 'https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/303-Circuit-Model-windows.zip'
$tmp = Join-Path $env:TEMP ('303cm-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $name..."
  Invoke-WebRequest -Uri $url -OutFile "$tmp\plugin.zip" -UseBasicParsing
  Expand-Archive -Path "$tmp\plugin.zip" -DestinationPath "$tmp\x"
  Get-ChildItem -Recurse "$tmp\x" | Unblock-File
  $dest = Join-Path $env:CommonProgramFiles 'VST3'
  $docs = Join-Path $env:APPDATA $name
  New-Item -ItemType Directory -Force -Path $docs | Out-Null
  Copy-Item "$tmp\x\LICENSE", "$tmp\x\CREDITS.md", "$tmp\x\OFL.txt" $docs -ErrorAction SilentlyContinue
  $copy = "New-Item -ItemType Directory -Force -Path '$dest' | Out-Null; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '$dest\$name.vst3'; Copy-Item -Recurse '$tmp\x\$name.vst3' '$dest'"
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($admin) { Invoke-Expression $copy }
  else { Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $copy }
  if (-not (Test-Path "$dest\$name.vst3")) { throw "Could not copy the plug-in to $dest (was the admin prompt declined?)" }
  Write-Host "Installed: $dest\$name.vst3"
  # the screen runs in Microsoft Edge WebView2, built into Windows 11 and most up-to-date Windows 10
  $wv = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  $hasWv = (Test-Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") -or (Test-Path "HKLM:\$wv") -or (Test-Path "HKCU:\$wv")
  if (-not $hasWv) {
    Write-Host ''
    Write-Host 'Note: the plug-in screen needs the Microsoft Edge WebView2 Runtime, which was not found.'
    Write-Host 'Get it free from https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen Bootstrapper).'
  }
  Write-Host ''
  Write-Host "Done. Rescan plug-ins in your DAW (it is under '$name', maker '303 Circuit')."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
