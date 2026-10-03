export function buildWindowsBetaManifests(manifest, installerName) {
  const betaInstallerName = installerName.replace(/-setup\.exe$/, '-beta-setup.exe')
  const body = manifest.split(installerName).join(betaInstallerName)

  return [
    { pathname: 'updates/beta.yml', body },
    { pathname: 'updates/latest-beta.yml', body }
  ]
}
