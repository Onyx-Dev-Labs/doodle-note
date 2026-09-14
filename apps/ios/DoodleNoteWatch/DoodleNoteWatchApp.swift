import SwiftUI
import WatchKit
import WatchConnectivity

@main
struct DoodleNoteWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchApplicationDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if let screen = WatchDesignPreview.requested {
                WatchDesignPreview(screen: screen)
            } else {
                WatchRecordingView()
            }
            #else
            Text("Apple Watch recording is in development.")
            #endif
        }
    }
}

struct WatchRecordingView: View {
    @Environment(\.scenePhase) private var phase
    @Environment(\.isLuminanceReduced) private var isDimmed
    @State private var transfer: WatchTransfer
    @State private var recorder: WatchRecorder
    @State private var showLibrary = false
    @State private var showSaved = false
    @State private var levels = Array(repeating: 0.0, count: 24)

    init() {
        let transfer = WatchTransfer.shared
        _transfer = State(initialValue: transfer)
        _recorder = State(initialValue: WatchRecorder(store: transfer.store) { transfer.sendPending() })
    }

    private var mode: WatchCaptureScreen.Mode {
        if let recording = recorder.current { return .recording(recording.startedAt) }
        if recorder.preparing { return .preparing }
        return showSaved ? .saved : .ready
    }

    private var shouldMeter: Bool { recorder.current != nil && phase == .active && !isDimmed }

    var body: some View {
        NavigationStack {
            WatchCaptureScreen(mode: mode, levels: levels,
                recordingCount: transfer.recordings.filter { $0.status != .recording }.count,
                error: recorder.error ?? transfer.error,
                onPrimary: {
                    if recorder.current != nil { recorder.stop() }
                    else {
                        showSaved = false
                        Task { await recorder.start() }
                    }
                },
                onLibrary: { showLibrary = true })
            .navigationDestination(isPresented: $showLibrary) {
                WatchLibraryScreen(recordings: transfer.recordings.filter { $0.status != .recording },
                    error: transfer.error, canRetry: recorder.current == nil,
                    retry: { transfer.sendPending() })
            }
        }
        .tint(WatchTheme.sage)
        .onChange(of: recorder.current?.id) { oldID, newID in
            if oldID != nil && newID == nil { showSaved = recorder.error == nil }
            if newID != nil { levels = Array(repeating: 0, count: 24) }
        }
        .onChange(of: phase) { _, phase in
            if phase == .active, recorder.current == nil { transfer.sendPending() }
        }
        .task(id: shouldMeter) {
            guard shouldMeter else { return }
            while !Task.isCancelled {
                levels.removeFirst()
                levels.append(recorder.sampleLevel())
                do { try await Task.sleep(for: .milliseconds(200)) }
                catch { return }
            }
        }
    }
}

#if DEBUG
/// Explicit launch argument for simulator design review. Uses no recording or
/// connectivity services; never makes a fixture look like a real saved file.
struct WatchDesignPreview: View {
    static var requested: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-watchPreview"), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }
    let screen: String
    private let samples = [0.1, 0.2, 0.1, 0.4, 0.65, 0.95, 0.7, 0.3, 0.15, 0.3, 0.5, 0.8,
                           0.55, 0.25, 0.1, 0.2, 0.4, 0.65, 0.4, 0.2, 0.1, 0.3, 0.5, 0.25]

    var body: some View {
        NavigationStack {
            if screen == "library" {
                WatchLibraryScreen(recordings: [
                    WatchRecording(startedAt: Date(timeIntervalSince1970: 1_789_142_400), duration: 1422, status: .ready),
                    WatchRecording(startedAt: Date(timeIntervalSince1970: 1_789_138_800), duration: 804, status: .received)
                ])
            } else {
                WatchCaptureScreen(mode: screen == "recording" ? .recording(.now.addingTimeInterval(-83))
                                   : screen == "saved" ? .saved : screen == "preparing" ? .preparing : .ready,
                    levels: samples, recordingCount: screen == "saved" ? 1 : 0,
                    error: screen == "error" ? "Allow microphone access in Settings to record a meeting." : nil)
            }
        }.tint(WatchTheme.sage)
    }
}
#endif

@MainActor
final class WatchApplicationDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        #if DEBUG
        if WatchDesignPreview.requested == nil { _ = WatchTransfer.shared }
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
