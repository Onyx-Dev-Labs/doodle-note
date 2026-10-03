import AVFoundation
import Speech

struct SavedSpeechGroup: Sendable {
    var segments: [AudioTimeline.Segment]
    let language: SpokenLanguage
    let sessionID: UUID?
    var start: Double { segments[0].start }
    var end: Double { segments.last!.end }
    static func make(plan: AudioTimeline.Plan, sessions: [RecordingSpeechSession], fallback: SpokenLanguage) throws -> [SavedSpeechGroup] {
        guard Set(sessions.map(\.id)).count == sessions.count else { throw TranscriptFailure.incomplete }
        for (index, session) in sessions.enumerated() {
            guard session.start.isFinite, session.start >= 0,
                  session.end == nil || (session.end!.isFinite && session.end! >= session.start),
                  index == 0 || session.start >= (sessions[index - 1].end ?? sessions[index - 1].start) else { throw TranscriptFailure.incomplete }
        }
        var groups: [SavedSpeechGroup] = []
        for segment in plan.segments where segment.available {
            let sessionIndex = sessions.indices.last { sessions[$0].start <= segment.start + 0.001 }
            let session = sessionIndex.map { sessions[$0] }
            if let sessionIndex {
                let boundary = sessions[sessionIndex].end ?? (sessionIndex + 1 < sessions.count ? sessions[sessionIndex + 1].start : .infinity)
                guard segment.end <= boundary + 0.001 else { throw TranscriptFailure.incomplete }
            } else if !sessions.isEmpty { throw TranscriptFailure.incomplete }
            let language = session?.language ?? fallback
            if let last = groups.last, last.language == language, last.sessionID == session?.id, abs(last.end - segment.start) < 0.001 {
                groups[groups.count - 1].segments.append(segment)
            } else { groups.append(.init(segments: [segment], language: language, sessionID: session?.id)) }
        }
        return groups
    }
}

private final class ReplaySupply: @unchecked Sendable {
    let input: AVAudioPCMBuffer
    private var used = false
    init(_ input: AVAudioPCMBuffer) { self.input = input }
    func take(_ status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        if used { status.pointee = .noDataNow; return nil }
        used = true; status.pointee = .haveData; return input
    }
}

/// Pull-based bounded conversion: one second of input and one output buffer, never an entire meeting.
/// Converter state survives five-second CAF boundaries. Group-relative timestamps do not use wall time.
actor SavedAudioInput {
    let group: SavedSpeechGroup
    let outputFormat: AVAudioFormat
    private var index = 0
    private var file: AVAudioFile?
    private var inputFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var outputFrames: Int64 = 0
    private var flushed = false
    init(group: SavedSpeechGroup, outputFormat: AVAudioFormat) { self.group = group; self.outputFormat = outputFormat }
    func next() throws -> AnalyzerInput? {
        try Task.checkCancellation()
        while index < group.segments.count {
            if file == nil {
                let opened = try AVAudioFile(forReading: group.segments[index].url)
                if let inputFormat, opened.processingFormat != inputFormat { throw TranscriptFailure.incomplete }
                inputFormat = opened.processingFormat
                if converter == nil && opened.processingFormat != outputFormat {
                    converter = AVAudioConverter(from: opened.processingFormat, to: outputFormat)
                    converter?.primeMethod = .none
                    guard converter != nil else { throw CaptureError.conversion }
                }
                file = opened
            }
            let source = file!
            if source.framePosition >= source.length { file = nil; index += 1; continue }
            guard let input = AVAudioPCMBuffer(pcmFormat: source.processingFormat, frameCapacity: AVAudioFrameCount(source.processingFormat.sampleRate)) else { throw CaptureError.conversion }
            try source.read(into: input)
            if input.frameLength == 0 { file = nil; index += 1; continue }
            if let converter {
                let supply = ReplaySupply(input)
                let output = try converted(converter, capacity: AVAudioFrameCount(ceil(Double(input.frameLength) * outputFormat.sampleRate / input.format.sampleRate)) + 64) { _, status in supply.take(status) }
                if output.frameLength > 0 { return packet(output) }
            } else { return packet(input) }
        }
        if !flushed, let converter {
            let output = try converted(converter, capacity: 4096) { _, status in status.pointee = .endOfStream; return nil }
            if output.frameLength > 0 { return packet(output) }
        }
        flushed = true
        guard abs(Double(outputFrames) - (group.end - group.start) * outputFormat.sampleRate) <= 1 else { throw TranscriptFailure.incomplete }
        return nil
    }
    private func packet(_ buffer: AVAudioPCMBuffer) -> AnalyzerInput? {
        // Converter flush can emit filter-padding samples beyond the source endpoint.
        // Keep the exact source duration instead of accumulating that tail at every group.
        let remaining = Int64(((group.end - group.start) * outputFormat.sampleRate).rounded()) - outputFrames
        guard remaining > 0 else { flushed = true; return nil }
        buffer.frameLength = AVAudioFrameCount(min(Int64(buffer.frameLength), remaining))
        let time = CMTime(seconds: Double(outputFrames) / outputFormat.sampleRate, preferredTimescale: 1_000_000_000)
        outputFrames += Int64(buffer.frameLength)
        return AnalyzerInput(buffer: buffer, bufferStartTime: time)
    }
    private func converted(_ converter: AVAudioConverter, capacity: AVAudioFrameCount,
                           supply: @escaping AVAudioConverterInputBlock) throws -> AVAudioPCMBuffer {
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { throw CaptureError.conversion }
        var error: NSError?
        let status = converter.convert(to: output, error: &error, withInputFrom: supply)
        if let error { throw error }
        guard status != .error else { throw CaptureError.conversion }
        return output
    }
}
