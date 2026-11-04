import Foundation
import SwiftUI
import WatchConnectivity

@MainActor @Observable
final class WatchTransfer: NSObject, WCSessionDelegate {
    static let shared = WatchTransfer()
    let store = WatchRecordingStore()
    private(set) var recordings: [WatchRecording] = []
    var error: String?

    override init() {
        super.init()
        WCSession.default.delegate = self
        WCSession.default.activate()
        refresh()
    }

    func refresh() {
        do { recordings = try store.recordings() }
        catch { self.error = "Could not read saved recordings. Reopen the app to retry." }
    }

    func sendPending() {
        refresh()
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        guard session.isCompanionAppInstalled else {
            error = "Install Doodle Note on your paired iPhone. Recordings stay saved on this watch."
            return
        }
        error = nil
        let queued = Set(session.outstandingFileTransfers.compactMap { $0.file.metadata?["id"] as? String })
        for recording in recordings where recording.status == .ready && !queued.contains(recording.id.uuidString) {
            session.transferFile(store.audioURL(recording.id), metadata: recording.metadata)
        }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            if error != nil { self.error = "iPhone connection unavailable. Your recordings are saved here." }
            else { self.sendPending() }
        }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        Task { @MainActor in
            // A successful transport is not an acknowledgement of durable import.
            if error != nil { self.error = "Transfer paused. Tap Retry transfer when your iPhone is available." }
            self.refresh()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let rawID = userInfo["receivedRecordingID"] as? String, let id = UUID(uuidString: rawID) else { return }
        Task { @MainActor in
            do {
                if var recording = try self.store.recordings().first(where: { $0.id == id }) {
                    recording.status = .received
                    try self.store.save(recording)
                    self.refresh()
                }
            } catch { self.error = "Could not save the iPhone receipt. Your audio is still saved here." }
        }
    }
}
