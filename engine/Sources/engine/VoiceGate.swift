import Foundation

/// What the speaker models saw in one look at the recent audio.
struct VoiceWindow {
    /// Frames across the full analysis window (`VoiceGate.windowSamples`), even
    /// when less audio than that was given.
    var frameCount: Int
    /// Up to three voices the segmentation model told apart in this window.
    var speakers: [Speaker]

    struct Speaker {
        /// Per frame: this voice is talking.
        var active: [Bool]
        /// Cosine distance to the enrolled voice (0 = identical). Nil when there
        /// was too little clean speech from this voice to tell voices apart.
        var distance: Float?
    }
}

protocol VoiceAnalyzing {
    /// `samples`: 16 kHz mono, at most `VoiceGate.windowSamples` long.
    func analyze(_ samples: ArraySlice<Float>) throws -> VoiceWindow
}

/// "Only my voice" for dictation: sits between the microphone and the
/// recognizer and silences speech that is not the enrolled voice, so a
/// colleague talking nearby never reaches the transcript.
///
/// Audio is held back just long enough to be judged (about half a second, a
/// little longer at the very start of an utterance), then released with other
/// people's speech replaced by silence. Silence rather than a cut, so the
/// recognizer's sense of pauses and its token timeline stay intact.
///
/// Two signals decide: the voice itself (distance to the enrolled embedding)
/// and, for speech too short or too close to call, loudness — the person at the
/// microphone is much louder than someone across the room. When neither can
/// tell, the audio is kept: losing the user's own words is the worse failure.
///
/// Not thread-safe; one caller at a time (the channel's consume task).
final class VoiceGate {
    static let sampleRate = 16_000
    static let windowSamples = 160_000

    struct Config {
        /// New audio between looks.
        var hop = 8_000
        /// The newest audio waits for the next look: the model has no right
        /// context there yet.
        var tailGuard = 2_560
        /// At or under this distance the voice is the enrolled one.
        var accept: Float = 0.60
        /// At or over this distance it is someone else.
        var reject: Float = 0.75
        /// How far under the user's own level (dB) a doubtful voice may be and
        /// still be kept.
        var levelMargin: Float = 10
        /// Longest that undecided speech is held waiting for more of it.
        var maxHold = 24_000
        /// A voice still talking this close to the newest audio (frames) may
        /// be about to give enough speech to judge.
        var stillTalkingFrames = 18
        /// Shorter activity than this is a click or a breath, not speech.
        var minSpeechFrames = 6
        /// Silence either side of rejected speech that goes with it (frames).
        var dropPadFrames = 3
        /// Consecutive model failures before the gate steps aside for the session.
        var maxFailures = 3
    }

    struct Stats {
        var keptSpeechSamples = 0
        var droppedSpeechSamples = 0
        var failures = 0
        /// Closest and farthest judged voices, for tuning the thresholds.
        var minDistance: Float?
        var maxDistance: Float?

        var keptMs: Int { keptSpeechSamples * 1000 / VoiceGate.sampleRate }
        var droppedMs: Int { droppedSpeechSamples * 1000 / VoiceGate.sampleRate }
    }

    private enum Verdict { case keep, drop, wait }
    private enum Frame { case quiet, keep, drop, pad, hold }

    private let analyzer: VoiceAnalyzing
    private let config: Config
    private let log: (String) -> Void
    /// The user's speech level: confirmed in this session, else from enrollment.
    private var ownLevelDb: Float?

    /// Audio from `historyStart` (absolute sample index) to `total`.
    private var history: [Float] = []
    private var historyStart = 0
    private var total = 0
    /// Everything before this absolute index has been handed on.
    private var released = 0
    private var lastLook = 0
    private var consecutiveFailures = 0
    private var bypassed = false

    private(set) var stats = Stats()

    /// `enrolledLevelDb`: the user's speech level at enrollment, when this
    /// session records from the same microphone (levels do not carry across
    /// microphones); nil otherwise.
    init(
        analyzer: VoiceAnalyzing,
        enrolledLevelDb: Float?,
        config: Config = Config(),
        log: @escaping (String) -> Void = { _ in }
    ) {
        self.analyzer = analyzer
        self.ownLevelDb = enrolledLevelDb
        self.config = config
        self.log = log
    }

    /// Feed captured audio; returns whatever is now ready for the recognizer
    /// (often nothing — audio comes out in half-second steps).
    func push(_ samples: [Float]) -> [Float] {
        if bypassed { return samples }
        history.append(contentsOf: samples)
        total += samples.count
        guard total - lastLook >= config.hop else { return [] }
        return look(final: false)
    }

    /// Capture ended: judge and release everything still held.
    func finish() -> [Float] {
        if bypassed || released == total { return [] }
        return look(final: true)
    }

