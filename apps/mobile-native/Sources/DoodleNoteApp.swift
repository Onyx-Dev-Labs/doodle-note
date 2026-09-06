import SwiftUI

@main
struct DoodleNoteApp: App {
    @State private var library: NoteLibrary
    @State private var recording = RecordingSession()

    init() {
        let base = URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteNative", isDirectory: true)
        #if DEBUG
        let root = ProcessInfo.processInfo.arguments.contains("--ui-testing")
            ? URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteUITests", isDirectory: true) : base
        #else
        let root = base
        #endif
        _library = State(initialValue: NoteLibrary(root: root))
    }

    var body: some Scene {
        WindowGroup { LibraryView(library: library, recording: recording) }
    }
}

struct LibraryView: View {
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @State private var selection: UUID?
    @State private var search = ""

    private var visibleNotes: [NoteRecord] {
        library.notes.filter { note in
            search.isEmpty || ([note.title, note.text] + note.passages.map(\.text))
                .contains { $0.localizedCaseInsensitiveContains(search) }
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    Label("Only on this device", systemImage: "iphone")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section("Notes") {
                    ForEach(visibleNotes) { note in
                        NavigationLink(value: note.id) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(note.title.isEmpty ? String(localized: "Untitled note") : note.title)
                                    .font(.headline).lineLimit(1)
                                Text(note.text.isEmpty ? String(localized: "Personal notes and recordings") : note.text)
                                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                                Text(note.updatedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                    }
                }
            }
            .navigationTitle("DoodleNote")
            .searchable(text: $search, prompt: "Search notes and transcripts")
            .overlay {
                if library.notes.isEmpty {
                    ContentUnavailableView("Your notes start here", systemImage: "note.text",
                        description: Text("Create a note to write, draw, or record a conversation."))
                        .allowsHitTesting(false)
                }
            }
            .toolbar {
                Button("New note", systemImage: "square.and.pencil") { selection = library.create() }
                    .disabled(library.disk == nil).accessibilityIdentifier("newNote")
            }
        } detail: {
            if let selection, library.note(selection) != nil {
                NoteEditor(id: selection, library: library, recording: recording).id(selection)
            } else {
                ContentUnavailableView("Choose a note", systemImage: "note.text",
                    description: Text("Your notes stay on this device. No account is required."))
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let problem = library.problem ?? recording.problem {
                Text(problem).font(.callout).foregroundStyle(.red)
                    .padding().frame(maxWidth: .infinity).background(.regularMaterial)
                    .accessibilityIdentifier("storageProblem")
            }
            if let active = recording.noteID, active != selection {
                Button("Open active recording", systemImage: "record.circle") { selection = active }
                    .padding().frame(maxWidth: .infinity).background(.regularMaterial)
            }
        }
    }
}
