import SwiftUI

private extension SourceAnchor.Content {
    var label: String {
        switch self {
        case .title: "Title"
        case .personalParagraph: "Typed note"
        case .transcript: "Transcript"
        case .summary: "Selected summary"
        }
    }
}

struct NoteSearchSection: View {
    @Bindable var library: NoteLibrary
    let query: String
    let openNote: (UUID) -> Void
    @State private var search: NoteSearchController
    @State private var selected: NoteSearchHit?
    @State private var limit = 100

    init(library: NoteLibrary, query: String, openNote: @escaping (UUID) -> Void) {
        self.library = library; self.query = query; self.openNote = openNote
        let root = (library.disk?.root ?? URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteNative"))
            .appendingPathComponent("SearchCache")
        _search = State(initialValue: NoteSearchController(root: root))
    }

    var body: some View {
        let identity = NoteSearchController.identity(library)
        Section("Search this library") {
            if search.searching { ProgressView("Searching saved notes…") }
            if let problem = search.problem { Text(L10n.message(problem)).foregroundStyle(.orange) }
            if let result = search.result, search.resultIdentity == identity {
                Text(L10n.count(result.matchedNoteCount) + " · " + L10n.format("%lld sources", result.matchedSourceCount))
                    .font(.caption).accessibilityIdentifier("searchCounts")
                if let reason = result.incompleteReason { Text(L10n.message(reason)).font(.caption).foregroundStyle(.orange) }
                if result.unavailableCount > 0 {
                    Text(L10n.format("%lld notes are not yet searchable. Save or repair them to include their content.", result.unavailableCount))
                        .font(.caption).foregroundStyle(.orange)
                }
                if !result.isExhaustive && result.countsAreComplete {
                    Text(L10n.format("Showing the first %lld sources. The counts include every matching saved note.", result.hits.count)).font(.caption)
                }
                if result.hits.isEmpty { Text("No matching saved content in this library.").foregroundStyle(.secondary) }
                ForEach(result.hits) { hit in
                    Button { selected = hit } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(hit.title.isEmpty ? L10n.text("Untitled note") : hit.title).font(.headline)
                            Text(L10n.key(hit.source.content.label)).font(.caption).foregroundStyle(.secondary)
                            Text(hit.text).lineLimit(3)
                        }
                    }.accessibilityIdentifier("searchHit")
                }
                if result.hits.count < result.matchedSourceCount {
                    Button("Show more sources") { limit += 100 }
                }
            }
        }
        .task(id: query + "|" + identity + "|" + String(limit)) { await search.search(query, library: library, limit: limit) }
        .onChange(of: query) { _, _ in limit = 100 }
        .onDisappear { search.cancel() }
        .sheet(item: $selected) { hit in
            SearchSourceView(hit: hit, library: library, openNote: openNote)
        }
        .onChange(of: library.authenticationGeneration) { _, _ in selected = nil; search.cancel() }
        .onChange(of: library.selectedLibraryID) { _, _ in selected = nil; search.cancel() }
    }
}

private struct SearchSourceView: View {
    let hit: NoteSearchHit
    @Bindable var library: NoteLibrary
    let openNote: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String?
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(L10n.key(hit.source.content.label)).font(.headline)
                    if let text { Text(text).textSelection(.enabled) }
                    else if let problem { Text(L10n.message(problem)) }
                    else { ProgressView("Opening saved source…") }
                    Text("This is the saved source. The note may contain newer edits.").font(.caption).foregroundStyle(.secondary)
                    Button("Open note") {
                        guard library.note(hit.source.noteID) != nil else { problem = "This note is no longer available."; text = nil; return }
                        openNote(hit.source.noteID); dismiss()
                    }.disabled(text == nil)
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .navigationTitle(L10n.text("Source"))
            .toolbar { Button("Done") { dismiss() } }
            .task(id: NoteSearchController.identity(library)) {
                text = nil
                do {
                    text = try await library.resolveSearchSource(hit.source)
                    if text == nil { problem = "This source version is unavailable. The original note has not been changed." }
                } catch { problem = "This source is no longer available in the current library." }
            }
        }
    }
}
