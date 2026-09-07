import SwiftUI
import PencilKit

struct NoteEditor: View {
    let id: UUID
    @Bindable var library: NoteLibrary
    @Bindable var recording: RecordingSession
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var pane = 0
    @State private var player = LocalPlayback()
    @State private var showSpeakers = false
    @State private var confirmAudioRemoval = false
    @State private var inkSession = InkEditingSession()
    @State private var showDetails = false
    @FocusState private var editingText: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var note: NoteRecord { library.note(id) ?? NoteRecord(id: id) }
    private var isActive: Bool { recording.noteID == id }
    private var audio: [URL] { library.disk?.audioFiles(for: id) ?? [] }

    private var audioStart: TimeInterval { library.lifecycle[id]?.audioTimelineStart ?? 0 }
    private func play(at seconds: TimeInterval? = nil) {
        let sourceTime = seconds ?? audioStart
        guard recording.permitsPlayback, sourceTime >= audioStart else { return }
        do {
            guard let disk = library.disk else { return }
            player.play(plan: try disk.playbackTimeline(for: id), at: sourceTime)
        } catch { player.problem = error.localizedDescription }
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<NoteRecord, Value>) -> Binding<Value> {
        Binding(get: { note[keyPath: keyPath] }, set: { value in library.update(id) { $0[keyPath: keyPath] = value } })
    }

