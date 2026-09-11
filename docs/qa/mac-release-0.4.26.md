# Mac release 0.4.26

Prepared for public release, superseding the unpublished 0.4.25 candidate.

Includes the accepted desktop feature integration in PR #163, the Google token handling fix in PR #164, and disabled Google connection controls pending verification approval. The Settings signed-out view, additional-provider view, and welcome tour all show a disabled grey Google button with an accessible explanation. Existing connected-account sync and disconnect remain available. Re-enabling new connections requires a subsequent release after approval.

Release highlights: automatic notes after Stop, Resume and regeneration, one dog/calendar tray with Compact and Full Island modes, local model reuse, clearer recording/setup feedback, and Cloud cancellation/retry. Google new connections are temporarily unavailable.

Package Mac separately from publishing. Validate Developer ID signature, notarization/stapling, final ZIP/DMG hashes, website feed and download routing. Keep Windows production publication on hold for Azure signing approval.

Native installed-app UI automation currently reports noWindowsAvailable; manual acceptance and actual updater relaunch remain separate from automated tests and artifact validation. Retain the prior Mac manifest and artifacts for rollback.
