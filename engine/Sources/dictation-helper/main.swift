import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation
import IOKit.hid

// DoodleNote dictation helper: reads one JSON request per stdin line, answers on
// stdout. Exits when stdin closes, so it can never outlive the app.

setvbuf(stdout, nil, _IOLBF, 0)
let snapshots = SnapshotStore()
let watches = FieldWatches()
// Accessibility calls can block on an unresponsive app; keep them off the main
// run loop, which services the hold-key event tap.
let workQueue = DispatchQueue(label: "dictation.work", qos: .userInitiated)
// CoreAudio reads must never queue behind a slow accessibility call, or the
// other way round.
let audioQueue = DispatchQueue(label: "dictation.audio", qos: .utility)

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
                "mouseActive": HoldWatcher.shared.mouseActive,
            ]
            fields["inputMonitoringAccess"] = Permissions.inputMonitoringState
            if let action = HoldKeySpec.fnKeyAction { fields["fnKeyAction"] = action }
            Wire.reply(id, fields)
        }
    case "request-accessibility":
        // Asks macOS for the Accessibility permission from this process, the one that
        // actually inserts text, so the entry macOS lists is the one that matters.
        DispatchQueue.main.async {
            Wire.reply(id, ["trusted": Permissions.requestAccessibility()])
        }
    case "request-input-monitoring":
        DispatchQueue.main.async {
            let granted = Permissions.requestInputMonitoring()
            Wire.reply(id, ["granted": granted, "state": Permissions.inputMonitoringState])
        }
    case "input-state":
        let uid = request["uid"] as? String
        audioQueue.async {
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
    case "mute-output":
        // Silences what is playing while the user dictates. Serial with restore-output
        // on the audio queue, so the two can never cross.
        audioQueue.async {
            let outcome = OutputAudio.mute(on: audioQueue)
            Wire.reply(id, ["outcome": outcome.rawValue])
        }
    case "restore-output":
        audioQueue.async {
            Wire.reply(id, ["outcome": OutputAudio.restore().rawValue])
        }
    case "app-icon":
        let path = request["path"] as? String ?? ""
        workQueue.async {
            guard let png = AppIcon.png(path: path) else {
                Wire.reply(id, ok: false, ["reason": "no-icon"])
                return
            }
            Wire.reply(id, ["png": png.base64EncodedString()])
        }
    case "app-info":
        let ids = (request["bundleIds"] as? [String] ?? []).prefix(AppInfo.maxBatch)
        workQueue.async {
            Wire.reply(id, ["apps": ids.map { AppInfo.lookup(bundleId: $0) }])
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
        let guards = DeliveryGuards(
            expectSelection: request["expectSelection"] as? String,
            replace: request["replace"] as? String)
        let watch = request["watch"] as? Bool ?? false
        workQueue.async {
            guard !text.isEmpty else {
                Wire.reply(id, DeliveryResult(outcome: .failed, reason: "empty-text").fields)
                return
            }
            guard let snapshot = snapshots.get(snapshotId) else {
                Wire.reply(id, DeliveryResult(outcome: .refused, reason: "no-target").fields)
                return
            }
            let result = Delivery.deliver(snapshot, text: text, guards: guards)
            // A snapshot is single-use: a second deliver can never re-insert.
            snapshots.drop(snapshotId)
            // Keep the field for read-backs only when asked, only after a confirmed
            // insertion, and never a secure field.
            if watch, result.outcome == .delivered, let element = snapshot.element,
                !(snapshot.facts?.secure ?? false)
            {
                watches.start(id: snapshotId, pid: snapshot.pid, element: element)
            }
            Wire.reply(id, result.fields)
        }
    case "watch-read":
        let watchId = request["watchId"] as? String ?? ""
        workQueue.async {
            guard let watch = watches.get(watchId) else {
                Wire.reply(id, ["state": "gone"])
                return
            }
            Wire.reply(id, FieldRead.read(watch))
        }
    case "watch-stop":
        if let watchId = request["watchId"] as? String { watches.stop(watchId) }
        Wire.reply(id)
    case "selection":
        // The text currently selected in the field the snapshot was taken from, so a
        // transform can work on it. Never read from a secure field.
        let snapshotId = request["snapshotId"] as? String ?? ""
        workQueue.async {
            guard let snapshot = snapshots.get(snapshotId), let expected = snapshot.element,
                AX.trusted
            else {
                Wire.reply(id, ok: false, ["reason": "no-target"])
                return
            }
            guard AX.frontmostPid() == snapshot.pid,
                let current = AX.focusedElement(pid: snapshot.pid), CFEqual(current, expected)
            else {
                Wire.reply(id, ok: false, ["reason": "focus-changed"])
                return
            }
            let facts = ElementFacts(current)
            if facts.secure || (snapshot.facts?.secure ?? false) {
                Wire.reply(id, ok: false, ["reason": "secure-field"])
                return
            }
            let selected = AX.string(current, kAXSelectedTextAttribute as String) ?? ""
            Wire.reply(id, ["text": selected])
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
    case "mouse-start":
        let button = (request["button"] as? NSNumber)?.int64Value ?? -1
        let swallow = request["swallow"] as? Bool ?? false
        let minHold = request["minHoldMs"] as? Int ?? 150
        let click = (request["mode"] as? String) == "click"
        DispatchQueue.main.async {
            if let failure = HoldWatcher.shared.startMouse(
                button: button, swallow: swallow, minHoldMs: minHold, click: click)
            {
                Wire.reply(id, ok: false, ["reason": failure])
            } else {
                Wire.reply(id, ["swallowing": HoldWatcher.shared.mouseSwallowing])
            }
        }
    case "mouse-stop":
        DispatchQueue.main.async {
            HoldWatcher.shared.stopMouse()
            Wire.reply(id)
        }
    case "mouse-capture":
        let seconds = (request["seconds"] as? NSNumber)?.doubleValue ?? 10
        DispatchQueue.main.async {
            // The watched button must not be swallowed while the user picks a new one.
            HoldWatcher.shared.setMousePaused(true)
            MouseCapture.shared.begin(seconds: max(1, min(seconds, 30))) { fields, reason in
                HoldWatcher.shared.setMousePaused(false)
                if let fields {
                    Wire.reply(id, fields)
                } else {
                    Wire.reply(id, ok: false, ["reason": reason ?? "failed"])
                }
            }
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
    // The app is gone. Make sure no hold stays "down" and no sound stays muted, then leave.
    DispatchQueue.main.sync { HoldWatcher.shared.stopAll() }
    audioQueue.sync { _ = OutputAudio.restore() }
    exit(0)
}.start()

// Being asked to quit must never leave the user's sound muted.
var terminationSources: [DispatchSourceSignal] = []
for signalNumber in [SIGTERM, SIGINT, SIGHUP] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: audioQueue)
    source.setEventHandler {
        _ = OutputAudio.restore()
        exit(0)
    }
    source.resume()
    terminationSources.append(source)
}

Wire.send(["event": "ready", "pid": Int(getpid())])
RunLoop.main.run()
