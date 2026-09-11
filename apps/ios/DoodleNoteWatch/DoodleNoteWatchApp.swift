import SwiftUI
import WatchKit
import WatchConnectivity

@main
struct DoodleNoteWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchApplicationDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            WatchRecordingView()
            #else
            Text("Apple Watch recording is in development.")
            #endif
        }
    }
}

struct WatchRecordingView: View {
    @Environment(\.scenePhase) private var phase
    @State private var transfer: WatchTransfer
    @State private var recorder: WatchRecorder

    init() {
        let transfer = WatchTransfer.shared
        _transfer = State(initialValue: transfer)
        _recorder = State(initialValue: WatchRecorder(store: transfer.store) { transfer.sendPending() })
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text("Doodle Note").font(.headline)
                if let recording = recorder.current {
                    Label("Recording", systemImage: "mic.fill").foregroundStyle(.red)
                    Text(recording.startedAt, style: .timer).font(.title2.monospacedDigit())
                    Button("Stop & save", systemImage: "stop.fill") { recorder.stop() }
                        .tint(.red).buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("watch.stop")
                } else {
                    Button {
                        Task { await recorder.start() }
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "mic.fill").font(.largeTitle)
                            Text(recorder.preparing ? "Preparing…" : "Start recording")
                        }.frame(maxWidth: .infinity).padding(.vertical, 10)
                    }
                    .tint(.green).buttonStyle(.borderedProminent)
                    .disabled(recorder.preparing)
                    .accessibilityIdentifier("watch.start")
                    Text("Uses this watch’s microphone.").font(.caption2).foregroundStyle(.secondary)
                }
                if let error = recorder.error ?? transfer.error {
                    Text(error).font(.caption2).foregroundStyle(.orange)
                }
                if !transfer.recordings.isEmpty {
                    Divider()
                    ForEach(transfer.recordings) { recording in
                        VStack(alignment: .leading) {
                            Text(recording.startedAt, format: .dateTime.month().day().hour().minute())
                            Text(status(recording)).foregroundStyle(.secondary)
                        }.font(.caption2).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Button("Retry transfer") { transfer.sendPending() }
                        .disabled(recorder.current != nil)
                }
            }.padding(.horizontal, 4)
        }
        .onChange(of: phase) { _, phase in
            if phase == .active, recorder.current == nil { transfer.sendPending() }
        }
    }

    private func status(_ recording: WatchRecording) -> String {
        switch recording.status {
        case .received, .transcribed: "Saved on iPhone"
        case .ready: "Saved here · waiting for iPhone"
        case .recording: "Recording"
        case .interrupted: "Interrupted · audio retained"
        }
    }
}


@MainActor
final class WatchApplicationDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        #if DEBUG
        _ = WatchTransfer.shared
        #endif
    }

    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if task is WKWatchConnectivityRefreshBackgroundTask {
                Task { @MainActor in
                    // Let queued receipts reach the delegate before completing
                    // this wake. Bound the wait within the background time budget.
                    let deadline = ContinuousClock.now.advanced(by: .seconds(20))
                    while ContinuousClock.now < deadline,
                          WCSession.default.activationState != .activated || WCSession.default.hasContentPending {
                        try? await Task.sleep(for: .milliseconds(200))
                    }
                    task.setTaskCompletedWithSnapshot(false)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}
