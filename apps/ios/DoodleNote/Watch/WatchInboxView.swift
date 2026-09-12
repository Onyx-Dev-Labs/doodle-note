import SwiftUI
import SwiftData

struct WatchInboxView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase
    @State private var inbox = WatchInbox.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top, spacing: 14) {
                    Image("Mascot").resizable().scaledToFit().frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 13))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("From your watch.")
                            .font(.system(.title2, design: .serif, weight: .semibold))
                            .foregroundStyle(Color.ink)
                        Text("Turn a conversation into meeting notes.")
                            .font(.subheadline).foregroundStyle(Color.stone)
                    }
                }
                if let error = inbox.error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.subheadline).foregroundStyle(Color.bark)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.sageFill, in: RoundedRectangle(cornerRadius: 16))
                }
                if inbox.recordings.isEmpty { emptyState }
                else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("YOUR RECORDINGS").font(.caption.weight(.semibold))
                            .tracking(1.5).foregroundStyle(Color.stone)
                        ForEach(inbox.recordings) { recording in
                            recordingCard(recording)
                        }
                    }
                    Label("Keep DoodleNote open while transcribing. Audio stays saved on both devices in this preview.", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(Color.stone)
                }
            }
            .padding(20)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color.cream.ignoresSafeArea())
        .navigationTitle("Watch recordings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.cream, for: .navigationBar)
        .tint(Color.sageDeep)
        .onAppear { inbox.refresh() }
        .onChange(of: phase) { _, phase in if phase == .active { inbox.refresh() } }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "applewatch")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(Color.sageDeep)
                .frame(width: 80, height: 80)
                .background(Color.sageFill, in: RoundedRectangle(cornerRadius: 25))
            Text("No watch recordings")
                .font(.system(.title3, design: .serif, weight: .semibold))
                .foregroundStyle(Color.ink)
            Text("Record a conversation on your watch. It will appear here after you stop and your iPhone reconnects.")
                .font(.subheadline).foregroundStyle(Color.stone)
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 28).padding(.vertical, 36)
        .frame(maxWidth: .infinity)
        .background(Color.cardSoft, in: RoundedRectangle(cornerRadius: 22))
        .overlay { RoundedRectangle(cornerRadius: 22).strokeBorder(Color.sand) }
    }

    private func recordingCard(_ recording: WatchRecording) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(recording.startedAt, format: .dateTime.month(.abbreviated).day())
                        .font(.system(.title3, design: .serif, weight: .semibold))
                        .foregroundStyle(Color.ink)
                    Text(recording.startedAt, format: .dateTime.hour().minute())
                        .font(.subheadline).foregroundStyle(Color.stone)
                }
                Spacer()
                Label(Duration.seconds(recording.duration).formatted(.time(pattern: .hourMinuteSecond)), systemImage: "waveform")
                    .font(.caption.monospacedDigit()).foregroundStyle(Color.sageDeep)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(Color.sageFill, in: Capsule())
            }
            if recording.status == .transcribed {
                Label("Added to meetings", systemImage: "checkmark.circle.fill")
                    .font(.subheadline).foregroundStyle(Color.sageDeep)
            } else if inbox.processingID == recording.id {
                ProgressView("Transcribing on this iPhone…")
                    .font(.subheadline).tint(Color.sageDeep)
            } else {
                Button {
                    Task { await inbox.transcribe(recording, container: context.container) }
                } label: {
                    Label("Transcribe & add to meetings", systemImage: "text.bubble")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain).foregroundStyle(Color.cream)
                .background(Color.sageDeep, in: RoundedRectangle(cornerRadius: 12))
                .disabled(inbox.processingID != nil)
                .opacity(inbox.processingID == nil ? 1 : 0.5)
            }
            ShareLink(item: inbox.store.audioURL(recording.id)) {
                Label("Export audio", systemImage: "square.and.arrow.up")
                    .font(.subheadline).foregroundStyle(Color.stone)
                    .frame(minHeight: 44)
            }
        }
        .padding(18)
        .background(Color.cardSoft, in: RoundedRectangle(cornerRadius: 20))
        .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(Color.sand) }
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
