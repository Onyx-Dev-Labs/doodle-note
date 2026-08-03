$ErrorActionPreference = "Stop"

$releaseDir = Join-Path $PSScriptRoot "..\release"
$installer = Get-ChildItem (Join-Path $releaseDir "DoodleNote-*-setup.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No DoodleNote Windows installer found. Run pnpm package:win first."
}

$signature = Get-AuthenticodeSignature $installer.FullName
if ($signature.Status -ne "Valid") {
  throw "Refusing to publish unsigned Windows installer $($installer.Name): $($signature.Status)"
}

Write-Host "Authenticode valid: $($signature.SignerCertificate.Subject)"
