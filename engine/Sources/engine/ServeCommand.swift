import FluidAudio
import Foundation

/// Persistent engine: load the ASR models ONCE, then run capture sessions on
/// demand — recording starts Granola-instant instead of paying the per-spawn
/// model warm-up. NDJSON commands on stdin:
///   {"cmd":"start","source":"both","aec":"off"}
///   {"cmd":"stop"}
/// Session events on stdout are identical to the `live` command's, ending in
/// "done"; between sessions the managers reset (models stay loaded). stdin
/// EOF or SIGTERM stops any active session and exits.
enum ServeCommand {
    static func run(_ options: CLIOptions) async throws {
        StopController.shared.arm()

        Events.emit(["event": "status", "stage": "serve_loading_models"])
        let micManager = StreamingUnifiedAsrManager()
        let systemManager = StreamingUnifiedAsrManager()
        try await micManager.loadModels()
        try await systemManager.loadModels()
        Events.emit(["event": "status", "stage": "serve_ready"])

        let box = SessionBox()

        // SIGTERM/SIGINT: host is quitting — drain the session, then exit.
        Task {
            await StopController.shared.wait(timeoutSeconds: nil)
            box.stop()
            await box.awaitCurrent()
            exit(0)
        }

        for await line in stdinLines() {
            guard
                let data = line.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let cmd = object["cmd"] as? String
            else { continue }

            switch cmd {
            case "start":
                let stopper = Stopper()
                let source = object["source"] as? String ?? "both"
                let aec = (object["aec"] as? String) == "on"
                let inputDevice = (object["inputDevice"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let audioDir = (object["audioDir"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let systemBackend = (object["systemBackend"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let started = box.begin(stopper) {
                    do {
                        try await LiveSession.run(
                            source: source,
                            aec: aec,
                            seconds: nil,
                            inputDevice: inputDevice,
                            audioDir: audioDir,
                            systemBackend: systemBackend,
                            micManager: micManager,
                            systemManager: systemManager,
                            stopper: stopper
                        )
                    } catch {
                        Events.emit(["event": "error", "message": "session failed: \(error)"])
                        Events.emit(["event": "done"])
                    }
                    // Models stay loaded; transcription state clears for next time.
                    try? await micManager.reset()
                    try? await systemManager.reset()
                }
                if !started {
                    Events.emit(["event": "error", "message": "a session is already active"])
                }
            case "stop":
                box.stop()
            case "set-input":
                // Mid-session mic switch; ignored (with a log) when idle.
                MicController.shared.switchInput(toUID: object["uid"] as? String)
            default:
                Events.log("serve: unknown command \(cmd)")
            }
        }

        // stdin closed — host process is gone.
        Events.log("serve: stdin closed — host gone; draining session")
        box.stop()
        await box.awaitCurrent()
        exit(0)
    }

    /// stdin, line by line, as an AsyncStream (finishes on EOF).
    private static func stdinLines() -> AsyncStream<String> {
        AsyncStream { continuation in
            Thread {
                var buffer = Data()
                while true {
                    let chunk = FileHandle.standardInput.availableData
                    if chunk.isEmpty { break }  // EOF
                    buffer.append(chunk)
                    while let newline = buffer.firstIndex(of: 0x0A) {
                        let lineData = buffer.subdata(in: buffer.startIndex..<newline)
                        buffer.removeSubrange(buffer.startIndex...newline)
                        if let line = String(data: lineData, encoding: .utf8),
                            !line.trimmingCharacters(in: .whitespaces).isEmpty
                        {
                            continuation.yield(line)
                        }
                    }
                }
                continuation.finish()
            }.start()
        }
    }
}

/// At most one session at a time; thread-safe handle to stop/await it.
final class SessionBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stopper: Stopper?
    private var task: Task<Void, Never>?

    /// Starts the session task unless one is already active.
    func begin(_ stopper: Stopper, _ body: @escaping @Sendable () async -> Void) -> Bool {
        lock.lock()
        guard task == nil else {
            lock.unlock()
            return false
        }
        self.stopper = stopper
        let task = Task {
            await body()
            self.clear()
        }
        self.task = task
        lock.unlock()
        return true
    }

    func stop() {
        lock.lock()
        let stopper = self.stopper
        lock.unlock()
        stopper?.stop()
    }

    func awaitCurrent() async {
        lock.lock()
        let task = self.task
        lock.unlock()
        await task?.value
    }

    private func clear() {
        lock.lock()
        stopper = nil
        task = nil
        lock.unlock()
    }
}
