import SwiftUI

@main
struct DoodleNoteApp: App {
    @State private var library: NoteLibrary
    @State private var recording = RecordingSession()
    @Environment(\.scenePhase) private var scenePhase

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
        WindowGroup {
            LibraryView(library: library, recording: recording)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active {
                        let task = SaveBackgroundLifetime()
                        Task {
                            await library.flush()
                            task.end()
                        }
                    }
                }
        }
    }
}

struct LibraryView: View {
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @State private var selection: UUID?
    @State private var search = ""
    @State private var folderID: UUID?
    @State private var folderName = ""
    @State private var creatingFolder = false

    private var visibleNotes: [NoteRecord] {
        library.visibleNotes.filter { note in
            (folderID == nil || note.metadata?.folderID == folderID) && (search.isEmpty || ([note.title, note.text] + note.passages.map(\.text) + (note.metadata?.summaries.map(\.text) ?? []))
                .contains { $0.localizedCaseInsensitiveContains(search) })
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    Picker("Library", selection: Binding(get: { library.selectedLibraryID }, set: { id in
                        library.selectLibrary(id); selection = nil; folderID = nil
                    })) {
                        ForEach(library.libraries) { Text($0.name).tag($0.id) }
                    }
                    Picker("Folder", selection: $folderID) {
                        Text("All notes").tag(UUID?.none)
                        ForEach(library.folders) { Text($0.name).tag(Optional($0.id)) }
                    }
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
                if library.visibleNotes.isEmpty {
                    ContentUnavailableView("Your notes start here", systemImage: "note.text",
                        description: Text("Create a note to write, draw, or record a conversation."))
                        .allowsHitTesting(false)
                }
            }
            .toolbar {
                Button("New folder", systemImage: "folder.badge.plus") { creatingFolder = true }
                Button("New note", systemImage: "square.and.pencil") { selection = library.create() }
                    .disabled(library.disk == nil || library.loading).accessibilityIdentifier("newNote")
            }
        } detail: {
            if let selection, library.note(selection) != nil {
                NoteEditor(id: selection, library: library, recording: recording).id(selection)
            } else {
                ContentUnavailableView("Choose a note", systemImage: "note.text",
                    description: Text("Your notes stay on this device. No account is required."))
            }
        }
        .alert("New folder", isPresented: $creatingFolder) {
            TextField("Folder name", text: $folderName)
            Button("Create") { let name = folderName; folderName = ""; Task { await library.addFolder(name) } }
            Button("Cancel", role: .cancel) { folderName = "" }
        }
        .safeAreaInset(edge: .bottom) {
            if library.loading { ProgressView("Opening notes…") }
            if library.pendingSaves > 0 { Text("Saving changes…").font(.caption) }
            if let problem = library.saveProblem {
                HStack {
                    Text(problem).font(.callout).foregroundStyle(.red)
                    Button("Retry saving") { library.retrySaving() }.accessibilityIdentifier("retrySaving")
                }.padding().background(.regularMaterial)
            }
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

/// Expiration ends the UIKit assertion, not the persistence work or its unsaved status.
@MainActor private final class SaveBackgroundLifetime {
    private var identifier = UIBackgroundTaskIdentifier.invalid
    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Save notes") { [weak self] in
            self?.end()
        }
    }
    func end() {
        guard identifier != .invalid else { return }
        let current = identifier
        identifier = .invalid
        UIApplication.shared.endBackgroundTask(current)
    }
}
