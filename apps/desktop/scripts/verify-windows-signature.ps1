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

# Bark's helper ships beside the app as a separate exe; it must be signed too, or
# Application Control / Smart App Control will refuse to run it on users' machines.
$helper = Join-Path $releaseDir "win-unpacked\resources\engine\dictation-helper.exe"
if (-not (Test-Path $helper)) {
  throw "The dictation helper is missing from the package: $helper"
}
$helperSignature = Get-AuthenticodeSignature $helper
if ($helperSignature.Status -ne "Valid") {
  throw "Refusing to publish: the dictation helper is not validly signed: $($helperSignature.Status)"
}
Write-Host "Dictation helper Authenticode valid: $($helperSignature.SignerCertificate.Subject)"
