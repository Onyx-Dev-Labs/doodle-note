import SwiftUI

struct SummaryPane: View {
    @Bindable var library: NoteLibrary
    let id: UUID
    @State private var controller = SummaryController()
    @State private var format = MeetingFormat.general
    @State private var language: SpokenLanguage
    @State private var editing: SummaryVersion?
    @State private var editText = ""
    @State private var confirmReplacement = false
    @State private var source: SummarySourceSelection?

    init(library: NoteLibrary, id: UUID) {
        self.library = library; self.id = id
        _language = State(initialValue: library.note(id)?.language ?? .english)
        #if DEBUG
        if SummaryUIFixture.enabled { _controller = State(initialValue: SummaryController(engine: SummaryUIFixture())) }
        #endif
    }
    private var note: NoteRecord? { library.note(id) }
    private var selected: SummaryVersion? { note?.metadata?.summaries.first { $0.id == note?.metadata?.selectedSummaryID } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Summary").font(.headline)
                #if DEBUG
                if SummaryUIFixture.enabled { Text("Synthetic generation fixture").font(.caption) }
                #endif
                Picker("Meeting format", selection: $format) {
                    ForEach(MeetingFormat.allCases) { Text($0.label).tag($0) }
                }.disabled(controller.busy)
                Picker("Summary language", selection: $language) {
                    ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0) }
                }.disabled(controller.busy)
                Text("Generation stays on this device. Review claims, owners and dates against the sources before using the summary.")
                    .font(.caption).foregroundStyle(.secondary)
                if controller.busy {
                    ProgressView("Processing source parts: \(controller.completed) of \(controller.total)")
                    Button("Cancel generation") { controller.cancel() }
                } else {
                    Button("Generate draft") { controller.generate(noteID: id, library: library, format: format, language: language) }
                        .disabled(note?.schemaVersion != 2).accessibilityIdentifier("generateSummary")
                }
                if let problem = controller.problem { Text(problem).foregroundStyle(.orange) }
                if let draft = controller.draft {
                    Text("Review generated draft").font(.headline)
                    Text(draft.text).textSelection(.enabled)
                    Text("Processed all \(draft.totalParts) source parts. Review the source citations below.").font(.caption)
                    sourceButtons(draft.sources)
                    Button("Save as selected version") {
                        if selected?.origin == .edited { confirmReplacement = true }
                        else { Task { _ = await controller.save(noteID: id, library: library, replaceEdited: false) } }
                    }.accessibilityIdentifier("saveGeneratedSummary")
                }
                Text("Retained versions").font(.headline)
                if note?.metadata?.summaries.isEmpty != false { Text("No summary versions yet. Your personal notes remain separate.") }
                ForEach(note?.metadata?.summaries.reversed() ?? []) { version in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(version.origin == .edited ? "Edited version" : "Generated version").font(.caption)
                        if selected?.id == version.id { Text("Selected version").font(.caption).foregroundStyle(.secondary) }
                        Text(version.text).textSelection(.enabled)
                        sourceButtons(version.sources)
                        Button("Edit as new version") { editText = version.text; editing = version }
                        if selected?.id != version.id {
                            Button("Select this version") { library.update(id) { $0.metadata?.selectedSummaryID = version.id } }
                        }
                    }.padding(.vertical, 8)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding()
        }
        .onDisappear { controller.cancel() }
        .onChange(of: library.authenticationGeneration) { _, _ in controller.cancel(); source = nil; editing = nil }
        .confirmationDialog("Replace the selected edited version?", isPresented: $confirmReplacement, titleVisibility: .visible) {
            Button("Select generated version") { Task { _ = await controller.save(noteID: id, library: library, replaceEdited: true) } }
        } message: { Text("Your edited version will remain in Retained versions.") }
        .sheet(item: $editing) { version in
            NavigationStack {
                TextEditor(text: $editText).accessibilityIdentifier("summaryVersionText").padding().navigationTitle("Edit summary")
                    .toolbar {
                        Button("Cancel") { editing = nil }
                        Button("Save version") { library.saveSummaryEdit(noteID: id, parent: version, text: editText); editing = nil }
                    }
            }
        }
        .sheet(item: $source) { selectedSource in
            SummarySourceSheet(library: library, anchor: selectedSource.anchor)
        }
    }

    private func sourceButtons(_ anchors: [SourceAnchor]) -> some View {
        ForEach(Array(anchors.enumerated()), id: \.offset) { index, anchor in
            Button("Source \(index + 1)") { source = .init(anchor: anchor) }
        }
    }
}

private struct SummarySourceSelection: Identifiable { let id = UUID(); let anchor: SourceAnchor }
private struct SummarySourceSheet: View {
    @Bindable var library: NoteLibrary
    let anchor: SourceAnchor
    @Environment(\.dismiss) private var dismiss
    @State private var text: String?
    @State private var failed = false
    var body: some View {
        NavigationStack {
            ScrollView {
                if let text { Text(text).textSelection(.enabled).padding() }
                else if failed { Text("The original source is unavailable in this library.").padding() }
                else { ProgressView("Opening saved source…") }
            }.navigationTitle("Original source")
                .toolbar { Button("Done") { dismiss() } }
                .task(id: NoteSearchController.identity(library)) {
                    text = nil; failed = false
                    do { text = try await library.resolveSearchSource(anchor); failed = text == nil }
                    catch { failed = true }
                }
        }
    }
}
