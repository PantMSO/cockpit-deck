# Builds icons + profiles, then packs dist\com.local.cockpitdeck.streamDeckPlugin
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$plugin = Join-Path $root 'com.local.cockpitdeck.sdPlugin'
$dist = Join-Path $root 'dist'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

node (Join-Path $PSScriptRoot 'build.js')
if ($LASTEXITCODE -ne 0) { throw 'build.js failed' }

# Zip a folder's contents with forward-slash entry names (what Stream Deck expects).
function New-Zip([string]$srcDir, [string]$zipPath, [string]$prefix) {
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($srcDir.Length).TrimStart('\').Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, "$prefix$rel", 'Optimal')
    }
  } finally { $zip.Dispose() }
}

# Profiles go inside the plugin folder.
Get-ChildItem (Join-Path $root 'build\profiles') -Directory | ForEach-Object {
  New-Zip $_.FullName (Join-Path $plugin "$($_.Name).streamDeckProfile") ''
}

# Drop native binaries for other platforms to keep the package small.
$koffiBuild = Join-Path $plugin 'node_modules\koffi\build\koffi'
if (Test-Path $koffiBuild) { Get-ChildItem $koffiBuild -Directory | Where-Object Name -ne 'win32_x64' | Remove-Item -Recurse -Force }

New-Item -ItemType Directory -Force $dist | Out-Null
New-Zip $plugin (Join-Path $dist 'com.local.cockpitdeck.streamDeckPlugin') 'com.local.cockpitdeck.sdPlugin/'
Get-Item (Join-Path $dist 'com.local.cockpitdeck.streamDeckPlugin') | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
