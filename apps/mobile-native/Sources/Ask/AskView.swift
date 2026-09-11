import SwiftUI

struct AskView: View {
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    let noteID: UUID?
    @Environment(\.dismiss) private var dismiss
    @State private var controller: AskController

    init(library: NoteLibrary, recording: RecordingSession, noteID: UUID?) {
        self.library = library; self.recording = recording; self.noteID = noteID
        #if DEBUG
        _controller = State(initialValue: AskController(engine: AskUIFixture.enabled ? AskUIFixture() : AppleLocalGeneration()))
        #else
        _controller = State(initialValue: AskController())
        #endif
    }
    @State private var question = ""
    @FocusState private var questionFocused: Bool
    @State private var language = SpokenLanguage.english
    @State private var mode = 0
    @State private var citation: AskEvidence?

    var body: some View {
        NavigationStack {
            Form {
                Section("Ask your notes") {
                    if let noteID {
                        Text(library.note(noteID)?.title ?? L10n.text("Untitled note"))
                        Text("Scope: this meeting's saved typed notes and transcript.").font(.caption)
                    } else {
                        Picker("Library", selection: Binding(get: { library.selectedLibraryID }, set: { library.selectLibrary($0) })) {
                            ForEach(library.libraries) { Text($0.id == LibraryRecord.localID ? L10n.text("Only on this device") : $0.name).tag($0.id) }
                        }.disabled(controller.busy)
                        Text("Scope: all saved typed notes and transcripts in this library, including older notes.").font(.caption)
                    }
                    TextField("Ask a question", text: $question, axis: .vertical).lineLimit(2...5).focused($questionFocused).accessibilityIdentifier("askQuestion")
                    Picker("Answer language", selection: $language) { ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0) } }
                    Picker("Answer view", selection: $mode) {
                        Text("Evidence").tag(0); Text("Count matching notes").tag(1); Text("List matching notes").tag(2)
                    }
                    Text("Answers show original evidence in its original language. Matching is generated on this device and may need correction.").font(.caption)
                    Button("Ask", systemImage: "questionmark.bubble") { controller.ask(question, noteID: noteID, language: language, library: library) }
                        .disabled(controller.busy || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("askSubmit")
                }
                if controller.busy {
                    Section {
                        ProgressView(value: Double(controller.completed), total: Double(max(1, controller.total)))
                        Text(L10n.format("Reviewed %lld of %lld source fragments", controller.completed, controller.total))
                        Button("Cancel") { controller.cancel() }
                    }
                }
                if controller.canceled { Text("Answer canceled. No completed answer was saved.").foregroundStyle(.secondary) }
                if let problem = controller.problem { Text(L10n.message(problem)).foregroundStyle(.orange).accessibilityIdentifier("askProblem") }
                if let answer = controller.answer, controller.identity == NoteSearchController.identity(library) {
                    Section("Answer") {
                        if answer.unsupportedCensus {
                            Text("Exact counts of people, tasks and events are not supported yet. Ask for a cited list, or count matching notes.")
                        }
                        if !answer.claims.isEmpty {
                            Text("Draft answer. Verify each claim against its original citations.").font(.caption).foregroundStyle(.orange)
                            ForEach(answer.claims) { claim in
                                Text(claim.text)
                                ForEach(claim.evidenceIDs, id: \.self) { sourceID in
                                    if let item = answer.evidence.first(where: { $0.id == sourceID }) {
                                        Button(L10n.format("Source %lld", sourceID + 1)) { citation = item }
                                    }
                                }
                            }
                        }
                        Text(L10n.format("Reviewed %lld notes and %lld source fragments", answer.scannedNotes, answer.scannedParts)).font(.caption)
                        if answer.incomplete && !answer.unsupportedCensus {
                            Text("Some sources are missing, unsaved or unfinished. This is partial evidence, not a complete count or list.").foregroundStyle(.orange)
                        }
                        if answer.unavailableCount > 0 { Text(L10n.format("%lld notes are unavailable", answer.unavailableCount)) }
                        if answer.claims.isEmpty && !answer.noteCensus && !answer.unsupportedCensus { Text("The available evidence is insufficient to answer this question.") }
                        else {
                            if (mode != 0 || answer.noteCensus) && !answer.incomplete {
                                Text(L10n.format("Model-identified matching notes: %lld", answer.matchingNotes)).font(.headline)
                                Text("This counts notes with selected evidence, not people, tasks or individual events. Review the sources before relying on the result.").font(.caption)
                            }
                            if answer.hasBothSourceKinds {
                                Text("Typed notes and transcript may disagree. Both are shown with their source labels; the app does not resolve conflicting claims.").foregroundStyle(.orange)
                            }
                            if mode == 2 {
                                ForEach(Array(Set(answer.evidence.map { $0.anchor.noteID })).sorted { $0.uuidString < $1.uuidString }, id: \.self) { id in
                                    if let first = answer.evidence.first(where: { $0.anchor.noteID == id }) {
                                        Text(first.title.isEmpty ? L10n.text("Untitled note") : first.title).font(.headline)
                                        ForEach(answer.evidence.filter { $0.anchor.noteID == id }) { item in
                                            Button(item.quote) { citation = item }
                                        }
                                    }
                                }
                            } else {
                            ForEach(answer.evidence) { item in
                                Button { citation = item } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(item.title.isEmpty ? L10n.text("Untitled note") : item.title).font(.headline)
                                        Text(L10n.key(item.anchor.askLabel)).font(.caption)
                                        Text(item.quote).textSelection(.enabled)
                                        Text("Open original passage").font(.caption)
                                    }
                                }.accessibilityIdentifier("askCitation")
                            }
                            }
                        }
                    }
                }
            }
            .navigationTitle(L10n.text("Ask"))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { controller.cancel(); dismiss() } }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done typing") { questionFocused = false }.accessibilityIdentifier("askDoneTyping") }
            }
            .sheet(item: $citation) { AskCitationView(evidence: $0, library: library, recording: recording) }
            .onChange(of: library.authenticationGeneration) { _, _ in controller.cancel(); citation = nil }
            .onChange(of: library.selectedLibraryID) { _, _ in controller.cancel(); citation = nil }
            .onDisappear { controller.cancel() }
            .onAppear { language = noteID.flatMap { library.note($0)?.language } ?? .english }
        }
    }
}
private extension SourceAnchor {
    var askLabel: String { if case .personalParagraph = content { "Typed note" } else { "Transcript" } }
}
private struct AskCitationView: View {
    let evidence: AskEvidence
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @Environment(\.dismiss) private var dismiss
    @State private var text: String?
    @State private var problem: String?
    @State private var player = LocalPlayback()
    private var passage: TranscriptPassage? {
        guard case .transcript(let id) = evidence.anchor.content else { return nil }
        return library.note(evidence.anchor.noteID)?.passages.first { $0.id == id }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(L10n.key(evidence.anchor.askLabel)).font(.headline)
                    if let text { Text(text).textSelection(.enabled) }
                    if let problem { Text(L10n.message(problem)).foregroundStyle(.orange) }
                    if let passage, text != nil, !(library.disk?.audioFiles(for: evidence.anchor.noteID).isEmpty ?? true) {
                        Button(player.isPlaying ? "Stop playback" : "Play original audio") {
                            if player.isPlaying { player.stop() }
                            else {
                                do {
                                    guard recording.permitsPlayback, let disk = library.disk else { return }
                                    player.play(plan: try disk.playbackTimeline(for: evidence.anchor.noteID), at: passage.start)
                                } catch { problem = error.localizedDescription }
                            }
                        }.disabled(!recording.permitsPlayback)
                    } else if passage != nil { Text("Local audio is unavailable. The original transcript is still readable.").font(.caption) }
                    if let problem = player.problem { Text(L10n.message(problem)).foregroundStyle(.orange) }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }.navigationTitle(L10n.text("Source"))
            .toolbar { Button("Done") { player.stop(); dismiss() } }
            .task(id: NoteSearchController.identity(library)) {
                player.stop(); text = nil
                do {
                    text = try await AskCitationAccess.resolve(evidence.anchor, library: library)
                    if text == nil { problem = "This source version is unavailable. The original note has not been changed." }
                } catch { problem = "This source is no longer available in the current library." }
            }.onDisappear { player.stop() }
            .onChange(of: recording.permitsPlayback) { _, permitted in if !permitted { player.stop() } }
        }
    }
}
