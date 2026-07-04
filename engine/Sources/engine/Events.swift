import Foundation

/// NDJSON event stream on stdout — the contract between the engine and its host
/// (the Electron app, or a terminal during development).
///
/// Every line is a single JSON object with an `event` field:
///   {"event":"status","stage":"loading_models","model":"parakeet-tdt-v2"}
///   {"event":"download","progress":0.42,"phase":"downloading"}
///   {"event":"ready"}
///   {"event":"partial","text":"hello wor"}
///   {"event":"final","text":"Hello world.","confidence":0.97,...}
///   {"event":"error","message":"..."}
///
/// Diagnostics go to stderr so stdout stays machine-parseable.
enum Events {
    private static let lock = NSLock()

    static func emit(_ payload: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        guard JSONSerialization.isValidJSONObject(payload),
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        else {
            log("dropped unencodable event: \(payload)")
            return
        }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    static func error(_ message: String) {
        emit(["event": "error", "message": message])
    }

    static func log(_ message: String) {
        if let data = ("[engine] " + message + "\n").data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
    }
}

/// Deduplicates download progress callbacks to whole-percent steps so the
/// event stream stays readable. Safe to call from concurrent download callbacks.
final class PercentGate: @unchecked Sendable {
    private let lock = NSLock()
    private var lastPercent = -1

    /// Returns the percentage if it advanced to a new whole percent, else nil.
    func advance(_ fraction: Double) -> Int? {
        let pct = max(0, min(100, Int(fraction * 100)))
        lock.lock()
        defer { lock.unlock() }
        guard pct > lastPercent else { return nil }
        lastPercent = pct
        return pct
    }
}
