import SwiftUI
import SwiftData

struct MeetingView: View {
    @Bindable var meeting: Meeting
    var startRecordingOnAppear = false

    @Environment(\.modelContext) private var context
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

            if recorder.isActive {
                recordingBanner
            }

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
            if recorder.isActive {
                Task { await recorder.stop(meeting: meeting, context: context) }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField("Untitled meeting", text: $meeting.title, axis: .vertical)
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

    private var recordingBanner: some View {
        HStack(spacing: 10) {
            switch recorder.state {
            case .preparing(let status):
                ProgressView().tint(Color.sageDeep)
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(Color.bark)
                    .lineLimit(2)
            case .recording:
                Circle()
                    .fill(.red)
                    .frame(width: 10, height: 10)
                if let started = recorder.recordingStartedAt {
                    ElapsedTimeText(since: started)
                        .font(.footnote.monospacedDigit().weight(.medium))
                        .foregroundStyle(Color.ink)
                }
                Text("Recording")
                    .font(.footnote)
                    .foregroundStyle(Color.bark)
            default:
                EmptyView()
            }

            Spacer()

            Button {
                Task { await recorder.stop(meeting: meeting, context: context) }
            } label: {
                Label("Stop", systemImage: "stop.fill")
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.ink, in: Capsule())
                    .foregroundStyle(Color.cream)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.sageFill)
    }

    // MARK: Notes tab

    private var notesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your rough notes")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.stone)
                    TextEditor(text: $meeting.roughNotes)
                        .frame(minHeight: 120)
                        .padding(8)
                        .scrollContentBackground(.hidden)
                        .background(Color.card, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12).stroke(Color.sand)
                        )
                        .font(.body)
                        .foregroundStyle(Color.ink)
                }

                generateSection

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
                .disabled(isGenerating || recorder.isActive)

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
        } catch {
            generationError = error.localizedDescription
        }
    }

    // MARK: Transcript tab

    private var transcriptTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
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
