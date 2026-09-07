import SwiftUI

struct CloudSyncView: View {
    @Bindable var cloud: CloudSyncCoordinator
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @Environment(\.dismiss) private var dismiss
    @State private var createLibrary = false
    @State private var confirmSignOut = false
    private var captureActive: Bool { recording.busy || recording.noteID != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section("Optional cloud sync") {
                    Text("Only notes in the cloud library you choose are synced. Local-only notes are never uploaded automatically.")
                    Text("Recordings and voice profiles stay on their original device. Transcripts, typed notes, summaries and drawings can sync.")
                    Text(cloud.status).accessibilityIdentifier("cloudSyncStatus")
                    if cloud.busy { ProgressView("Working…") }
                }
                if let connection = cloud.connection, connection.authenticated {
                    Section("Connected workspace") {
                        Text(connection.account.workspaceName)
                        if !connection.account.entitled { Text("Your account library remains available locally while cloud sync is paused.") }
                        ForEach(connection.account.libraries) { item in
                            Button(item.id == connection.selectedLibraryID ? "Use selected cloud library" : "Use cloud library \(item.id.uuidString.prefix(8))") {
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
                if captureActive { Text("Stop recording before changing cloud accounts or libraries.") }
            }
            .navigationTitle("Cloud sync")
            .toolbar { Button("Done") { dismiss() } }
            .confirmationDialog("Create an empty cloud library?", isPresented: $createLibrary, titleVisibility: .visible) {
                Button("Create cloud library") { Task { await cloud.select(UUID(), library: library, recording: recording) } }
            } message: { Text("Existing local notes stay in their current library. New notes created in the cloud library will sync when the service is available.") }
            .confirmationDialog("Sign out and lock account notes?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await cloud.signOut(library: library, recording: recording) } }
            } message: { Text("Local-only notes stay available. Reconnect the same account to reopen its cached notes.") }
        }
    }
}
