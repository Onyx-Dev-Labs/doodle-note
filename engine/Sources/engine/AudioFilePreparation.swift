import AVFoundation
import Foundation

enum AudioFilePreparation {
    /// AVAudioFile reads the existing audio imports directly. An MP4 video is
    /// first normalized to a temporary audio-only M4A so video tracks never
    /// enter the ASR path and the same channel splitter can process both.
    static func prepare(
        _ sourceURL: URL, temporaryParent: URL = FileManager.default.temporaryDirectory
    ) async throws -> PreparedAudioFile {
        try Task.checkCancellation()
        do {
            let file = try AVAudioFile(forReading: sourceURL)
            guard file.length > 0 else {
                throw EngineError.internalError("audio file has no content: \(sourceURL.path)")
            }
            return PreparedAudioFile(url: sourceURL, temporaryDirectory: nil)
        } catch {
            guard sourceURL.pathExtension.lowercased() == "mp4" else { throw error }
        }
        return try await normalizeMP4(sourceURL, temporaryParent: temporaryParent)
    }

    static func normalizeMP4(_ sourceURL: URL, temporaryParent: URL) async throws -> PreparedAudioFile {
        let asset = AVURLAsset(url: sourceURL)
        do {
            let audioTracks = try await asset.loadTracks(withMediaType: .audio)
            try Task.checkCancellation()
            guard !audioTracks.isEmpty else {
                throw EngineError.internalError(
                    "MP4 file has no decodable audio track: \(sourceURL.lastPathComponent)")
            }
            guard
                let exporter = AVAssetExportSession(
                    asset: asset, presetName: AVAssetExportPresetAppleM4A)
            else {
                throw EngineError.internalError(
                    "MP4 audio is not supported: \(sourceURL.lastPathComponent)")
            }

            return try await exportAudio(exporter, sourceURL: sourceURL, temporaryParent: temporaryParent)
        } catch let error as CancellationError {
            throw error
        } catch let error as EngineError {
            throw error
        } catch {
            throw EngineError.internalError(
                "Could not decode an audio track from \(sourceURL.lastPathComponent): "
                    + error.localizedDescription)
        }
    }

    static func exportAudio(
        _ exporter: AVAssetExportSession, sourceURL: URL, temporaryParent: URL
    ) async throws -> PreparedAudioFile {
        let directory = temporaryParent.appendingPathComponent(
            "doodlenote-import-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true)
        let outputURL = directory.appendingPathComponent("audio.m4a")
        do {
            try await AudioExport(exporter).run(to: outputURL)
            let file = try AVAudioFile(forReading: outputURL)
            guard file.length > 0 else {
                throw EngineError.internalError(
                    "MP4 file has no decodable audio track: \(sourceURL.lastPathComponent)")
            }
            return PreparedAudioFile(url: outputURL, temporaryDirectory: directory)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}

/// One export per instance. Use the callback API supported by macOS 14, and
/// wait for its terminal callback before callers clean up temporary files.
final class AudioExport: @unchecked Sendable {
    private let session: AVAssetExportSession
    private let lock = NSLock()
    private var started = false
    private var canceled = false

    init(_ session: AVAssetExportSession) {
        self.session = session
    }

    func run(to outputURL: URL) async throws {
        // The legacy setter raises an Objective-C exception for unsupported
        // types; reject them through Swift's error path so cleanup still runs.
        guard session.supportedFileTypes.contains(.m4a) else {
            throw EngineError.internalError("Audio export does not support M4A")
        }
        session.outputURL = outputURL
        session.outputFileType = .m4a
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { start($0) }
            try Task.checkCancellation()
        } onCancel: {
            self.cancel()
        }
    }

    func start(_ continuation: CheckedContinuation<Void, Error>) {
        lock.lock()
        defer { lock.unlock() }
        guard !canceled else {
            continuation.resume(throwing: CancellationError())
            return
        }
        started = true
        session.exportAsynchronously { [session] in
            switch session.status {
            case .completed:
                continuation.resume()
            case .cancelled:
                continuation.resume(throwing: CancellationError())
            default:
                continuation.resume(throwing: session.error ?? EngineError.internalError(
                    "Audio export did not complete (status \(session.status.rawValue))"))
            }
        }
    }

    func cancel() {
        // Serialize with start: cancelExport before exportAsynchronously would
        // otherwise be lost. Only the completion callback resumes a started job.
        lock.lock()
        defer { lock.unlock() }
        canceled = true
        if started { session.cancelExport() }
    }
}

struct PreparedAudioFile {
    let url: URL
    let temporaryDirectory: URL?

    func removeTemporaryFiles() {
        guard let temporaryDirectory else { return }
        try? FileManager.default.removeItem(at: temporaryDirectory)
    }
}
