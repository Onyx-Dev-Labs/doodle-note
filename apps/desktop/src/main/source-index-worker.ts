// Separate bundled entry: worker_threads owns filesystem scans and SQLite, never Electron main.
import '@repo/meetings-store/source-index-worker'
