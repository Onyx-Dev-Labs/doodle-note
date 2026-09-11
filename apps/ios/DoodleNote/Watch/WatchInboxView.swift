import SwiftUI
import SwiftData

struct WatchInboxView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase
    @State private var inbox = WatchInbox.shared

    var body: some View {
        List {
            Section {
                Text("Record on your Apple Watch, then transfer the audio to this iPhone. Transcribe here to add it to your meetings.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("Keep Doodle Note open while transcribing. Audio stays saved on both devices in this preview.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let error = inbox.error {
                Section { Text(error).foregroundStyle(.orange) }
            }
            if inbox.recordings.isEmpty {
                ContentUnavailableView("No watch recordings", systemImage: "applewatch", description: Text("Start a recording in Doodle Note on your watch."))
            }
            ForEach(inbox.recordings) { recording in
                Section {
                    Text(recording.startedAt, format: .dateTime.month().day().hour().minute())
                    Text(Duration.seconds(recording.duration).formatted(.time(pattern: .hourMinuteSecond)))
                        .font(.caption).foregroundStyle(.secondary)
                    if recording.status == .transcribed {
                        Text("Added to meetings").foregroundStyle(.secondary)
                    } else if inbox.processingID == recording.id {
                        ProgressView("Transcribing on this iPhone…")
                    } else {
                        Button("Transcribe & add to meetings") {
                            Task { await inbox.transcribe(recording, container: context.container) }
                        }.disabled(inbox.processingID != nil)
                    }
                    ShareLink("Export audio", item: inbox.store.audioURL(recording.id))
                }
            }
        }
        .navigationTitle("Watch recordings")
        .onAppear { inbox.refresh() }
        .onChange(of: phase) { _, phase in if phase == .active { inbox.refresh() } }
    }
}


struct WatchInboxSection: View {
    var body: some View {
        if AppFeatures.watchRecording {
            Section {
                NavigationLink {
                    WatchInboxView()
                } label: {
                    Label("Watch recordings", systemImage: "applewatch")
                }
            }
        }
    }
}
