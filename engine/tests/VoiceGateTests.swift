// Run from the repository root:
// swiftc -parse-as-library engine/Sources/engine/VoiceGate.swift \
//   engine/tests/VoiceGateTests.swift -o /tmp/doodle-voice-gate-tests && /tmp/doodle-voice-gate-tests
import Foundation

/// Stands in for the speaker models. Who is talking is read from the sample
/// values (`me` and `other` amplitudes below), so a sliding window sees what the
/// real segmentation would: the same voices at the same times.
private final class FakeModels: VoiceAnalyzing {
    static let frames = 500  // 20ms frames across the ten-second window
    static let judgeFrames = 40  // 0.8s of speech before a voice can be judged
    static let me: Float = 0.5
    static let other: Float = 0.05

    var otherDistance: Float = 0.9
    var meDistance: Float = 0.2
    var failing = false
    var looks = 0

    struct Broken: Error {}

    func analyze(_ samples: ArraySlice<Float>) throws -> VoiceWindow {
        looks += 1
        if failing { throw Broken() }
        let perFrame = VoiceGate.windowSamples / Self.frames
        var mine = [Bool](repeating: false, count: Self.frames)
        var theirs = [Bool](repeating: false, count: Self.frames)
        for frame in 0..<Self.frames {
            let index = samples.startIndex + frame * perFrame
            guard index < samples.endIndex else { break }
            mine[frame] = samples[index] == Self.me
            theirs[frame] = samples[index] == Self.other
        }
        func distance(_ active: [Bool], _ value: Float) -> Float? {
            active.filter { $0 }.count >= Self.judgeFrames ? value : nil
        }
        return VoiceWindow(
            frameCount: Self.frames,
            speakers: [
                .init(active: mine, distance: distance(mine, meDistance)),
                .init(active: theirs, distance: distance(theirs, otherDistance)),
            ])
    }
}

private func audio(_ parts: [(Float, Double)]) -> [Float] {
    parts.flatMap { value, seconds in
        [Float](repeating: value, count: Int(seconds * Double(VoiceGate.sampleRate)))
    }
}

/// Push in 100ms buffers, as capture does, then finish.
private func run(_ gate: VoiceGate, _ input: [Float]) -> [Float] {
    var output: [Float] = []
    var offset = 0
    while offset < input.count {
        let end = min(input.count, offset + 1_600)
        output.append(contentsOf: gate.push(Array(input[offset..<end])))
        offset = end
    }
    output.append(contentsOf: gate.finish())
    return output
}

private let quiet: Float = 0
private let me = FakeModels.me
private let other = FakeModels.other

@main
struct VoiceGateTests {
    static func main() {
        // The user's own speech comes out exactly as it went in.
        do {
            let input = audio([(quiet, 0.3), (me, 3), (quiet, 0.4), (me, 2), (quiet, 0.3)])
            let gate = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: nil)
            precondition(run(gate, input) == input, "own speech must pass unchanged")
            precondition(gate.stats.droppedMs == 0 && gate.stats.keptMs > 4_800)
        }

