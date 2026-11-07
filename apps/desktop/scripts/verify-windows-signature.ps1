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
$appDir = Join-Path $releaseDir "win-unpacked"
$helper = Join-Path $appDir "resources\engine\dictation-helper.exe"
if (-not (Test-Path $helper)) {
  throw "The dictation helper is missing from the package: $helper"
}
$helperSignature = Get-AuthenticodeSignature $helper
if ($helperSignature.Status -ne "Valid") {
  throw "Refusing to publish: the dictation helper is not validly signed: $($helperSignature.Status)"
}
Write-Host "Dictation helper Authenticode valid: $($helperSignature.SignerCertificate.Subject)"

# After signing, the packaged helper must still match the build's signing-invariant digest, and its
# signer must be exactly the publisher and certificate the build recorded (the values the app has
# baked in and enforces at run time). The digest is recomputed with the same code the build used.
$manifestPath = Join-Path $releaseDir "win-unpacked\resources\engine\dictation-helper.manifest.json"
if (-not (Test-Path $manifestPath)) {
  throw "The dictation helper manifest is missing from the package: $manifestPath"
}
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$env:DN_HELPER_PATH = $helper
$digest = (node -e "process.stdout.write(require(process.argv[1]).stableDigest(require('fs').readFileSync(process.env.DN_HELPER_PATH)) || '')" (Join-Path $PSScriptRoot "authenticode-digest.mjs"))
if ($LASTEXITCODE -ne 0 -or -not $digest) { throw "Could not recompute the dictation helper digest" }
if ($digest -ne $manifest.authenticodeSha256) {
  throw "Refusing to publish: the signed dictation helper digest $digest does not match the build's $($manifest.authenticodeSha256)"
}
$signerCn = $helperSignature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($signerCn -ne $manifest.publisherCn) {
  throw "Refusing to publish: the dictation helper is signed by '$signerCn', but the build expects '$($manifest.publisherCn)'"
}
if (-not ($manifest.thumbprints -contains $helperSignature.SignerCertificate.Thumbprint)) {
  throw "Refusing to publish: the dictation helper signer certificate is not the one the build recorded"
}
Write-Host "Dictation helper digest and signer match the build ($signerCn)"

# Every other portable executable the app ships (app exe, Electron DLLs, native
# modules, ONNX/llama runtimes) is loaded under the same Code Integrity policy.
# Vendor-signed files keep their vendor's valid signature; nothing may be unsigned.
$pe = Get-ChildItem -LiteralPath $appDir -Recurse -File |
  Where-Object { $_.Extension -in @(".exe", ".dll", ".node") }
$invalid = @()
foreach ($file in $pe) {
  $status = (Get-AuthenticodeSignature -LiteralPath $file.FullName).Status
  if ($status -ne "Valid") {
    $invalid += "$($file.FullName.Substring($appDir.Length + 1)): $status"
  }
}
if ($invalid.Count -gt 0) {
  $invalid | ForEach-Object { Write-Host "  $_" }
  throw "Refusing to publish: $($invalid.Count) of $($pe.Count) shipped PE files are not validly signed"
}
Write-Host "All $($pe.Count) shipped PE files (exe/dll/node) are validly signed"
