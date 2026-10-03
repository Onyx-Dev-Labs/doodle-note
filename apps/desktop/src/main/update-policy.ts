export interface UpdatePolicyTarget {
  channel: string | null
  allowPrerelease: boolean
  allowDowngrade: boolean
}

export function publicUpdateErrorMessage(): string {
  return 'Could not check for updates. Please try again.'
}

/**
 * Windows is currently distributed through the public beta channel
 * (`beta.yml`). Other platforms retain electron-updater's configured default
 * channel.
 */
export function applyUpdatePolicy(
  updater: UpdatePolicyTarget,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return

  // Setting the channel opts electron-updater into downgrade support. Reset it
  // immediately so a stale beta manifest can never replace a newer install.
  updater.channel = 'beta'
  updater.allowPrerelease = true
  updater.allowDowngrade = false
}
