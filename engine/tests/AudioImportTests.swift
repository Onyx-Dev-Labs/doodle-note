// Run with engine/tests/test-audio-import.sh. Synthetic media only; no ASR models.
import AVFoundation
import Foundation

@main
struct AudioImportTests {
    static func main() async throws {
        setbuf(stdout, nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let scratch = root.appendingPathComponent("imports")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        let wav = root.appendingPathComponent("tone.wav")
        try makeTone(wav)
        let original = try Data(contentsOf: wav)

        let direct = try await AudioFilePreparation.prepare(wav, temporaryParent: scratch)
        precondition(direct.url == wav && direct.temporaryDirectory == nil)
        direct.removeTemporaryFiles()
        expect(try Data(contentsOf: wav) == original)
        print("PASS: WAV remains readable and source is retained")

        let video = root.appendingPathComponent("video.mp4")
        let silent = root.appendingPathComponent("silent.mp4")
        try await makeVideo(silent)
        try await addAudio(wav, to: silent, output: video)
        let videoBytes = try Data(contentsOf: video)
        let importedVideo = try await AudioFilePreparation.prepare(video, temporaryParent: scratch)
        expect(try AVAudioFile(forReading: importedVideo.url).length > 0)
        importedVideo.removeTemporaryFiles()
        // Newer AVAudioFile versions can read this MP4 directly. Also exercise
        // the actual fallback explicitly, independent of the host decoder.
        let prepared = try await AudioFilePreparation.normalizeMP4(video, temporaryParent: scratch)
        precondition(prepared.temporaryDirectory != nil && prepared.url != video)
        try await checkAudio(prepared.url)
        prepared.removeTemporaryFiles()
        prepared.removeTemporaryFiles()
        precondition(!FileManager.default.fileExists(atPath: prepared.url.path))
        expect(try Data(contentsOf: video) == videoBytes)
        try assertEmpty(scratch)
        print("PASS: video exports decodable audio-only M4A, cleanup is idempotent, source is retained")

        let m4a = root.appendingPathComponent("tone.m4a")
        try await AudioExport(session(wav)).run(to: m4a)
        let directM4A = try await AudioFilePreparation.prepare(m4a, temporaryParent: scratch)
        precondition(directM4A.url == m4a && directM4A.temporaryDirectory == nil)
        try await checkAudio(m4a)
        print("PASS: M4A remains a direct audio import")

        let corrupt = root.appendingPathComponent("corrupt.mp4")
        try Data("not media".utf8).write(to: corrupt)
        for source in [silent, corrupt, root.appendingPathComponent("missing.wav")] {
            do {
                _ = try await AudioFilePreparation.prepare(source, temporaryParent: scratch)
                fatalError("invalid import succeeded")
            } catch {
                precondition(error is EngineError || source.pathExtension == "wav")
            }
            try assertEmpty(scratch)
        }
        print("PASS: silent video, corrupt MP4 and missing audio fail without temporary leftovers")

        // The exporter must not report success merely because its callback fired.
        let failed = session(wav)
        do {
            try await AudioExport(failed).run(to: root.appendingPathComponent("missing/audio.m4a"))
            fatalError("unwritable output succeeded")
        } catch {
            precondition(failed.status == .failed)
            let actual = error as NSError
            let expected = failed.error! as NSError
            precondition(actual.domain == expected.domain && actual.code == expected.code)
        }
        print("PASS: failed export throws the AVFoundation error")

        let incompatible = AVAssetExportSession(
            asset: AVURLAsset(url: silent), presetName: AVAssetExportPresetPassthrough)!
        do {
            _ = try await AudioFilePreparation.exportAudio(
                incompatible, sourceURL: silent, temporaryParent: scratch)
            fatalError("video-only passthrough to M4A succeeded")
        } catch {}
        precondition(incompatible.outputURL != nil && incompatible.status == .failed)
        try assertEmpty(scratch)

        let unsupported = AVAssetExportSession(
            asset: AVURLAsset(url: video), presetName: AVAssetExportPresetHighestQuality)!
        precondition(!unsupported.supportedFileTypes.contains(.m4a))
        do {
            _ = try await AudioFilePreparation.exportAudio(
                unsupported, sourceURL: video, temporaryParent: scratch)
            fatalError("unsupported output type succeeded")
        } catch let error as EngineError {
            precondition(error.message == "Audio export does not support M4A")
        }
        precondition(unsupported.status == .unknown)
        try assertEmpty(scratch)

        let taskCanceledSession = session(wav)
        let exportTask = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await AudioFilePreparation.exportAudio(
                taskCanceledSession, sourceURL: wav, temporaryParent: scratch)
        }
        do {
            _ = try await exportTask.value
            fatalError("canceled export succeeded")
        } catch is CancellationError {}
        // outputURL is assigned after directory creation, before cancellation
        // is acknowledged. This checks the actual temporary-file cleanup path.
        precondition(taskCanceledSession.outputURL != nil && taskCanceledSession.status == .unknown)
        try assertEmpty(scratch)
        print("PASS: export failure and task cancellation clean up after directory creation")

        let beforeStart = session(wav)
        let canceled = AudioExport(beforeStart)
        canceled.cancel()
        do {
            try await canceled.run(to: root.appendingPathComponent("pre-cancel.m4a"))
            fatalError("pre-canceled export succeeded")
        } catch is CancellationError {}
        precondition(beforeStart.status == .unknown)
        precondition(!FileManager.default.fileExists(atPath: root.appendingPathComponent("pre-cancel.m4a").path))

        // Synchronous start/cancel exercises the boundary without timing sleeps.
        let activeSession = session(wav)
        activeSession.outputURL = root.appendingPathComponent("active-cancel.m4a")
        activeSession.outputFileType = .m4a
        let active = AudioExport(activeSession)
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                active.start(continuation)
                active.cancel()
            }
            fatalError("active cancellation succeeded")
        } catch is CancellationError {}
        precondition(activeSession.status == .cancelled)
        // Completion has been acknowledged, so callers may now remove partial files.
        try? FileManager.default.removeItem(at: activeSession.outputURL!)
        active.cancel() // A late cancellation must not resume the continuation twice.
        print("PASS: pre-start and active cancellation finish exactly once")

        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await AudioFilePreparation.prepare(video, temporaryParent: scratch)
        }
        do {
            _ = try await task.value
            fatalError("canceled import succeeded")
        } catch is CancellationError {}
        try assertEmpty(scratch)
        let retry = try await AudioFilePreparation.normalizeMP4(video, temporaryParent: scratch)
        try await checkAudio(retry.url)
        retry.removeTemporaryFiles()
        try assertEmpty(scratch)
        print("PASS: task cancellation propagates and a subsequent import succeeds")
    }

    static func expect(_ condition: Bool) { precondition(condition) }

    static func session(_ source: URL) -> AVAssetExportSession {
        AVAssetExportSession(asset: AVURLAsset(url: source), presetName: AVAssetExportPresetAppleM4A)!
    }

    static func assertEmpty(_ directory: URL) throws {
        expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    }

    static func checkAudio(_ url: URL) async throws {
        let audio = try AVAudioFile(forReading: url)
        precondition(audio.length > 0 && audio.processingFormat.channelCount == 2)
        let seconds = Double(audio.length) / audio.processingFormat.sampleRate
        precondition(abs(seconds - 2) < 0.2)
        let asset = AVURLAsset(url: url)
        let videos = try await asset.loadTracks(withMediaType: .video)
        precondition(videos.isEmpty)
    }

    static func makeTone(_ url: URL) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let file = try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        ], commonFormat: .pcmFormatFloat32, interleaved: false)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 88200)!
        buffer.frameLength = buffer.frameCapacity
        for channel in 0..<2 {
            for frame in 0..<Int(buffer.frameLength) {
                buffer.floatChannelData![channel][frame] = Float(sin(Double(frame) * 2 * .pi * Double(440 + channel * 220) / 44100)) * 0.1
            }
        }
        try file.write(from: buffer)
    }

    static func makeVideo(_ url: URL) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 32, AVVideoHeightKey: 32,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 32, kCVPixelBufferHeightKey as String: 32,
        ])
        writer.add(input)
        precondition(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        for frame in 0...4 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
            var pixel: CVPixelBuffer?
            precondition(CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pixel) == kCVReturnSuccess)
            CVPixelBufferLockBaseAddress(pixel!, [])
            memset(CVPixelBufferGetBaseAddress(pixel!)!, 0, CVPixelBufferGetDataSize(pixel!))
            CVPixelBufferUnlockBaseAddress(pixel!, [])
            precondition(adaptor.append(pixel!, withPresentationTime: CMTime(value: Int64(frame), timescale: 2)))
        }
        input.markAsFinished()
        await withCheckedContinuation { continuation in writer.finishWriting { continuation.resume() } }
        precondition(writer.status == .completed)
    }

    static func addAudio(_ audio: URL, to video: URL, output: URL) async throws {
        let composition = AVMutableComposition()
        for (url, media) in [(video, AVMediaType.video), (audio, AVMediaType.audio)] {
            let asset = AVURLAsset(url: url)
            let source = try await asset.loadTracks(withMediaType: media)[0]
            let track = composition.addMutableTrack(withMediaType: media, preferredTrackID: kCMPersistentTrackID_Invalid)!
            try withExtendedLifetime(asset) {
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: CMTime(seconds: 2, preferredTimescale: 600)), of: source, at: .zero)
            }
        }
        let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality)!
        exporter.outputURL = output
        exporter.outputFileType = .mp4
        await withCheckedContinuation { continuation in
            exporter.exportAsynchronously { continuation.resume() }
        }
        precondition(exporter.status == .completed)
    }
}
