/** Permanent invite to the DoodleNote Discord: help, updates and QA. */
export const COMMUNITY_URL = 'https://discord.gg/2tjEBUcTr'
export const COMMUNITY_LABEL = 'Join our community'

/** Opens in the system browser; the app's window-open handler hands it off. */
export function openCommunity(): void {
  window.open(COMMUNITY_URL)
}
