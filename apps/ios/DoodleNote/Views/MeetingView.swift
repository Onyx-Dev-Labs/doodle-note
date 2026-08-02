import SwiftUI
import SwiftData

struct MeetingView: View {
    @Bindable var meeting: Meeting
    var startRecordingOnAppear = false
    var discardEmptyDraftOnExit = false
    var onDraftResolved: (() -> Void)?

    @Environment(\.modelContext) private var context
    @Environment(\.openURL) private var openURL
    @Query(sort: \Folder.createdAt) private var folders: [Folder]
    @State private var recorder = RecordingController()
    @State private var tab: Tab = .notes
    @State private var isGenerating = false
    @State private var generationError: String?
    @State private var showChat = false

    enum Tab: String, CaseIterable {
        case notes = "Notes"
        case transcript = "Transcript"
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if meeting.isNote {
                // Quick note: just the editor — no recording chrome, no
                // transcript tab (there is nothing to transcribe).
                notesTab
            } else {
                recordingControls

                Picker("View", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

                switch tab {
                case .notes: notesTab
                case .transcript: transcriptTab
                }
            }
        }
        .background(Color.cream)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showChat = true
                } label: {
                    Label("Ask", systemImage: "sparkles")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Folder", selection: $meeting.folderId) {
                        Text("No folder").tag(UUID?.none)
                        ForEach(folders) { folder in
                            Text(folder.name).tag(UUID?.some(folder.id))
                        }
                    }
                } label: {
                    Image(systemName: meeting.folderId == nil ? "folder" : "folder.fill")
                }
                .accessibilityLabel("Move to folder")
            }
        }
        .sheet(isPresented: $showChat) {
            ChatView(scope: .meeting(meeting))
        }
        .task {
            if startRecordingOnAppear, !recorder.isActive {
                await recorder.start(meeting: meeting, context: context)
            }
        }
        .onDisappear {
            Task {
                if recorder.isActive {
                    await recorder.stop(meeting: meeting, context: context)
                }
                resolveDraftOnExit()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(meeting.isNote ? "Untitled note" : "Untitled meeting",
                      text: $meeting.title, axis: .vertical)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.ink)
                .lineLimit(2)
            Text(meeting.createdAt, format: .dateTime.weekday().month().day().hour().minute())
                .font(.caption)
                .foregroundStyle(Color.stone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: Recording

    @ViewBuilder private var recordingControls: some View {
        switch recorder.state {
        case .idle:
            recordingBar(
                icon: "record.circle",
                message: meeting.startedAt == nil ? "Ready to record" : "Recording finished"
            ) {
                if meeting.startedAt == nil {
                    Button("Start recording") { Task { await startRecording() } }
                        .buttonStyle(RecordingActionButtonStyle())
                        .accessibilityIdentifier("recording.start")
                }
            }
        case .preparing(let status):
            recordingBar(icon: "waveform", message: status, showsProgress: true) {
                Button("Cancel") {
                    Task { await recorder.stop(meeting: meeting, context: context) }
                }
                .buttonStyle(RecordingActionButtonStyle())
                .accessibilityIdentifier("recording.cancel")
            }
        case .recording:
            recordingBar(icon: "record.circle.fill", message: "Recording", isRecording: true) {
                Button("Stop") { Task { await stopRecording() } }
                    .buttonStyle(RecordingActionButtonStyle())
                    .accessibilityIdentifier("recording.stop")
            }
        case .stopping:
            recordingBar(icon: "stop.circle", message: "Finishing transcript…", showsProgress: true) {
                EmptyView()
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 10) {
                Label("Recording unavailable", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.orange)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Color.bark)
                HStack(spacing: 10) {
                    Button("Retry recording") { Task { await startRecording() } }
                        .buttonStyle(RecordingActionButtonStyle())
                        .accessibilityIdentifier("recording.retry")
                    Button("Open Settings") {
                        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                        openURL(url)
                    }
                    .font(.footnote.weight(.semibold))
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.orange.opacity(0.45)))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .accessibilityIdentifier("recording.failed")
        }
    }

    private func recordingBar<Actions: View>(
        icon: String,
        message: String,
        showsProgress: Bool = false,
        isRecording: Bool = false,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        HStack(spacing: 10) {
            if showsProgress {
                ProgressView().tint(Color.sageDeep)
            } else {
                Image(systemName: icon)
                    .foregroundStyle(isRecording ? Color.red : Color.sageDeep)
            }
            if isRecording, let started = recorder.recordingStartedAt {
                ElapsedTimeText(since: started)
                    .font(.footnote.monospacedDigit().weight(.medium))
                    .foregroundStyle(Color.ink)
            }
            Text(message)
                .font(.footnote)
                .foregroundStyle(Color.bark)
                .lineLimit(2)
            Spacer()
            actions()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.sageFill)
        .accessibilityIdentifier("recording.status")
    }

    // MARK: Notes tab

    private var notesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(meeting.isNote ? "Your note" : "Your rough notes")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.stone)
                    // A growing TextField (not TextEditor): TextEditor has its
                    // own scroll view that fights the page ScrollView, so the
                    // notes screen wouldn't scroll on the first touch. TextField
                    // with a vertical axis grows to fit and never scrolls itself.
                    TextField(
                        meeting.isNote ? "Write anything…" : "Jot your rough notes…",
                        text: $meeting.roughNotes,
                        axis: .vertical
                    )
                    .lineLimit(4...)
                    .padding(12)
                    .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12).stroke(Color.sand)
                    )
                    .font(.body)
                    .foregroundStyle(Color.ink)
                }

                // Notes have no transcript to merge — generation is meetings-only.
                if !meeting.isNote {
                    generateSection
                }

                if let notes = meeting.generatedNotes {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Meeting notes")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.stone)
                        MarkdownText(markdown: notes)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.cardSoft, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12).stroke(Color.sand)
                            )
                    }
                }
            }
            .padding(16)
        }
    }

    private var generateSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    Task { await generateNotes() }
                } label: {
                    HStack(spacing: 6) {
                        if isGenerating {
                            ProgressView().tint(Color.cream)
                        } else {
                            Image(systemName: "sparkles")
                        }
                        Text(meeting.generatedNotes == nil ? "Generate notes" : "Regenerate")
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.sageDeep, in: Capsule())
                    .foregroundStyle(Color.cream)
                }
                .disabled(isGenerating || recorder.isActive || !meeting.hasNoteSourceContent)

                Picker("Template", selection: $meeting.templateId) {
                    ForEach(NotePrompt.templates) { template in
                        Text(template.label).tag(template.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.sageDeep)
            }

            if let generationError {
                Text(generationError)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private func generateNotes() async {
        isGenerating = true
        generationError = nil
        defer { isGenerating = false }

        let input = NotesInput(
            title: meeting.displayTitle,
            roughNotes: meeting.roughNotes,
            segments: meeting.sortedSegments.map { ($0.speaker, $0.text, $0.startMs) },
            durationMs: meeting.durationMs,
            templateId: meeting.templateId
        )
        do {
            let notes = try await NotesEngineFactory.make().generate(input)
            meeting.generatedNotes = notes
            try? context.save()

            // Ad-hoc meetings (not created from a calendar event) usually have
            // no real title — let the model name them from what was discussed.
            if meeting.calendarEventId == nil, isUntitled(meeting.title) {
                await titleFromNotes(notes: notes)
            }
            // A fresh note is exactly what other devices are waiting for.
            if SyncEngine.shared.isLinked {
                await SyncEngine.shared.syncNow(context: context)
            }
        } catch {
            generationError = error.localizedDescription
        }
    }

    private func isUntitled(_ title: String) -> Bool {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return t.isEmpty || t == "untitled meeting" || t == "new meeting"
    }

    /// One short title from the generated notes. Best-effort: a failure or an
    /// odd response leaves the meeting titled as it was.
    private func titleFromNotes(notes: String) async {
        let engine = NotesEngineFactory.make()
        let system = "You write a concise meeting title of 3 to 6 words. "
            + "Reply with ONLY the title — no quotes, no punctuation at the end, no preamble."
        let user = "Meeting notes:\n\n" + String(notes.prefix(1500))
        guard let raw = try? await engine.respond(system: system, user: user) else { return }
        let title = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'.“”"))
        guard !title.isEmpty, title.count <= 80 else { return }
        meeting.title = title
        try? context.save()
    }

    // MARK: Transcript tab

    private var transcriptTab: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if meeting.segments.isEmpty && recorder.livePartial.isEmpty {
                    Text(recorder.isActive
                        ? "Listening…"
                        : "No transcript. Start recording to capture one.")
                        .font(.subheadline)
                        .foregroundStyle(Color.stone)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 40)
                }

                ForEach(meeting.sortedSegments) { segment in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(NotePrompt.formatTimestamp(ms: segment.startMs))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Color.stone)
                        Text(segment.text)
                            .font(.callout)
                            .foregroundStyle(Color.ink)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.card, in: RoundedRectangle(cornerRadius: 10))
                }

                if !recorder.livePartial.isEmpty {
                    Text(recorder.livePartial)
                        .font(.callout)
                        .foregroundStyle(Color.stone)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Color.sageFill, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(16)
        }
        .defaultScrollAnchor(.bottom)
    }

    private func startRecording() async {
        await recorder.start(meeting: meeting, context: context)
    }

    private func stopRecording() async {
        await recorder.stop(meeting: meeting, context: context)
        if SyncEngine.shared.isLinked {
            await SyncEngine.shared.syncNow(context: context)
        }
    }

    private func resolveDraftOnExit() {
        guard discardEmptyDraftOnExit else { return }
        if meeting.isEmptyDraft {
            context.delete(meeting)
            try? context.save()
        }
        onDraftResolved?()
    }
}

private struct RecordingActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Color.ink.opacity(configuration.isPressed ? 0.75 : 1), in: Capsule())
            .foregroundStyle(Color.cream)
    }
}

/// Self-updating elapsed-time label (m:ss) for the recording banner.
struct ElapsedTimeText: View {
    let since: Date

    var body: some View {
        TimelineView(.periodic(from: since, by: 1)) { timeline in
            let seconds = max(0, Int(timeline.date.timeIntervalSince(since)))
            Text("\(seconds / 60):" + String(format: "%02d", seconds % 60))
        }
    }
}
