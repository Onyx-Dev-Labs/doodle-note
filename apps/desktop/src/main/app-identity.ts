import identities from '../shared/app-identities.json'

/**
 * Which app identity this build carries. Baked in at build time by electron-vite
 * (`DOODLENOTE_QA_IDENTITY=1`, together with electron-builder.qa.cjs), so a QA
 * build can be installed, upgraded and migrated in a real Windows account
 * without touching the production install, profile, login item or MCP client
 * configs. Anything not built as QA is production. Every identity-bearing name
 * derives from the entry in src/shared/app-identities.json, which the
 * electron-builder overlay reads too.
 */
declare const __DOODLENOTE_IDENTITY__: string | undefined

export type AppIdentityName = keyof typeof identities

export interface AppIdentity {
  name: AppIdentityName
  /** electron-builder appId; the NSIS APP_GUID, uninstall key and migration journal derive from it. */
  appId: string
  productName: string
  /** package.json name: the packaged app name, so the profile is %APPDATA%\<packageName>. */
  packageName: string
  /** Windows AppUserModelID: taskbar grouping, notifications, and the login item. */
  appUserModelId: string
  /**
   * The HKCU\...\Run value "Open at login" writes. Electron reads the value named
   * after the AppUserModelID, so the two must stay equal.
   */
  loginItemName: string
  /** Per-user install folder under <UserProgramFiles> (electron-builder's PRODUCT_FILENAME). */
  installFolder: string
  /** The folder builds before the rename installed to (named after the package). */
  legacyInstallFolder: string
  /** The entry our MCP server is registered under in client configs. */
  mcpServerKey: string
  /**
   * The MCP opt-in file and client configs live in a sandbox inside the profile
   * instead of the real home directory, so a QA build never edits them.
   */
  isolatesAgentAccess: boolean
  /** Only production may contact an update feed. */
  updatesAllowed: boolean
}

export function appIdentity(name: AppIdentityName): AppIdentity {
  const base = identities[name]
  return {
    name,
    appId: base.appId,
    productName: base.productName,
    packageName: base.packageName,
    appUserModelId: base.appId,
    loginItemName: base.appId,
    installFolder: base.productName,
    legacyInstallFolder: base.packageName,
    mcpServerKey: base.mcpServerKey,
    isolatesAgentAccess: name !== 'production',
    updatesAllowed: name === 'production'
  }
}

export const APP_IDENTITY: AppIdentity = appIdentity(
  typeof __DOODLENOTE_IDENTITY__ === 'string' && __DOODLENOTE_IDENTITY__ === 'qa'
    ? 'qa'
    : 'production'
)

/**
 * A packaged Windows build must run under the identity its code was built for:
 * production code packaged with the QA overlay (or the reverse) would write the
 * other identity's login item and MCP entries. The packaged app name is the
 * package name electron-builder wrote into app.asar.
 */
export function identityMismatch(packagedAppName: string, identity = APP_IDENTITY): string | null {
  if (packagedAppName === identity.packageName) return null
  return `This build's code is the ${identity.name} identity (${identity.packageName}) but it was packaged as ${packagedAppName}.`
}
