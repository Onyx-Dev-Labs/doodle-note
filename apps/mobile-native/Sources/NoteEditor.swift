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

    private var note: NoteRecord { library.note(id) ?? NoteRecord(id: id) }
    private var isActive: Bool { recording.noteID == id }
    private var audio: [URL] { library.disk?.audioFiles(for: id) ?? [] }

    private var audioStart: TimeInterval { library.lifecycle[id]?.audioTimelineStart ?? 0 }
    private func play(at seconds: TimeInterval? = nil) {
        let sourceTime = seconds ?? audioStart
        guard recording.permitsPlayback, sourceTime >= audioStart else { return }
        player.play(files: audio, at: sourceTime - audioStart)
    }

    private func binding<Value>(_ keyPath: WritableKeyPath<NoteRecord, Value>) -> Binding<Value> {
        Binding(get: { note[keyPath: keyPath] }, set: { value in library.update(id) { $0[keyPath: keyPath] = value } })
    }

    var body: some View {
        VStack(spacing: 0) {
            TextField("Untitled note", text: binding(\.title), axis: .vertical)
                .font(.largeTitle.bold()).padding().accessibilityIdentifier("noteTitle").disabled(note.schemaVersion != 2)
            Picker("Move to folder", selection: Binding(get: { note.metadata?.folderID }, set: { folder in
                library.update(id) { $0.metadata?.folderID = folder }
            })) {
                Text("No folder").tag(UUID?.none)
                ForEach(library.folders) { Text($0.name).tag(Optional($0.id)) }
            }.padding(.horizontal).disabled(note.schemaVersion != 2).accessibilityIdentifier("noteFolder")
            if note.captureState == .interrupted {
                Label("Recording interrupted. Saved audio and notes are retained. Start again when ready.", systemImage: "pause.circle")
                    .font(.callout).foregroundStyle(.orange).padding(.horizontal)
            }
            HStack {
                Picker("Spoken language", selection: binding(\.language)) {
                    ForEach(SpokenLanguage.allCases) { Text($0.name).tag($0) }
                }
                .disabled(note.schemaVersion != 2 || recording.noteID != nil || recording.busy || recording.speech.readiness == .downloading)
                Spacer()
                if let started = recording.startedAt, isActive {
                    Label { Text(started, style: .timer).monospacedDigit() } icon: { Image(systemName: "record.circle.fill") }
                        .foregroundStyle(.red)
                }
            }.padding(.horizontal)
            // Keep recording controls clear of PencilKit's floating tool palette.
            captureControls
            if showSpeakers { speakerSettings }
            if sizeClass == .regular {
                HStack(spacing: 0) {
                    VStack(spacing: 0) { notePicker; notePane }.frame(maxWidth: .infinity)
                    Divider()
                    transcript.frame(maxWidth: .infinity)
                }
            } else {
                Picker("Content", selection: $pane) {
                    Text("Notes").tag(0)
                    Text("Ink").tag(1)
                    Text("Transcript").tag(2)
                    Text("Summary").tag(3)
                }.pickerStyle(.segmented).padding()
                if pane == 2 { transcript } else { notePane }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
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
        .onDisappear { player.stop() }
        .onChange(of: recording.noteID) { _, value in if value != nil { player.stop() } }
        .onChange(of: recording.busy) { _, value in if value { player.stop() } }
    }

    private var notePicker: some View {
        Picker("Content", selection: $pane) { Text("Notes").tag(0); Text("Ink").tag(1); Text("Summary").tag(3) }
            .pickerStyle(.segmented).padding()
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
                        Text(version.origin == .edited ? "Edited version" : "Generated version").font(.caption)
                        Text(version.text).textSelection(.enabled)
                        Button("Edit as new version") { summaryText = version.text; editingSummary = version }.disabled(note.schemaVersion != 2)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }
            .sheet(item: $editingSummary) { version in
                NavigationStack {
                    TextEditor(text: $summaryText).padding().navigationTitle("Edit summary")
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
            if note.ink.isEmpty || (try? PKDrawing(data: note.ink)) != nil {
                InkCanvas(data: binding(\.ink), editable: note.schemaVersion == 2).accessibilityLabel("Drawing canvas")
            } else {
                ContentUnavailableView("Drawing could not be opened", systemImage: "pencil.tip.crop.circle.badge.exclamationmark",
                    description: Text("The original drawing is preserved."))
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Your personal notes").font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                if note.schemaVersion == 2 {
                    TextEditor(text: binding(\.text)).padding(.horizontal, 8)
                        .accessibilityLabel("Personal notes").accessibilityIdentifier("personalNotes")
                } else {
                    ScrollView { Text(note.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
                }
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

    private var captureControls: some View {
        VStack(spacing: 8) {
            if let problem = player.problem { Text(problem).font(.caption).foregroundStyle(.red) }
            if recording.speakers.state == .failed {
                Text(recording.speakers.detail).font(.caption).foregroundStyle(.orange)
            }
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
                Button(isActive ? "Stop recording" : "Record", systemImage: isActive ? "stop.fill" : "mic.fill") {
                    player.stop()
                    Task {
                        if isActive { await recording.stop(library: library) }
                        else { await recording.start(id, library: library) }
                    }
                }.buttonStyle(.borderedProminent).tint(isActive ? .red : .accentColor)
                    .disabled(library.storageBusy || note.schemaVersion != 2 || recording.busy || (recording.noteID != nil && !isActive) || recording.speech.readiness == .downloading || recording.speakers.preparing)
                    .accessibilityIdentifier("recordButton")
            }
            if recording.busy { ProgressView("Preparing or finalizing recording…").font(.caption) }
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

struct InkCanvas: UIViewRepresentable {
    @Binding var data: Data
    var editable = true

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = DrawingCanvasView()
        canvas.picker = context.coordinator.picker
        canvas.drawingPolicy = .anyInput
        canvas.alwaysBounceVertical = true
        canvas.contentSize = CGSize(width: 1200, height: 1800)
        canvas.minimumZoomScale = 0.25
        canvas.maximumZoomScale = 4
        canvas.tool = PKInkingTool(.pen, color: .label, width: 3)
        canvas.delegate = context.coordinator
        context.coordinator.picker.addObserver(canvas)
        return canvas
    }
    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        context.coordinator.parent = self
        canvas.drawingGestureRecognizer.isEnabled = editable
        if context.coordinator.lastData != data {
            context.coordinator.lastData = data
            canvas.drawing = (try? PKDrawing(data: data)) ?? PKDrawing()
        }
        context.coordinator.picker.setVisible(editable, forFirstResponder: canvas)
    }
    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var parent: InkCanvas
        var lastData = Data()
        let picker = PKToolPicker()
        init(_ parent: InkCanvas) { self.parent = parent }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            let data = canvasView.drawing.dataRepresentation()
            guard data != lastData else { return }
            lastData = data
            parent.data = data
        }
    }
}

final class DrawingCanvasView: PKCanvasView {
    var picker: PKToolPicker?
    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        becomeFirstResponder()
        picker?.setVisible(true, forFirstResponder: self)
    }
}