    private func look(final: Bool) -> [Float] {
        lastLook = total
        let windowStart = max(historyStart, total - Self.windowSamples)
        let window = history[(windowStart - historyStart)..<(total - historyStart)]

        let seen: VoiceWindow
        do {
            seen = try analyzer.analyze(window)
            consecutiveFailures = 0
        } catch {
            // Never lose the user's words to a model hiccup: pass this audio
            // on untouched, and stop trying if it keeps happening.
            stats.failures += 1
            consecutiveFailures += 1
            log("voice gate: analysis failed (\(error)); audio passed through")
            if consecutiveFailures >= config.maxFailures {
                bypassed = true
                log("voice gate: off for the rest of this session")
            }
            return release(to: total, windowStart: windowStart, frames: [], samplesPerFrame: 1)
        }
        guard seen.frameCount > 0 else {
            return release(to: total, windowStart: windowStart, frames: [], samplesPerFrame: 1)
        }

        let samplesPerFrame = Double(Self.windowSamples) / Double(seen.frameCount)
        let liveFrames = min(seen.frameCount, Int((Double(window.count) / samplesPerFrame).rounded(.up)))
        let pendingFrame = max(0, Int(Double(released - windowStart) / samplesPerFrame))
        let mayWait = !final && total - released < config.maxHold

        var frames = [Frame](repeating: .quiet, count: liveFrames)
        for speaker in seen.speakers {
            let active = (0..<min(liveFrames, speaker.active.count)).filter { speaker.active[$0] }
            guard active.count >= config.minSpeechFrames, let lastActive = active.last else { continue }
            let level = Self.levelDb(of: window, frames: active, samplesPerFrame: samplesPerFrame)
            let pending = lastActive >= pendingFrame

            let verdict: Verdict
            if let distance = speaker.distance, distance.isFinite {
                if pending {
                    stats.minDistance = min(stats.minDistance ?? distance, distance)
                    stats.maxDistance = max(stats.maxDistance ?? distance, distance)
                }
                if distance <= config.accept {
                    verdict = .keep
                    ownLevelDb = level
                } else if distance >= config.reject {
                    verdict = .drop
                } else {
                    // Could be either. Loudness breaks the tie; without a
                    // reference, the nearer threshold does.
                    verdict =
                        byLevel(level)
                        ?? (distance < (config.accept + config.reject) / 2 ? .keep : .drop)
                }
                if pending, verdict == .drop {
                    log(
                        "voice gate: another voice (distance \(Self.short(distance)), "
                            + "level \(Self.short(level)) dB, yours \(ownLevelDb.map(Self.short) ?? "unknown"))")
                }
            } else if mayWait, liveFrames - 1 - lastActive <= config.stillTalkingFrames {
                // Too little speech to tell voices apart, and still talking:
                // hold it until there is enough.
                verdict = .wait
            } else {
                verdict = byLevel(level) ?? .keep
                if pending, verdict == .drop {
                    log("voice gate: quiet short speech dropped (level \(Self.short(level)) dB)")
                }
            }

            for frame in active {
                switch verdict {
                case .keep: frames[frame] = .keep
                case .wait: if frames[frame] != .keep { frames[frame] = .hold }
                case .drop: if frames[frame] == .quiet { frames[frame] = .drop }
                }
            }
        }

        // The quiet edges of rejected speech (a trailing consonant, a breath)
        // go with it, but never into anyone else's speech.
        if config.dropPadFrames > 0 {
            for frame in frames.indices where frames[frame] == .drop {
                let from = max(0, frame - config.dropPadFrames)
                let to = min(frames.count - 1, frame + config.dropPadFrames)
                for near in from...to where frames[near] == .quiet { frames[near] = .pad }
            }
        }

        var end = final ? total : total - config.tailGuard
        if let held = frames.indices.first(where: { $0 >= pendingFrame && frames[$0] == .hold }) {
            end = min(end, windowStart + Int(Double(held) * samplesPerFrame))
        }
        return release(
            to: max(end, released), windowStart: windowStart, frames: frames,
            samplesPerFrame: samplesPerFrame)
    }

    private func byLevel(_ level: Float) -> Verdict? {
        guard let own = ownLevelDb else { return nil }
        return level >= own - config.levelMargin ? .keep : .drop
    }

    /// Hand on `released..<end`, with rejected frames silenced.
    private func release(
        to end: Int, windowStart: Int, frames: [Frame], samplesPerFrame: Double
    ) -> [Float] {
        guard end > released else { return [] }
        var out = Array(history[(released - historyStart)..<(end - historyStart)])
        if !frames.isEmpty {
            let firstFrame = max(0, Int(Double(released - windowStart) / samplesPerFrame))
            for frame in firstFrame..<frames.count {
                let from = max(released, windowStart + Int(Double(frame) * samplesPerFrame))
                let to = min(end, windowStart + Int(Double(frame + 1) * samplesPerFrame))
                guard to > from else { continue }
                switch frames[frame] {
                case .keep:
                    stats.keptSpeechSamples += to - from
                case .drop, .pad:
                    if frames[frame] == .drop { stats.droppedSpeechSamples += to - from }
                    for index in (from - released)..<(to - released) { out[index] = 0 }
                case .quiet, .hold:
                    break
                }
            }
        }
        released = end
        // Keep one window of context behind the newest audio.
        let keepFrom = min(released, max(historyStart, total - Self.windowSamples))
        if keepFrom > historyStart {
            history.removeFirst(keepFrom - historyStart)
            historyStart = keepFrom
        }
        return out
    }

    /// RMS level in dBFS over the given frames of a window.
    static func levelDb(of window: ArraySlice<Float>, frames: [Int], samplesPerFrame: Double) -> Float {
        var sum: Float = 0
        var count = 0
        for frame in frames {
            let from = window.startIndex + Int(Double(frame) * samplesPerFrame)
            let to = min(window.endIndex, window.startIndex + Int(Double(frame + 1) * samplesPerFrame))
            guard to > from else { continue }
            for index in from..<to { sum += window[index] * window[index] }
            count += to - from
        }
        guard count > 0, sum > 0 else { return -120 }
        return max(-120, 10 * log10(sum / Float(count)))
    }

    private static func short(_ value: Float) -> String { String(format: "%.2f", value) }
}
