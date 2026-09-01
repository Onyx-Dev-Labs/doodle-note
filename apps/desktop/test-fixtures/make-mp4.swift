import AVFoundation
import CoreVideo
import Foundation

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: swift make-mp4.swift <output.mp4> [audio-file]\n", stderr)
    exit(64)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let audioURL = CommandLine.arguments.count >= 3
    ? URL(fileURLWithPath: CommandLine.arguments[2]) : nil
let durationSeconds: Double
if let audioURL {
    let audio = try AVAudioFile(forReading: audioURL)
    durationSeconds = max(1, Double(audio.length) / audio.processingFormat.sampleRate)
} else {
    durationSeconds = 1
}
let duration = CMTime(seconds: durationSeconds, preferredTimescale: 600)

let tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
    "doodlenote-mp4-fixture-\(UUID().uuidString)", isDirectory: true)
try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tempDirectory) }
let videoOnlyURL = tempDirectory.appendingPathComponent("video-only.mp4")

let writer = try AVAssetWriter(outputURL: videoOnlyURL, fileType: .mp4)
let videoInput = AVAssetWriterInput(
    mediaType: .video,
    outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: 320,
        AVVideoHeightKey: 240,
    ])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: videoInput,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: 320,
        kCVPixelBufferHeightKey as String: 240,
    ])
guard writer.canAdd(videoInput) else { throw NSError(domain: "fixture", code: 1) }
writer.add(videoInput)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "fixture", code: 2) }
writer.startSession(atSourceTime: .zero)
guard let pool = adaptor.pixelBufferPool else { throw NSError(domain: "fixture", code: 3) }

let finalFrame = max(2, Int(ceil(durationSeconds * 2)))
for frame in 0...finalFrame {
    while !videoInput.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 1_000_000) }
    var pixelBuffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess,
        let pixelBuffer
    else { throw NSError(domain: "fixture", code: 4) }
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    if let base = CVPixelBufferGetBaseAddress(pixelBuffer) {
        memset(base, 0, CVPixelBufferGetBytesPerRow(pixelBuffer) * 240)
    }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
    guard adaptor.append(
        pixelBuffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 2))
    else { throw writer.error ?? NSError(domain: "fixture", code: 5) }
}
videoInput.markAsFinished()
let writeFinished = DispatchSemaphore(value: 0)
writer.finishWriting { writeFinished.signal() }
writeFinished.wait()
guard writer.status == .completed else {
    throw writer.error ?? NSError(domain: "fixture", code: 6)
}

try? FileManager.default.removeItem(at: outputURL)
guard let audioURL else {
    try FileManager.default.moveItem(at: videoOnlyURL, to: outputURL)
    exit(0)
}

let videoAsset = AVURLAsset(url: videoOnlyURL)
let audioAsset = AVURLAsset(url: audioURL)
guard let sourceVideo = try await videoAsset.loadTracks(withMediaType: .video).first,
    let sourceAudio = try await audioAsset.loadTracks(withMediaType: .audio).first
else { throw NSError(domain: "fixture", code: 7) }
let composition = AVMutableComposition()
guard let videoTrack = composition.addMutableTrack(
    withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
    let audioTrack = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
else { throw NSError(domain: "fixture", code: 8) }
try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: sourceVideo, at: .zero)
try audioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: sourceAudio, at: .zero)

guard let exporter = AVAssetExportSession(
    asset: composition, presetName: AVAssetExportPresetHighestQuality)
else { throw NSError(domain: "fixture", code: 9) }
exporter.timeRange = CMTimeRange(start: .zero, duration: duration)
try await exporter.export(to: outputURL, as: .mp4)
