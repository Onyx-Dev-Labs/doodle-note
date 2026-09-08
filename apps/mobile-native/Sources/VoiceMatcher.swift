import AVFoundation
import Foundation

/// Conservative open-set matching. Thresholds follow the feasibility proposal and are not a
/// physical-device accuracy claim; unknown and close scores abstain rather than guess.
enum VoiceMatcher {
    static let acceptCosine: Float = 0.82
    static let minMargin: Float = 0.10
    static let minSoloSeconds: TimeInterval = 2
    static let embeddingDimension = 32

    enum Decision: Equatable, Sendable {
        case identified(UUID)
        case unknown
        case uncertain
    }

    static func cosine(_ left: [Float], _ right: [Float]) -> Float? {
        guard left.count == right.count, left.count == embeddingDimension else { return nil }
        var dot: Float = 0, leftNorm: Float = 0, rightNorm: Float = 0
        for index in left.indices {
            dot += left[index] * right[index]
            leftNorm += left[index] * left[index]
            rightNorm += right[index] * right[index]
        }
        let denominator = sqrt(leftNorm) * sqrt(rightNorm)
        guard denominator > 1e-8 else { return nil }
        return dot / denominator
    }

    static func decide(probe: [Float], candidates: [VoiceProfile]) -> Decision {
        let scored = candidates.compactMap { profile -> (UUID, Float)? in
            guard let score = cosine(probe, profile.embedding) else { return nil }
            return (profile.id, score)
        }.sorted { $0.1 > $1.1 }
        guard let best = scored.first else { return .unknown }
        let second = scored.dropFirst().first?.1 ?? -1
        if best.1 >= acceptCosine && best.1 - second >= minMargin { return .identified(best.0) }
        if best.1 >= acceptCosine || (best.1 >= acceptCosine - 0.05 && best.1 - second < minMargin) {
            return .uncertain
        }
        return .unknown
    }
}

enum VoicePrint {
    static func embedding(_ samples: [Float]) -> [Float]? {
        let frame = 512
        guard samples.count >= frame else { return nil }
        var bins = [Float](repeating: 0, count: VoiceMatcher.embeddingDimension)
        var offset = 0
        var frames = 0
        while offset + frame <= samples.count {
            for bin in 0..<VoiceMatcher.embeddingDimension {
                let start = bin * frame / VoiceMatcher.embeddingDimension
                let end = (bin + 1) * frame / VoiceMatcher.embeddingDimension
                var energy: Float = 0
                for index in start..<end {
                    let sample = samples[offset + index]
                    energy += sample * sample
                }
                bins[bin] += energy
            }
            offset += frame / 2
            frames += 1
        }
        guard frames > 0 else { return nil }
        let total = bins.reduce(0, +)
        guard total > 1e-6 else { return nil }
        let logs = bins.map { log(1 + $0 / total) }
        return normalize(logs)
    }

    static func normalize(_ values: [Float]) -> [Float]? {
        guard values.count == VoiceMatcher.embeddingDimension else { return nil }
        let norm = sqrt(values.reduce(0) { $0 + $1 * $1 })
        guard norm > 1e-8 else { return nil }
        return values.map { $0 / norm }
    }

    static func samples(plan: AudioTimeline.Plan, intervals: [(TimeInterval, TimeInterval)]) throws -> [Float] {
        var collected: [Float] = []
        for (start, end) in intervals where end > start {
            var cursor = start
            while cursor < end - 0.000_5 {
                let (index, offset) = try plan.resolve(cursor)
                let segment = plan.segments[index]
                guard segment.available else { throw AudioTimeline.Failure.unavailable }
                let available = min(end, segment.end) - cursor
                collected += try read(segment.url, from: offset, duration: available)
                cursor += available
            }
        }
        return collected
    }

    private static func read(_ url: URL, from offset: TimeInterval, duration: TimeInterval) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let rate = file.processingFormat.sampleRate
        let startFrame = AVAudioFramePosition((offset * rate).rounded(.down))
        let frames = AVAudioFrameCount(max(0, (duration * rate).rounded(.down)))
        guard startFrame >= 0, startFrame < file.length, frames > 0 else { return [] }
        file.framePosition = startFrame
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else {
            throw AudioTimeline.Failure.unavailable
        }
        try file.read(into: buffer, frameCount: min(frames, AVAudioFrameCount(file.length - startFrame)))
        let converter = SpeakerPCMConverter()
        var samples = try converter.convert(buffer)
        samples += try converter.finish()
        return samples
    }
}

enum SpeakerEnrollment {
    /// Final, non-overlapping stretches long enough to enroll or match. Overlap stays unknown.
    static func soloFinalIntervals(for key: String, annotations: SpeakerAnnotations) -> [(TimeInterval, TimeInterval)] {
        let mine = annotations.turns.filter { $0.key == key && $0.isFinal }
        let others = annotations.turns.filter { $0.key != key }
        var result: [(TimeInterval, TimeInterval)] = []
        for turn in mine {
            let coverage = SpeakerAttribution.coverage(turns: others, start: turn.start, end: turn.end)
            let overlap = coverage.values.reduce(0, +)
            let duration = turn.end - turn.start
            guard duration > 0, overlap / duration < SpeakerAttribution.overlapFloor else { continue }
            result.append((turn.start, turn.end))
        }
        return result
    }

    static func soloFinalDuration(for key: String, annotations: SpeakerAnnotations) -> TimeInterval {
        soloFinalIntervals(for: key, annotations: annotations).reduce(0) { $0 + ($1.1 - $1.0) }
    }

    static func canEnroll(key: String, annotations: SpeakerAnnotations) -> Bool {
        soloFinalDuration(for: key, annotations: annotations) >= VoiceMatcher.minSoloSeconds
            && annotations.turns.contains { $0.key == key && $0.isFinal }
    }
}
