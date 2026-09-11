import SwiftUI
import UIKit

struct NoteExportView: View {
    let note: NoteRecord
    @Bindable var library: NoteLibrary
    @State private var access: NoteExportAccess
    @State private var invalidated = false
    @Environment(\.dismiss) private var dismiss
    @State private var selection = NoteExportSelection()
    @State private var format = NoteExportFormat.pdf
    @State private var busy = false
    @State private var problem: String?
    @State private var artifact: NoteExportArtifact?
    @State private var retainedArtifact: NoteExportArtifact?
    @State private var job: Task<NoteExportArtifact, Error>?

    init(note: NoteRecord, library: NoteLibrary) {
        self.note = note
        self.library = library
        _access = State(initialValue: NoteExportAccess(generation: library.authenticationGeneration,
            libraryID: library.selectedLibraryID))
    }

    private var noteAvailable: Bool {
        !invalidated && library.note(note.id)?.metadata?.libraryID == access.libraryID
    }

    private func invalidate() {
        invalidated = true
        job?.cancel()
        artifact = nil
        cleanup()
        dismiss()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Export format", selection: $format) {
                        ForEach(NoteExportFormat.allCases) { Text(L10n.key($0.label)).tag($0) }
                    }
                    Toggle("Personal notes", isOn: $selection.personal)
                    Toggle("Transcript", isOn: $selection.transcript)
                    Toggle("Drawing", isOn: $selection.ink)
                } footer: { Text("Exports use the current notes, transcript and drawing. Choose summary versions below. Audio and saved voices are never included.") }.disabled(busy)
                Section("Summary versions") {
                    if (note.metadata?.summaries ?? []).isEmpty { Text("No summary versions yet.").foregroundStyle(.secondary) }
                    ForEach(note.metadata?.summaries ?? []) { version in
                        Toggle(isOn: Binding(get: { selection.summaryIDs.contains(version.id) }, set: { included in
                            if included { selection.summaryIDs.insert(version.id) } else { selection.summaryIDs.remove(version.id) }
                        })) {
                            VStack(alignment: .leading) {
                                Text(L10n.key(MeetingFormat(rawValue: version.format)?.label ?? version.format))
                                Text(L10n.date(version.createdAt)).font(.caption)
                                Text(version.text).font(.caption).lineLimit(2)
                            }
                        }.accessibilityIdentifier("exportSummary-" + version.id.uuidString)
                    }
                }
                .disabled(busy)
                Section {
                    if busy {
                        ProgressView("Preparing export…")
                        Button("Cancel export", role: .cancel) { job?.cancel() }
                    } else {
                        Button("Prepare export", systemImage: "square.and.arrow.up") { prepare() }
                            .accessibilityIdentifier("prepareExport")
                    }
                    if let problem { Text(L10n.message(problem)).foregroundStyle(.orange).accessibilityIdentifier("exportStatus") }
                }
            }
            .navigationTitle("Share note")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { job?.cancel(); dismiss() } } }
            .interactiveDismissDisabled(busy)
            .sheet(item: $artifact, onDismiss: cleanup) { artifact in
                ExportActivityView(file: artifact.file) { completed, failed in
                    problem = failed ? "Sharing failed. Your original note is preserved." : (completed ? "Export shared." : "Sharing canceled. Your original note is preserved.")
                    self.artifact = nil
                }
            }
            .onAppear {
                NoteExporter.removeExpiredArtifacts()
                if let id = note.metadata?.selectedSummaryID { selection.summaryIDs = [id] }
            }
            .onChange(of: library.authenticationGeneration) { _, _ in invalidate() }
            .onChange(of: library.selectedLibraryID) { _, _ in invalidate() }
            .onChange(of: noteAvailable) { _, available in if !available { invalidate() } }
            .onDisappear { invalidated = true; job?.cancel(); cleanup() }
        }
    }

    private func prepare() {
        guard access.permits(generation: library.authenticationGeneration, libraryID: library.selectedLibraryID, noteAvailable: noteAvailable) else {
            invalidate()
            return
        }
        problem = nil
        do {
            let document = try NoteExportDocument(note: note, selection: selection)
            let chosenFormat = format
            busy = true
            let task = Task.detached(priority: .userInitiated) { try NoteExporter.create(document, format: chosenFormat) }
            job = task
            Task { @MainActor in
                do {
                    let result = try await task.value
                    if task.isCancelled { result.cleanup() }
                    else if let accepted = access.accept(result, generation: library.authenticationGeneration,
                        libraryID: library.selectedLibraryID, noteAvailable: noteAvailable) {
                        retainedArtifact = accepted
                        artifact = accepted
                    } else { invalidate() }
                } catch is CancellationError { problem = "Export canceled. Your original note is preserved." }
                catch { problem = error.localizedDescription }
                busy = false
                job = nil
            }
        } catch { problem = error.localizedDescription }
    }

    private func cleanup() { retainedArtifact?.cleanup(); retainedArtifact = nil }
}

private struct ExportActivityView: UIViewControllerRepresentable {
    let file: URL
    let completion: @MainActor (Bool, Bool) -> Void
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, error in
            Task { @MainActor in completion(completed, error != nil) }
        }
        return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
