import SwiftUI
import SwiftData

/// The Cloud sync section of Settings: link/unlink this phone and sync now.
struct SyncSettingsSection: View {
    @Environment(\.modelContext) private var context
    @State private var sync = SyncEngine.shared

    var body: some View {
        Section {
            if sync.isLinked {
                LabeledContent("Account") {
                    Text(sync.linkedEmail ?? "Linked")
                }
                LabeledContent("Workspace") {
                    Text(sync.workspaceName ?? "—")
                }
                Button {
                    Task { await sync.syncNow(context: context) }
                } label: {
                    HStack {
                        Text(sync.isSyncing ? "Syncing…" : "Sync now")
                        if sync.isSyncing {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(sync.isSyncing)
                Button("Unlink this phone", role: .destructive) {
                    sync.unlink()
                }
            } else {
                Button {
                    Task { await sync.link() }
                } label: {
                    HStack {
                        Label(
                            sync.isLinking
                                ? "Finish signing in with Safari…"
                                : "Link to your DoodleNote account",
                            systemImage: "icloud"
                        )
                        if sync.isLinking {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(sync.isLinking)
            }
        } header: {
            Text("Cloud sync")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if let error = sync.lastError {
                    Text(error).foregroundStyle(.red)
                }
                if let synced = sync.lastSyncedAt {
                    Text("Last synced \(synced, format: .relative(presentation: .named)).")
                }
                Text(sync.isLinked
                    ? "Meetings recorded on this phone sync to your workspace and appear on your other devices."
                    : "Optional. Sign in on doodlenote.ai to sync meetings across your devices.")
            }
        }
    }
}
