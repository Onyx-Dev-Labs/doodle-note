import Foundation

/// NDJSON over stdio between the DoodleNote main process and this helper.
///
/// Requests:  {"op":"status|snapshot|deliver|release|hold-start|hold-stop","id":"…", …}
/// Replies:   {"event":"reply","id":"…","ok":true|false, …}
/// Unsolicited events: {"event":"hold","phase":"down|up","holdId":N,"reason":"…"}
///
/// The helper holds no credentials and never sees provider keys. It receives
/// only a snapshot id, the text to insert and delivery options.
enum Wire {
    private static let lock = NSLock()

    static func send(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    static func reply(_ id: String, ok: Bool = true, _ fields: [String: Any] = [:]) {
        var payload = fields
        payload["event"] = "reply"
        payload["id"] = id
        payload["ok"] = ok
        send(payload)
    }

    static func log(_ message: String) {
        if let data = ("[dictation-helper] " + message + "\n").data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}
