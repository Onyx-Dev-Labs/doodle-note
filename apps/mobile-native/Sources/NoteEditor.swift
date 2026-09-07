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
    @State private var summaryText = ""
    @State private var editingSummary: SummaryVersion?
    @State private var confirmAudioRemoval = false
    @State private var inkSession = InkEditingSession()
    @State private var showDetails = false
    @State private var transcription = SavedTranscription()
    @State private var editingPassage: TranscriptPassage?
    @State private var correctionText = ""
    @State private var correctionProblem: String?
    private enum TextFocus: Hashable { case title, personalNotes }
    @FocusState private var editingText: TextFocus?
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

    private var canEdit: Bool { note.schemaVersion == 2 && note.metadata?.cloudReadOnly != true }

    var body: some View {
        GeometryReader { geometry in
        VStack(spacing: 0) {
            if note.metadata?.cloudReadOnly == true { Text("This cloud version is read-only. Its original data is preserved.").font(.caption).padding() }
            TextField("Untitled note", text: binding(\.title), axis: .vertical)
                .focused($editingText, equals: .title)
                .font(.title2.bold()).lineLimit(2).padding(.horizontal).padding(.top, 8).accessibilityIdentifier("noteTitle").disabled(!canEdit)
            DisclosureGroup("Note details", isExpanded: $showDetails) {
            Picker("Move to folder", selection: Binding(get: { note.metadata?.folderID }, set: { folder in
                library.update(id) { $0.metadata?.folderID = folder }
            })) {
                Text("No folder").tag(UUID?.none)
                ForEach(library.folders) { Text($0.name).tag(Optional($0.id)) }
            }.padding(.horizontal).disabled(!canEdit).accessibilityIdentifier("noteFolder")
            HStack {
                Picker("Spoken language", selection: binding(\.language)) {
                    ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0) }
                }
                .disabled(transcription.busy || !canEdit || recording.noteID != nil || recording.busy || recording.speech.readiness == .downloading)
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
                Button("Personal notes") { pane = 0; editingText = .personalNotes }
                Button("Drawing") { pane = 1; editingText = nil }
                Button("Transcript") { pane = 2; editingText = nil }
                Button("Summary") { pane = 3; editingText = nil }
            }
            if editingText != nil { Button("Done typing") { editingText = nil }.accessibilityIdentifier("doneTyping") }
            Menu("Note storage", systemImage: "ellipsis.circle") {
                Button("Move to Trash", role: .destructive) {
                    player.stop()
                    Task { await library.performStorage(.trash, id: id,
                        captureActive: recording.busy || recording.noteID != nil) }
                }.accessibilityIdentifier("moveToTrash")
                if !audio.isEmpty {
                    Button("Remove local audio", role: .destructive) { player.stop(); confirmAudioRemoval = true }
                }
            }.disabled(transcription.busy || recording.busy || recording.noteID != nil || library.storageBusy || note.schemaVersion != 2)
        }
        .alert("Remove this device's audio?", isPresented: $confirmAudioRemoval) {
            Button("Remove audio", role: .destructive) {
                player.stop()
                Task { await library.performStorage(.removeAudio, id: id, confirmed: true,
                    captureActive: recording.busy || recording.noteID != nil) }
            }
            Button("Cancel", role: .cancel) { }
        } message: { Text("Your notes, transcript, ink and summary versions stay. Audio removal cannot be undone here.") }
        .task {
            #if DEBUG
            if CommandLine.arguments.contains("--ui-testing"), CommandLine.arguments.contains("--transcript-fixture"), note.passages.isEmpty {
                library.update(id) { note in
                    note.title = CommandLine.arguments.first(where: { $0.hasPrefix("--transcript-title=") }).map { String($0.dropFirst("--transcript-title=".count)) } ?? "Transcript fixture"
                    note.passages = [.init(start: 0, end: 1, text: "Synthetic transcript draft", isFinal: false)]
                    note.metadata?.cloudTranscriptStatus = .partial
                }
            }
            #endif
        }
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
        .onChange(of: pane) { _, value in if value != 0 { editingText = nil } }
        .onDisappear { player.stop(); transcription.cancel(noteID: id, library: library); Task { await library.flush() } }
        .onChange(of: library.authenticationGeneration) { _, _ in transcription.cancel(noteID: id, library: library); editingPassage = nil }
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
        Button(L10n.key(title)) { pane = value; editingText = value == 0 ? .personalNotes : nil }
            .keyboardShortcut(key, modifiers: .command)
            .buttonStyle(.bordered).tint(pane == value ? .accentColor : .secondary)
            .accessibilityAddTraits(pane == value ? .isSelected : [])
    }

    @ViewBuilder private var notePane: some View {
        if pane == 3 {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Summary versions").font(.headline)
                    if note.metadata?.summaries.isEmpty != false {
                        Text("Generated summaries will appear here. Your personal notes remain separate.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(note.metadata?.summaries ?? []) { version in
                        Text(L10n.key(version.origin == .edited ? "Edited version" : "Generated version")).font(.caption)
                        Text(version.text).textSelection(.enabled)
                        Button("Edit as new version") { summaryText = version.text; editingSummary = version }.disabled(!canEdit)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .sheet(item: $editingSummary) { version in
                NavigationStack {
                    TextEditor(text: $summaryText).padding().navigationTitle(L10n.text("Edit summary"))
                        .toolbar {
                            Button("Cancel") { editingSummary = nil }
                            Button("Save version") {
                                library.saveSummaryEdit(noteID: id, parent: version, text: summaryText)
                                editingSummary = nil
                            }
                        }
                }
            }
        } else if pane == 1 {
            InkEditor(session: inkSession, id: id, data: binding(\.ink), editable: canEdit)
        } else {
            notePaneForNotes
        }
    }

    private var notePaneForNotes: some View {
            VStack(alignment: .leading, spacing: 0) {
                Text(L10n.key(UIDevice.current.userInterfaceIdiom == .pad ? "Personal notes · Type or use system Scribble" : "Personal notes")).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                if canEdit {
                    TextEditor(text: binding(\.text)).padding(.horizontal, 8)
                        .accessibilityLabel("Personal notes").accessibilityIdentifier("personalNotes")
                        .focused($editingText, equals: .personalNotes)
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
                Text(note.metadata?.cloudTranscriptStatus == .complete ? "Transcript processing complete" : "Transcript may be incomplete").font(.caption)
                if let problem = transcription.problem { Text(L10n.message(problem)).foregroundStyle(.orange) }
                if transcription.busy {
                    ProgressView(value: Double(transcription.completed), total: Double(max(1, transcription.total)))
                    Button("Cancel transcription") { transcription.cancel(noteID: id, library: library) }.disabled(transcription.cancelling)
                } else {
                    Button("Retry saved audio") { player.stop(); transcription.retry(noteID: id, library: library) }
                        .accessibilityIdentifier("retryTranscript")
                        .disabled(recording.busy || recording.noteID != nil || audio.isEmpty || note.schemaVersion != 2)
                }
                if note.transcriptNeedsReview == true { Text("Corrections were preserved across changed transcript boundaries. Review the transcript.").font(.caption) }
                Text(L10n.message(recording.speech.detail)).font(.callout).foregroundStyle(.secondary)
                if recording.noteID == nil && recording.speech.readiness == .downloadNeeded {
                    Button("Download speech model", systemImage: "arrow.down.circle") {
                        Task { await recording.speech.download(note.language) }
                    }.disabled(recording.busy || transcription.busy)
                }
                if recording.noteID == nil && recording.speech.readiness == .failed {
                    Button("Check speech availability") { Task { await recording.speech.check(note.language) } }.disabled(transcription.busy)
                }
                ForEach(note.passages) { passage in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(passage.speakerName ?? note.speakerAnnotations?.label(for: passage, localized: true) ?? L10n.text( "Unassigned speaker"))
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
                        Button("Correct transcript") { correctionText = passage.text; correctionProblem = nil; editingPassage = passage }.disabled(note.schemaVersion != 2)
                        if passage.isUserEdited == true { Text("User correction").font(.caption) }
                        if !passage.isFinal { Text("Draft transcription").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if note.passages.isEmpty {
                    Text("Live text will appear here when the speech model is ready.")
                        .foregroundStyle(.secondary).padding(.vertical)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding()
        }
        .sheet(item: $editingPassage) { passage in
            NavigationStack {
                VStack {
                    if let correctionProblem { Text(L10n.message(correctionProblem)).foregroundStyle(.orange) }
                    TextEditor(text: $correctionText).accessibilityIdentifier("transcriptCorrection").padding()
                }
                    .navigationTitle(L10n.text("Correct transcript"))
                    .toolbar {
                        Button("Cancel") { editingPassage = nil }
                        Button("Save correction") {
                            var saved = false
                            library.update(id) { saved = $0.correctPassage(id: passage.id, text: correctionText) }
                            if saved { editingPassage = nil }
                            else { correctionProblem = "The original passage changed. Your correction is still here; copy it before reopening the updated passage." }
                        }
                    }
            }
        }
    }

    private var recordControl: some View {
                Button(L10n.key(isActive ? "Stop recording" : (note.captureState == .interrupted ? "Resume" : "Record")), systemImage: isActive ? "stop.fill" : "mic.fill") {
                    editingText = nil
                    player.stop()
                    Task {
                        if isActive { await recording.stop(library: library) }
                        else { await recording.start(id, library: library) }
                    }
                }.buttonStyle(.borderedProminent).tint(isActive ? .red : .accentColor)
                    .disabled(transcription.busy || library.storageBusy || !canEdit || recording.busy || (recording.noteID != nil && !isActive) || recording.speech.readiness == .downloading || recording.speakers.preparing)
                    .accessibilityIdentifier("recordButton")
    }

    private var captureControls: some View {
        VStack(spacing: 8) {
            #if DEBUG
            if CommandLine.arguments.contains("--ui-testing") && CommandLine.arguments.contains("--capture-fixture") {
                Text("Synthetic capture fixture · No microphone").font(.caption).foregroundStyle(.secondary)
                if recording.preparingNoteID == id {
                    Button(action: recording.allowFixtureCapture) {
                        Text(verbatim: "Continue synthetic capture")
                    }.accessibilityIdentifier("allowFixtureCapture")
                }
            }
            #endif
                if let started = recording.startedAt, isActive {
                    Label { Text(started, style: .timer).monospacedDigit() } icon: { Image(systemName: "record.circle.fill") }
                        .foregroundStyle(.red)
                }
            if let problem = player.problem { Text(L10n.message(problem)).font(.caption).foregroundStyle(.red) }
            if recording.speakers.state == .failed {
                Text(L10n.message(recording.speakers.detail)).font(.caption).foregroundStyle(.orange)
            }
            ViewThatFits(in: .horizontal) {
            HStack {
                Button("Speakers", systemImage: "person.2") { showSpeakers.toggle() }
                    .accessibilityIdentifier("speakerSettings")
                if !audio.isEmpty && recording.noteID == nil {
                    Button(L10n.key(player.isPlaying ? "Stop playback" : "Play recording"),
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
                    Button(L10n.key(player.isPlaying ? "Stop playback" : "Play recording")) { if player.isPlaying { player.stop() } else { play() } }
                        .disabled(!recording.permitsPlayback)
                }
            }
            }
            if recording.busy {
                ProgressView(L10n.key(recording.preparingNoteID != nil ? "Preparing recording…" : "Finishing and saving recording…")).font(.caption)
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
                Text(L10n.message(recording.speakers.detail)).font(.caption).foregroundStyle(.secondary)
                if recording.noteID == nil && !recording.busy {
                    if recording.speakers.state == .downloading {
                        Button("Cancel model download") { recording.speakers.cancelDownload() }
                    } else if recording.speakers.state == .missing || recording.speakers.state == .failed {
                        Button("Download speaker model") { recording.speakers.download() }
                    }
                }
                if let annotations = note.speakerAnnotations {
                    ForEach(annotations.speakerKeys, id: \.self) { key in
                        TextField(annotations.name(for: key, localized: true), text: Binding(
                            get: { library.note(id)?.speakerAnnotations?.names[key] ?? "" },
                            set: { name in library.update(id) { $0.speakerAnnotations?.names[key] = name.trimmingCharacters(in: .whitespacesAndNewlines) } }))
                            .textFieldStyle(.roundedBorder).disabled(!canEdit)
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
