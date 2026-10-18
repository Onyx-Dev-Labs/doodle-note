import SwiftUI

/// Presentation only: previews and simulator snapshots cannot activate the mic,
/// transfer files, or mutate the user's recording store.
struct WatchCaptureScreen: View {
    enum Mode: Equatable {
        case ready, preparing, recording(Date), saved
    }

    let mode: Mode
    var levels: [Double] = Array(repeating: 0, count: 24)
    var recordingCount = 0
    var error: String?
    var onPrimary: () -> Void = {}
    var onLibrary: () -> Void = {}
    @Environment(\.isLuminanceReduced) private var isDimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .title2) private var headingSize = 28

    private var isRecording: Bool {
        if case .recording = mode { return true }
        return false
    }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 180
            VStack(spacing: 6) {
                ScrollView {
                    VStack(alignment: .leading, spacing: compact ? 4 : 8) {
                        WatchWordmark(compact: compact)
                        if case .recording(let startedAt) = mode {
                            recordingPanel(startedAt: startedAt, compact: compact)
                        } else {
                            idlePanel(compact: compact, width: geometry.size.width)
                        }
                        if let error {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.caption2).foregroundStyle(WatchTheme.danger)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("watch.error")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 2)
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.hidden)
                .defaultScrollAnchor(.top)
                primaryAction.padding(.horizontal, 12).padding(.bottom, 14)
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(WatchTheme.background.ignoresSafeArea())
        .foregroundStyle(WatchTheme.ink)
        .tint(WatchTheme.sage)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onLibrary) {
                    Image(systemName: "waveform.path")
                        .foregroundStyle(WatchTheme.sage)
                }
                .tint(WatchTheme.card)
                .accessibilityLabel("Recordings")
                .accessibilityValue(recordingCount.formatted())
                .accessibilityIdentifier("watch.library")
            }
        }
    }

    private func idlePanel(compact: Bool, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: mode == .saved ? "checkmark.circle.fill" : "waveform")
                Text(mode == .saved ? "ON YOUR WATCH" : "IN PERSON")
                    .tracking(1.4)
            }
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(WatchTheme.sage)
            Text(mode == .saved ? "Saved." : "Keep the\nconversation.")
                .font(.system(size: min(headingSize, (width - 24) * 0.14), weight: .medium, design: .serif))
                .tracking(-0.7)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(mode == .saved ? "watch.saved" : "watch.ready")
        }
        .padding(.vertical, compact ? 0 : 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func recordingPanel(startedAt: Date, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 4) {
            HStack(spacing: 6) {
                Circle().fill(WatchTheme.danger).frame(width: 6, height: 6)
                Text("RECORDING").tracking(1)
                    .font(.system(size: 10, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "applewatch").font(.system(size: 11))
            }.foregroundStyle(WatchTheme.secondary)
            Text(startedAt, style: .timer)
                .font(.system(size: compact ? 22 : 30, weight: .medium, design: .monospaced))
                .monospacedDigit().contentTransition(.identity)
                .minimumScaleFactor(0.7).lineLimit(1)
                .accessibilityLabel("Recording duration")
            HStack(alignment: .center, spacing: 3) {
                ForEach(levels.indices, id: \.self) { index in
                    Capsule()
                        .fill(WatchTheme.sage.opacity(isDimmed ? 0.4 : 0.85))
                        .frame(maxWidth: .infinity)
                        .frame(height: isDimmed ? 3 : 3 + levels[index] * (compact ? 5 : 13))
                }
            }
            .frame(height: compact ? 8 : 16)
            .animation(reduceMotion || isDimmed ? nil : .easeOut(duration: 0.18), value: levels)
            .accessibilityHidden(true)
        }
        .padding(compact ? 4 : 8)
        .background(WatchTheme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(WatchTheme.border)
        }
    }

    private var primaryAction: some View {
        Button(action: onPrimary) {
            HStack(spacing: 9) {
                if mode == .preparing {
                    ProgressView().tint(WatchTheme.background)
                } else {
                    Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(.body, weight: .medium))
                }
                Text(isRecording ? "Stop & save" : mode == .preparing ? "Preparing…" : "Record")
                    .minimumScaleFactor(0.7).lineLimit(1)
            }.padding(.horizontal, 10)
        }
        .buttonStyle(WatchActionStyle(isStop: isRecording))
        .disabled(mode == .preparing)
        .accessibilityLabel(isRecording ? "Stop and save recording" : "Record meeting")
        .accessibilityIdentifier(isRecording ? "watch.stop" : "watch.start")
        .accessibilityHint(isRecording ? "Saves the audio on your watch" : "Records using this watch’s microphone")
    }


}

#Preview("Ready") { WatchCaptureScreen(mode: .ready) }
#Preview("Recording") {
    WatchCaptureScreen(mode: .recording(.now.addingTimeInterval(-83)),
        levels: [0.1, 0.2, 0.3, 0.6, 0.8, 0.4, 0.2, 0.1, 0.3, 0.7, 0.9, 0.5], recordingCount: 2)
}
#Preview("Saved") { WatchCaptureScreen(mode: .saved, recordingCount: 1) }
#Preview("Permission denied") {
    WatchCaptureScreen(mode: .ready, error: "Allow microphone access in Settings to record a meeting.")
}