        // Someone else's speech is silenced; the timeline keeps its length.
        do {
            let input = audio([(quiet, 0.3), (me, 2), (quiet, 0.5), (other, 2), (quiet, 0.5), (me, 2), (quiet, 0.3)])
            let gate = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: nil)
            let output = run(gate, input)
            precondition(output.count == input.count, "silenced, not cut")
            precondition(!output.contains(other), "the other voice must not reach the recognizer")
            precondition(output.filter { $0 == me }.count == input.filter { $0 == me }.count)
            precondition(gate.stats.droppedMs > 1_900 && gate.stats.droppedMs < 2_100)
        }

        // A session where only the other person talks yields silence.
        do {
            let input = audio([(quiet, 0.4), (other, 3), (quiet, 0.4)])
            let gate = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: nil)
            let output = run(gate, input)
            precondition(output.allSatisfy { $0 == 0 } && output.count == input.count)
            precondition(gate.stats.keptMs == 0)
        }

        // Speech too short to judge is held while it is still going, then
        // released once there is enough of it to recognise the user.
        do {
            let models = FakeModels()
            let gate = VoiceGate(analyzer: models, enrolledLevelDb: nil)
            var output: [Float] = []
            let input = audio([(quiet, 0.2), (me, 0.5)])
            var offset = 0
            while offset < input.count {
                output.append(contentsOf: gate.push(Array(input[offset..<min(input.count, offset + 1_600)])))
                offset += 1_600
            }
            precondition(models.looks > 0 && !output.contains(me), "undecided speech must wait")
            output.append(contentsOf: run(gate, audio([(me, 1.5), (quiet, 0.2)])))
            precondition(output == input + audio([(me, 1.5), (quiet, 0.2)]))
        }

        // A short remark nobody can identify: kept when nothing says otherwise,
        // dropped when it is far quieter than the user is known to be.
        do {
            let input = audio([(quiet, 0.3), (other, 0.4), (quiet, 0.3)])
            let unknown = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: nil)
            precondition(run(unknown, input) == input, "without evidence, keep")
            let enrolled = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: -6)
            precondition(run(enrolled, input).allSatisfy { $0 == 0 }, "20dB under the user's level is not the user")
            let loud = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: -6)
            let own = audio([(quiet, 0.3), (me, 0.4), (quiet, 0.3)])
            precondition(run(loud, own) == own, "the user's own short remark stays")
        }

        // A voice that could be either is settled by loudness, and without a
        // level by the nearer threshold.
        do {
            let input = audio([(quiet, 0.3), (other, 2), (quiet, 0.3)])
            let models = FakeModels()
            models.otherDistance = 0.7
            let gate = VoiceGate(analyzer: models, enrolledLevelDb: -6)
            precondition(run(gate, input).allSatisfy { $0 == 0 })
            let near = FakeModels()
            near.otherDistance = 0.62
            precondition(run(VoiceGate(analyzer: near, enrolledLevelDb: nil), input) == input)
            let far = FakeModels()
            far.otherDistance = 0.72
            precondition(run(VoiceGate(analyzer: far, enrolledLevelDb: nil), input).allSatisfy { $0 == 0 })
        }

        // The user's level learned in this session judges later doubtful speech.
        do {
            let models = FakeModels()
            models.otherDistance = 0.7
            let input = audio([(quiet, 0.3), (me, 2), (quiet, 0.5), (other, 2), (quiet, 0.3)])
            let output = run(VoiceGate(analyzer: models, enrolledLevelDb: nil), input)
            precondition(!output.contains(other) && output.contains(me))
        }

        // A model failure never costs the user their words: audio passes
        // through, and repeated failures switch the gate off for the session.
        do {
            let models = FakeModels()
            models.failing = true
            let gate = VoiceGate(analyzer: models, enrolledLevelDb: nil)
            let input = audio([(quiet, 0.3), (other, 3), (me, 3), (quiet, 0.3)])
            precondition(run(gate, input) == input)
            precondition(gate.stats.failures == 3 && models.looks == 3, "stops trying after three failures")
        }

        // Longer than one analysis window, in odd-sized buffers: nothing lost,
        // nothing duplicated, the right parts silenced.
        do {
            let input = audio([
                (quiet, 0.5), (me, 6), (quiet, 0.7), (other, 4), (quiet, 0.6), (me, 5), (quiet, 0.5), (other, 3),
                (quiet, 0.4), (me, 4), (quiet, 0.3),
            ])
            let gate = VoiceGate(analyzer: FakeModels(), enrolledLevelDb: nil)
            var output: [Float] = []
            var offset = 0
            var size = 777
            while offset < input.count {
                let end = min(input.count, offset + size)
                output.append(contentsOf: gate.push(Array(input[offset..<end])))
                offset = end
                size = size % 3_000 + 911
            }
            output.append(contentsOf: gate.finish())
            precondition(output.count == input.count)
            precondition(!output.contains(other))
            precondition(output.filter { $0 == me }.count == input.filter { $0 == me }.count)
            precondition(gate.finish().isEmpty, "finishing twice releases nothing more")
        }

        print("voice gate tests passed")
    }
}
