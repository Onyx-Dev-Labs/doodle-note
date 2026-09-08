import SwiftUI

struct CloudSyncView: View {
    @Bindable var cloud: CloudSyncCoordinator
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @Environment(\.dismiss) private var dismiss
    @State private var createLibrary = false
    @State private var confirmSignOut = false
    @State private var legacySelection: Set<UUID> = []
    @State private var confirmAdoption = false
    @State private var reviewNote: UUID?
    private var captureActive: Bool { recording.busy || recording.noteID != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section("Optional cloud sync") {
                    Text("Only notes in the cloud library you choose are synced. Local-only notes are never uploaded automatically.")
                    Text("Recordings and voice profiles stay on their original device. Transcripts, typed notes, summaries and drawings can sync.")
                    Text(L10n.message(cloud.status)).accessibilityIdentifier("cloudSyncStatus")
                    if cloud.busy { ProgressView("Working…") }
                }
                if let connection = cloud.connection, connection.authenticated {
                    Section("Connected workspace") {
                        Text(connection.account.workspaceName)
                        if !connection.account.entitled { Text("Your account library remains available locally while cloud sync is paused.") }
                        ForEach(connection.account.libraries) { item in
                            Button(item.id == connection.selectedLibraryID ? L10n.key("Use selected cloud library") : L10n.format("Use cloud library %@", String(item.id.uuidString.prefix(8)))) {
                                Task { await cloud.select(item.id, library: library, recording: recording) }
                            }.disabled(cloud.busy || captureActive || !connection.account.entitled)
                        }
                        Button("Create a separate cloud library") { createLibrary = true }
                            .disabled(cloud.busy || captureActive || !connection.account.entitled)
                        if let selected = connection.selectedLibraryID, connection.paused {
                            Button("Resume sync") { Task { await cloud.select(selected, library: library, recording: recording) } }
                                .disabled(cloud.busy || captureActive)
                        } else {
                            Button("Sync now") { Task { await cloud.synchronize(library: library) } }.disabled(cloud.busy)
                            Button("Pause sync") { Task { await cloud.pause() } }
                        }
                        Button("Reconnect account") { Task { await cloud.connect(library: library, recording: recording) } }
                            .disabled(cloud.busy || captureActive)
                        Button("Sign out and lock account notes", role: .destructive) { confirmSignOut = true }
                            .disabled(cloud.busy || captureActive)
                    }
                } else {
                    Button("Connect account") { Task { await cloud.connect(library: library, recording: recording) } }
                        .disabled(cloud.busy || captureActive).accessibilityIdentifier("connectCloudAccount")
                }
                if !cloud.report.conflicts.isEmpty {
                    Section("Versions to review") {
                        Text("Choose which version becomes current. The other version remains in cloud history.")
                        ForEach(Array(cloud.report.conflicts).sorted(by: { $0.uuidString < $1.uuidString }), id: \.self) { id in
                            Button(library.note(id)?.title ?? L10n.key("Review note")) {
                                reviewNote = id
                                Task { await cloud.previewConflict(id, library: library) }
                            }
                        }
                        if let id = reviewNote {
                            Text("Device version").font(.headline)
                            Text(library.note(id)?.text ?? L10n.key("This note is unavailable."))
                            Text("Current cloud version").font(.headline)
                            Text(cloud.cloudVersionText ?? L10n.key("Loading version…"))
                            Button("Keep device version as current") { Task { await cloud.resolve(id, keepDevice: true, library: library); reviewNote = nil } }
                                .disabled(cloud.busy || captureActive)
                            Button("Use current cloud version") { Task { await cloud.resolve(id, keepDevice: false, library: library); reviewNote = nil } }
                                .disabled(cloud.busy || captureActive || cloud.cloudVersionText == nil)
                        }
                    }
                }
                if cloud.connection?.authenticated == true, cloud.connection?.selectedLibraryID != nil {
                    Section("Existing desktop notes") {
                        Text("Review and select desktop notes to add to this cloud library. Original IDs and full stored transcripts are retained. Imported legacy notes are read-only.")
                        Button("Find desktop notes") { Task { legacySelection = []; await cloud.discoverLegacy() } }.disabled(cloud.busy)
                        if let page = cloud.legacy {
                            Text(L10n.format("%lld desktop notes available", page.total))
                            ForEach(page.notes) { note in
                                Toggle(isOn: Binding(get: { legacySelection.contains(note.id) }, set: { selected in
                                    if selected { legacySelection.insert(note.id) } else { legacySelection.remove(note.id) }
                                })) {
                                    VStack(alignment: .leading) { Text(note.title); Text(L10n.format("%lld transcript passages", note.transcriptCount)).font(.caption) }
                                }
                            }
                            Button("Import selected notes") { confirmAdoption = true }.disabled(legacySelection.isEmpty || cloud.busy)
                            if page.next != nil { Button("Next page") { Task { legacySelection = []; await cloud.discoverLegacy(next: true) } }.disabled(cloud.busy) }
                        }
                    }
                }
                if captureActive { Text("Stop recording before changing cloud accounts or libraries.") }
            }
            .navigationTitle("Cloud sync")
            .toolbar { Button("Done") { dismiss() } }
            .confirmationDialog("Import selected desktop notes?", isPresented: $confirmAdoption, titleVisibility: .visible) {
                Button("Import selected notes") { Task { await cloud.adopt(Array(legacySelection), library: library); legacySelection = [] } }
            } message: { Text("These notes will use the shared cloud version history. Older desktop editors cannot overwrite their richer content after import. Local-only mobile notes are unchanged.") }
            .confirmationDialog("Create an empty cloud library?", isPresented: $createLibrary, titleVisibility: .visible) {
                Button("Create cloud library") { Task { await cloud.select(UUID(), library: library, recording: recording) } }
            } message: { Text("Existing local notes stay in their current library. New notes created in the cloud library will sync when the service is available.") }
            .confirmationDialog("Sign out and lock account notes?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await cloud.signOut(library: library, recording: recording) } }
            } message: { Text("Local-only notes stay available. Reconnect the same account to reopen its cached notes.") }
        }
    }
}
