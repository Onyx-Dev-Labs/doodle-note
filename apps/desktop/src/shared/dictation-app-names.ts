/**
 * Friendly names for the apps the style lists name by bundle identifier. The
 * helper supplies the real name and icon of an app that is installed; this table
 * is only for the ones that are not, and for the settings page before the helper
 * has answered.
 */
const NAMES: Record<string, string> = {
  'com.apple.MobileSMS': 'Messages',
  'net.whatsapp.WhatsApp': 'WhatsApp',
  'ru.keepcoder.Telegram': 'Telegram',
  'org.telegram.desktop': 'Telegram Desktop',
  'com.hnc.Discord': 'Discord',
  'org.whispersystems.signal-desktop': 'Signal',
  'com.facebook.archon.developerID': 'Messenger (older version)',
  'com.facebook.Messenger': 'Messenger',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.microsoft.teams2': 'Microsoft Teams',
  'com.microsoft.teams': 'Microsoft Teams (classic)',
  'Cisco-Systems.Spark': 'Webex',
  'us.zoom.xos': 'Zoom',
  'com.linear': 'Linear',
  'com.apple.mail': 'Mail',
  'com.microsoft.Outlook': 'Outlook',
  'com.readdle.smartemail-Mac': 'Spark',
  'com.freron.MailMate': 'MailMate',
  'it.bloop.airmail2': 'Airmail',
  'com.superhuman.electron': 'Superhuman',
  'com.google.Chrome': 'Google Chrome',
  'com.apple.Safari': 'Safari',
  'org.mozilla.firefox': 'Firefox',
  'company.thebrowser.Browser': 'Arc',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'com.apple.Notes': 'Notes',
  'com.apple.TextEdit': 'TextEdit',
  'com.microsoft.VSCode': 'Visual Studio Code',
  'notion.id': 'Notion',
  'md.obsidian': 'Obsidian',
  // Windows: the executable names the Windows helper reports.
  'whatsapp.exe': 'WhatsApp',
  'whatsapp.root.exe': 'WhatsApp',
  'telegram.exe': 'Telegram Desktop',
  'discord.exe': 'Discord',
  'signal.exe': 'Signal',
  'messenger.exe': 'Messenger',
  'slack.exe': 'Slack',
  'ms-teams.exe': 'Microsoft Teams',
  'teams.exe': 'Microsoft Teams (classic)',
  'ciscocollabhost.exe': 'Webex',
  'webex.exe': 'Webex',
  'zoom.exe': 'Zoom',
  'linear.exe': 'Linear',
  'outlook.exe': 'Outlook (classic)',
  'olk.exe': 'Outlook',
  'hxoutlook.exe': 'Mail',
  'thunderbird.exe': 'Thunderbird',
  'mailbird.exe': 'Mailbird',
  'superhuman.exe': 'Superhuman',
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'notepad.exe': 'Notepad',
  'code.exe': 'Visual Studio Code',
  'winword.exe': 'Word',
  'notion.exe': 'Notion',
  'obsidian.exe': 'Obsidian'
}

const byLowerId = new Map(Object.entries(NAMES).map(([id, name]) => [id.toLowerCase(), name]))

/** A known name for a bundle identifier, or null. */
export function fallbackAppName(bundleId: string): string | null {
  return byLowerId.get(bundleId.trim().toLowerCase()) ?? null
}

/**
 * Which of a category's apps to list. The built-in lists name apps people may not
 * have, so a built-in app is listed only when it is installed on this Mac; an app
 * the person added is always listed. `known` is what the helper reported for each
 * app (a name or an icon means installed); null means the helper cannot say, so
 * everything is listed rather than nothing. `hidden` counts the built-in apps left out.
 */
export function visibleApps<T extends { bundleId: string; builtin: boolean }>(
  apps: readonly T[],
  known: Record<string, { name: string | null; icon: string | null }> | null
): { shown: T[]; hidden: number } {
  if (known === null) return { shown: [...apps], hidden: 0 }
  const installed = (id: string): boolean => Boolean(known[id]?.name || known[id]?.icon)
  const shown = apps.filter((app) => !app.builtin || installed(app.bundleId))
  return { shown, hidden: apps.length - shown.length }
}

/** What an app is shown as: the system's name, else one the app reported, else ours, else its identifier. */
export function appDisplayName(
  bundleId: string,
  systemName: string | null | undefined,
  recentName: string | null | undefined
): string {
  return systemName || recentName || fallbackAppName(bundleId) || bundleId
}
