import Foundation

@main
struct EngineMain {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else {
            Events.error(
                "usage: engine <transcribe|stream|live|merge-audio|info> [--file <path>] [--model v2|v3] [--realtime] [--source mic|system|both] [--seconds N] [--audio-dir <path>] [--dir <path>]"
            )
            exit(64)
        }

        let options = CLIOptions(args.dropFirst())
        do {
            switch command {
            case "transcribe":
                try await Commands.transcribe(options)
            case "stream":
                try await Commands.stream(options)
            case "live":
                try await LiveCommand.run(options)
            case "preflight":
                await PreflightCommand.run()
            case "micmon":
                MicMonitorCommand.run()
            case "serve":
                try await ServeCommand.run(options)
            case "merge-audio":
                // Post-crash recovery: merge a session's leftover checkpoint
                // chunks into audio.m4a — the same code path a clean stop runs.
                guard let dir = options.values["dir"] else {
                    throw EngineError.usage("merge-audio requires --dir <session audio directory>")
                }
                let saved = try SessionRecorder.mergeAndClean(directory: URL(fileURLWithPath: dir))
                Events.emit([
                    "event": "audio",
                    "path": saved.url.path,
                    "durationMs": saved.durationMs,
                    "startEpochMs": saved.startEpochMs,
                ])
                Events.emit(["event": "done"])
            case "devices":
                DevicesCommand.run()
            case "info":
                Commands.info()
            default:
                throw EngineError.usage("unknown command: \(command)")
            }
        } catch let error as EngineError {
            Events.error(error.message)
            exit(64)
        } catch {
            Events.error(String(describing: error))
            exit(1)
        }
    }
}

/// Minimal `--key value` / `--flag` parser; no positional arguments.
struct CLIOptions {
    private(set) var values: [String: String] = [:]
    private(set) var flags: Set<String> = []

    init(_ args: ArraySlice<String>) {
        var iterator = args.makeIterator()
        var pending: String?
        while let arg = iterator.next() {
            if arg.hasPrefix("--") {
                if let key = pending { flags.insert(key) }
                pending = String(arg.dropFirst(2))
            } else if let key = pending {
                values[key] = arg
                pending = nil
            }
        }
        if let key = pending { flags.insert(key) }
    }

    func requireFile() throws -> URL {
        guard let path = values["file"] else {
            throw EngineError.usage("--file <path> is required")
        }
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw EngineError.usage("file not found: \(url.path)")
        }
        return url
    }
}

enum EngineError: Error {
    case usage(String)
    case internalError(String)

    var message: String {
        switch self {
        case .usage(let m): return m
        case .internalError(let m): return m
        }
    }
}
