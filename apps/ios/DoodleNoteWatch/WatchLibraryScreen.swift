import SwiftUI

struct WatchLibraryScreen: View {
    let recordings: [WatchRecording]
    var error: String?
    var canRetry = true
    var retry: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if recordings.isEmpty {
                    VStack(alignment: .leading, spacing: 9) {
                        Image(systemName: "waveform.path").font(.title2).foregroundStyle(WatchTheme.sage)
                        Text("Room for your\nnext conversation.")
                            .font(.system(.body, design: .serif))
                        Text("Your saved audio will appear here.")
                            .font(.caption2).foregroundStyle(WatchTheme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 16))
                }
                ForEach(recordings) { recording in
                    recordingRow(recording)
                }
                if let error {
                    Text(error).font(.caption2).foregroundStyle(WatchTheme.danger)
                }
                if recordings.contains(where: { $0.status == .ready }) {
                    Button(action: retry) {
                        Label("Retry transfer", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption)
                    }
                    .buttonStyle(WatchActionStyle()).disabled(!canRetry)
                }
                if !recordings.isEmpty {
                    Text("Open Watch recordings on your iPhone to transcribe.")
                        .font(.caption2).foregroundStyle(WatchTheme.muted)
                }
            }.padding(.horizontal, 10).padding(.bottom, 12)
        }
        .scrollIndicators(.hidden)
        .background(WatchTheme.background.ignoresSafeArea())
        .foregroundStyle(WatchTheme.ink)
        .tint(WatchTheme.sage)
        .navigationTitle("Library")
    }

    private func recordingRow(_ recording: WatchRecording) -> some View {
        let received = recording.status == .received || recording.status == .transcribed
        let interrupted = recording.status == .interrupted
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(recording.startedAt, format: .dateTime.hour().minute())
                    .font(.system(.body, design: .serif, weight: .medium))
                Spacer(minLength: 4)
                Text(Duration.seconds(recording.duration).formatted(.time(pattern: .minuteSecond)))
                    .font(.caption2).monospacedDigit().foregroundStyle(WatchTheme.muted)
            }
            Text(recording.startedAt, format: .dateTime.month(.abbreviated).day())
                .font(.caption2).foregroundStyle(WatchTheme.muted)
            Label(received ? "On your iPhone" : interrupted ? "Interrupted" : "Waiting for iPhone",
                  systemImage: received ? "checkmark.circle.fill" : interrupted ? "exclamationmark.circle" : "arrow.up.circle")
                .font(.caption2)
                .foregroundStyle(interrupted ? WatchTheme.danger : WatchTheme.sage)
        }
        .padding(12)
        .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(WatchTheme.border) }
        .accessibilityElement(children: .combine)
    }
}
