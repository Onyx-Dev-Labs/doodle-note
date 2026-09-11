// Public release guard. Never print the credential or read it from tracked files.
if (!process.env.DOODLENOTE_GOOGLE_CLIENT_SECRET?.trim()) {
  console.error(
    'DOODLENOTE_GOOGLE_CLIENT_SECRET is required to package an official release with Google Calendar. Supply the Desktop client credential through secure build configuration.'
  )
  process.exit(1)
}