    var body: some View {
        GeometryReader { geometry in
        VStack(spacing: 0) {
            TextField("Untitled note", text: binding(\.title), axis: .vertical)
                .font(.title2.bold()).lineLimit(2).padding(.horizontal).padding(.top, 8).accessibilityIdentifier("noteTitle").disabled(note.schemaVersion != 2)
            DisclosureGroup("Note details", isExpanded: $showDetails) {
            Picker("Move to folder", selection: Binding(get: { note.metadata?.folderID }, set: { folder in
                library.update(id) { $0.metadata?.folderID = folder }
            })) {
                Text("No folder").tag(UUID?.none)
                ForEach(library.folders) { Text($0.name).tag(Optional($0.id)) }
            }.padding(.horizontal).disabled(note.schemaVersion != 2).accessibilityIdentifier("noteFolder")
            HStack {
                Picker("Spoken language", selection: binding(\.language)) {
                    ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0) }
                }
                .disabled(note.schemaVersion != 2 || recording.noteID != nil || recording.busy || recording.speech.readiness == .downloading)
                Spacer()
            }.padding(.horizontal)
            }.padding(.horizontal)
            if note.captureState == .interrupted {
                Label("Recording interrupted. Saved audio and notes are retained. Start again when ready.", systemImage: "pause.circle")
                    .font(.callout).foregroundStyle(.orange).padding(.horizontal)
            }
            // Recording controls stay outside the docked drawing tools.
            captureControls
            if showSpeakers { speakerSettings }
            if sizeClass == .regular && geometry.size.width >= 740 && !dynamicTypeSize.isAccessibilitySize {
                HStack(spacing: 0) {
                    VStack(spacing: 0) { notePicker; if pane == 2 { notePaneForNotes } else { notePane } }.frame(maxWidth: .infinity)
                    Divider()
                    transcript.frame(maxWidth: .infinity)
                }
            } else {
                notePicker
                if pane == 2 { transcript } else { notePane }
            }
        }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Menu("Editor navigation", systemImage: "rectangle.split.2x1") {
                Button("Personal notes") { pane = 0; editingText = true }
                Button("Drawing") { pane = 1; editingText = false }
                Button("Transcript") { pane = 2; editingText = false }
                Button("Summary") { pane = 3; editingText = false }
            }
            if editingText { Button("Done typing") { editingText = false }.accessibilityIdentifier("doneTyping") }
            Menu("Note storage", systemImage: "ellipsis.circle") {
                Button("Move to Trash", role: .destructive) {
                    player.stop()
                    Task { await library.performStorage(.trash, id: id,
                        captureActive: recording.busy || recording.noteID != nil) }
                }.accessibilityIdentifier("moveToTrash")
                if !audio.isEmpty {
                    Button("Remove local audio", role: .destructive) { player.stop(); confirmAudioRemoval = true }
                }
            }.disabled(recording.busy || recording.noteID != nil || library.storageBusy || note.schemaVersion != 2)
        }
        .alert("Remove this device's audio?", isPresented: $confirmAudioRemoval) {
            Button("Remove audio", role: .destructive) {
                player.stop()
                Task { await library.performStorage(.removeAudio, id: id, confirmed: true,
                    captureActive: recording.busy || recording.noteID != nil) }
            }
            Button("Cancel", role: .cancel) { }
        } message: { Text("Your notes, transcript, ink and summary versions stay. Audio removal cannot be undone here.") }
        .onChange(of: library.storageBusy) { _, busy in if busy { player.stop() } }
        .task(id: note.language) {
            if recording.noteID == nil && !recording.busy {
                await recording.speech.check(note.language)
                await recording.speakers.check()
            }
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ink-fixture"), note.passages.isEmpty {
                library.update(id) { $0.passages = [
                    TranscriptPassage(start: 0, end: 8, text: "Let’s keep the sketch beside the meeting notes while we explore this idea.", isFinal: true, speakerName: "Fixture speaker 1"),
                    TranscriptPassage(start: 8, end: 16, text: "We can review the next steps together, then keep this drawing editable.", isFinal: true, speakerName: "Fixture speaker 2")
                ] }
            }
            #endif
        }
        .onChange(of: pane) { _, value in if value != 0 { editingText = false } }
        .onDisappear { player.stop(); Task { await library.flush() } }
        .onChange(of: recording.noteID) { _, value in if value != nil { player.stop() } }
        .onChange(of: recording.busy) { _, value in if value { player.stop() } }
    }

    private var notePicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                contentButton("Notes", pane: 0, key: "1")
                contentButton("Ink", pane: 1, key: "2")
                contentButton("Transcript", pane: 2, key: "3")
                contentButton("Summary", pane: 3, key: "4")
            }.padding(8)
        }.fixedSize(horizontal: false, vertical: true)
    }

    private func contentButton(_ title: String, pane value: Int, key: KeyEquivalent) -> some View {
        Button(title) { pane = value; editingText = value == 0 }
            .keyboardShortcut(key, modifiers: .command)
            .buttonStyle(.bordered).tint(pane == value ? .accentColor : .secondary)
            .accessibilityAddTraits(pane == value ? .isSelected : [])
    }

    @ViewBuilder private var notePane: some View {
        if pane == 3 {
            SummaryPane(library: library, id: id)
        } else if pane == 1 {
            InkEditor(session: inkSession, id: id, data: binding(\.ink), editable: note.schemaVersion == 2)
        } else {
            notePaneForNotes
        }
    }

    private var notePaneForNotes: some View {
            VStack(alignment: .leading, spacing: 0) {
                Text(UIDevice.current.userInterfaceIdiom == .pad ? "Personal notes · Type or use system Scribble" : "Personal notes").font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                if note.schemaVersion == 2 {
                    TextEditor(text: binding(\.text)).padding(.horizontal, 8)
                        .accessibilityLabel("Personal notes").accessibilityIdentifier("personalNotes")
                        .focused($editingText)
                        .accessibilityHint("Type with the keyboard or write with Apple Pencil using system Scribble. Saved drawings are not converted automatically.")
                } else {
                    ScrollView { Text(note.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
                }
            }
    }

    private var transcript: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                Text("Transcript").font(.title2.bold())
                Text(recording.speech.detail).font(.callout).foregroundStyle(.secondary)
                if recording.noteID == nil && recording.speech.readiness == .downloadNeeded {
                    Button("Download speech model", systemImage: "arrow.down.circle") {
                        Task { await recording.speech.download(note.language) }
                    }.disabled(recording.busy)
                }
                if recording.noteID == nil && recording.speech.readiness == .failed {
                    Button("Check speech availability") { Task { await recording.speech.check(note.language) } }
                }
                ForEach(note.passages) { passage in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(passage.speakerName ?? note.speakerAnnotations?.label(for: passage) ?? String(localized: "Unassigned speaker"))
                                .font(.caption.bold())
                            Spacer()
                            Button {
                                play(at: passage.start)
                            } label: {
                                Text(Duration.seconds(passage.start), format: .time(pattern: .minuteSecond))
                                    .monospacedDigit().font(.caption)
                            }.disabled(audio.isEmpty || passage.start < audioStart || !recording.permitsPlayback)
                                .accessibilityLabel("Play passage")
                        }
                        Text(passage.text).foregroundStyle(passage.isFinal ? .primary : .secondary)
                        if !passage.isFinal { Text("Draft transcription").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if note.passages.isEmpty {
                    Text("Live text will appear here when the speech model is ready.")
                        .foregroundStyle(.secondary).padding(.vertical)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding()
        }
    }

    private var recordControl: some View {
                Button(isActive ? "Stop recording" : (note.captureState == .interrupted ? "Resume" : "Record"), systemImage: isActive ? "stop.fill" : "mic.fill") {
                    player.stop()
                    Task {
                        if isActive { await recording.stop(library: library) }
                        else { await recording.start(id, library: library) }
                    }
                }.buttonStyle(.borderedProminent).tint(isActive ? .red : .accentColor)
                    .disabled(library.storageBusy || note.schemaVersion != 2 || recording.busy || (recording.noteID != nil && !isActive) || recording.speech.readiness == .downloading || recording.speakers.preparing)
                    .accessibilityIdentifier("recordButton")
    }

    private var captureControls: some View {
        VStack(spacing: 8) {
            #if DEBUG
            if CommandLine.arguments.contains("--ui-testing") && CommandLine.arguments.contains("--capture-fixture") {
                Text("Synthetic capture fixture · No microphone").font(.caption).foregroundStyle(.secondary)
            }
            #endif
                if let started = recording.startedAt, isActive {
                    Label { Text(started, style: .timer).monospacedDigit() } icon: { Image(systemName: "record.circle.fill") }
                        .foregroundStyle(.red)
                }
            if let problem = player.problem { Text(problem).font(.caption).foregroundStyle(.red) }
            if recording.speakers.state == .failed {
                Text(recording.speakers.detail).font(.caption).foregroundStyle(.orange)
            }
            ViewThatFits(in: .horizontal) {
            HStack {
                Button("Speakers", systemImage: "person.2") { showSpeakers.toggle() }
                    .accessibilityIdentifier("speakerSettings")
                if !audio.isEmpty && recording.noteID == nil {
                    Button(player.isPlaying ? "Stop playback" : "Play recording",
                           systemImage: player.isPlaying ? "stop.fill" : "play.fill") {
                        if player.isPlaying { player.stop() } else { play() }
                    }.buttonStyle(.bordered).disabled(!recording.permitsPlayback)
                }
                Spacer()
                recordControl
            }
            VStack(alignment: .leading, spacing: 8) {
                Button("Speakers", systemImage: "person.2") { showSpeakers.toggle() }.accessibilityIdentifier("speakerSettings")
                recordControl
                if !audio.isEmpty && recording.noteID == nil {
                    Button(player.isPlaying ? "Stop playback" : "Play recording") { if player.isPlaying { player.stop() } else { play() } }
                        .disabled(!recording.permitsPlayback)
                }
            }
            }
            if recording.busy {
                ProgressView(recording.preparingNoteID != nil ? "Preparing recording…" : "Finishing and saving recording…").font(.caption)
                if recording.preparingNoteID != nil {
                    Button("Cancel recording preparation") { Task { await recording.stop(library: library) } }
                        .accessibilityIdentifier("cancelRecordingPreparation")
                }
            }
        }.padding().background(.bar)
    }

    private var speakerSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Live speaker labels", isOn: Binding(get: { recording.speakers.enabled }, set: { recording.speakers.enabled = $0 }))
                    .disabled(recording.noteID != nil || recording.busy || recording.speakers.preparing)
                Text(recording.speakers.detail).font(.caption).foregroundStyle(.secondary)
                if recording.noteID == nil && !recording.busy {
                    if recording.speakers.state == .downloading {
                        Button("Cancel model download") { recording.speakers.cancelDownload() }
                    } else if recording.speakers.state == .missing || recording.speakers.state == .failed {
                        Button("Download speaker model") { recording.speakers.download() }
                    }
                }
                if let annotations = note.speakerAnnotations {
                    ForEach(annotations.speakerKeys, id: \.self) { key in
                        TextField(annotations.name(for: key), text: Binding(
                            get: { library.note(id)?.speakerAnnotations?.names[key] ?? "" },
                            set: { name in library.update(id) { $0.speakerAnnotations?.names[key] = name.trimmingCharacters(in: .whitespacesAndNewlines) } }))
                            .textFieldStyle(.roundedBorder).disabled(note.schemaVersion != 2)
                    }
                }
                Text("Names apply to this recording session. Remembering voices across meetings is still being built.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Link("Model source", destination: URL(string: "https://huggingface.co/FluidInference/diar-streaming-sortformer-coreml")!)
                    Link("Model license", destination: URL(string: "https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/")!)
                }.font(.caption)
            }.padding()
        }.frame(maxHeight: 240).background(.quaternary.opacity(0.3))
    }
}
