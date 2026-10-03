import SwiftUI

struct StorageView: View {
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @Environment(\.dismiss) private var dismiss
    @State private var deleting: NoteRecord?
    private var blocked: Bool { recording.busy || recording.noteID != nil || library.storageBusy }

    var body: some View {
        NavigationStack {
            List {
                Section("On this device") {
                    Text(library.selectedLibraryID == LibraryRecord.localID ? L10n.text("Only on this device") : library.libraries.first(where: { $0.id == library.selectedLibraryID })?.name ?? L10n.text("Library"))
                    if let usage = library.storage {
                        LabeledContent("Notes, ink and history", value: L10n.bytes(usage.notesBytes))
                        LabeledContent("Audio", value: L10n.bytes(usage.audioBytes))
                        if let free = usage.availableBytes {
                            LabeledContent("Device space available", value: L10n.bytes(free))
                        }
                        if usage.lowSpace { Text("Device space is low. Remove unneeded local audio or permanently delete items in Trash.").foregroundStyle(.orange) }
                    } else { ProgressView("Checking storage…") }
                    Text("Audio stays on its original device. Removing audio keeps your text, transcript, ink and summary versions.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    NavigationLink("Backup & restore") { ArchiveView(library: library) }
                        .disabled(blocked).accessibilityIdentifier("archiveSettings")
                }
                Section("Trash") {
                    if library.trashNotes.isEmpty { Text("Trash is empty").foregroundStyle(.secondary) }
                    ForEach(library.trashNotes) { note in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(note.title.isEmpty ? L10n.text("Untitled note") : note.title).font(.headline)
                            if let state = library.lifecycle[note.id] {
                                if state.clock == .provisionalAccount {
                                    Text("Recovery timing awaits cloud confirmation.").font(.caption)
                                } else if let expiry = state.expiresAt {
                                    Text("Recover until \(L10n.date(expiry))").font(.caption)
                                }
                            }
                            HStack {
                                Button("Restore") { Task { await library.performStorage(.restore, id: note.id, captureActive: blocked) } }
                                    .buttonStyle(.bordered).accessibilityIdentifier("restore-\(note.title)")
                                Spacer()
                                Button("Delete permanently", role: .destructive) { deleting = note }
                                    .buttonStyle(.bordered)
                            }.disabled(blocked)
                        }.padding(.vertical, 4)
                    }
                    Text("Trash retains notes and local audio for 30 days. Expired local items are removed when DoodleNote next runs. This does not erase exported backups or devices that are powered off.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if library.cleanupPending {
                    Section {
                        Text("Some local cleanup is pending.").foregroundStyle(.orange)
                        Button("Retry cleanup") { Task { await library.processRetention(captureActive: blocked); await library.refreshStorage() } }
                            .disabled(blocked)
                    }
                }
                if let error = library.storageProblem ?? library.problem { Text(L10n.message(error)).foregroundStyle(.red).font(.callout) }
            }
            .navigationTitle(L10n.text("Storage & Trash"))
            .toolbar { Button("Done") { dismiss() } }
            .task { await library.refreshLifecycle(); await library.refreshStorage() }
            .alert("Permanently delete this note and its local audio?", isPresented: Binding(
                get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
                if let note = deleting {
                    Button("Delete permanently", role: .destructive) {
                        Task { await library.performStorage(.purge, id: note.id, confirmed: true, captureActive: blocked) }
                        deleting = nil
                    }
                }
                Button("Cancel", role: .cancel) { deleting = nil }
            } message: { Text("This removes this device's note, ink, history and audio. It cannot be undone here. Exported backups are not erased.") }
        }
    }
}
