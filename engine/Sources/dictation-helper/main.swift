import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

// DoodleNote dictation helper: reads one JSON request per stdin line, answers on
// stdout. Exits when stdin closes, so it can never outlive the app.

setvbuf(stdout, nil, _IOLBF, 0)
let snapshots = SnapshotStore()
// Accessibility calls can block on an unresponsive app; keep them off the main
// run loop, which services the hold-key event tap.
let workQueue = DispatchQueue(label: "dictation.work", qos: .userInitiated)

func handle(_ request: [String: Any]) {
    guard let op = request["op"] as? String, let id = request["id"] as? String else { return }
    switch op {
    case "status":
        workQueue.async {
            var fields: [String: Any] = [
                "accessibility": AX.trusted,
                "inputMonitoring": CGPreflightListenEventAccess(),
                "secureInput": IsSecureEventInputEnabled(),
                "conflicts": Target.conflictingDictationApps,
                "holdActive": HoldWatcher.shared.active,
            ]
            if let action = HoldKeySpec.fnKeyAction { fields["fnKeyAction"] = action }
            Wire.reply(id, fields)
        }
    case "input-state":
        let uid = request["uid"] as? String
        workQueue.async {
            guard let device = Microphone.device(uid: uid) else {
                Wire.reply(id, ok: false, ["reason": "no-input-device"])
                return
            }
            let state = Microphone.state(of: device)
            var fields: [String: Any] = [:]
            if let muted = state.muted { fields["muted"] = muted }
            if let volume = state.volume { fields["volume"] = Double(volume) }
            Wire.reply(id, fields)
        }
    case "snapshot":
        let snapshotId = request["snapshotId"] as? String ?? id
        workQueue.async {
            guard let snapshot = Target.capture(id: snapshotId) else {
                Wire.reply(id, ok: false, ["reason": "no-frontmost-app"])
                return
            }
            snapshots.put(snapshot)
            Wire.reply(id, Target.describe(snapshot))
        }
    case "deliver":
        let snapshotId = request["snapshotId"] as? String ?? ""
        let text = request["text"] as? String ?? ""
        workQueue.async {
            guard !text.isEmpty else {
                Wire.reply(id, DeliveryResult(outcome: .failed, reason: "empty-text").fields)
                return
            }
            guard let snapshot = snapshots.get(snapshotId) else {
                Wire.reply(id, DeliveryResult(outcome: .refused, reason: "no-target").fields)
                return
            }
            let result = Delivery.deliver(snapshot, text: text)
            // A snapshot is single-use: a second deliver can never re-insert.
            snapshots.drop(snapshotId)
            Wire.reply(id, result.fields)
        }
    case "release":
        if let snapshotId = request["snapshotId"] as? String { snapshots.drop(snapshotId) }
        Wire.reply(id)
    case "hold-start":
        let key = request["key"] as? String ?? ""
        let minHold = request["minHoldMs"] as? Int ?? 150
        DispatchQueue.main.async {
            if let failure = HoldWatcher.shared.start(key: key, minHoldMs: minHold) {
                Wire.reply(id, ok: false, ["reason": failure])
            } else {
                Wire.reply(id)
            }
        }
    case "hold-stop":
        DispatchQueue.main.async {
            HoldWatcher.shared.stop()
            Wire.reply(id)
        }
    default:
        Wire.reply(id, ok: false, ["reason": "unknown-op"])
    }
}

Thread {
    var buffer = Data()
    while true {
        let chunk = FileHandle.standardInput.availableData
        if chunk.isEmpty { break }
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer.subdata(in: buffer.startIndex..<newline)
            buffer.removeSubrange(buffer.startIndex...newline)
            if let object = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] {
                handle(object)
            }
        }
    }
    // The app is gone. Make sure no hold stays "down" for anyone, then leave.
    DispatchQueue.main.sync { HoldWatcher.shared.stop() }
    exit(0)
}.start()

Wire.send(["event": "ready", "pid": Int(getpid())])
RunLoop.main.run()
